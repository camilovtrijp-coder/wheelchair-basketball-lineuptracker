// Firestore-implementatie van OwnershipTransferGateway (PR 8.3c-2b-iii,
// docs/pr-8.3c-2b-plan.md §B.7, §B.8, §B.11, §C.3).
//
// - Aanroeper uitsluitend uit `getAuth(db.app).currentUser` plus diens EIGEN
//   `organizationMembers`-document, van de server — nooit uit een parameter. Bewust NIET
//   `OrganizationExportGateway.readAuthoritativeCaller()`: die leest via `getDoc` (mag uit
//   de cache) en maakt van offline `null`; zie ontwerp §C.3 "Uitvoering 2b-iii".
// - ALLE reads van de SERVER (`getDocsFromServer`/`getDocFromServer`, of de reads binnen
//   een transactie, die altijd naar de backend gaan).
// - Elke schrijfmethode weigert de eigen uid als doel (`self-target`, geen write).
// - Rolgevoelige writes (promoveren, membership verwijderen) in een TRANSACTIE: de
//   huidige rol wordt atomair gelezen en vergeleken met de verwachte rol; wijkt die af,
//   dan volgt geen write (`role-changed`). Een transactie werkt niet offline en komt nooit
//   in de schrijfwachtrij.
// - Dezelfde transactie leest ook het EIGEN membership van de aanroeper en schrijft alleen
//   als dat `organizationOwner` is (reviewbevinding A op #108). De Rules lezen de rol van de
//   aanroeper met `get()`, maar die read hoort niet bij de transactie van de client. Pas
//   doordat de client het eigen document in de transactie leest, controleert de SDK bij de
//   commit dat het sindsdien niet veranderd is (precondition op de leesversie). Zo kunnen
//   twee owners die elkaar tegelijk verwijderen niet allebei slagen: de tweede commit faalt,
//   de transactie herhaalt zich en ziet het eigen membership weg (Rules weigeren de get →
//   `rejected`) of zonder ownerrol (→ `rejected`), zonder write.
// - Na een timeout van een transactie één server-readback van het doel: staat het doel al
//   in de bedoelde eindtoestand, dan is dat het antwoord; anders blijft het `timeout` (de
//   transactie kan nog lopen en later landen).
// - Uitnodigingen worden RUW gelezen (alleen `email` en `status`), zonder converter: een
//   misvormde uitnodiging van een ander adres blokkeert het intrekken niet meer. Een
//   document zonder leesbaar `email` (geen string) telt als `skippedMalformed`; Rules
//   laten zo'n uitnodiging nooit accepteren of claimen (die vergelijken `email` met de
//   token-e-mail). Een document dat op het doeladres MATCHT maar een onbekende status
//   heeft, telt ook als `skippedMalformed` (Opruim-PR 2, reviewnit 1 van #110): Rules laten
//   alleen `pending` accepteren, alleen `accepted` claimen (ook de membership-join eist
//   `accepted`) en alleen `pending`/`accepted` intrekken, dus zo'n document geeft niemand
//   toegang en kan ook niet worden ingetrokken. Fail closed blijft waar een BEKENDE open
//   status niet in te trekken blijkt (`rejected`) en bij een onleesbare status in de
//   readback na een eigen write.
// - Na elke write een server-readback; een Rules-weigering wordt met een readback
//   geclassificeerd (`rejected` als er niets veranderd is).
// - Elke aanroep naar Firestore heeft een timeout van 8 s.
// - Alle paden en patches komen uit `ownershipTransferPaths.ts`, die de emulatortest
//   tegen de echte Rules gebruikt.
import {
  deleteDoc,
  getDocFromServer,
  getDocsFromServer,
  runTransaction,
  updateDoc,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { organizationMemberConverter } from 'firebase-base/documents';
import type {
  CallerReadResult,
  FootprintReadResult,
  MembersReadResult,
  OwnershipTransferGateway,
  PromoteResult,
  RemoveMemberResult,
  RemoveTeamMembershipsResult,
  RevokeInvitationsResult,
  TransferReadError,
  TransferWriteError,
} from '../../application/account/OwnershipTransferGateway';
import {
  isOpenInvitationStatus,
  isSameEmailAddress,
  type TransferMember,
} from '../../domain/account/transfer';
import { INVITATION_STATUSES, type InvitationStatus } from '../../domain/invitations/types';
import type { OrganizationRole } from '../../domain/organizations/types';
import { firebaseErrorCode } from '../firebase/errors';
import { isFirebaseCallTimeout, withTimeout } from '../firebase/withTimeout';
import {
  organizationInvitationRef,
  organizationInvitationsCollection,
  organizationMemberRef,
  organizationMembersCollection,
  organizationTeamsCollection,
  promoteToOwnerPatch,
  revokeInvitationPatch,
  teamMemberRef,
} from './ownershipTransferPaths';

export const OWNERSHIP_TRANSFER_TIMEOUT_MS = 8000;

/** Fout in de vorm van een server-resultaat (pad of veld klopt niet): fail closed. */
class TransferShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferShapeError';
  }
}

