import {
  checkCompleteTarget,
  checkPromoteTarget,
  isFootprintEmpty,
  isOwnerRole,
  isReadyForMemberRemoval,
  splitTransferMembers,
  type TransferMember,
} from '../../domain/account/transfer';
import type {
  OwnershipTransferGateway,
  TransferCaller,
  TransferReadError,
  TransferWriteError,
} from './OwnershipTransferGateway';

/** Een mislukte read VÓÓR de eerste write: er is niets geschreven. */
export type TransferReadFailureOutcome =
  | { status: 'not-signed-in' }
  | { status: 'offline' }
  | { status: 'failed'; reason: 'read-failed' | 'timeout' };

export type TransferDeniedReason =
  /** De aanroeper heeft (volgens de server) geen membership in deze organisatie. */
  | 'not-a-member'
  /** De aanroeper is geen owner. Alleen een owner mag promoveren of een owner verwijderen. */
  | 'not-owner'
  /** Het doel is de aanroeper zelf (zichzelf promoveren of verwijderen kan nooit). */
  | 'self'
  /** `completeTransfer` alleen op een ANDERE owner (besluit B9). */
  | 'target-not-owner';

export type TransferRejectedReason =
  /** De rol van het doel veranderde tussen lezen en schrijven; er is niets geschreven. */
  | 'target-changed'
  /** Rules weigerden (bijv. de aanroeper verloor zijn ownerrol tijdens de flow). */
  | 'permission-denied';

export type TransferCandidatesOutcome =
  | TransferReadFailureOutcome
  | { status: 'denied'; reason: 'not-a-member' | 'not-owner' }
  | { status: 'ok'; candidates: TransferMember[]; otherOwners: TransferMember[] };

export type PromoteOutcome =
  | TransferReadFailureOutcome
  | { status: 'in-progress' }
  | { status: 'denied'; reason: 'not-a-member' | 'not-owner' | 'self' }
  /** Het doel is (volgens de server) geen lid van deze organisatie; niets geschreven. */
  | { status: 'not-found' }
  | { status: 'rejected'; reason: TransferRejectedReason }
  /** Geen serverantwoord; de promotie kan later alsnog landen. Opnieuw `promote()` beslist. */
  | { status: 'timeout' }
  | { status: 'failed'; reason: 'write-failed' }
  /** `already-owner`: idempotent — het doel was al owner, er is niets geschreven. */
  | { status: 'ok'; outcome: 'promoted' | 'already-owner' };

export type CompleteTransferStage =
  'invitations' | 'team-members' | 'pre-removal-check' | 'organization-member' | 'final-check';

export type CompleteTransferOutcome =
  | TransferReadFailureOutcome
  | { status: 'in-progress' }
  | { status: 'denied'; reason: TransferDeniedReason }
  /** De vorige owner is (volgens de server) geen lid meer — ook: overdracht al afgerond. */
  | { status: 'not-found' }
  /**
   * Rules of de rolvoorwaarde hielden een write tegen. Bij `stage` ná `invitations` kan
   * er al iets geschreven zijn (ingetrokken uitnodigingen, verwijderde teamMembers); het
   * membership van de vorige owner staat dan nog.
   */
  | { status: 'rejected'; stage: CompleteTransferStage; reason: TransferRejectedReason }
  /**
   * Er is mogelijk WEL al iets geschreven; opnieuw `completeTransfer()` hervat uit een
   * verse server-lezing. `error` ontbreekt wanneer een server-controle gewoon nog
   * documenten aantrof.
   */
  | {
      status: 'incomplete';
      stage: CompleteTransferStage;
      error?: TransferWriteError | TransferReadError;
    }
  | {
      status: 'ok';
      revokedInvitations: number;
      /** Uitnodigingen zonder leesbaar `email`-veld die bij het intrekken zijn overgeslagen. */
      skippedMalformedInvitations: number;
      removedTeamMemberships: number;
      organizationMember: 'deleted' | 'already-gone';
    };

function readFailure(error: TransferReadError): TransferReadFailureOutcome {
  switch (error.code) {
    case 'not-signed-in':
      return { status: 'not-signed-in' };
    case 'offline':
      return { status: 'offline' };
    case 'timeout':
      return { status: 'failed', reason: 'timeout' };
    case 'read-failed':
      return { status: 'failed', reason: 'read-failed' };
  }
}

