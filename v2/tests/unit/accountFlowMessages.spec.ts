// PR 8.3c-2c-i — de vaste mapping uitkomst → tekst (docs/pr-8.3c-2c-plan.md §3). Bewijst
// voor ELKE uitkomst van `LeaveOrganizationCoordinator` en `AccountDeletionCoordinator`
// dat er in NL én EN een niet-lege tekst zonder overgebleven placeholder uitkomt, dat de
// parameters worden ingevuld, en dat "verwijderd" alleen bij `deleted` voorkomt.
import { describe, it, expect } from 'vitest';
import { STRINGS, type Lang } from '../../src/i18n/strings';
import {
  deletionClassKey,
  deletionClassLine,
  deletionStopView,
  formatLine,
  leaveOutcomeView,
  reauthErrorKey,
  stageKey,
  stepErrorKey,
} from '../../src/ui/account/accountFlowMessages';
import type {
  AccountDeletionStopOutcome,
  LeaveFlowOutcome,
} from '../../src/application/account/useAccountFlow';
import { ORGANIZATION_LEAVE_CLASSES } from '../../src/domain/account/types';

const LANGS: Lang[] = ['nl', 'en'];

const LEAVE_OUTCOMES: [string, LeaveFlowOutcome][] = [
  [
    'ok',
    {
      status: 'ok',
      removed: { teamMembers: 1, invitations: 0, organizationMember: true },
      organizationDeletionPending: false,
      invitationsChecked: true,
    },
  ],
  ['not-signed-in', { status: 'not-signed-in' }],
  ['in-progress', { status: 'in-progress' }],
  ['offline', { status: 'offline' }],
  ['failed/timeout', { status: 'failed', reason: 'timeout' }],
  ['failed/read-failed', { status: 'failed', reason: 'read-failed' }],
  ['not-a-member', { status: 'not-a-member' }],
  ['denied/owner-sole', { status: 'denied', reason: 'owner-sole', otherOwnerCount: 0 }],
  [
    'denied/owner-awaiting-removal',
    { status: 'denied', reason: 'owner-awaiting-removal', otherOwnerCount: 2 },
  ],
  ['denied/creator-needs-owner', { status: 'denied', reason: 'creator-needs-owner' }],
  ['denied/organization-unsupported', { status: 'denied', reason: 'organization-unsupported' }],
  ['denied/organization-missing', { status: 'denied', reason: 'organization-missing' }],
  [
    'denied/awaiting-organization-deletion',
    { status: 'denied', reason: 'awaiting-organization-deletion' },
  ],
  [
    'denied/organization-deletion-failed',
    { status: 'denied', reason: 'organization-deletion-failed' },
  ],
  ['blocked', { status: 'blocked', reason: 'local-unsynced-work', count: 3 }],
  ['incomplete/team-members', { status: 'incomplete', stage: 'team-members' }],
  [
    'incomplete/invitations+timeout',
    { status: 'incomplete', stage: 'invitations', error: { code: 'timeout' } },
  ],
  ['incomplete/per-org-check', { status: 'incomplete', stage: 'per-org-check' }],
  [
    'incomplete/organization-member+rejected',
    { status: 'incomplete', stage: 'organization-member', error: { code: 'rejected' } },
  ],
  ['incomplete/final-check', { status: 'incomplete', stage: 'final-check' }],
  ['unexpected', { status: 'unexpected' }],
];

const STOP_OUTCOMES: [string, AccountDeletionStopOutcome][] = [
  ['in-progress', { status: 'in-progress' }],
  ['not-signed-in', { status: 'not-signed-in' }],
  ['email-not-verified', { status: 'email-not-verified' }],
  ['offline', { status: 'offline' }],
  ['failed/read-failed', { status: 'failed', reason: 'read-failed' }],
  ['failed/timeout', { status: 'failed', reason: 'timeout' }],
  ['auth-state-unknown', { status: 'auth-state-unknown' }],
  [
    'incomplete/team-members',
    {
      status: 'incomplete',
      stage: 'team-members',
      organizationId: 'org-a',
      error: { code: 'offline' },
    },
  ],
  [
    'incomplete/final-gate+remaining',
    {
      status: 'incomplete',
      stage: 'final-gate',
      organizationId: null,
      remaining: { organizationMembers: 0, teamMembers: 1, invitations: 2 },
    },
  ],
  [
    'incomplete/final-gate+error',
    {
      status: 'incomplete',
      stage: 'final-gate',
      organizationId: null,
      error: { code: 'read-failed', detail: null },
    },
  ],
  [
    'firestore-cleared-auth-present/requires-recent-login',
    { status: 'firestore-cleared-auth-present', reason: 'requires-recent-login' },
  ],
  [
    'firestore-cleared-auth-present/network',
    { status: 'firestore-cleared-auth-present', reason: 'network' },
  ],
  [
    'firestore-cleared-auth-present/other',
    { status: 'firestore-cleared-auth-present', reason: 'other' },
  ],
  ['unexpected', { status: 'unexpected' }],
];

