// PR 8.3c-2c-ii — de vaste mapping uitkomst → tekst voor de overdracht
// (docs/pr-8.3c-2c-plan.md §8). Bewijst voor ELKE uitkomst van `listTransferCandidates`,
// `promote` en `completeTransfer` dat er in NL én EN een niet-lege tekst zonder
// overgebleven placeholder uitkomt, welke sleutels erbij horen, of "Opnieuw" mag, en dat
// een lid nooit met zijn uid wordt aangeduid.
import { describe, it, expect } from 'vitest';
import { STRINGS, translate, type Lang, type StringKey } from '../../src/i18n/strings';
import {
  completeTransferOutcomeView,
  formatLine,
  promoteOutcomeView,
  transferListStopView,
  transferMemberLabel,
  transferRoleKey,
  transferStageKey,
  transferStepErrorKey,
  type OutcomeView,
} from '../../src/ui/account/accountFlowMessages';
import {
  isRetryableTransferOutcome,
  isTransferConfirmationValid,
  type CompleteTransferFlowOutcome,
  type PromoteFlowOutcome,
  type TransferListStopOutcome,
} from '../../src/application/account/useAccountFlow';
import { ORGANIZATION_ROLES } from '../../src/domain/organizations/types';
import type { TransferMember } from '../../src/domain/account/transfer';

const LANGS: Lang[] = ['nl', 'en'];
const MEMBER = 'b.fictief@example.test';
const ORG = 'Fictieve Adelaars';

type Row<T> = [label: string, outcome: T, keys: StringKey[], retry: boolean];

const LIST: Row<TransferListStopOutcome>[] = [
  ['not-signed-in', { status: 'not-signed-in' }, ['transferNotSignedIn'], false],
  ['in-progress', { status: 'in-progress' }, ['accountActionBusy'], true],
  ['offline', { status: 'offline' }, ['transferOffline', 'accountNothingChanged'], true],
  [
    'failed/read-failed',
    { status: 'failed', reason: 'read-failed' },
    ['transferFailedRead', 'accountNothingChanged'],
    true,
  ],
  [
    'failed/timeout',
    { status: 'failed', reason: 'timeout' },
    ['transferFailedTimeout', 'accountNothingChanged'],
    true,
  ],
  [
    'denied/not-a-member',
    { status: 'denied', reason: 'not-a-member' },
    ['transferDeniedNotAMember', 'accountNothingChanged'],
    false,
  ],
  [
    'denied/not-owner',
    { status: 'denied', reason: 'not-owner' },
    ['transferDeniedNotOwner', 'accountNothingChanged'],
    false,
  ],
  ['unexpected', { status: 'unexpected' }, ['transferFailedRead', 'accountNothingChanged'], true],
];

const PROMOTE: Row<PromoteFlowOutcome>[] = [
  [
    'ok/promoted',
    { status: 'ok', outcome: 'promoted' },
    ['transferPromoteOk', 'transferPromoteAwaiting'],
    false,
  ],
  [
    'ok/already-owner',
    { status: 'ok', outcome: 'already-owner' },
    ['transferPromoteAlreadyOwner', 'transferPromoteAwaiting'],
    false,
  ],
  ['in-progress', { status: 'in-progress' }, ['accountActionBusy'], true],
  ['not-signed-in', { status: 'not-signed-in' }, ['transferNotSignedIn'], false],
  ['offline', { status: 'offline' }, ['transferOffline', 'accountNothingChanged'], true],
  [
    'failed/read-failed',
    { status: 'failed', reason: 'read-failed' },
    ['transferFailedRead', 'accountNothingChanged'],
    true,
  ],
  [
    'failed/timeout',
    { status: 'failed', reason: 'timeout' },
    ['transferFailedTimeout', 'accountNothingChanged'],
    true,
  ],
  [
    'failed/write-failed',
    { status: 'failed', reason: 'write-failed' },
    ['transferPromoteFailedWrite'],
    true,
  ],
  [
    'denied/not-a-member',
    { status: 'denied', reason: 'not-a-member' },
    ['transferDeniedNotAMember', 'accountNothingChanged'],
    false,
  ],
  [
    'denied/not-owner',
    { status: 'denied', reason: 'not-owner' },
    ['transferDeniedNotOwner', 'accountNothingChanged'],
    false,
  ],
  [
    'denied/self',
    { status: 'denied', reason: 'self' },
    ['transferDeniedSelf', 'accountNothingChanged'],
    false,
  ],
  [
    'not-found',
    { status: 'not-found' },
    ['transferPromoteNotFound', 'accountNothingChanged'],
    false,
  ],
  [
    'rejected/target-changed',
    { status: 'rejected', reason: 'target-changed' },
    ['transferRejectedTargetChanged', 'accountNothingChanged'],
    false,
  ],
  [
    'rejected/permission-denied',
    { status: 'rejected', reason: 'permission-denied' },
    ['transferRejectedPermission', 'accountNothingChanged'],
    false,
  ],
  ['timeout', { status: 'timeout' }, ['transferPromoteTimeout'], true],
  ['unexpected', { status: 'unexpected' }, ['transferPromoteFailedWrite'], true],
];