type CallerCheck =
  | { ok: true; caller: TransferCaller }
  | {
      ok: false;
      outcome:
        TransferReadFailureOutcome | { status: 'denied'; reason: 'not-a-member' | 'not-owner' };
    };

/**
 * PR 8.3c-2b-iii: overdracht van het eigenaarschap als tweestapsflow
 * (docs/pr-8.3c-2b-plan.md §B.8, besluitrecord §4.2) plus het intrekken van openstaande
 * uitnodigingen van de vertrekkende owner (§B.7 punt 2).
 *
 *   1. `promote(orgId, B)` door owner A: B (een bestaand niet-owner-lid) wordt owner.
 *      A blijft owner; "wacht op bevestiging door de nieuwe eigenaar" is afleidbaar
 *      (klasse `owner-awaiting-removal` in 2b-i), niet opgeslagen.
 *   2. `completeTransfer(orgId, A)` door owner B ("andere eigenaar verwijderen", B9):
 *      (a) A's openstaande uitnodigingen in deze organisatie intrekken, (b) A's
 *      teamMembers-documenten in alle teams verwijderen, controle van de server, (c) A's
 *      membership als LAATSTE write, (d) eindcontrole van de server.
 *
 * Bewaart NIETS: elke aanroep begint met een gezaghebbende owner-check (server) en een
 * verse ledenlijst; opnieuw aanroepen na een onderbreking hervat, en een tweede
 * `completeTransfer` na een geslaagde eerste geeft `not-found` zonder één write.
 * Eén slot over beide schrijfmethoden: een tweede gelijktijdige aanroep → `in-progress`.
 *
 * Restrisico R2 (§F) blijft bewust staan: verwijdert B een maker A binnen 7 dagen na
 * `createdAt`, dan kan A zich via de bootstrap-create weer owner maken. Dit stuk
 * verandert de Rules niet.
 */
export class OwnershipTransferCoordinator {
  private busy = false;

  constructor(private readonly gateway: OwnershipTransferGateway) {}

  /** Read-only: niet-owner-leden (kandidaten voor A) en andere owners (doelen voor B). */
  async listTransferCandidates(organizationId: string): Promise<TransferCandidatesOutcome> {
    const callerCheck = await this.requireOwner(organizationId);
    if (!callerCheck.ok) return callerCheck.outcome;
    const members = await this.gateway.listOrganizationMembers(organizationId);
    if (!members.ok) return readFailure(members.error);
    return { status: 'ok', ...splitTransferMembers(members.members, callerCheck.caller.uid) };
  }

  async promote(organizationId: string, targetUid: string): Promise<PromoteOutcome> {
    if (this.busy) return { status: 'in-progress' };
    this.busy = true;
    try {
      return await this.runPromote(organizationId, targetUid);
    } finally {
      this.busy = false;
    }
  }

  async completeTransfer(
    organizationId: string,
    previousOwnerUid: string,
  ): Promise<CompleteTransferOutcome> {
    if (this.busy) return { status: 'in-progress' };
    this.busy = true;
    try {
      return await this.runCompleteTransfer(organizationId, previousOwnerUid);
    } finally {
      this.busy = false;
    }
  }

  /** Gezaghebbende owner-check vóór elke andere read of write (identiteit uit de sessie). */
  private async requireOwner(organizationId: string): Promise<CallerCheck> {
    const read = await this.gateway.readCaller(organizationId);
    if (!read.ok) return { ok: false, outcome: readFailure(read.error) };
    if (read.caller === null) {
      return { ok: false, outcome: { status: 'denied', reason: 'not-a-member' } };
    }
    if (!isOwnerRole(read.caller.role)) {
      return { ok: false, outcome: { status: 'denied', reason: 'not-owner' } };
    }
    return { ok: true, caller: read.caller };
  }

  private async runPromote(organizationId: string, targetUid: string): Promise<PromoteOutcome> {
    const callerCheck = await this.requireOwner(organizationId);
    if (!callerCheck.ok) return callerCheck.outcome;
    // Vóór elke verdere read: zichzelf promoveren is nooit een overdracht.
    if (targetUid === callerCheck.caller.uid) return { status: 'denied', reason: 'self' };

    const members = await this.gateway.listOrganizationMembers(organizationId);
    if (!members.ok) return readFailure(members.error);
    const check = checkPromoteTarget(members.members, callerCheck.caller.uid, targetUid);
    if (!check.ok) {
      return check.reason === 'self'
        ? { status: 'denied', reason: 'self' }
        : { status: 'not-found' };
    }
    if (check.alreadyOwner) return { status: 'ok', outcome: 'already-owner' };

    const result = await this.gateway.promoteToOwner(organizationId, targetUid, check.target.role);
    if (result.ok) return { status: 'ok', outcome: result.outcome };
    return promoteFailure(result.error);
  }

