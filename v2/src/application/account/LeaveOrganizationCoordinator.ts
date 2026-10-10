import {
  classifyOrganizationForLeave,
  countOtherOwners,
  groupInventoryByOrganization,
  isInventoryEmpty,
  isOpenInvitation,
} from '../../domain/account/classify';
import type { OrganizationFacts, OrganizationSlice } from '../../domain/account/types';
import type { AccountGateway, AccountReadError, SelfDeleteError } from './AccountGateway';
import type { LocalUnsyncedWorkProbe } from './LocalUnsyncedWorkProbe';

export type LeaveDeniedReason =
  | 'owner-sole'
  | 'owner-awaiting-removal'
  | 'creator-needs-owner'
  | 'organization-unsupported'
  | 'organization-missing'
  | 'awaiting-organization-deletion'
  | 'organization-deletion-failed';

export type LeaveIncompleteStage =
  'team-members' | 'invitations' | 'per-org-check' | 'organization-member' | 'final-check';

export type LeaveIncompleteOutcome = {
  status: 'incomplete';
  stage: LeaveIncompleteStage;
  /**
   * De fout van de stap die stopte, als er een was. Ontbreekt wanneer een
   * server-controle (stap 5 of 7) gewoon nog eigen documenten aantrof. Er is dan
   * mogelijk WEL al iets verwijderd; opnieuw `leave()` hervat uit een verse inventaris.
   */
  error?: SelfDeleteError | AccountReadError;
};

export type LeaveOkOutcome = {
  status: 'ok';
  removed: { teamMembers: number; invitations: number; organizationMember: boolean };
  /** Informatief: er loopt een verwijderverzoek voor deze organisatie (geen blokkade). */
  organizationDeletionPending: boolean;
  /**
   * `false`: de eigen uitnodigingen in deze organisatie zijn NIET bekeken, omdat het
   * (vers ververste) token geen geverifieerde e-mailclaim had (reviewbevinding A op
   * 2b-i). Een openstaande uitnodiging kan dan nog bestaan en na vertrek claimbaar zijn
   * (restrisico R1); de aanroeper moet dat kunnen melden in plaats van "alles weg".
   */
  invitationsChecked: boolean;
};

export type LeaveOrganizationOutcome =
  | { status: 'not-signed-in' }
  | { status: 'in-progress' }
  | { status: 'offline' }
  | { status: 'failed'; reason: 'read-failed' | 'timeout' }
  /** Geen eigen membership of teamMembers-document in deze organisatie — ook: al vertrokken. */
  | { status: 'not-a-member' }
  | { status: 'denied'; reason: LeaveDeniedReason; otherOwnerCount?: number }
  | { status: 'blocked'; reason: 'local-unsynced-work'; count: number }
  | LeaveIncompleteOutcome
  | LeaveOkOutcome;

type ReadFailureOutcome = Extract<
  LeaveOrganizationOutcome,
  { status: 'not-signed-in' } | { status: 'offline' } | { status: 'failed' }
>;

/** Een mislukte read VÓÓR de eerste write: er is niets geschreven. */
function readFailureOutcome(error: AccountReadError): ReadFailureOutcome {
  switch (error.code) {
    case 'not-signed-in':
      return { status: 'not-signed-in' };
    case 'offline':
      return { status: 'offline' };
    case 'timeout':
      return { status: 'failed', reason: 'timeout' };
    case 'email-not-verified':
    case 'read-failed':
      return { status: 'failed', reason: 'read-failed' };
  }
}

/** Er loopt een verwijderverzoek voor de organisatie (`requested`/`executing`). */
export function isDeletionPending(facts: OrganizationFacts | null): boolean {
  const status = facts?.deletionRequestStatus ?? null;
  return status === 'requested' || status === 'executing';
}

