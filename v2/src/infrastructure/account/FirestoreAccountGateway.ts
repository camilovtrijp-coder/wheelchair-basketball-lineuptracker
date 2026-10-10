// Firestore-implementatie van AccountGateway (PR 8.3c-2b-i, docs/pr-8.3c-2b-plan.md
// §B.3–§B.6, §B.11, §C.1).
//
// - Identiteit uitsluitend uit `getAuth(db.app).currentUser` en de claims van het
//   ID-token (`email`, `email_verified`), nooit uit een parameter. De preflight
//   (`readIdentity()`) ververst het token altijd; de stappen daarna gebruiken dat verse
//   token uit de SDK-cache.
// - ALLE reads van de SERVER (`getDocsFromServer`/`getDocFromServer`): offline faalt een
//   read met `offline`, nooit met een leeg resultaat uit de persistente cache (§B.5).
// - Elke aanroep naar Firestore/Auth heeft een timeout van 8 s.
// - Self-deletes alleen op het eigen-uid-pad (of een eigen uitnodiging), en altijd
//   EERST teruglezen: een document dat de server niet meer kent wordt niet opnieuw
//   verwijderd (`already-gone`), want Rules weigeren een delete op een al verwijderd
//   membership of uitnodiging (A1, reviewnit #98). Na elke delete opnieuw teruglezen:
//   geen succes zonder serverbewijs.
// - Teruglezen gebeurt via dezelfde eigen-identiteit-collectionGroup-queries: een
//   directe get op het eigen pad zou na het verlies van het lidmaatschap door Rules
//   worden geweigerd (`isOrgMember`/`canReadTeam`), de queries niet.
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  type DocumentReference,
  type Firestore,
  type Query,
} from 'firebase/firestore';
import { getAuth, type User } from 'firebase/auth';
import {
  deletionRequestConverter,
  invitationConverter,
  organizationMemberConverter,
  teamMemberConverter,
} from 'firebase-base/documents';
import type {
  AccountGateway,
  AccountReadError,
  FactsReadResult,
  IdentityReadResult,
  InventoryReadResult,
  SelfDeleteError,
  SelfDeleteResult,
} from '../../application/account/AccountGateway';
import type {
  AccountInventory,
  OwnInvitationRef,
  OwnOrganizationMembershipRef,
  OwnTeamMembershipRef,
} from '../../domain/account/types';
import { firebaseErrorCode } from '../firebase/errors';
import { isFirebaseCallTimeout, withTimeout } from '../firebase/withTimeout';
import {
  organizationIdOf,
  ownInvitationRef,
  ownInvitationsQuery,
  ownOrganizationMemberRef,
  ownOrganizationMembershipsQuery,
  ownTeamMemberRef,
  ownTeamMembershipsQuery,
  teamIdOf,
} from './accountQueries';

export const ACCOUNT_GATEWAY_TIMEOUT_MS = 8000;

/** Fout in de vorm van een server-resultaat (pad of veld klopt niet): fail closed. */
class AccountShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountShapeError';
  }
}

type ReadOutcome<T> = { ok: true; value: T } | { ok: false; error: AccountReadError };

function toReadError(error: unknown): AccountReadError {
  if (isFirebaseCallTimeout(error)) return { code: 'timeout' };
  const code = firebaseErrorCode(error);
  // `getDocsFromServer`/`getDocFromServer` zonder verbinding. Alleen `unavailable`:
  // `failed-precondition` (bijv. een ontbrekende index) is een echte leesfout en mag
  // niet als "offline" worden gemeld (reviewbevinding C op 2b-i).
  if (code === 'unavailable') return { code: 'offline' };
  return { code: 'read-failed', detail: error };
}

/** Auth-codes waarbij de sessie niet meer bruikbaar is: geen geauthenticeerd verzoek mogelijk. */
const UNUSABLE_SESSION_CODES = new Set([
  'auth/user-token-expired',
  'auth/user-not-found',
  'auth/user-disabled',
  'auth/invalid-user-token',
]);

