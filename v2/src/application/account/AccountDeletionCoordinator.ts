import { groupInventoryByOrganization, isInventoryEmpty } from '../../domain/account/classify';
import { buildAccountDeletionPlan, type AccountDeletionPlan } from '../../domain/account/plan';
import type { AccountInventory, OrganizationFacts } from '../../domain/account/types';
import type { AccountAuthGateway, ReauthResult } from './AccountAuthGateway';
import type { AccountGateway, AccountReadError, SelfDeleteError } from './AccountGateway';
import {
  executeLeaveSteps,
  isDeletionPending,
  type LeaveIncompleteStage,
} from './LeaveOrganizationCoordinator';
import type { LocalUnsyncedWorkProbe } from './LocalUnsyncedWorkProbe';

/**
 * PR 8.3c-2b-ii (docs/pr-8.3c-2b-plan.md §B.9, §C.2; besluitrecord
 * docs/pr-8.3c-besluitvoorstel.md §4.4): accountverwijdering.
 *
 * Drie methoden, elk vanaf een VERSE server-inventaris (niets wordt bewaard, B5):
 *
 *   assess()                 — read-only: voorwaarden, inventaris, plan per organisatie.
 *   clearFirestoreData(pw)   — §B.9 stap 1–6: plan-poort vóór de eerste write, dan
 *                              reauthenticatie (B2: VÓÓR de eerste write), dan per
 *                              organisatie `executeLeaveSteps()` (hergebruik, geen kopie),
 *                              dan alle eigen uitnodigingen (elke status), dan de harde
 *                              eindpoort (drie queries van de server, alle drie leeg).
 *   deleteAuthAccount(pw)    — §B.9 stap 7–9: reauthenticatie, eindpoort 5' DIRECT vóór
 *                              `deleteUser`, `deleteUser`. Bij `requires-recent-login`
 *                              één keer opnieuw: reauth → eindpoort → `deleteUser` (B2).
 *
 * Harde invarianten:
 *   - `deleteUser` wordt nooit aangeroepen zonder dat DEZE aanroep zelf, direct ervoor,
 *     de eindpoort groen zag (een groene eindpoort uit `clearFirestoreData()` telt niet);
 *   - `deleted` alleen na een bevestigend antwoord op `deleteUser`; een onbekende afloop
 *     is `auth-state-unknown`, nooit `deleted`;
 *   - een plan dat niet zelf op te lossen is, of mislukte voorwaarden, geven NUL writes;
 *   - "Firestore leeg, Auth-account nog aanwezig" is afleidbaar (§B.4): `assess()` en
 *     `clearFirestoreData()` melden dan `ready-for-auth-deletion`.
 *
 * Eén slot per instantie over alle drie de methoden: een tweede aanroep terwijl er één
 * loopt geeft `in-progress` en doet niets.
 */

export interface AccountRemainingCounts {
  organizationMembers: number;
  teamMembers: number;
  invitations: number;
}

/** Mislukte voorwaarde of read VÓÓR de eerste write van deze aanroep: niets geschreven. */
export type AccountDeletionPreconditionOutcome =
  | { status: 'not-signed-in' }
  | { status: 'email-not-verified' }
  | { status: 'offline' }
  | { status: 'failed'; reason: 'read-failed' | 'timeout' }
  /** Het token is niet meer te verversen (account weg/uitgeschakeld?): opnieuw inloggen beslist. */
  | { status: 'auth-state-unknown' };

export type AccountDeletionIncompleteStage = LeaveIncompleteStage | 'final-gate';

/** Er is in deze aanroep (mogelijk) WEL geschreven; opnieuw starten hervat uit een verse inventaris. */
export interface AccountDeletionIncompleteOutcome {
  status: 'incomplete';
  stage: AccountDeletionIncompleteStage;
  /** De organisatie waarin de flow stopte; `null` bij de eindpoort of de uitnodigingsread. */
  organizationId: string | null;
  error?: SelfDeleteError | AccountReadError;
  /** Alleen bij `final-gate`: wat de server nog aan eigen documenten teruggaf. */
  remaining?: AccountRemainingCounts;
}

export interface ReauthFailedOutcome {
  status: 'reauth-failed';
  reason: 'wrong-password' | 'too-many-requests' | 'network' | 'other';
}