/**
 * De kern van "organisatie verlaten" (stap 3–7 uit docs/pr-8.3c-2b-plan.md §C.1), los
 * van de preflight, zodat `AccountDeletionCoordinator` (2b-ii) hem per organisatie kan
 * hergebruiken. Vereist dat de aanroeper de organisatie al als `leave` of
 * `leave-team-only` heeft geclassificeerd op basis van een VERSE server-inventaris;
 * `slice` komt uit die inventaris.
 *
 * Vaste volgorde (bewijs, niet bevoegdheid — besluitrecord §4.3):
 *   3. eigen teamMembers-documenten in deze organisatie;
 *   4. eigen OPENSTAANDE (pending/accepted) uitnodigingen in deze organisatie (B3);
 *   5. per-organisatie-controle van de server: geen teamMembers en geen open uitnodiging meer;
 *   6. het eigen organizationMembers-document als LAATSTE write (alleen als het er nog is);
 *   7. eindcontrole van de server: beide eigen-uid-queries leeg voor deze organisatie.
 * Bij de eerste fout stopt de flow en volgt er GEEN volgende write.
 */
export async function executeLeaveSteps(
  gateway: AccountGateway,
  input: {
    slice: OrganizationSlice;
    includeInvitations: boolean;
    organizationDeletionPending: boolean;
    /** Het uid uit de preflight van deze flow: de gateway weigert bij een andere sessie. */
    expectedUid: string;
  },
): Promise<LeaveIncompleteOutcome | LeaveOkOutcome> {
  const { slice, includeInvitations, expectedUid } = input;
  const organizationId = slice.organizationId;
  const removed = { teamMembers: 0, invitations: 0, organizationMember: false };

  // 3 — teamMembers eerst, zolang de organisatietoegang er nog is.
  for (const team of slice.teamMemberships) {
    const result = await gateway.deleteOwnTeamMembership({
      organizationId,
      teamId: team.teamId,
      expectedUid,
    });
    if (!result.ok) return { status: 'incomplete', stage: 'team-members', error: result.error };
    if (result.outcome === 'deleted') removed.teamMembers += 1;
  }

  // 4 — eigen openstaande uitnodigingen in deze organisatie (B3); claimed/revoked blijven.
  for (const invitation of slice.invitations.filter(isOpenInvitation)) {
    const result = await gateway.deleteOwnInvitation({
      organizationId,
      invitationId: invitation.invitationId,
      expectedUid,
    });
    if (!result.ok) return { status: 'incomplete', stage: 'invitations', error: result.error };
    if (result.outcome === 'deleted') removed.invitations += 1;
  }

  // 5 — per-organisatie-controle, van de server, vóór de laatste write.
  const check = await gateway.readInventoryFromServer({ includeInvitations });
  if (!check.ok) return { status: 'incomplete', stage: 'per-org-check', error: check.error };
  const remaining = groupInventoryByOrganization(check.inventory).get(organizationId);
  if (
    remaining !== undefined &&
    (remaining.teamMemberships.length > 0 || remaining.invitations.some(isOpenInvitation))
  ) {
    return { status: 'incomplete', stage: 'per-org-check' };
  }

  // 6 — het eigen membership als LAATSTE write, alleen als de server het nog kent.
  if (remaining?.membership) {
    const result = await gateway.deleteOwnOrganizationMembership(organizationId, expectedUid);
    if (!result.ok) {
      return { status: 'incomplete', stage: 'organization-member', error: result.error };
    }
    removed.organizationMember = result.outcome === 'deleted';
  }

  // 7 — eindcontrole ná de laatste delete: beide eigen-uid-queries, van de server.
  const final = await gateway.readInventoryFromServer({ includeInvitations: false });
  if (!final.ok) return { status: 'incomplete', stage: 'final-check', error: final.error };
  if (!isInventoryEmpty(final.inventory, { organizationId })) {
    return { status: 'incomplete', stage: 'final-check' };
  }

  return {
    status: 'ok',
    removed,
    organizationDeletionPending: input.organizationDeletionPending,
    invitationsChecked: includeInvitations,
  };
}