type IdentityError = Exclude<AccountReadError, { code: 'email-not-verified' }>;

function toIdentityError(error: unknown): IdentityError {
  if (isFirebaseCallTimeout(error)) return { code: 'timeout' };
  const code = firebaseErrorCode(error);
  if (code === 'auth/network-request-failed') return { code: 'offline' };
  if (UNUSABLE_SESSION_CODES.has(code)) return { code: 'not-signed-in' };
  return { code: 'read-failed', detail: error };
}

function readErrorToDeleteError(error: AccountReadError): SelfDeleteError {
  switch (error.code) {
    case 'not-signed-in':
    case 'offline':
    case 'timeout':
      return { code: error.code };
    case 'email-not-verified':
      return { code: 'rejected' };
    case 'read-failed':
      return { code: 'failed', detail: error.detail };
  }
}

export class FirestoreAccountGateway implements AccountGateway {
  constructor(
    private readonly db: Firestore,
    private readonly timeoutMs: number = ACCOUNT_GATEWAY_TIMEOUT_MS,
  ) {}

  private currentUser(): User | null {
    return getAuth(this.db.app).currentUser;
  }

  /**
   * Preflight: ververst het ID-token ALTIJD (`getIdTokenResult(true)`, reviewbevinding A
   * op 2b-i). Een gecachet token kan nog `email_verified=false` dragen terwijl de
   * gebruiker inmiddels geverifieerd is; dan zou de uitnodigingsstap (B3) stil
   * overgeslagen worden. Offline faalt de verversing → `offline` (niet "niet ingelogd").
   * Een sessie die niet meer te verversen is (account weg/uitgeschakeld) → `not-signed-in`.
   */
  async readIdentity(): Promise<IdentityReadResult> {
    return this.readTokenIdentity(true);
  }

  /**
   * Interne variant voor de stappen NA de preflight: gebruikt het (zojuist ververste)
   * token uit de SDK-cache, zodat niet elke delete een extra tokenverzoek kost.
   */
  private async readTokenIdentity(forceRefresh: boolean): Promise<IdentityReadResult> {
    const user = this.currentUser();
    if (!user) return { ok: false, error: { code: 'not-signed-in' } };
    try {
      const token = await withTimeout(user.getIdTokenResult(forceRefresh), this.timeoutMs);
      const email = token.claims.email;
      return {
        ok: true,
        identity: {
          uid: user.uid,
          email: typeof email === 'string' && email.length > 0 ? email : null,
          emailVerified: token.claims.email_verified === true,
        },
      };
    } catch (error) {
      return { ok: false, error: toIdentityError(error) };
    }
  }

  async readInventoryFromServer(options: {
    includeInvitations: boolean;
  }): Promise<InventoryReadResult> {
    const user = this.currentUser();
    if (!user) return { ok: false, error: { code: 'not-signed-in' } };

    let email: string | null = null;
    if (options.includeInvitations) {
      const read = await this.readTokenIdentity(false);
      if (!read.ok) return { ok: false, error: read.error };
      if (!read.identity.emailVerified || read.identity.email === null) {
        return { ok: false, error: { code: 'email-not-verified' } };
      }
      email = read.identity.email;
    }

    try {
      const inventory: AccountInventory = {
        organizationMemberships: await this.readOwnOrganizationMemberships(user.uid),
        teamMemberships: await this.readOwnTeamMemberships(user.uid),
        invitations: email === null ? [] : await this.readOwnInvitations(email),
      };
      return { ok: true, inventory };
    } catch (error) {
      return { ok: false, error: toReadError(error) };
    }
  }