const OK_COMPLETE = {
  status: 'ok' as const,
  revokedInvitations: 2,
  skippedMalformedInvitations: 0,
  removedTeamMemberships: 3,
  organizationMember: 'deleted' as const,
};

const COMPLETE: Row<CompleteTransferFlowOutcome>[] = [
  ['ok', OK_COMPLETE, ['transferCompleteOk', 'transferCompleteCounts'], false],
  [
    'ok+skipped+already-gone',
    { ...OK_COMPLETE, skippedMalformedInvitations: 1, organizationMember: 'already-gone' },
    [
      'transferCompleteOk',
      'transferCompleteCounts',
      'transferCompleteSkippedMalformed',
      'transferCompleteAlreadyGone',
    ],
    false,
  ],
  ['in-progress', { status: 'in-progress' }, ['accountActionBusy'], true],
  ['not-signed-in', { status: 'not-signed-in' }, ['transferNotSignedIn'], false],
  ['offline', { status: 'offline' }, ['transferOffline', 'accountNothingChanged'], true],
  [
    'failed/read-failed',
    { status: 'failed', reason: 'read-failed' },
    ['transferFailedRead', 'accountNothingChanged'],
    true,
  ],
  [
    'failed/timeout',
    { status: 'failed', reason: 'timeout' },
    ['transferFailedTimeout', 'accountNothingChanged'],
    true,
  ],
  [
    'denied/not-a-member',
    { status: 'denied', reason: 'not-a-member' },
    ['transferDeniedNotAMember', 'accountNothingChanged'],
    false,
  ],
  [
    'denied/not-owner',
    { status: 'denied', reason: 'not-owner' },
    ['transferDeniedNotOwner', 'accountNothingChanged'],
    false,
  ],
  [
    'denied/self',
    { status: 'denied', reason: 'self' },
    ['transferDeniedSelf', 'accountNothingChanged'],
    false,
  ],
  [
    'denied/target-not-owner',
    { status: 'denied', reason: 'target-not-owner' },
    ['transferDeniedTargetNotOwner', 'accountNothingChanged'],
    false,
  ],
  ['not-found (al afgerond)', { status: 'not-found' }, ['transferCompleteNotFound'], false],
  [
    'rejected/invitations/target-changed',
    { status: 'rejected', stage: 'invitations', reason: 'target-changed' },
    ['transferRejectedTargetChanged', 'transferStageInvitations', 'transferCompletePartial'],
    false,
  ],
  [
    'rejected/organization-member/permission-denied',
    { status: 'rejected', stage: 'organization-member', reason: 'permission-denied' },
    ['transferRejectedPermission', 'transferStageOrganizationMember', 'transferCompletePartial'],
    false,
  ],
  [
    'incomplete/invitations+timeout',
    { status: 'incomplete', stage: 'invitations', error: { code: 'timeout' } },
    ['transferCompleteIncomplete', 'transferStageInvitations', 'accountStepErrorTimeout'],
    true,
  ],
  [
    'incomplete/team-members+offline',
    { status: 'incomplete', stage: 'team-members', error: { code: 'offline' } },
    ['transferCompleteIncomplete', 'transferStageTeamMembers', 'accountStepErrorOffline'],
    true,
  ],
  [
    'incomplete/pre-removal-check (zonder fout)',
    { status: 'incomplete', stage: 'pre-removal-check' },
    ['transferCompleteIncomplete', 'transferStagePreRemovalCheck'],
    true,
  ],
  [
    'incomplete/pre-removal-check+read-failed',
    {
      status: 'incomplete',
      stage: 'pre-removal-check',
      error: { code: 'read-failed', detail: null },
    },
    ['transferCompleteIncomplete', 'transferStagePreRemovalCheck', 'accountStepErrorReadFailed'],
    true,
  ],
  [
    'incomplete/organization-member+failed',
    { status: 'incomplete', stage: 'organization-member', error: { code: 'failed', detail: null } },
    ['transferCompleteIncomplete', 'transferStageOrganizationMember', 'accountStepErrorFailed'],
    true,
  ],
  [
    'incomplete/final-check+not-found',
    { status: 'incomplete', stage: 'final-check', error: { code: 'not-found' } },
    ['transferCompleteIncomplete', 'transferStageFinalCheck', 'transferStepErrorNotFound'],
    true,
  ],
  ['unexpected', { status: 'unexpected' }, ['transferCompleteIncomplete'], true],
];

