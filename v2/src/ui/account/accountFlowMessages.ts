import { translate, type Lang, type StringKey } from '../../i18n/strings';
import type { AccountReadError, SelfDeleteError } from '../../application/account/AccountGateway';
import type {
  AccountDeletionIncompleteStage,
  ReauthFailedOutcome,
} from '../../application/account/AccountDeletionCoordinator';
import type { LeaveDeniedReason } from '../../application/account/LeaveOrganizationCoordinator';
import {
  isRetryableTransferOutcome,
  type AccountDeletionStopOutcome,
  type CompleteTransferFlowOutcome,
  type LeaveFlowOutcome,
  type PromoteFlowOutcome,
  type TransferListStopOutcome,
} from '../../application/account/useAccountFlow';
import type {
  CompleteTransferStage,
  TransferDeniedReason,
  TransferRejectedReason,
} from '../../application/account/OwnershipTransferCoordinator';
import type {
  TransferReadError,
  TransferWriteError,
} from '../../application/account/OwnershipTransferGateway';
import type { TransferMember } from '../../domain/account/transfer';
import type { OrganizationRole } from '../../domain/organizations/types';
import type { AccountDeletionPlanEntry } from '../../domain/account/plan';
import type { OrganizationLeaveClass } from '../../domain/account/types';

/**
 * PR 8.3c-2c-i (docs/pr-8.3c-2c-plan.md §3): de VASTE mapping van elke uitkomst van
 * `LeaveOrganizationCoordinator` en `AccountDeletionCoordinator` naar tekstsleutels.
 * Puur en exhaustief (`switch` zonder default): een nieuwe uitkomst in de coördinator
 * laat `tsc` falen tot hij hier een tekst krijgt. De UI rendert alleen wat hieruit komt.
 */
export interface MessageLine {
  key: StringKey;
  params?: Record<string, string | number>;
}