  async readOrganizationFacts(organizationId: string): Promise<FactsReadResult> {
    if (!this.currentUser()) return { ok: false, error: { code: 'not-signed-in' } };
    try {
      // Ruw, ZONDER organizationConverter: die gooit bij een ontbrekende `createdBy`,
      // en de classificatie moet "geen maker" kunnen onderscheiden van een leesfout.
      const organization = await withTimeout(
        getDocFromServer(doc(this.db, 'organizations', organizationId)),
        this.timeoutMs,
      );
      if (!organization.exists()) {
        return {
          ok: true,
          facts: {
            organizationId,
            exists: false,
            createdBy: null,
            ownerUids: [],
            deletionRequestStatus: null,
          },
        };
      }
      const rawCreatedBy: unknown = organization.data().createdBy;
      const createdBy =
        typeof rawCreatedBy === 'string' && rawCreatedBy.trim().length > 0 ? rawCreatedBy : null;

      // Ongefilterde listing van één organisatie: dezelfde vorm als de 8.3b-export
      // (`isOrgMember`). Een ongeldig document van een ander lid laat de converter
      // gooien → `read-failed` (fail closed, geen write).
      const members = await withTimeout(
        getDocsFromServer(
          collection(this.db, 'organizations', organizationId, 'organizationMembers').withConverter(
            organizationMemberConverter,
          ),
        ),
        this.timeoutMs,
      );
      const ownerUids = members.docs
        .filter((member) => member.data().role === 'organizationOwner')
        .map((member) => member.id);

      // Rechtstreeks van de server in plaats van via `DeletionRequestGateway.read()`, die
      // uit de cache mag lezen (§B.5).
      const request = await withTimeout(
        getDocFromServer(
          doc(
            this.db,
            'organizations',
            organizationId,
            'deletionRequests',
            'current',
          ).withConverter(deletionRequestConverter),
        ),
        this.timeoutMs,
      );

      return {
        ok: true,
        facts: {
          organizationId,
          exists: true,
          createdBy,
          ownerUids,
          deletionRequestStatus: request.exists() ? request.data().status : null,
        },
      };
    } catch (error) {
      return { ok: false, error: toReadError(error) };
    }
  }

  async deleteOwnTeamMembership(ref: {
    organizationId: string;
    teamId: string;
    expectedUid: string;
  }): Promise<SelfDeleteResult> {
    const user = this.currentUser();
    if (!user || user.uid !== ref.expectedUid) {
      return { ok: false, error: { code: 'not-signed-in' } };
    }
    const target = ownTeamMemberRef(this.db, ref.organizationId, ref.teamId, user.uid);
    return this.selfDelete(target, ownTeamMembershipsQuery(this.db, user.uid));
  }

  async deleteOwnInvitation(ref: {
    organizationId: string;
    invitationId: string;
    expectedUid: string;
  }): Promise<SelfDeleteResult> {
    if (this.currentUser()?.uid !== ref.expectedUid) {
      return { ok: false, error: { code: 'not-signed-in' } };
    }
    const read = await this.readTokenIdentity(false);
    if (!read.ok) return { ok: false, error: readErrorToDeleteError(read.error) };
    const identity = read.identity;
    // Zonder geverifieerde e-mailclaim kan de uitnodiging niet gevonden en niet
    // verwijderd worden (Rules); er volgt geen write.
    if (!identity.emailVerified || identity.email === null) {
      return { ok: false, error: { code: 'rejected' } };
    }
    const target = ownInvitationRef(this.db, ref.organizationId, ref.invitationId);
    return this.selfDelete(target, ownInvitationsQuery(this.db, identity.email));
  }

  async deleteOwnOrganizationMembership(
    organizationId: string,
    expectedUid: string,
  ): Promise<SelfDeleteResult> {
    const user = this.currentUser();
    if (!user || user.uid !== expectedUid) {
      return { ok: false, error: { code: 'not-signed-in' } };
    }
    const target = ownOrganizationMemberRef(this.db, organizationId, user.uid);
    return this.selfDelete(target, ownOrganizationMembershipsQuery(this.db, user.uid));
  }