function expectRendered(view: OutcomeView, keys: StringKey[], retry: boolean) {
  expect(view.lines.map((line) => line.key)).toEqual(keys);
  expect(view.canRetry).toBe(retry);
  for (const lang of LANGS) {
    for (const line of view.lines) {
      const text = formatLine(lang, line);
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toMatch(/\{[a-z]+\}/);
      expect(text).not.toContain('uid-');
    }
  }
}

describe('overdracht: uitkomst → tekst (NL en EN)', () => {
  it.each(LIST)('lijst %s', (_label, outcome, keys, retry) => {
    expectRendered(transferListStopView(outcome), keys, retry);
    expect(isRetryableTransferOutcome(outcome)).toBe(retry);
  });

  it.each(PROMOTE)('promote %s', (_label, outcome, keys, retry) => {
    expectRendered(promoteOutcomeView(outcome, MEMBER, ORG), keys, retry);
    expect(isRetryableTransferOutcome(outcome)).toBe(retry);
  });

  it.each(COMPLETE)('completeTransfer %s', (_label, outcome, keys, retry) => {
    expectRendered(completeTransferOutcomeView(outcome, MEMBER, ORG), keys, retry);
    expect(isRetryableTransferOutcome(outcome)).toBe(retry);
  });

  it('alleen ok en "al afgerond" klinken als succes', () => {
    for (const [, outcome] of PROMOTE) {
      const tone = promoteOutcomeView(outcome, MEMBER, ORG).tone;
      expect(tone).toBe(outcome.status === 'ok' ? 'success' : 'error');
    }
    for (const [, outcome] of COMPLETE) {
      const tone = completeTransferOutcomeView(outcome, MEMBER, ORG).tone;
      expect(tone).toBe(
        outcome.status === 'ok' || outcome.status === 'not-found' ? 'success' : 'error',
      );
    }
  });

  it.each(LANGS)('ok (%s) vult lid, organisatie en aantallen in', (lang) => {
    const view = completeTransferOutcomeView(
      { ...OK_COMPLETE, skippedMalformedInvitations: 4 },
      MEMBER,
      ORG,
    );
    const text = view.lines.map((line) => formatLine(lang, line)).join(' ');
    expect(text).toContain(MEMBER);
    expect(text).toContain(ORG);
    expect(text).toContain(': 2');
    expect(text).toContain(': 3');
    expect(text).toContain(': 4');
  });

  it.each(LANGS)('promote ok (%s) noemt de wachtstand voor de nieuwe eigenaar', (lang) => {
    const view = promoteOutcomeView({ status: 'ok', outcome: 'promoted' }, MEMBER, ORG);
    const awaiting = formatLine(lang, view.lines[1]!);
    expect(awaiting).toContain(MEMBER);
    expect(awaiting).toContain(translate(lang, 'transferRemoveOwnerStartBtn'));
  });

  it('elke stage en elke stapfout heeft een tekst in beide talen', () => {
    const stages = [
      'invitations',
      'team-members',
      'pre-removal-check',
      'organization-member',
      'final-check',
    ] as const;
    const errors = [
      { code: 'rejected' },
      { code: 'role-changed', actualRole: 'coach' },
      { code: 'not-found' },
      { code: 'self-target' },
      { code: 'timeout' },
      { code: 'offline' },
      { code: 'not-signed-in' },
      { code: 'failed', detail: null },
      { code: 'read-failed', detail: null },
    ] as const;
    const keys = [...stages.map(transferStageKey), ...errors.map(transferStepErrorKey)];
    expect(new Set(stages.map(transferStageKey)).size).toBe(stages.length);
    for (const lang of LANGS) {
      for (const key of keys) expect(STRINGS[lang][key].length).toBeGreaterThan(0);
    }
  });
});