/** Binnen een transactie: de rol van het doel wijkt af van de verwachte rol. Geen write. */
class RoleChangedError extends Error {
  constructor(readonly actualRole: OrganizationRole) {
    super('rol van het doel gewijzigd');
    this.name = 'RoleChangedError';
  }
}

/**
 * Binnen een transactie: het eigen membership van de aanroeper heeft (niet meer) de rol
 * `organizationOwner`. Geen write; naar buiten `rejected` (zelfde uitkomst als een
 * Rules-weigering, want het is dezelfde grens).
 */
class CallerNotOwnerError extends Error {
  constructor() {
    super('aanroeper is geen owner (meer)');
    this.name = 'CallerNotOwnerError';
  }
}

/** Binnen een transactie: het doel bestaat niet (meer). Geen write. */
class TargetMissingError extends Error {
  constructor() {
    super('doel bestaat niet');
    this.name = 'TargetMissingError';
  }
}

type Read<T> = { ok: true; value: T } | { ok: false; error: TransferReadError };

interface OpenInvitationIds {
  ids: string[];
  /** Uitnodigingen zonder leesbaar `email`-veld: overgeslagen en geteld. */
  malformed: number;
}

function parseInvitationStatus(value: unknown): InvitationStatus | null {
  return (INVITATION_STATUSES as readonly unknown[]).includes(value)
    ? (value as InvitationStatus)
    : null;
}

function toReadError(error: unknown): TransferReadError {
  if (isFirebaseCallTimeout(error)) return { code: 'timeout' };
  // Alleen `unavailable` is offline; `failed-precondition` is een echte leesfout
  // (reviewbevinding C op 2b-i).
  if (firebaseErrorCode(error) === 'unavailable') return { code: 'offline' };
  return { code: 'read-failed', detail: error };
}

function readToWriteError(error: TransferReadError): TransferWriteError {
  switch (error.code) {
    case 'not-signed-in':
    case 'offline':
    case 'timeout':
      return { code: error.code };
    case 'read-failed':
      return { code: 'failed', detail: error.detail };
  }
}

/** Fout van een write (of transactie) die NIET `permission-denied` is. */
function toWriteError(error: unknown): TransferWriteError {
  if (isFirebaseCallTimeout(error)) return { code: 'timeout' };
  if (error instanceof RoleChangedError)
    return { code: 'role-changed', actualRole: error.actualRole };
  if (error instanceof TargetMissingError) return { code: 'not-found' };
  if (error instanceof CallerNotOwnerError) return { code: 'rejected' };
  if (firebaseErrorCode(error) === 'unavailable') return { code: 'offline' };
  return { code: 'failed', detail: error };
}

function isPermissionDenied(error: unknown): boolean {
  return !isFirebaseCallTimeout(error) && firebaseErrorCode(error) === 'permission-denied';
}

/**
 * De classificatie-readback NA een `permission-denied` wordt zelf geweigerd: de aanroeper
 * is geen lid meer (bijv. net door een andere owner verwijderd). Een geweigerde transactie
 * heeft niets geschreven, dus dat is `rejected` en geen `failed`.
 */
function isDeniedReadback(error: TransferReadError): boolean {
  return error.code === 'read-failed' && isPermissionDenied(error.detail);
}