  /**
   * Teruglezen → delete → teruglezen. `ownQuery` is de eigen-identiteit-query waarin
   * `target` zou moeten staan; aanwezigheid wordt op het exacte documentpad bepaald.
   */
  private async selfDelete(target: DocumentReference, ownQuery: Query): Promise<SelfDeleteResult> {
    const before = await this.isPresentOnServer(target, ownQuery);
    if (!before.ok) return { ok: false, error: readErrorToDeleteError(before.error) };
    if (!before.value) return { ok: true, outcome: 'already-gone' };

    try {
      await withTimeout(deleteDoc(target), this.timeoutMs);
    } catch (error) {
      if (isFirebaseCallTimeout(error)) return { ok: false, error: { code: 'timeout' } };
      const code = firebaseErrorCode(error);
      if (code === 'unavailable') return { ok: false, error: { code: 'offline' } };
      if (code !== 'permission-denied')
        return { ok: false, error: { code: 'failed', detail: error } };
      // Geweigerd: weg (tussendoor door een ander verwijderd) of echt geweigerd?
      const afterDenied = await this.isPresentOnServer(target, ownQuery);
      if (!afterDenied.ok) return { ok: false, error: readErrorToDeleteError(afterDenied.error) };
      return afterDenied.value
        ? { ok: false, error: { code: 'rejected' } }
        : { ok: true, outcome: 'already-gone' };
    }

    const after = await this.isPresentOnServer(target, ownQuery);
    if (!after.ok) return { ok: false, error: readErrorToDeleteError(after.error) };
    if (after.value) {
      return { ok: false, error: { code: 'failed', detail: 'document staat er nog na delete' } };
    }
    return { ok: true, outcome: 'deleted' };
  }

  private async isPresentOnServer(
    target: DocumentReference,
    ownQuery: Query,
  ): Promise<ReadOutcome<boolean>> {
    try {
      const snapshot = await withTimeout(getDocsFromServer(ownQuery), this.timeoutMs);
      return { ok: true, value: snapshot.docs.some((entry) => entry.ref.path === target.path) };
    } catch (error) {
      return { ok: false, error: toReadError(error) };
    }
  }

  private async readOwnOrganizationMemberships(
    uid: string,
  ): Promise<OwnOrganizationMembershipRef[]> {
    const snapshot = await withTimeout(
      getDocsFromServer(
        ownOrganizationMembershipsQuery(this.db, uid).withConverter(organizationMemberConverter),
      ),
      this.timeoutMs,
    );
    return snapshot.docs.map((entry) => {
      const organizationId = organizationIdOf(entry);
      const data = entry.data();
      if (organizationId === null || entry.id !== uid || data.uid !== uid) {
        throw new AccountShapeError('organizationMembers: onverwacht pad of uid');
      }
      return { organizationId, role: data.role };
    });
  }

  private async readOwnTeamMemberships(uid: string): Promise<OwnTeamMembershipRef[]> {
    const snapshot = await withTimeout(
      getDocsFromServer(ownTeamMembershipsQuery(this.db, uid).withConverter(teamMemberConverter)),
      this.timeoutMs,
    );
    return snapshot.docs.map((entry) => {
      const organizationId = organizationIdOf(entry);
      const teamId = teamIdOf(entry);
      const data = entry.data();
      if (organizationId === null || teamId === null || entry.id !== uid || data.uid !== uid) {
        throw new AccountShapeError('teamMembers: onverwacht pad of uid');
      }
      return { organizationId, teamId, role: data.role };
    });
  }

  private async readOwnInvitations(email: string): Promise<OwnInvitationRef[]> {
    const snapshot = await withTimeout(
      getDocsFromServer(ownInvitationsQuery(this.db, email).withConverter(invitationConverter)),
      this.timeoutMs,
    );
    return snapshot.docs.map((entry) => {
      const organizationId = organizationIdOf(entry);
      const data = entry.data();
      if (organizationId === null || data.email !== email) {
        throw new AccountShapeError('invitations: onverwacht pad of e-mail');
      }
      return { organizationId, invitationId: entry.id, status: data.status, role: data.role };
    });
  }
}