export function formatLine(lang: Lang, line: MessageLine): string {
  let text = translate(lang, line.key);
  for (const [name, value] of Object.entries(line.params ?? {})) {
    text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

const NOTHING_CHANGED: MessageLine = { key: 'accountNothingChanged' };

export function stageKey(stage: AccountDeletionIncompleteStage): StringKey {
  switch (stage) {
    case 'team-members':
      return 'accountStageTeamMembers';
    case 'invitations':
      return 'accountStageInvitations';
    case 'per-org-check':
      return 'accountStagePerOrgCheck';
    case 'organization-member':
      return 'accountStageOrganizationMember';
    case 'final-check':
      return 'accountStageFinalCheck';
    case 'final-gate':
      return 'accountStageFinalGate';
  }
}

export function stepErrorKey(error: SelfDeleteError | AccountReadError): StringKey {
  switch (error.code) {
    case 'rejected':
      return 'accountStepErrorRejected';
    case 'timeout':
      return 'accountStepErrorTimeout';
    case 'offline':
      return 'accountStepErrorOffline';
    case 'not-signed-in':
      return 'accountStepErrorNotSignedIn';
    case 'failed':
      return 'accountStepErrorFailed';
    case 'read-failed':
      return 'accountStepErrorReadFailed';
    case 'email-not-verified':
      return 'accountStepErrorEmailNotVerified';
  }
}

function leaveDeniedKey(reason: LeaveDeniedReason): StringKey {
  switch (reason) {
    case 'owner-sole':
      return 'leaveOrgDeniedOwnerSole';
    case 'owner-awaiting-removal':
      return 'leaveOrgDeniedOwnerAwaitingRemoval';
    case 'creator-needs-owner':
      return 'leaveOrgDeniedCreatorNeedsOwner';
    case 'organization-unsupported':
      return 'leaveOrgDeniedUnsupported';
    case 'organization-missing':
      return 'leaveOrgDeniedMissing';
    case 'awaiting-organization-deletion':
      return 'leaveOrgDeniedAwaitingDeletion';
    case 'organization-deletion-failed':
      return 'leaveOrgDeniedDeletionFailed';
  }
}

export interface OutcomeView {
  tone: 'success' | 'error';
  lines: MessageLine[];
  /** Mag de gebruiker dezelfde actie opnieuw starten (hervatbaar of tijdelijk)? */
  canRetry: boolean;
}

export function leaveOutcomeView(outcome: LeaveFlowOutcome, organizationName: string): OutcomeView {
  switch (outcome.status) {
    case 'ok': {
      const lines: MessageLine[] = [{ key: 'leaveOrgOk', params: { org: organizationName } }];
      if (!outcome.invitationsChecked) lines.push({ key: 'leaveOrgOkInvitationsUnchecked' });
      if (outcome.organizationDeletionPending) lines.push({ key: 'leaveOrgOkDeletionPending' });
      return { tone: 'success', lines, canRetry: false };
    }
    case 'not-signed-in':
      return { tone: 'error', lines: [{ key: 'leaveOrgNotSignedIn' }], canRetry: false };
    case 'in-progress':
      return { tone: 'error', lines: [{ key: 'accountActionBusy' }], canRetry: true };
    case 'offline':
      return {
        tone: 'error',
        lines: [{ key: 'leaveOrgOffline' }, NOTHING_CHANGED],
        canRetry: true,
      };
    case 'failed':
      return {
        tone: 'error',
        lines: [
          { key: outcome.reason === 'timeout' ? 'leaveOrgFailedTimeout' : 'leaveOrgFailedRead' },
          NOTHING_CHANGED,
        ],
        canRetry: true,
      };
    case 'not-a-member':
      return {
        tone: 'error',
        lines: [{ key: 'leaveOrgNotAMember' }, NOTHING_CHANGED],
        canRetry: false,
      };
    case 'denied':
      return {
        tone: 'error',
        lines: [
          {
            key: leaveDeniedKey(outcome.reason),
            params: { count: outcome.otherOwnerCount ?? 0 },
          },
          NOTHING_CHANGED,
        ],
        canRetry: false,
      };
    case 'blocked':
      return {
        tone: 'error',
        lines: [
          { key: 'leaveOrgBlockedLocalWork', params: { count: outcome.count } },
          NOTHING_CHANGED,
        ],
        canRetry: false,
      };
    case 'incomplete': {
      const lines: MessageLine[] = [
        { key: 'leaveOrgIncomplete' },
        { key: stageKey(outcome.stage) },
      ];
      if (outcome.error !== undefined) lines.push({ key: stepErrorKey(outcome.error) });
      return { tone: 'error', lines, canRetry: true };
    }
    case 'unexpected':
      return { tone: 'error', lines: [{ key: 'leaveOrgIncomplete' }], canRetry: true };
  }
}

export function deletionClassKey(organizationClass: OrganizationLeaveClass): StringKey {
  switch (organizationClass) {
    case 'leave':
      return 'accountDeleteClassLeave';
    case 'leave-team-only':
      return 'accountDeleteClassLeaveTeamOnly';
    case 'invitations-only':
      return 'accountDeleteClassInvitationsOnly';
    case 'owner-sole':
      return 'accountDeleteClassOwnerSole';
    case 'owner-awaiting-removal':
      return 'accountDeleteClassOwnerAwaitingRemoval';
    case 'creator-needs-owner':
      return 'accountDeleteClassCreatorNeedsOwner';
    case 'awaiting-organization-deletion':
      return 'accountDeleteClassAwaitingDeletion';
    case 'organization-deletion-failed':
      return 'accountDeleteClassDeletionFailed';
    case 'organization-unsupported':
      return 'accountDeleteClassUnsupported';
    case 'organization-missing':
      return 'accountDeleteClassMissing';
    case 'local-unsynced-work':
      return 'accountDeleteClassLocalWork';
  }
}

export function deletionClassLine(entry: AccountDeletionPlanEntry): MessageLine {
  return {
    key: deletionClassKey(entry.class),
    params: { count: entry.otherOwnerCount ?? entry.localUnsyncedWork ?? 0 },
  };
}

export function reauthErrorKey(reason: ReauthFailedOutcome['reason']): StringKey {
  switch (reason) {
    case 'wrong-password':
      return 'accountDeleteWrongPassword';
    case 'too-many-requests':
      return 'accountDeleteTooManyRequests';
    case 'network':
      return 'accountDeleteReauthNetwork';
    case 'other':
      return 'accountDeleteReauthOther';
  }
}

export interface DeletionStopView extends OutcomeView {
  /** Wat "Opnieuw proberen" doet: opnieuw beoordelen, of alleen de Auth-stap opnieuw. */
  retry: 'assess' | 'auth-delete' | null;
  offerVerificationMail: boolean;
}

export function deletionStopView(outcome: AccountDeletionStopOutcome): DeletionStopView {
  const base = { tone: 'error' as const, offerVerificationMail: false };
  switch (outcome.status) {
    case 'in-progress':
      return { ...base, lines: [{ key: 'accountActionBusy' }], canRetry: true, retry: 'assess' };
    case 'not-signed-in':
      return {
        ...base,
        lines: [{ key: 'accountDeleteNotSignedIn' }],
        canRetry: false,
        retry: null,
      };
    case 'email-not-verified':
      return {
        ...base,
        lines: [{ key: 'accountDeleteEmailNotVerified' }],
        canRetry: true,
        retry: 'assess',
        offerVerificationMail: true,
      };
    case 'offline':
      return { ...base, lines: [{ key: 'accountDeleteOffline' }], canRetry: true, retry: 'assess' };
    case 'failed':
      return {
        ...base,
        lines: [
          {
            key:
              outcome.reason === 'timeout'
                ? 'accountDeleteFailedTimeout'
                : 'accountDeleteFailedRead',
          },
        ],
        canRetry: true,
        retry: 'assess',
      };
    case 'auth-state-unknown':
      return {
        ...base,
        lines: [{ key: 'accountDeleteAuthStateUnknown' }],
        canRetry: false,
        retry: null,
      };
    case 'incomplete': {
      const lines: MessageLine[] = [];
      if (outcome.stage === 'final-gate' && outcome.remaining !== undefined) {
        lines.push({
          key: 'accountDeleteIncompleteFinalGate',
          params: {
            members: outcome.remaining.organizationMembers,
            teams: outcome.remaining.teamMembers,
            invitations: outcome.remaining.invitations,
          },
        });
      } else {
        lines.push({ key: 'accountDeleteIncomplete' }, { key: stageKey(outcome.stage) });
      }
      if (outcome.error !== undefined) lines.push({ key: stepErrorKey(outcome.error) });
      return { ...base, lines, canRetry: true, retry: 'assess' };
    }
    case 'firestore-cleared-auth-present':
      return {
        ...base,
        lines: [
          { key: 'accountDeleteClearedAuthPresent' },
          {
            key:
              outcome.reason === 'requires-recent-login'
                ? 'accountDeleteReasonRecentLogin'
                : outcome.reason === 'network'
                  ? 'accountDeleteReasonNetwork'
                  : 'accountDeleteReasonOther',
          },
        ],
        canRetry: true,
        retry: 'auth-delete',
      };
    case 'unexpected':
      return {
        ...base,
        lines: [{ key: 'accountDeleteIncomplete' }],
        canRetry: true,
        retry: 'assess',
      };
  }
}

// ---------------------------------------------------------------------------------------
// PR 8.3c-2c-ii (docs/pr-8.3c-2c-plan.md §8): overdracht. Elke uitkomst van
// `listTransferCandidates`, `promote` en `completeTransfer` krijgt hier zijn sleutels.
// ---------------------------------------------------------------------------------------

/**
 * Het zichtbare label van een lid: het e-mailadres uit de serverlezing. Ontbreekt dat (zou
 * de converter niet doorlaten, maar fail safe), dan een neutraal label, nooit de uid.
 */
export function transferMemberLabel(lang: Lang, member: TransferMember): string {
  const email = member.email.trim();
  return email.length > 0 ? email : translate(lang, 'transferMemberNoEmail');
}

export function transferRoleKey(role: OrganizationRole): StringKey {
  switch (role) {
    case 'organizationOwner':
      return 'transferRoleOwner';
    case 'organizationAdmin':
      return 'transferRoleAdmin';
    case 'coach':
      return 'transferRoleCoach';
    case 'scorer':
      return 'transferRoleScorer';
    case 'viewer':
      return 'transferRoleViewer';
  }
}

export function transferStageKey(stage: CompleteTransferStage): StringKey {
  switch (stage) {
    case 'invitations':
      return 'transferStageInvitations';
    case 'team-members':
      return 'transferStageTeamMembers';
    case 'pre-removal-check':
      return 'transferStagePreRemovalCheck';
    case 'organization-member':
      return 'transferStageOrganizationMember';
    case 'final-check':
      return 'transferStageFinalCheck';
  }
}

export function transferStepErrorKey(error: TransferWriteError | TransferReadError): StringKey {
  switch (error.code) {
    case 'rejected':
      return 'accountStepErrorRejected';
    case 'role-changed':
      return 'transferStepErrorRoleChanged';
    case 'not-found':
      return 'transferStepErrorNotFound';
    case 'self-target':
      return 'transferStepErrorSelf';
    case 'timeout':
      return 'accountStepErrorTimeout';
    case 'offline':
      return 'accountStepErrorOffline';
    case 'not-signed-in':
      return 'accountStepErrorNotSignedIn';
    case 'failed':
      return 'accountStepErrorFailed';
    case 'read-failed':
      return 'accountStepErrorReadFailed';
  }
}

function transferDeniedKey(reason: TransferDeniedReason): StringKey {
  switch (reason) {
    case 'not-a-member':
      return 'transferDeniedNotAMember';
    case 'not-owner':
      return 'transferDeniedNotOwner';
    case 'self':
      return 'transferDeniedSelf';
    case 'target-not-owner':
      return 'transferDeniedTargetNotOwner';
  }
}

function transferRejectedKey(reason: TransferRejectedReason): StringKey {
  return reason === 'target-changed'
    ? 'transferRejectedTargetChanged'
    : 'transferRejectedPermission';
}

/** Gedeeld door de drie methoden: een mislukte read vóór de eerste write, of het slot. */
type TransferCommonOutcome = Extract<
  TransferListStopOutcome,
  | { status: 'not-signed-in' }
  | { status: 'offline' }
  | { status: 'failed'; reason: 'read-failed' | 'timeout' }
  | { status: 'in-progress' }
>;

function transferCommonView(outcome: TransferCommonOutcome): OutcomeView {
  const canRetry = isRetryableTransferOutcome(outcome);
  switch (outcome.status) {
    case 'not-signed-in':
      return { tone: 'error', lines: [{ key: 'transferNotSignedIn' }], canRetry };
    case 'in-progress':
      return { tone: 'error', lines: [{ key: 'accountActionBusy' }], canRetry };
    case 'offline':
      return { tone: 'error', lines: [{ key: 'transferOffline' }, NOTHING_CHANGED], canRetry };
    case 'failed':
      return {
        tone: 'error',
        lines: [
          {
            key: outcome.reason === 'timeout' ? 'transferFailedTimeout' : 'transferFailedRead',
          },
          NOTHING_CHANGED,
        ],
        canRetry,
      };
  }
}

export function transferListStopView(outcome: TransferListStopOutcome): OutcomeView {
  switch (outcome.status) {
    case 'denied':
      return {
        tone: 'error',
        lines: [{ key: transferDeniedKey(outcome.reason) }, NOTHING_CHANGED],
        canRetry: isRetryableTransferOutcome(outcome),
      };
    case 'unexpected':
      return {
        tone: 'error',
        lines: [{ key: 'transferFailedRead' }, NOTHING_CHANGED],
        canRetry: isRetryableTransferOutcome(outcome),
      };
    default:
      return transferCommonView(outcome);
  }
}

export function promoteOutcomeView(
  outcome: PromoteFlowOutcome,
  member: string,
  organizationName: string,
): OutcomeView {
  const params = { member, org: organizationName };
  const canRetry = isRetryableTransferOutcome(outcome);
  switch (outcome.status) {
    case 'ok':
      return {
        tone: 'success',
        lines: [
          {
            key:
              outcome.outcome === 'promoted' ? 'transferPromoteOk' : 'transferPromoteAlreadyOwner',
            params,
          },
          { key: 'transferPromoteAwaiting', params },
        ],
        canRetry,
      };
    case 'denied':
      return {
        tone: 'error',
        lines: [{ key: transferDeniedKey(outcome.reason), params }, NOTHING_CHANGED],
        canRetry,
      };
    case 'not-found':
      return {
        tone: 'error',
        lines: [{ key: 'transferPromoteNotFound', params }, NOTHING_CHANGED],
        canRetry,
      };
    case 'rejected':
      return {
        tone: 'error',
        lines: [{ key: transferRejectedKey(outcome.reason), params }, NOTHING_CHANGED],
        canRetry,
      };
    case 'timeout':
      return { tone: 'error', lines: [{ key: 'transferPromoteTimeout', params }], canRetry };
    case 'failed':
      if (outcome.reason === 'write-failed') {
        return { tone: 'error', lines: [{ key: 'transferPromoteFailedWrite', params }], canRetry };
      }
      return transferCommonView({ status: 'failed', reason: outcome.reason });
    case 'unexpected':
      return { tone: 'error', lines: [{ key: 'transferPromoteFailedWrite', params }], canRetry };
    default:
      return transferCommonView(outcome);
  }
}

export function completeTransferOutcomeView(
  outcome: CompleteTransferFlowOutcome,
  member: string,
  organizationName: string,
): OutcomeView {
  const params = { member, org: organizationName };
  const canRetry = isRetryableTransferOutcome(outcome);
  switch (outcome.status) {
    case 'ok': {
      const lines: MessageLine[] = [
        { key: 'transferCompleteOk', params },
        {
          key: 'transferCompleteCounts',
          params: {
            invitations: outcome.revokedInvitations,
            teams: outcome.removedTeamMemberships,
          },
        },
      ];
      if (outcome.skippedMalformedInvitations > 0) {
        lines.push({
          key: 'transferCompleteSkippedMalformed',
          params: { count: outcome.skippedMalformedInvitations },
        });
      }
      if (outcome.organizationMember === 'already-gone') {
        lines.push({ key: 'transferCompleteAlreadyGone', params });
      }
      return { tone: 'success', lines, canRetry };
    }
    case 'not-found':
      return { tone: 'success', lines: [{ key: 'transferCompleteNotFound', params }], canRetry };
    case 'denied':
      return {
        tone: 'error',
        lines: [{ key: transferDeniedKey(outcome.reason), params }, NOTHING_CHANGED],
        canRetry,
      };
    case 'rejected':
      return {
        tone: 'error',
        lines: [
          { key: transferRejectedKey(outcome.reason), params },
          { key: transferStageKey(outcome.stage) },
          { key: 'transferCompletePartial', params },
        ],
        canRetry,
      };
    case 'incomplete': {
      const lines: MessageLine[] = [
        { key: 'transferCompleteIncomplete', params },
        { key: transferStageKey(outcome.stage) },
      ];
      if (outcome.error !== undefined) lines.push({ key: transferStepErrorKey(outcome.error) });
      return { tone: 'error', lines, canRetry };
    }
    case 'unexpected':
      return { tone: 'error', lines: [{ key: 'transferCompleteIncomplete', params }], canRetry };
    default:
      return transferCommonView(outcome);
  }
}