export class FirestoreOwnershipTransferGateway implements OwnershipTransferGateway {
  constructor(
    private readonly db: Firestore,
    private readonly timeoutMs: number = OWNERSHIP_TRANSFER_TIMEOUT_MS,
  ) {}

  private currentUid(): string | null {
    return getAuth(this.db.app).currentUser?.uid ?? null;
  }

  async readCaller(organizationId: string): Promise<CallerReadResult> {
    const uid = this.currentUid();
    if (uid === null) return { ok: false, error: { code: 'not-signed-in' } };
    try {
      const snapshot = await withTimeout(
        getDocFromServer(
          organizationMemberRef(this.db, organizationId, uid).withConverter(
            organizationMemberConverter,
          ),
        ),
        this.timeoutMs,
      );
      if (!snapshot.exists()) return { ok: true, caller: null };
      const data = snapshot.data();
      if (data.uid !== uid) throw new TransferShapeError('organizationMembers: uid wijkt af');
      return { ok: true, caller: { uid, role: data.role } };
    } catch (error) {
      // Zonder membership weigeren Rules de directe get (`isOrgMember`): dat is "geen lid",
      // geen leesfout.
      if (isPermissionDenied(error)) return { ok: true, caller: null };
      return { ok: false, error: toReadError(error) };
    }
  }

  async listOrganizationMembers(organizationId: string): Promise<MembersReadResult> {
    if (this.currentUid() === null) return { ok: false, error: { code: 'not-signed-in' } };
    try {
      return { ok: true, members: await this.readMembers(organizationId) };
    } catch (error) {
      return { ok: false, error: toReadError(error) };
    }
  }

  async promoteToOwner(
    organizationId: string,
    targetUid: string,
    expectedRole: OrganizationRole,
    expectedCallerUid: string,
  ): Promise<PromoteResult> {
    const uid = this.currentUid();
    if (uid === null || uid !== expectedCallerUid) {
      return { ok: false, error: { code: 'not-signed-in' } };
    }
    if (targetUid === uid) return { ok: false, error: { code: 'self-target' } };
    const target = organizationMemberRef(this.db, organizationId, targetUid);
    const self = organizationMemberRef(this.db, organizationId, uid);

    let outcome: 'promoted' | 'already-owner';
    try {
      outcome = await withTimeout(
        runTransaction(this.db, async (transaction) => {
          // Eerst het EIGEN membership (reviewbevinding A op #108), zie `requireCallerOwner`.
          await requireCallerOwner(transaction, self, uid);
          const snapshot = await transaction.get(target.withConverter(organizationMemberConverter));
          if (!snapshot.exists()) throw new TargetMissingError();
          const role = snapshot.data().role;
          if (role === 'organizationOwner') return 'already-owner' as const;
          if (role !== expectedRole) throw new RoleChangedError(role);
          transaction.update(target, promoteToOwnerPatch());
          return 'promoted' as const;
        }),
        this.timeoutMs,
      );
    } catch (error) {
      if (isFirebaseCallTimeout(error)) {
        // De transactie kan alsnog gecommit zijn (of nog lopen). Eén readback: is het doel
        // al owner, dan is de eindtoestand bereikt (of déze transactie of een gelijktijdige
        // promotie schreef, is niet te onderscheiden); anders blijft het `timeout`.
        const afterTimeout = await this.readRole(target);
        return afterTimeout.ok && afterTimeout.value === 'organizationOwner'
          ? { ok: true, outcome: 'promoted' }
          : { ok: false, error: { code: 'timeout' } };
      }
      if (!isPermissionDenied(error)) return { ok: false, error: toWriteError(error) };
      // Geweigerd: tussendoor door een ander gepromoveerd, of echt geweigerd?
      const after = await this.readRole(target);
      if (!after.ok) {
        if (isDeniedReadback(after.error)) return { ok: false, error: { code: 'rejected' } };
        return { ok: false, error: readToWriteError(after.error) };
      }
      return after.value === 'organizationOwner'
        ? { ok: true, outcome: 'already-owner' }
        : { ok: false, error: { code: 'rejected' } };
    }

    const after = await this.readRole(target);
    if (!after.ok) return { ok: false, error: readToWriteError(after.error) };
    if (after.value !== 'organizationOwner') {
      return { ok: false, error: { code: 'failed', detail: 'rol na promotie geen owner' } };
    }
    return { ok: true, outcome };
  }