export type AccountAssessmentOutcome =
  | { status: 'in-progress' }
  | AccountDeletionPreconditionOutcome
  /** Minstens één organisatie is niet zelf op te lossen; er volgt geen write. */
  | { status: 'needs-action'; plan: AccountDeletionPlan }
  /** Alles is zelf op te lossen; `clearFirestoreData()` kan starten. */
  | { status: 'ready-to-clear'; plan: AccountDeletionPlan }
  /** De server kent geen eigen document meer: alleen het Auth-account bestaat nog. */
  | { status: 'ready-for-auth-deletion' };

export type ClearFirestoreDataOutcome =
  | { status: 'in-progress' }
  | AccountDeletionPreconditionOutcome
  | { status: 'needs-action'; plan: AccountDeletionPlan }
  | ReauthFailedOutcome
  | AccountDeletionIncompleteOutcome
  | { status: 'ready-for-auth-deletion' };

export type DeleteAuthAccountOutcome =
  | { status: 'in-progress' }
  | AccountDeletionPreconditionOutcome
  | AccountDeletionIncompleteOutcome
  | ReauthFailedOutcome
  /** Firestore-data verwijderd, Auth-account bestaat aantoonbaar nog — hervatbaar. */
  | {
      status: 'firestore-cleared-auth-present';
      reason: 'requires-recent-login' | 'network' | 'other';
    }
  | { status: 'deleted' };

export type AccountDeletionOutcome =
  AccountAssessmentOutcome | ClearFirestoreDataOutcome | DeleteAuthAccountOutcome;

type Step<T, O> = { ok: true; value: T } | { ok: false; outcome: O };

function readFailureOutcome(error: AccountReadError): AccountDeletionPreconditionOutcome {
  switch (error.code) {
    case 'not-signed-in':
      return { status: 'not-signed-in' };
    case 'email-not-verified':
      return { status: 'email-not-verified' };
    case 'offline':
      return { status: 'offline' };
    case 'timeout':
      return { status: 'failed', reason: 'timeout' };
    case 'read-failed':
      return { status: 'failed', reason: 'read-failed' };
  }
}

function reauthFailureOutcome(
  result: Extract<ReauthResult, { ok: false }>,
): ReauthFailedOutcome | AccountDeletionPreconditionOutcome {
  switch (result.code) {
    case 'not-signed-in':
      return { status: 'not-signed-in' };
    case 'session-invalid':
      return { status: 'auth-state-unknown' };
    case 'wrong-password':
    case 'too-many-requests':
    case 'network':
    case 'other':
      return { status: 'reauth-failed', reason: result.code };
  }
}

function remainingCounts(inventory: AccountInventory): AccountRemainingCounts {
  return {
    organizationMembers: inventory.organizationMemberships.length,
    teamMembers: inventory.teamMemberships.length,
    invitations: inventory.invitations.length,
  };
}

interface Assessment {
  uid: string;
  inventory: AccountInventory;
  plan: AccountDeletionPlan;
  factsByOrganization: Map<string, OrganizationFacts>;
}

export class AccountDeletionCoordinator {
  private busy = false;

  constructor(
    private readonly gateway: AccountGateway,
    private readonly auth: AccountAuthGateway,
    private readonly probe: LocalUnsyncedWorkProbe,
  ) {}

  assess(): Promise<AccountAssessmentOutcome> {
    return this.exclusive(async () => {
      const assessed = await this.readAssessment();
      if (!assessed.ok) return assessed.outcome;
      if (assessed.value === null) return { status: 'ready-for-auth-deletion' };
      const { plan } = assessed.value;
      return plan.canProceed
        ? { status: 'ready-to-clear', plan }
        : { status: 'needs-action', plan };
    });
  }

  clearFirestoreData(password: string): Promise<ClearFirestoreDataOutcome> {
    return this.exclusive(() => this.runClear(password));
  }

  deleteAuthAccount(password: string): Promise<DeleteAuthAccountOutcome> {
    return this.exclusive(() => this.runDelete(password));
  }

  /** Synchroon slot, gezet vóór de eerste await: twee aanroepen zien elkaar altijd. */
  private async exclusive<T>(run: () => Promise<T>): Promise<T | { status: 'in-progress' }> {
    if (this.busy) return { status: 'in-progress' };
    this.busy = true;
    try {
      return await run();
    } finally {
      this.busy = false;
    }
  }