/**
 * PR 8.3c-2b-i: "organisatie verlaten" voor een niet-owner (docs/pr-8.3c-2b-plan.md
 * §B.4–§B.6, §C.1). Bewaart NIETS: elke stap volgt uit een verse server-inventaris,
 * dus opnieuw `leave()` na een onderbreking hervat precies waar het bleef, en een
 * tweede `leave()` na een geslaagde eerste geeft `not-a-member` zonder één write.
 *
 *   0. identiteit uit een VERS ververst token (offline → `offline`, geen sessie →
 *      `not-signed-in`); een lopende leave voor dezelfde organisatie op
 *      deze instantie → `in-progress`;
 *   1. inventaris (server; uitnodigingen alleen met een geverifieerde e-mailclaim);
 *      organisatie niet in de inventaris → `not-a-member` (geen write);
 *   2. feiten (alleen bij een eigen membership) + lokale-werkprobe + classificatie;
 *      niet zelf op te lossen → `denied`/`blocked` (geen write);
 *   3–7. `executeLeaveSteps()`.
 *
 * De `organizationId` uit de aanroep wordt nooit rechtstreeks als pad gebruikt: hij
 * selecteert alleen een regel uit de inventaris.
 */
export class LeaveOrganizationCoordinator {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly gateway: AccountGateway,
    private readonly probe: LocalUnsyncedWorkProbe,
  ) {}

  async leave(organizationId: string): Promise<LeaveOrganizationOutcome> {
    // Synchroon, vóór de eerste await: twee gelijktijdige aanroepen zien elkaar altijd.
    if (this.inFlight.has(organizationId)) return { status: 'in-progress' };
    this.inFlight.add(organizationId);
    try {
      return await this.run(organizationId);
    } finally {
      this.inFlight.delete(organizationId);
    }
  }

  private async run(organizationId: string): Promise<LeaveOrganizationOutcome> {
    // 0
    const identityRead = await this.gateway.readIdentity();
    if (!identityRead.ok) return readFailureOutcome(identityRead.error);
    const identity = identityRead.identity;
    const includeInvitations = identity.emailVerified && identity.email !== null;

    // 1
    const inventoryRead = await this.gateway.readInventoryFromServer({ includeInvitations });
    if (!inventoryRead.ok) return readFailureOutcome(inventoryRead.error);
    const slice = groupInventoryByOrganization(inventoryRead.inventory).get(organizationId);
    if (slice === undefined || (slice.membership === null && slice.teamMemberships.length === 0)) {
      // Alleen eigen uitnodigingen (of niets): geen lidmaatschap om te verlaten.
      return { status: 'not-a-member' };
    }

    // 2
    let facts: OrganizationFacts | null = null;
    if (slice.membership !== null) {
      const factsRead = await this.gateway.readOrganizationFacts(organizationId);
      if (!factsRead.ok) return readFailureOutcome(factsRead.error);
      facts = factsRead.facts;
    }
    const localUnsyncedWork = this.probe.countForOrganization(organizationId);
    const organizationClass = classifyOrganizationForLeave({
      callerUid: identity.uid,
      slice,
      facts,
      localUnsyncedWork,
    });

    switch (organizationClass) {
      case 'leave':
      case 'leave-team-only':
        break;
      case 'local-unsynced-work':
        return { status: 'blocked', reason: 'local-unsynced-work', count: localUnsyncedWork };
      case 'invitations-only':
        return { status: 'not-a-member' };
      case 'owner-sole':
      case 'owner-awaiting-removal':
        return {
          status: 'denied',
          reason: organizationClass,
          otherOwnerCount: facts === null ? 0 : countOtherOwners(facts, identity.uid),
        };
      default:
        return { status: 'denied', reason: organizationClass };
    }

    // 3–7
    return executeLeaveSteps(this.gateway, {
      slice,
      includeInvitations,
      organizationDeletionPending: isDeletionPending(facts),
      expectedUid: identity.uid,
    });
  }
}