  async revokeOpenInvitationsForEmail(
    organizationId: string,
    email: string,
    expectedCallerUid: string,
  ): Promise<RevokeInvitationsResult> {
    let revoked = 0;
    let alreadyClosed = 0;
    if (this.currentUid() !== expectedCallerUid) {
      return { ok: false, error: { code: 'not-signed-in' }, revoked };
    }

    const listed = await this.readOpenInvitationIds(organizationId, email);
    if (!listed.ok) return { ok: false, error: readToWriteError(listed.error), revoked };

    for (const invitationId of listed.value.ids) {
      // De sessie kan tijdens de lus wisselen: vóór elke write opnieuw controleren.
      if (this.currentUid() !== expectedCallerUid) {
        return { ok: false, error: { code: 'not-signed-in' }, revoked };
      }
      const ref = organizationInvitationRef(this.db, organizationId, invitationId);
      try {
        await withTimeout(updateDoc(ref, revokeInvitationPatch()), this.timeoutMs);
      } catch (error) {
        if (!isPermissionDenied(error)) return { ok: false, error: toWriteError(error), revoked };
        // Geweigerd: tussendoor gesloten (ingetrokken/geclaimd/verwijderd) of echt geweigerd?
        const status = await this.readInvitationStatus(ref);
        if (!status.ok) return { ok: false, error: readToWriteError(status.error), revoked };
        if (status.value !== null && isOpenInvitationStatus(status.value)) {
          return { ok: false, error: { code: 'rejected' }, revoked };
        }
        alreadyClosed += 1;
        continue;
      }
      const status = await this.readInvitationStatus(ref);
      if (!status.ok) return { ok: false, error: readToWriteError(status.error), revoked };
      if (status.value !== 'revoked') {
        return {
          ok: false,
          error: { code: 'failed', detail: 'uitnodiging na intrekken niet revoked' },
          revoked,
        };
      }
      revoked += 1;
    }
    return { ok: true, revoked, alreadyClosed, skippedMalformed: listed.value.malformed };
  }

  async removeTeamMembershipsOf(
    organizationId: string,
    targetUid: string,
    expectedCallerUid: string,
  ): Promise<RemoveTeamMembershipsResult> {
    let removed = 0;
    const uid = this.currentUid();
    if (uid === null || uid !== expectedCallerUid) {
      return { ok: false, error: { code: 'not-signed-in' }, removed };
    }
    if (targetUid === uid) return { ok: false, error: { code: 'self-target' }, removed };

    const teams = await this.readTeamIds(organizationId);
    if (!teams.ok) return { ok: false, error: readToWriteError(teams.error), removed };

    for (const teamId of teams.value) {
      const ref = teamMemberRef(this.db, organizationId, teamId, targetUid);
      const before = await this.readExists(ref);
      if (!before.ok) return { ok: false, error: readToWriteError(before.error), removed };
      if (!before.value) continue;
      // De sessie kan tijdens de lus wisselen: vóór elke write opnieuw controleren.
      if (this.currentUid() !== expectedCallerUid) {
        return { ok: false, error: { code: 'not-signed-in' }, removed };
      }

      try {
        await withTimeout(deleteDoc(ref), this.timeoutMs);
      } catch (error) {
        if (!isPermissionDenied(error)) return { ok: false, error: toWriteError(error), removed };
        const afterDenied = await this.readExists(ref);
        if (!afterDenied.ok) {
          return { ok: false, error: readToWriteError(afterDenied.error), removed };
        }
        if (afterDenied.value) return { ok: false, error: { code: 'rejected' }, removed };
        continue;
      }
      const after = await this.readExists(ref);
      if (!after.ok) return { ok: false, error: readToWriteError(after.error), removed };
      if (after.value) {
        return {
          ok: false,
          error: { code: 'failed', detail: 'teamMembers staat er nog na delete' },
          removed,
        };
      }
      removed += 1;
    }
    return { ok: true, removed };
  }