describe('overdracht: labels zonder ruwe ID', () => {
  const member = (email: string): TransferMember => ({
    uid: 'uid-fictief-geheim',
    role: 'coach',
    email,
  });

  it.each(LANGS)('label (%s) is het e-mailadres; leeg → neutraal label, nooit de uid', (lang) => {
    expect(transferMemberLabel(lang, member('  b.fictief@example.test '))).toBe(
      'b.fictief@example.test',
    );
    const fallback = transferMemberLabel(lang, member('   '));
    expect(fallback).toBe(translate(lang, 'transferMemberNoEmail'));
    expect(fallback).not.toContain('uid-fictief-geheim');
  });

  it('elke rol heeft een eigen label in beide talen', () => {
    const keys = ORGANIZATION_ROLES.map(transferRoleKey);
    expect(new Set(keys).size).toBe(ORGANIZATION_ROLES.length);
    for (const lang of LANGS) {
      for (const key of keys) expect(STRINGS[lang][key].length).toBeGreaterThan(0);
    }
  });
});

describe('getypte bevestiging (B9): beleid', () => {
  const target: TransferMember = {
    uid: 'uid-fictief-a',
    role: 'organizationOwner',
    email: 'A.Eigenaar@Example.test',
  };

  it.each([
    ['exact', 'A.Eigenaar@Example.test', true],
    ['kleine letters', 'a.eigenaar@example.test', true],
    ['spaties eromheen', '  a.eigenaar@example.test\t', true],
    ['leeg', '', false],
    ['alleen spaties', '   ', false],
    ['spatie binnenin', 'a.eigenaar @example.test', false],
    ['ander adres', 'b.fictief@example.test', false],
    ['te kort', 'a.eigenaar@example', false],
    ['naam i.p.v. adres', 'A.Eigenaar', false],
  ])('%s → %s', (_label, typed, valid) => {
    expect(isTransferConfirmationValid(typed, target)).toBe(valid);
  });

  it('een doel zonder adres is nooit te bevestigen', () => {
    expect(isTransferConfirmationValid('', { ...target, email: '' })).toBe(false);
    expect(isTransferConfirmationValid('  ', { ...target, email: '  ' })).toBe(false);
  });
});

describe('carry-over 2c-i', () => {
  it.each(LANGS)('accountDeletePasswordDesc (%s) zegt dat het onomkeerbaar is', (lang) => {
    expect(translate(lang, 'accountDeletePasswordDesc')).toMatch(
      lang === 'nl' ? /niet ongedaan/ : /cannot be undone/,
    );
  });

  it.each(LANGS)('de owner-sole-teksten (%s) verwijzen naar de overdrachtsknop', (lang) => {
    const button = translate(lang, 'transferStartBtn');
    for (const key of [
      'leaveOrgOwnerNote',
      'leaveOrgDeniedOwnerSole',
      'accountDeleteClassOwnerSole',
    ] as const) {
      expect(translate(lang, key)).toContain(button);
    }
    for (const key of [
      'leaveOrgDeniedOwnerAwaitingRemoval',
      'accountDeleteClassOwnerAwaitingRemoval',
    ] as const) {
      expect(translate(lang, key)).toContain(translate(lang, 'transferRemoveOwnerStartBtn'));
    }
  });
});