  /** §B.9 stap 1: ingelogd en een geverifieerde e-mailclaim in een VERS ververst token. */
  private async preconditions(): Promise<Step<string, AccountDeletionPreconditionOutcome>> {
    const claim = await this.auth.readVerifiedEmailClaim();
    if (!claim.ok) {
      switch (claim.code) {
        case 'not-signed-in':
          return { ok: false, outcome: { status: 'not-signed-in' } };
        case 'network':
          return { ok: false, outcome: { status: 'offline' } };
        case 'session-invalid':
          return { ok: false, outcome: { status: 'auth-state-unknown' } };
        case 'other':
          return { ok: false, outcome: { status: 'failed', reason: 'read-failed' } };
      }
    }
    // Zonder geverifieerde claim kan de derde query niet draaien en is "leeg" onbewijsbaar.
    if (!claim.verified || claim.email === null) {
      return { ok: false, outcome: { status: 'email-not-verified' } };
    }
    return { ok: true, value: claim.uid };
  }

  /**
   * Stap 1–3, read-only. `value: null` = de server kent geen eigen document meer
   * ("Firestore leeg, Auth-account aanwezig").
   */
  private async readAssessment(): Promise<
    Step<Assessment | null, AccountDeletionPreconditionOutcome>
  > {
    const pre = await this.preconditions();
    if (!pre.ok) return pre;
    const uid = pre.value;

    const inventoryRead = await this.gateway.readInventoryFromServer({ includeInvitations: true });
    if (!inventoryRead.ok) return { ok: false, outcome: readFailureOutcome(inventoryRead.error) };
    const inventory = inventoryRead.inventory;
    if (isInventoryEmpty(inventory)) return { ok: true, value: null };

    const factsByOrganization = new Map<string, OrganizationFacts>();
    const localUnsyncedWorkByOrganization = new Map<string, number>();
    for (const slice of groupInventoryByOrganization(inventory).values()) {
      if (slice.membership !== null) {
        const factsRead = await this.gateway.readOrganizationFacts(slice.organizationId);
        if (!factsRead.ok) return { ok: false, outcome: readFailureOutcome(factsRead.error) };
        factsByOrganization.set(slice.organizationId, factsRead.facts);
      }
      localUnsyncedWorkByOrganization.set(
        slice.organizationId,
        this.probe.countForOrganization(slice.organizationId),
      );
    }

    const plan = buildAccountDeletionPlan({
      callerUid: uid,
      inventory,
      factsByOrganization,
      localUnsyncedWorkByOrganization,
    });
    return { ok: true, value: { uid, inventory, plan, factsByOrganization } };
  }