  private async runCompleteTransfer(
    organizationId: string,
    previousOwnerUid: string,
  ): Promise<CompleteTransferOutcome> {
    const callerCheck = await this.requireOwner(organizationId);
    if (!callerCheck.ok) return callerCheck.outcome;
    if (previousOwnerUid === callerCheck.caller.uid) return { status: 'denied', reason: 'self' };

    const members = await this.gateway.listOrganizationMembers(organizationId);
    if (!members.ok) return readFailure(members.error);
    const check = checkCompleteTarget(members.members, callerCheck.caller.uid, previousOwnerUid);
    if (!check.ok) {
      return check.reason === 'not-found'
        ? { status: 'not-found' }
        : { status: 'denied', reason: check.reason };
    }
    // Het adres komt uit A's membership (server-read), nooit uit invoer (§B.7 punt 2).
    const { email } = check.target;

    // (a) Openstaande uitnodigingen op A's adres in deze organisatie intrekken (R1).
    const revoked = await this.gateway.revokeOpenInvitationsForEmail(organizationId, email);
    if (!revoked.ok) return stepFailure('invitations', revoked.error);

    // (b) A's teamMembers-documenten in alle teams van deze organisatie.
    const teams = await this.gateway.removeTeamMembershipsOf(organizationId, previousOwnerUid);
    if (!teams.ok) return stepFailure('team-members', teams.error);

    // Controle van de server vóór de laatste write: niets open, geen teamMembers meer.
    const before = await this.gateway.readMemberFootprint(organizationId, previousOwnerUid, email);
    if (!before.ok)
      return { status: 'incomplete', stage: 'pre-removal-check', error: before.error };
    if (!isReadyForMemberRemoval(before.footprint)) {
      return { status: 'incomplete', stage: 'pre-removal-check' };
    }

    // (c) A's membership als LAATSTE write, alleen als A (atomair gelezen) nog owner is.
    let organizationMember: 'deleted' | 'already-gone' = 'already-gone';
    if (before.footprint.organizationMember) {
      const removed = await this.gateway.removeOrganizationMember(
        organizationId,
        previousOwnerUid,
        'organizationOwner',
      );
      if (!removed.ok) return stepFailure('organization-member', removed.error);
      organizationMember = removed.outcome;
    }

    // (d) Eindcontrole van de server, ná de laatste write.
    const final = await this.gateway.readMemberFootprint(organizationId, previousOwnerUid, email);
    if (!final.ok) return { status: 'incomplete', stage: 'final-check', error: final.error };
    if (!isFootprintEmpty(final.footprint)) return { status: 'incomplete', stage: 'final-check' };

    return {
      status: 'ok',
      revokedInvitations: revoked.revoked,
      skippedMalformedInvitations: revoked.skippedMalformed,
      removedTeamMemberships: teams.removed,
      organizationMember,
    };
  }
}

function promoteFailure(error: TransferWriteError): PromoteOutcome {
  switch (error.code) {
    case 'role-changed':
      return { status: 'rejected', reason: 'target-changed' };
    case 'rejected':
      return { status: 'rejected', reason: 'permission-denied' };
    case 'not-found':
      return { status: 'not-found' };
    case 'self-target':
      return { status: 'denied', reason: 'self' };
    case 'timeout':
      return { status: 'timeout' };
    case 'offline':
      return { status: 'offline' };
    case 'not-signed-in':
      return { status: 'not-signed-in' };
    case 'failed':
      return { status: 'failed', reason: 'write-failed' };
  }
}

function stepFailure(
  stage: CompleteTransferStage,
  error: TransferWriteError,
): CompleteTransferOutcome {
  switch (error.code) {
    case 'role-changed':
      return { status: 'rejected', stage, reason: 'target-changed' };
    case 'rejected':
      return { status: 'rejected', stage, reason: 'permission-denied' };
    case 'self-target':
      return { status: 'denied', reason: 'self' };
    default:
      return { status: 'incomplete', stage, error };
  }
}