  async removeOrganizationMember(
    organizationId: string,
    targetUid: string,
    expectedRole: OrganizationRole,
    expectedCallerUid: string,
  ): Promise<RemoveMemberResult> {
    const uid = this.currentUid();
    if (uid === null || uid !== expectedCallerUid) {
      return { ok: false, error: { code: 'not-signed-in' } };
    }
    if (targetUid === uid) return { ok: false, error: { code: 'self-target' } };
    const target = organizationMemberRef(this.db, organizationId, targetUid);
    const self = organizationMemberRef(this.db, organizationId, uid);

    let outcome: 'deleted' | 'already-gone';
    try {
      outcome = await withTimeout(
        runTransaction(this.db, async (transaction) => {
          // Eerst het EIGEN membership (reviewbevinding A op #108): zonder deze read kunnen
          // twee owners die elkaar tegelijk verwijderen allebei slagen.
          await requireCallerOwner(transaction, self, uid);
          const snapshot = await transaction.get(target.withConverter(organizationMemberConverter));
          if (!snapshot.exists()) return 'already-gone' as const;
          const role = snapshot.data().role;
          if (role !== expectedRole) throw new RoleChangedError(role);
          transaction.delete(target);
          return 'deleted' as const;
        }),
        this.timeoutMs,
      );
    } catch (error) {
      if (isFirebaseCallTimeout(error)) {
        // Eén readback: is het doel weg, dan is de eindtoestand bereikt (door déze of een
        // gelijktijdige delete); staat het er nog, dan blijft het `timeout`.
        const afterTimeout = await this.readExists(target);
        return afterTimeout.ok && !afterTimeout.value
          ? { ok: true, outcome: 'deleted' }
          : { ok: false, error: { code: 'timeout' } };
      }
      if (!isPermissionDenied(error)) return { ok: false, error: toWriteError(error) };
      const afterDenied = await this.readExists(target);
      if (!afterDenied.ok) {
        if (isDeniedReadback(afterDenied.error)) return { ok: false, error: { code: 'rejected' } };
        return { ok: false, error: readToWriteError(afterDenied.error) };
      }
      return afterDenied.value
        ? { ok: false, error: { code: 'rejected' } }
        : { ok: true, outcome: 'already-gone' };
    }

    const after = await this.readExists(target);
    if (!after.ok) return { ok: false, error: readToWriteError(after.error) };
    if (after.value) {
      return { ok: false, error: { code: 'failed', detail: 'membership staat er nog na delete' } };
    }
    return { ok: true, outcome };
  }

  async readMemberFootprint(
    organizationId: string,
    targetUid: string,
    email: string,
  ): Promise<FootprintReadResult> {
    if (this.currentUid() === null) return { ok: false, error: { code: 'not-signed-in' } };

    const member = await this.readExists(organizationMemberRef(this.db, organizationId, targetUid));
    if (!member.ok) return member;
    const teams = await this.readTeamIds(organizationId);
    if (!teams.ok) return teams;
    let teamMemberships = 0;
    for (const teamId of teams.value) {
      const exists = await this.readExists(
        teamMemberRef(this.db, organizationId, teamId, targetUid),
      );
      if (!exists.ok) return exists;
      if (exists.value) teamMemberships += 1;
    }
    const invitations = await this.readOpenInvitationIds(organizationId, email);
    if (!invitations.ok) return invitations;

    return {
      ok: true,
      footprint: {
        organizationMember: member.value,
        teamMemberships,
        openInvitations: invitations.value.ids.length,
      },
    };
  }

  private async readMembers(organizationId: string): Promise<TransferMember[]> {
    const snapshot = await withTimeout(
      getDocsFromServer(
        organizationMembersCollection(this.db, organizationId).withConverter(
          organizationMemberConverter,
        ),
      ),
      this.timeoutMs,
    );
    return snapshot.docs.map((entry) => {
      const data = entry.data();
      if (data.uid !== entry.id) {
        throw new TransferShapeError('organizationMembers: uid wijkt af van document-ID');
      }
      return { uid: entry.id, role: data.role, email: data.email };
    });
  }