  private async runClear(password: string): Promise<ClearFirestoreDataOutcome> {
    // 1–3: voorwaarden, inventaris, plan — nog geen write.
    const assessed = await this.readAssessment();
    if (!assessed.ok) return assessed.outcome;
    if (assessed.value === null) return { status: 'ready-for-auth-deletion' };
    const { uid, inventory, plan, factsByOrganization } = assessed.value;
    if (!plan.canProceed) return { status: 'needs-action', plan };

    // B2: reauthenticatie VÓÓR de eerste Firestore-write. Een open (gekaapte) sessie
    // zonder het wachtwoord kan zo geen lidmaatschappen weghalen.
    const reauth = await this.auth.reauthenticateWithPassword(password, { expectedUid: uid });
    if (!reauth.ok) return reauthFailureOutcome(reauth);

    // 4: per organisatie verlaten, met precies dezelfde stappen als "organisatie verlaten".
    const slices = groupInventoryByOrganization(inventory);
    for (const entry of plan.organizations) {
      if (entry.class !== 'leave' && entry.class !== 'leave-team-only') continue;
      const slice = slices.get(entry.organizationId);
      if (slice === undefined) continue;
      const left = await executeLeaveSteps(this.gateway, {
        slice,
        includeInvitations: true,
        organizationDeletionPending: isDeletionPending(
          factsByOrganization.get(entry.organizationId) ?? null,
        ),
      });
      if (left.status === 'incomplete') {
        return {
          status: 'incomplete',
          stage: left.stage,
          organizationId: entry.organizationId,
          ...(left.error === undefined ? {} : { error: left.error }),
        };
      }
    }

    // 5: ALLE eigen uitnodigingen, elke status en elke ouderdom, uit een verse read.
    const invitationsRead = await this.gateway.readInventoryFromServer({
      includeInvitations: true,
    });
    if (!invitationsRead.ok) {
      return {
        status: 'incomplete',
        stage: 'invitations',
        organizationId: null,
        error: invitationsRead.error,
      };
    }
    for (const invitation of invitationsRead.inventory.invitations) {
      const result = await this.gateway.deleteOwnInvitation({
        organizationId: invitation.organizationId,
        invitationId: invitation.invitationId,
      });
      if (!result.ok) {
        return {
          status: 'incomplete',
          stage: 'invitations',
          organizationId: invitation.organizationId,
          error: result.error,
        };
      }
    }

    // 6: harde eindpoort. Anders `incomplete` en GEEN reauth/`deleteUser`.
    const gate = await this.gateway.readInventoryFromServer({ includeInvitations: true });
    if (!gate.ok) {
      return { status: 'incomplete', stage: 'final-gate', organizationId: null, error: gate.error };
    }
    if (!isInventoryEmpty(gate.inventory)) {
      return {
        status: 'incomplete',
        stage: 'final-gate',
        organizationId: null,
        remaining: remainingCounts(gate.inventory),
      };
    }
    return { status: 'ready-for-auth-deletion' };
  }

  private async runDelete(password: string): Promise<DeleteAuthAccountOutcome> {
    const pre = await this.preconditions();
    if (!pre.ok) return pre.outcome;
    const uid = pre.value;

    // 7: reauthenticatie in DEZE aanroep, vóór de eindpoort en `deleteUser`.
    const reauth = await this.auth.reauthenticateWithPassword(password, { expectedUid: uid });
    if (!reauth.ok) return reauthFailureOutcome(reauth);

    for (let attempt = 1; ; attempt += 1) {
      // 8 — eindpoort 5', DIRECT vóór `deleteUser`: drie queries van de server, alle leeg.
      // Dit is de enige route naar `deleteCurrentUser`; een groene eindpoort uit een
      // eerdere aanroep telt niet.
      const gate = await this.gateway.readInventoryFromServer({ includeInvitations: true });
      if (!gate.ok) return readFailureOutcome(gate.error);
      if (!isInventoryEmpty(gate.inventory)) {
        return {
          status: 'incomplete',
          stage: 'final-gate',
          organizationId: null,
          remaining: remainingCounts(gate.inventory),
        };
      }

      // 9
      const deletion = await this.auth.deleteCurrentUser({ expectedUid: uid });
      if (deletion.ok) return { status: 'deleted' };

      switch (deletion.code) {
        case 'requires-recent-login': {
          if (attempt >= 2) {
            return { status: 'firestore-cleared-auth-present', reason: 'requires-recent-login' };
          }
          // B2: opnieuw reauthenticeren vlak vóór `deleteUser`; daarna opnieuw de eindpoort.
          const again = await this.auth.reauthenticateWithPassword(password, { expectedUid: uid });
          if (!again.ok) return reauthFailureOutcome(again);
          continue;
        }
        case 'not-signed-in':
          return { status: 'not-signed-in' };
        case 'unknown-state':
          return { status: 'auth-state-unknown' };
        case 'network':
        case 'other':
          return this.probeAfterFailedDelete(uid, deletion.code);
      }
    }
  }

  /**
   * Na een mislukte `deleteUser` waarvan niet zeker is of het verzoek de server bereikte:
   * alleen als een verse tokenverversing bewijst dat DIT account nog bestaat, is de
   * uitkomst "Auth-account nog aanwezig". Anders is de afloop onbekend — nooit `deleted`.
   */
  private async probeAfterFailedDelete(
    uid: string,
    reason: 'network' | 'other',
  ): Promise<DeleteAuthAccountOutcome> {
    const claim = await this.auth.readVerifiedEmailClaim();
    if (claim.ok && claim.uid === uid) return { status: 'firestore-cleared-auth-present', reason };
    return { status: 'auth-state-unknown' };
  }
}