function render(lang: Lang, lines: { key: keyof (typeof STRINGS)['nl'] }[]): string[] {
  return lines.map((line) => formatLine(lang, line));
}

describe('accountFlowMessages: organisatie verlaten', () => {
  it.each(LEAVE_OUTCOMES)('%s geeft in NL en EN een volledige tekst', (_naam, outcome) => {
    for (const lang of LANGS) {
      const view = leaveOutcomeView(outcome, 'Fictief Org');
      expect(view.lines.length).toBeGreaterThan(0);
      for (const text of render(lang, view.lines)) {
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).not.toMatch(/\{[a-z]+\}/);
      }
    }
  });

  it('elke weigeringsreden heeft een eigen tekst (geen gedeelde verzameltekst)', () => {
    const denied = LEAVE_OUTCOMES.filter(([, o]) => o.status === 'denied').map(
      ([, o]) => leaveOutcomeView(o, 'X').lines[0]?.key,
    );
    expect(new Set(denied).size).toBe(7);
  });

  it('ok noemt de organisatie en is een succes zonder "opnieuw"', () => {
    const view = leaveOutcomeView(LEAVE_OUTCOMES[0]![1], 'Fictief Org');
    expect(view.tone).toBe('success');
    expect(view.canRetry).toBe(false);
    expect(formatLine('nl', view.lines[0]!)).toBe('Je hebt Fictief Org verlaten.');
    expect(formatLine('en', view.lines[0]!)).toBe('You have left Fictief Org.');
  });

  it('ok met invitationsChecked=false en lopend verwijderverzoek meldt beide', () => {
    const view = leaveOutcomeView(
      {
        status: 'ok',
        removed: { teamMembers: 0, invitations: 0, organizationMember: true },
        organizationDeletionPending: true,
        invitationsChecked: false,
      },
      'X',
    );
    expect(view.lines.map((l) => l.key)).toEqual([
      'leaveOrgOk',
      'leaveOrgOkInvitationsUnchecked',
      'leaveOrgOkDeletionPending',
    ]);
  });

  it('owner-awaiting-removal en blocked vullen het aantal in', () => {
    expect(
      formatLine(
        'nl',
        leaveOutcomeView(
          { status: 'denied', reason: 'owner-awaiting-removal', otherOwnerCount: 2 },
          'X',
        ).lines[0]!,
      ),
    ).toContain('aantal: 2');
    expect(
      formatLine(
        'en',
        leaveOutcomeView({ status: 'blocked', reason: 'local-unsynced-work', count: 3 }, 'X')
          .lines[0]!,
      ),
    ).toContain('count: 3');
  });

  it('weigering, blokkade en leesfouten zeggen dat er niets is gewijzigd; incomplete niet', () => {
    const nothing = (o: LeaveFlowOutcome) =>
      leaveOutcomeView(o, 'X').lines.some((l) => l.key === 'accountNothingChanged');
    expect(nothing({ status: 'denied', reason: 'owner-sole' })).toBe(true);
    expect(nothing({ status: 'blocked', reason: 'local-unsynced-work', count: 1 })).toBe(true);
    expect(nothing({ status: 'offline' })).toBe(true);
    expect(nothing({ status: 'failed', reason: 'timeout' })).toBe(true);
    expect(nothing({ status: 'incomplete', stage: 'team-members' })).toBe(false);
    expect(nothing({ status: 'unexpected' })).toBe(false);
  });

  it('alleen tijdelijke/hervatbare uitkomsten bieden "opnieuw"', () => {
    const retry = Object.fromEntries(
      LEAVE_OUTCOMES.map(([naam, o]) => [naam, leaveOutcomeView(o, 'X').canRetry]),
    );
    expect(retry['ok']).toBe(false);
    expect(retry['denied/owner-sole']).toBe(false);
    expect(retry['blocked']).toBe(false);
    expect(retry['not-a-member']).toBe(false);
    expect(retry['offline']).toBe(true);
    expect(retry['incomplete/final-check']).toBe(true);
  });
});