  /**
   * ID's van de `pending`/`accepted` uitnodigingen op `email` in deze organisatie. Leest
   * ruw alleen `email` en `status` (geen converter): een misvormd veld in een uitnodiging
   * van een ánder adres blokkeert niets. Geen string als `email` → overslaan en tellen
   * (`malformed`). Wel het doeladres maar een onbekende `status` → ook overslaan en tellen:
   * volgens de Rules is zo'n document niet te accepteren, niet te claimen en niet in te
   * trekken. Het blokkeerde eerder (fail closed) de overdracht tot de opruimtermijn.
   */
  private async readOpenInvitationIds(
    organizationId: string,
    email: string,
  ): Promise<Read<OpenInvitationIds>> {
    try {
      const snapshot = await withTimeout(
        getDocsFromServer(organizationInvitationsCollection(this.db, organizationId)),
        this.timeoutMs,
      );
      const ids: string[] = [];
      let malformed = 0;
      for (const entry of snapshot.docs) {
        const data = entry.data() as Record<string, unknown>;
        if (typeof data.email !== 'string') {
          malformed += 1;
          continue;
        }
        if (!isSameEmailAddress(data.email, email)) continue;
        const status = parseInvitationStatus(data.status);
        if (status === null) {
          malformed += 1;
          continue;
        }
        if (isOpenInvitationStatus(status)) ids.push(entry.id);
      }
      return { ok: true, value: { ids, malformed } };
    } catch (error) {
      return { ok: false, error: toReadError(error) };
    }
  }

  /** Alleen de ID's: een team zonder geldige vorm mag de overdracht niet blokkeren. */
  private async readTeamIds(organizationId: string): Promise<Read<string[]>> {
    try {
      const snapshot = await withTimeout(
        getDocsFromServer(organizationTeamsCollection(this.db, organizationId)),
        this.timeoutMs,
      );
      return { ok: true, value: snapshot.docs.map((entry) => entry.id) };
    } catch (error) {
      return { ok: false, error: toReadError(error) };
    }
  }

  private async readExists(ref: DocumentReference): Promise<Read<boolean>> {
    try {
      const snapshot = await withTimeout(getDocFromServer(ref), this.timeoutMs);
      return { ok: true, value: snapshot.exists() };
    } catch (error) {
      return { ok: false, error: toReadError(error) };
    }
  }

  /** De huidige rol van een membership, `null` als het niet (meer) bestaat. */
  private async readRole(ref: DocumentReference): Promise<Read<OrganizationRole | null>> {
    try {
      const snapshot = await withTimeout(
        getDocFromServer(ref.withConverter(organizationMemberConverter)),
        this.timeoutMs,
      );
      return { ok: true, value: snapshot.exists() ? snapshot.data().role : null };
    } catch (error) {
      return { ok: false, error: toReadError(error) };
    }
  }

  /**
   * De huidige status van een uitnodiging, `null` als ze niet (meer) bestaat. Ruw alleen
   * `status` (zelfde reden als `readOpenInvitationIds`); onbekend → fail closed.
   */
  private async readInvitationStatus(
    ref: DocumentReference,
  ): Promise<Read<InvitationStatus | null>> {
    try {
      const snapshot = await withTimeout(getDocFromServer(ref), this.timeoutMs);
      if (!snapshot.exists()) return { ok: true, value: null };
      const status = parseInvitationStatus((snapshot.data() as Record<string, unknown>).status);
      if (status === null) throw new TransferShapeError('invitations: onleesbare status');
      return { ok: true, value: status };
    } catch (error) {
      return { ok: false, error: toReadError(error) };
    }
  }
}

/**
 * Leest binnen `transaction` het EIGEN membership van de aanroeper (uid uit de sessie,
 * nooit uit invoer) en eist de rol `organizationOwner`. Daardoor hoort dit document bij de
 * leesset van de transactie en controleert de SDK bij de commit dat het niet veranderd is.
 * Ontbreekt het, dan weigeren de Rules de get al (`permission-denied`); bestaat het zonder
 * ownerrol → `CallerNotOwnerError`; een afwijkend `uid`-veld → fail closed.
 */
async function requireCallerOwner(
  transaction: Transaction,
  self: DocumentReference,
  uid: string,
): Promise<void> {
  const snapshot = await transaction.get(self.withConverter(organizationMemberConverter));
  if (!snapshot.exists()) throw new CallerNotOwnerError();
  const data = snapshot.data();
  if (data.uid !== uid) throw new TransferShapeError('organizationMembers: uid wijkt af');
  if (data.role !== 'organizationOwner') throw new CallerNotOwnerError();
}