describe('accountFlowMessages: account verwijderen', () => {
  it.each(STOP_OUTCOMES)('%s geeft in NL en EN een volledige tekst', (_naam, outcome) => {
    for (const lang of LANGS) {
      const view = deletionStopView(outcome);
      for (const text of render(lang, view.lines)) {
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).not.toMatch(/\{[a-z]+\}/);
      }
    }
  });

  it('geen enkele stopuitkomst zegt "account is verwijderd"', () => {
    for (const [, outcome] of STOP_OUTCOMES) {
      const keys = deletionStopView(outcome).lines.map((l) => l.key);
      expect(keys).not.toContain('accountDeleteDeleted');
      const nl = render('nl', deletionStopView(outcome).lines).join(' ');
      expect(nl).not.toMatch(/(^|\. )Je account is verwijderd\./);
    }
  });

  it('firestore-cleared-auth-present zegt expliciet dat het account nog bestaat en hervat alleen de Auth-stap', () => {
    const view = deletionStopView({
      status: 'firestore-cleared-auth-present',
      reason: 'requires-recent-login',
    });
    expect(formatLine('nl', view.lines[0]!)).toContain('je account bestaat nog');
    expect(formatLine('en', view.lines[0]!)).toContain('your account still exists');
    expect(view.retry).toBe('auth-delete');
  });

  it('auth-state-unknown biedt geen "opnieuw" maar "log opnieuw in"', () => {
    const view = deletionStopView({ status: 'auth-state-unknown' });
    expect(view.retry).toBeNull();
    expect(formatLine('nl', view.lines[0]!)).toContain('Log opnieuw in');
  });

  it('email-not-verified biedt de bevestigingsmail aan', () => {
    expect(deletionStopView({ status: 'email-not-verified' }).offerVerificationMail).toBe(true);
    expect(deletionStopView({ status: 'offline' }).offerVerificationMail).toBe(false);
  });

  it('final-gate met remaining vult de drie aantallen in', () => {
    const view = deletionStopView({
      status: 'incomplete',
      stage: 'final-gate',
      organizationId: null,
      remaining: { organizationMembers: 4, teamMembers: 5, invitations: 6 },
    });
    const nl = formatLine('nl', view.lines[0]!);
    expect(nl).toContain('lidmaatschappen: 4');
    expect(nl).toContain('teamtoegang: 5');
    expect(nl).toContain('uitnodigingen: 6');
  });

  it.each(ORGANIZATION_LEAVE_CLASSES)('klasse %s heeft een eigen tekst in NL en EN', (klasse) => {
    const key = deletionClassKey(klasse);
    expect(STRINGS.nl[key].length).toBeGreaterThan(0);
    expect(STRINGS.en[key].length).toBeGreaterThan(0);
  });

  it('alle elf klassen hebben verschillende sleutels', () => {
    expect(new Set(ORGANIZATION_LEAVE_CLASSES.map(deletionClassKey)).size).toBe(11);
  });

  it('deletionClassLine vult het aantal andere owners of lokale wijzigingen in', () => {
    expect(
      formatLine(
        'nl',
        deletionClassLine({
          organizationId: 'o',
          class: 'owner-awaiting-removal',
          otherOwnerCount: 1,
        }),
      ),
    ).toContain('aantal: 1');
    expect(
      formatLine(
        'en',
        deletionClassLine({
          organizationId: 'o',
          class: 'local-unsynced-work',
          localUnsyncedWork: 7,
        }),
      ),
    ).toContain('count: 7');
  });

  it.each(['wrong-password', 'too-many-requests', 'network', 'other'] as const)(
    'reauth %s heeft een eigen tekst',
    (reason) => {
      expect(STRINGS.nl[reauthErrorKey(reason)]).toBeTruthy();
      expect(STRINGS.en[reauthErrorKey(reason)]).toBeTruthy();
    },
  );

  it('stage- en stapfoutsleutels bestaan in beide talen', () => {
    const stages = [
      'team-members',
      'invitations',
      'per-org-check',
      'organization-member',
      'final-check',
      'final-gate',
    ] as const;
    for (const stage of stages) expect(STRINGS.en[stageKey(stage)]).toBeTruthy();
    const errors = [
      { code: 'rejected' },
      { code: 'timeout' },
      { code: 'offline' },
      { code: 'not-signed-in' },
      { code: 'failed', detail: null },
      { code: 'read-failed', detail: null },
      { code: 'email-not-verified' },
    ] as const;
    expect(new Set(errors.map((e) => stepErrorKey(e))).size).toBe(7);
  });
});
