// @vitest-environment jsdom
// PR 8.3c-2c-ii — DOM-tests voor de overdracht (docs/pr-8.3c-2c-plan.md §8): de echte
// `useAccountFlow`-hook met het echte dialoog, tegen een nep-`AccountActionGate`. De
// beslissingen zelf zijn bewezen in de coördinatortests (2b-iii); hier: welke aanroep op
// welke klik, welke tekst bij welke uitkomst (NL en EN), de getypte bevestiging van B9,
// focus/Escape/backdrop, en dat een uid nooit in de DOM komt.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/preact';
import { useAccountFlow, type AccountFlowApi } from '../../src/application/account/useAccountFlow';
import type { AccountActionGate } from '../../src/application/account/AccountActionGate';
import { AccountFlowDialog } from '../../src/ui/account/AccountFlowDialog';
import { translate, type Lang, type StringKey } from '../../src/i18n/strings';
import { formatLine, type MessageLine } from '../../src/ui/account/accountFlowMessages';
import type { TransferMember } from '../../src/domain/account/transfer';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeGate() {
  return {
    leave: vi.fn(),
    assess: vi.fn(),
    clearFirestoreData: vi.fn(),
    deleteAuthAccount: vi.fn(),
    listTransferCandidates: vi.fn(),
    promote: vi.fn(),
    completeTransfer: vi.fn(),
    isBusy: false,
  };
}
type FakeGate = ReturnType<typeof fakeGate>;

const ORG = 'Fictieve Adelaars';
const COACH: TransferMember = {
  uid: 'uid-fictief-coach',
  role: 'coach',
  email: 'coach.fictief@example.test',
};
const ADMIN: TransferMember = {
  uid: 'uid-fictief-admin',
  role: 'organizationAdmin',
  email: 'admin.fictief@example.test',
};
const OWNER_A: TransferMember = {
  uid: 'uid-fictief-owner-a',
  role: 'organizationOwner',
  email: 'A.Eigenaar@Example.test',
};

const LISTED = { status: 'ok', candidates: [COACH, ADMIN], otherOwners: [OWNER_A] };

let latestFlow: AccountFlowApi | null = null;

function Harness({ gate, lang }: { gate: FakeGate; lang: Lang }) {
  const flow = useAccountFlow({
    gate: gate as unknown as AccountActionGate,
    onLeft: () => undefined,
    onAccountDeleted: async () => undefined,
  });
  latestFlow = flow;
  return (
    <>
      <button
        type="button"
        data-testid="open-promote"
        onClick={() => flow.openTransfer('org-a', ORG, 'promote')}
      >
        promote
      </button>
      <button
        type="button"
        data-testid="open-remove"
        onClick={() => flow.openTransfer('org-a', ORG, 'remove-owner')}
      >
        remove
      </button>
      <button type="button" data-testid="open-leave" onClick={() => flow.openLeave('org-a', ORG)}>
        leave
      </button>
      <button type="button" data-testid="open-delete" onClick={flow.openDelete}>
        delete
      </button>
      <AccountFlowDialog
        lang={lang}
        flow={flow}
        organizationName={(id) => (id === 'org-a' ? ORG : 'Onbekend-fictief')}
      />
    </>
  );
}

function mount(gate: FakeGate, lang: Lang = 'nl') {
  return render(<Harness gate={gate} lang={lang} />);
}

const t = (lang: Lang, key: StringKey) => translate(lang, key);
const line = (lang: Lang, key: StringKey, member = COACH.email) =>
  formatLine(lang, { key, params: { member, org: ORG } } as MessageLine);

async function toPromoteConfirm(gate: FakeGate, lang: Lang = 'nl') {
  gate.listTransferCandidates.mockResolvedValue(LISTED);
  mount(gate, lang);
  fireEvent.click(screen.getByTestId('open-promote'));
  fireEvent.click(await screen.findByTestId('transfer-member-0'));
}

async function toRemoveConfirm(gate: FakeGate, lang: Lang = 'nl') {
  gate.listTransferCandidates.mockResolvedValue(LISTED);
  mount(gate, lang);
  fireEvent.click(screen.getByTestId('open-remove'));
  fireEvent.click(await screen.findByTestId('transfer-member-0'));
}

function typeConfirmation(value: string) {
  fireEvent.input(screen.getByTestId('transfer-remove-owner-input'), { target: { value } });
}

function confirmButton() {
  return screen.getByTestId('transfer-confirm-btn') as HTMLButtonElement;
}

describe('overdracht: openen en kandidatenlijst', () => {
  it('roept niets aan bij mount; openen leest de lijst precies één keer', async () => {
    const gate = fakeGate();
    const pending = deferred<unknown>();
    gate.listTransferCandidates.mockReturnValue(pending.promise);
    const utils = mount(gate);
    utils.rerender(<Harness gate={gate} lang="nl" />);
    expect(gate.listTransferCandidates).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('open-promote'));
    expect(gate.listTransferCandidates).toHaveBeenCalledTimes(1);
    expect(gate.listTransferCandidates).toHaveBeenCalledWith('org-a');
    expect(screen.getByTestId('transfer-loading').textContent).toBe(t('nl', 'transferLoading'));
    // Tijdens het lezen: niet te sluiten, geen tweede flow.
    fireEvent.keyDown(screen.getByTestId('account-flow-dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('account-flow-dialog'));
    fireEvent.click(screen.getByTestId('open-remove'));
    expect(screen.getByTestId('transfer-loading')).toBeTruthy();
    expect(gate.listTransferCandidates).toHaveBeenCalledTimes(1);
    pending.resolve(LISTED);
    await screen.findByTestId('transfer-member-list');
    expect(gate.promote).not.toHaveBeenCalled();
  });

  it.each(['nl', 'en'] as const)(
    'promote (%s): titel, alleen kandidaten met e-mail en rol, geen uid in de DOM',
    async (lang) => {
      const gate = fakeGate();
      gate.listTransferCandidates.mockResolvedValue(LISTED);
      mount(gate, lang);
      fireEvent.click(screen.getByTestId('open-promote'));
      const list = await screen.findByTestId('transfer-member-list');
      expect(screen.getByTestId('account-flow-dialog').getAttribute('aria-label')).toBe(
        t(lang, 'transferPromoteTitle').replace('{org}', ORG),
      );
      expect(screen.getByTestId('transfer-member-0').textContent).toBe(
        `${COACH.email} (${t(lang, 'transferRoleCoach')})`,
      );
      expect(screen.getByTestId('transfer-member-1').textContent).toBe(
        `${ADMIN.email} (${t(lang, 'transferRoleAdmin')})`,
      );
      expect(list.textContent).not.toContain(OWNER_A.email);
      expect(document.body.innerHTML).not.toContain('uid-fictief');
    },
  );

  it.each(['nl', 'en'] as const)(
    'remove-owner (%s): UITSLUITEND de andere owners, nooit een gewoon lid',
    async (lang) => {
      const gate = fakeGate();
      gate.listTransferCandidates.mockResolvedValue(LISTED);
      mount(gate, lang);
      fireEvent.click(screen.getByTestId('open-remove'));
      const list = await screen.findByTestId('transfer-member-list');
      expect(screen.getByTestId('account-flow-dialog').getAttribute('aria-label')).toBe(
        t(lang, 'transferRemoveOwnerTitle').replace('{org}', ORG),
      );
      expect(list.querySelectorAll('button')).toHaveLength(1);
      expect(screen.getByTestId('transfer-member-0').textContent).toBe(
        `${OWNER_A.email} (${t(lang, 'transferRoleOwner')})`,
      );
      expect(list.textContent).not.toContain(COACH.email);
      expect(list.textContent).not.toContain(ADMIN.email);
      expect(document.body.innerHTML).not.toContain('uid-fictief');
    },
  );

  it('een lid zonder adres krijgt het neutrale label, nooit de uid', async () => {
    const gate = fakeGate();
    gate.listTransferCandidates.mockResolvedValue({
      status: 'ok',
      candidates: [{ ...COACH, email: '  ' }],
      otherOwners: [],
    });
    mount(gate);
    fireEvent.click(screen.getByTestId('open-promote'));
    expect((await screen.findByTestId('transfer-member-0')).textContent).toBe(
      `${t('nl', 'transferMemberNoEmail')} (${t('nl', 'transferRoleCoach')})`,
    );
    expect(document.body.innerHTML).not.toContain('uid-fictief');
  });

  it.each([
    ['promote', 'open-promote', 'transferNoCandidates'],
    ['remove-owner', 'open-remove', 'transferNoOtherOwners'],
  ] as const)('%s met een lege lijst: uitleg, geen keuze', async (_mode, opener, key) => {
    const gate = fakeGate();
    gate.listTransferCandidates.mockResolvedValue({
      status: 'ok',
      candidates: [],
      otherOwners: [],
    });
    mount(gate);
    fireEvent.click(screen.getByTestId(opener));
    expect((await screen.findByTestId('transfer-empty')).textContent).toBe(t('nl', key));
    expect(screen.queryByTestId('transfer-member-list')).toBeNull();
    fireEvent.click(screen.getByTestId('transfer-close-btn'));
    expect(screen.queryByTestId('account-flow-dialog')).toBeNull();
  });

  it.each([
    ['offline', { status: 'offline' }, 'transferOffline', true],
    ['failed/timeout', { status: 'failed', reason: 'timeout' }, 'transferFailedTimeout', true],
    ['failed/read-failed', { status: 'failed', reason: 'read-failed' }, 'transferFailedRead', true],
    ['in-progress', { status: 'in-progress' }, 'accountActionBusy', true],
    ['not-signed-in', { status: 'not-signed-in' }, 'transferNotSignedIn', false],
    [
      'denied/not-owner',
      { status: 'denied', reason: 'not-owner' },
      'transferDeniedNotOwner',
      false,
    ],
    [
      'denied/not-a-member',
      { status: 'denied', reason: 'not-a-member' },
      'transferDeniedNotAMember',
      false,
    ],
  ] as const)(
    'lijst %s: melding in NL en EN; opnieuw leest opnieuw',
    async (_l, out, key, retry) => {
      for (const lang of ['nl', 'en'] as const) {
        const gate = fakeGate();
        gate.listTransferCandidates.mockResolvedValueOnce(out).mockResolvedValueOnce(LISTED);
        mount(gate, lang);
        fireEvent.click(screen.getByTestId('open-promote'));
        const result = await screen.findByTestId('transfer-result');
        expect(result.getAttribute('role')).toBe('alert');
        expect(result.textContent).toContain(t(lang, key));
        if (retry) {
          fireEvent.click(screen.getByTestId('transfer-retry-btn'));
          await screen.findByTestId('transfer-member-list');
          expect(gate.listTransferCandidates).toHaveBeenCalledTimes(2);
        } else {
          expect(screen.queryByTestId('transfer-retry-btn')).toBeNull();
        }
        cleanup();
      }
    },
  );

  it('een gooiende lijst eindigt in een melding, niet in een crash', async () => {
    const gate = fakeGate();
    gate.listTransferCandidates.mockRejectedValue(new Error('kapot'));
    mount(gate);
    fireEvent.click(screen.getByTestId('open-promote'));
    expect((await screen.findByTestId('transfer-result')).textContent).toContain(
      t('nl', 'transferFailedRead'),
    );
  });
});

describe('overdracht A: promoveren', () => {
  it.each(['nl', 'en'] as const)(
    'bevestiging (%s) legt het tweestapsmodel uit; promote één keer; ok toont de wachtstand',
    async (lang) => {
      const gate = fakeGate();
      const pending = deferred<unknown>();
      gate.promote.mockReturnValue(pending.promise);
      await toPromoteConfirm(gate, lang);
      expect(screen.getByTestId('transfer-promote-desc').textContent).toBe(
        line(lang, 'transferPromoteConfirmDesc'),
      );
      expect(gate.promote).not.toHaveBeenCalled();
      fireEvent.click(confirmButton());
      expect(gate.promote).toHaveBeenCalledTimes(1);
      expect(gate.promote).toHaveBeenCalledWith('org-a', COACH.uid);
      // Tijdens het lopen: knoppen uit, Escape/backdrop sluiten niet.
      expect(confirmButton().disabled).toBe(true);
      expect(confirmButton().textContent).toBe(t(lang, 'transferPromoteInProgress'));
      fireEvent.click(confirmButton());
      fireEvent.keyDown(screen.getByTestId('account-flow-dialog'), { key: 'Escape' });
      fireEvent.click(screen.getByTestId('account-flow-dialog'));
      expect(screen.getByTestId('account-flow-dialog')).toBeTruthy();
      expect(gate.promote).toHaveBeenCalledTimes(1);

      pending.resolve({ status: 'ok', outcome: 'promoted' });
      const result = await screen.findByTestId('transfer-result');
      expect(result.getAttribute('role')).toBe('status');
      expect(result.textContent).toContain(line(lang, 'transferPromoteOk'));
      expect(result.textContent).toContain(line(lang, 'transferPromoteAwaiting'));
      expect(screen.queryByTestId('transfer-retry-btn')).toBeNull();
      fireEvent.click(screen.getByTestId('transfer-close-btn'));
      expect(screen.queryByTestId('account-flow-dialog')).toBeNull();
    },
  );

  const PROMOTE_CASES: [string, unknown, StringKey, boolean][] = [
    [
      'ok/already-owner',
      { status: 'ok', outcome: 'already-owner' },
      'transferPromoteAlreadyOwner',
      false,
    ],
    ['in-progress', { status: 'in-progress' }, 'accountActionBusy', true],
    ['not-signed-in', { status: 'not-signed-in' }, 'transferNotSignedIn', false],
    ['offline', { status: 'offline' }, 'transferOffline', true],
    ['failed/read-failed', { status: 'failed', reason: 'read-failed' }, 'transferFailedRead', true],
    ['failed/timeout', { status: 'failed', reason: 'timeout' }, 'transferFailedTimeout', true],
    [
      'failed/write-failed',
      { status: 'failed', reason: 'write-failed' },
      'transferPromoteFailedWrite',
      true,
    ],
    [
      'denied/not-a-member',
      { status: 'denied', reason: 'not-a-member' },
      'transferDeniedNotAMember',
      false,
    ],
    [
      'denied/not-owner',
      { status: 'denied', reason: 'not-owner' },
      'transferDeniedNotOwner',
      false,
    ],
    ['denied/self', { status: 'denied', reason: 'self' }, 'transferDeniedSelf', false],
    ['not-found', { status: 'not-found' }, 'transferPromoteNotFound', false],
    [
      'rejected/target-changed',
      { status: 'rejected', reason: 'target-changed' },
      'transferRejectedTargetChanged',
      false,
    ],
    [
      'rejected/permission-denied',
      { status: 'rejected', reason: 'permission-denied' },
      'transferRejectedPermission',
      false,
    ],
    ['timeout', { status: 'timeout' }, 'transferPromoteTimeout', true],
  ];

  it.each(PROMOTE_CASES)(
    '%s: tekst in NL en EN, opnieuw alleen waar zinvol',
    async (_l, out, key, retry) => {
      for (const lang of ['nl', 'en'] as const) {
        const gate = fakeGate();
        gate.promote.mockResolvedValueOnce(out).mockResolvedValueOnce({
          status: 'ok',
          outcome: 'already-owner',
        });
        await toPromoteConfirm(gate, lang);
        fireEvent.click(confirmButton());
        const result = await screen.findByTestId('transfer-result');
        expect(result.textContent).toContain(line(lang, key));
        if (retry) {
          fireEvent.click(screen.getByTestId('transfer-retry-btn'));
          await waitFor(() =>
            expect(screen.getByTestId('transfer-result').textContent).toContain(
              line(lang, 'transferPromoteAlreadyOwner'),
            ),
          );
          expect(gate.promote).toHaveBeenCalledTimes(2);
          expect(gate.promote).toHaveBeenLastCalledWith('org-a', COACH.uid);
        } else {
          expect(screen.queryByTestId('transfer-retry-btn')).toBeNull();
        }
        cleanup();
      }
    },
  );

  it('een gooiende promote is een hervatbare melding, geen succes', async () => {
    const gate = fakeGate();
    gate.promote.mockRejectedValue(new Error('kapot'));
    await toPromoteConfirm(gate);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId('transfer-result');
    expect(result.textContent).toContain(line('nl', 'transferPromoteFailedWrite'));
    expect(result.textContent).not.toContain(line('nl', 'transferPromoteOk'));
    expect(screen.getByTestId('transfer-retry-btn')).toBeTruthy();
  });

  it('terug naar de lijst zonder aanroep; een andere keuze promoveert die', async () => {
    const gate = fakeGate();
    gate.promote.mockResolvedValue({ status: 'ok', outcome: 'promoted' });
    await toPromoteConfirm(gate);
    fireEvent.click(screen.getByTestId('transfer-back-btn'));
    fireEvent.click(await screen.findByTestId('transfer-member-1'));
    fireEvent.click(confirmButton());
    await screen.findByTestId('transfer-result');
    expect(gate.promote).toHaveBeenCalledTimes(1);
    expect(gate.promote).toHaveBeenCalledWith('org-a', ADMIN.uid);
    expect(gate.listTransferCandidates).toHaveBeenCalledTimes(1);
  });
});

describe('overdracht B: andere eigenaar verwijderen (getypte bevestiging)', () => {
  it.each(['nl', 'en'] as const)(
    'knop (%s) staat uit tot het e-mailadres klopt; daarna completeTransfer één keer',
    async (lang) => {
      const gate = fakeGate();
      gate.completeTransfer.mockResolvedValue({
        status: 'ok',
        revokedInvitations: 2,
        skippedMalformedInvitations: 0,
        removedTeamMemberships: 1,
        organizationMember: 'deleted',
      });
      await toRemoveConfirm(gate, lang);
      expect(screen.getByTestId('transfer-remove-owner-desc').textContent).toBe(
        line(lang, 'transferRemoveOwnerConfirmDesc', OWNER_A.email),
      );
      expect(confirmButton().disabled).toBe(true);
      expect(screen.queryByTestId('transfer-remove-owner-mismatch')).toBeNull();

      typeConfirmation('b.fictief@example.test');
      expect(confirmButton().disabled).toBe(true);
      expect(screen.getByTestId('transfer-remove-owner-mismatch').textContent).toBe(
        t(lang, 'transferRemoveOwnerMismatch'),
      );
      fireEvent.submit(screen.getByTestId('transfer-remove-owner-form'));
      fireEvent.click(confirmButton());
      expect(gate.completeTransfer).not.toHaveBeenCalled();

      // Beleid: getrimd en zonder hoofdlettergevoeligheid.
      typeConfirmation('  a.eigenaar@example.test ');
      expect(confirmButton().disabled).toBe(false);
      expect(screen.queryByTestId('transfer-remove-owner-mismatch')).toBeNull();
      fireEvent.click(confirmButton());
      expect(gate.completeTransfer).toHaveBeenCalledTimes(1);
      expect(gate.completeTransfer).toHaveBeenCalledWith('org-a', OWNER_A.uid);

      const result = await screen.findByTestId('transfer-result');
      expect(result.getAttribute('role')).toBe('status');
      expect(result.textContent).toContain(line(lang, 'transferCompleteOk', OWNER_A.email));
      expect(result.textContent).toContain(
        formatLine(lang, {
          key: 'transferCompleteCounts',
          params: { invitations: 2, teams: 1 },
        }),
      );
      expect(result.textContent).not.toContain(
        formatLine(lang, { key: 'transferCompleteSkippedMalformed', params: { count: 0 } }),
      );
      expect(screen.queryByTestId('transfer-retry-btn')).toBeNull();
    },
  );

  it.each([
    ['spatie binnenin', 'a.eigenaar @example.test'],
    ['alleen spaties', '    '],
    ['zonder domein', 'A.Eigenaar'],
    ['naam van de organisatie', ORG],
  ])('mismatch "%s" laat de knop uit', async (_label, typed) => {
    const gate = fakeGate();
    await toRemoveConfirm(gate);
    typeConfirmation(typed);
    expect(confirmButton().disabled).toBe(true);
    fireEvent.submit(screen.getByTestId('transfer-remove-owner-form'));
    expect(gate.completeTransfer).not.toHaveBeenCalled();
  });

  it('de hook weigert zelf een verkeerde of ontbrekende bevestiging (een gedispatchte klik omzeilt niets)', async () => {
    const gate = fakeGate();
    gate.completeTransfer.mockResolvedValue({ status: 'not-found' });
    await toRemoveConfirm(gate);
    latestFlow!.confirmTransfer();
    latestFlow!.confirmTransfer('');
    latestFlow!.confirmTransfer('b.fictief@example.test');
    expect(gate.completeTransfer).not.toHaveBeenCalled();
    expect(screen.getByTestId('transfer-remove-owner-input')).toBeTruthy();
    latestFlow!.confirmTransfer('a.eigenaar@example.test');
    expect(gate.completeTransfer).toHaveBeenCalledTimes(1);
  });

  it('ok met overgeslagen misvormde uitnodigingen en al verwijderd lidmaatschap noemt beide', async () => {
    for (const lang of ['nl', 'en'] as const) {
      const gate = fakeGate();
      gate.completeTransfer.mockResolvedValue({
        status: 'ok',
        revokedInvitations: 0,
        skippedMalformedInvitations: 3,
        removedTeamMemberships: 0,
        organizationMember: 'already-gone',
      });
      await toRemoveConfirm(gate, lang);
      typeConfirmation(OWNER_A.email);
      fireEvent.click(confirmButton());
      const result = await screen.findByTestId('transfer-result');
      expect(result.textContent).toContain(
        formatLine(lang, { key: 'transferCompleteSkippedMalformed', params: { count: 3 } }),
      );
      expect(result.textContent).toContain(
        line(lang, 'transferCompleteAlreadyGone', OWNER_A.email),
      );
      cleanup();
    }
  });

  const COMPLETE_CASES: [string, unknown, StringKey[], boolean][] = [
    ['not-found (al afgerond)', { status: 'not-found' }, ['transferCompleteNotFound'], false],
    ['in-progress', { status: 'in-progress' }, ['accountActionBusy'], true],
    ['not-signed-in', { status: 'not-signed-in' }, ['transferNotSignedIn'], false],
    ['offline', { status: 'offline' }, ['transferOffline', 'accountNothingChanged'], true],
    ['failed/timeout', { status: 'failed', reason: 'timeout' }, ['transferFailedTimeout'], true],
    [
      'failed/read-failed',
      { status: 'failed', reason: 'read-failed' },
      ['transferFailedRead'],
      true,
    ],
    [
      'denied/not-owner',
      { status: 'denied', reason: 'not-owner' },
      ['transferDeniedNotOwner'],
      false,
    ],
    [
      'denied/not-a-member',
      { status: 'denied', reason: 'not-a-member' },
      ['transferDeniedNotAMember'],
      false,
    ],
    ['denied/self', { status: 'denied', reason: 'self' }, ['transferDeniedSelf'], false],
    [
      'denied/target-not-owner',
      { status: 'denied', reason: 'target-not-owner' },
      ['transferDeniedTargetNotOwner'],
      false,
    ],
    [
      'rejected/team-members/target-changed',
      { status: 'rejected', stage: 'team-members', reason: 'target-changed' },
      ['transferRejectedTargetChanged', 'transferStageTeamMembers', 'transferCompletePartial'],
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
      'incomplete/final-check',
      { status: 'incomplete', stage: 'final-check' },
      ['transferCompleteIncomplete', 'transferStageFinalCheck'],
      true,
    ],
  ];

  it.each(COMPLETE_CASES)(
    '%s: tekst in NL en EN; opnieuw hervat zonder nieuwe invoer',
    async (_l, out, keys, retry) => {
      for (const lang of ['nl', 'en'] as const) {
        const gate = fakeGate();
        gate.completeTransfer
          .mockResolvedValueOnce(out)
          .mockResolvedValueOnce({ status: 'not-found' });
        await toRemoveConfirm(gate, lang);
        typeConfirmation(OWNER_A.email);
        fireEvent.click(confirmButton());
        const result = await screen.findByTestId('transfer-result');
        for (const key of keys) {
          expect(result.textContent).toContain(line(lang, key, OWNER_A.email));
        }
        expect(result.textContent).not.toContain(line(lang, 'transferCompleteOk', OWNER_A.email));
        if (retry) {
          fireEvent.click(screen.getByTestId('transfer-retry-btn'));
          await waitFor(() =>
            expect(screen.getByTestId('transfer-result').textContent).toContain(
              line(lang, 'transferCompleteNotFound', OWNER_A.email),
            ),
          );
          expect(gate.completeTransfer).toHaveBeenCalledTimes(2);
          expect(gate.completeTransfer).toHaveBeenLastCalledWith('org-a', OWNER_A.uid);
        } else {
          expect(screen.queryByTestId('transfer-retry-btn')).toBeNull();
        }
        cleanup();
      }
    },
  );

  it('een gooiende completeTransfer is hervatbaar, nooit "afgerond"', async () => {
    const gate = fakeGate();
    gate.completeTransfer.mockRejectedValue(new Error('kapot'));
    await toRemoveConfirm(gate);
    typeConfirmation(OWNER_A.email);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId('transfer-result');
    expect(result.textContent).toContain(line('nl', 'transferCompleteIncomplete', OWNER_A.email));
    expect(screen.getByTestId('transfer-retry-btn')).toBeTruthy();
  });

  it('tijdens het verwijderen staat het invoerveld uit en sluit niets het dialoog', async () => {
    const gate = fakeGate();
    const pending = deferred<unknown>();
    gate.completeTransfer.mockReturnValue(pending.promise);
    await toRemoveConfirm(gate);
    typeConfirmation(OWNER_A.email);
    fireEvent.click(confirmButton());
    expect((screen.getByTestId('transfer-remove-owner-input') as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(confirmButton().textContent).toBe(t('nl', 'transferRemoveOwnerInProgress'));
    fireEvent.keyDown(screen.getByTestId('account-flow-dialog'), { key: 'Escape' });
    expect(screen.getByTestId('account-flow-dialog')).toBeTruthy();
    pending.resolve({ status: 'not-found' });
    await screen.findByTestId('transfer-result');
  });
});

describe('overdracht: dialooggedrag', () => {
  it('vangt de focus, cyclet Tab, en geeft focus terug bij Escape', async () => {
    const gate = fakeGate();
    gate.listTransferCandidates.mockResolvedValue(LISTED);
    mount(gate);
    const opener = screen.getByTestId('open-remove');
    opener.focus();
    fireEvent.click(opener);
    const member = await screen.findByTestId('transfer-member-0');
    await waitFor(() => expect(document.activeElement).toBe(member));
    const close = screen.getByTestId('transfer-close-btn');
    close.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(member);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);

    fireEvent.click(member);
    // In de getypte bevestiging staat de focus op het invoerveld.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('transfer-remove-owner-input')),
    );
    fireEvent.keyDown(screen.getByTestId('account-flow-dialog'), { key: 'Escape' });
    expect(screen.queryByTestId('account-flow-dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(gate.completeTransfer).not.toHaveBeenCalled();
  });

  it('backdrop-klik sluit, een klik in het dialoog niet', async () => {
    const gate = fakeGate();
    await toPromoteConfirm(gate);
    fireEvent.click(screen.getByRole('document'));
    expect(screen.getByTestId('account-flow-dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('account-flow-dialog'));
    expect(screen.queryByTestId('account-flow-dialog')).toBeNull();
    expect(gate.promote).not.toHaveBeenCalled();
  });

  it('heropenen na sluiten begint met een verse lijst, zonder getypte tekst', async () => {
    const gate = fakeGate();
    await toRemoveConfirm(gate);
    typeConfirmation(OWNER_A.email);
    fireEvent.keyDown(screen.getByTestId('account-flow-dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('open-remove'));
    fireEvent.click(await screen.findByTestId('transfer-member-0'));
    expect((screen.getByTestId('transfer-remove-owner-input') as HTMLInputElement).value).toBe('');
    expect(confirmButton().disabled).toBe(true);
    expect(gate.listTransferCandidates).toHaveBeenCalledTimes(2);
  });
});

describe('één ingang: overdracht naast verlaten en verwijderen', () => {
  it('terwijl een vertrek open is, opent de overdracht niet (en omgekeerd)', async () => {
    const gate = fakeGate();
    mount(gate);
    fireEvent.click(screen.getByTestId('open-leave'));
    fireEvent.click(screen.getByTestId('open-promote'));
    fireEvent.click(screen.getByTestId('open-remove'));
    expect(gate.listTransferCandidates).not.toHaveBeenCalled();
    expect(screen.getByTestId('leave-org-confirm-btn')).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('account-flow-dialog'), { key: 'Escape' });

    gate.listTransferCandidates.mockResolvedValue(LISTED);
    fireEvent.click(screen.getByTestId('open-promote'));
    await screen.findByTestId('transfer-member-list');
    fireEvent.click(screen.getByTestId('open-leave'));
    fireEvent.click(screen.getByTestId('open-delete'));
    expect(gate.assess).not.toHaveBeenCalled();
    expect(gate.leave).not.toHaveBeenCalled();
    expect(screen.getByTestId('transfer-member-list')).toBeTruthy();
  });

  it.each(['nl', 'en'] as const)(
    'verlaten geweigerd als enige owner (%s): knop "Eigendom overdragen" start de overdracht',
    async (lang) => {
      const gate = fakeGate();
      gate.leave.mockResolvedValue({ status: 'denied', reason: 'owner-sole', otherOwnerCount: 0 });
      gate.listTransferCandidates.mockResolvedValue(LISTED);
      mount(gate, lang);
      fireEvent.click(screen.getByTestId('open-leave'));
      fireEvent.click(screen.getByTestId('leave-org-confirm-btn'));
      const transfer = await screen.findByTestId('leave-org-transfer-btn');
      expect(transfer.textContent).toBe(t(lang, 'transferStartBtn'));
      fireEvent.click(transfer);
      await screen.findByTestId('transfer-member-list');
      expect(gate.listTransferCandidates).toHaveBeenCalledWith('org-a');
      expect(screen.getByTestId('account-flow-dialog').getAttribute('aria-label')).toBe(
        t(lang, 'transferPromoteTitle').replace('{org}', ORG),
      );
    },
  );

  it('geen overdrachtsknop bij een andere weigering', async () => {
    const gate = fakeGate();
    gate.leave.mockResolvedValue({ status: 'denied', reason: 'creator-needs-owner' });
    mount(gate);
    fireEvent.click(screen.getByTestId('open-leave'));
    fireEvent.click(screen.getByTestId('leave-org-confirm-btn'));
    await screen.findByTestId('leave-org-result');
    expect(screen.queryByTestId('leave-org-transfer-btn')).toBeNull();
  });

  it('verwijderplan: alleen een owner-sole-rij krijgt de overdrachtsknop', async () => {
    const gate = fakeGate();
    gate.assess.mockResolvedValue({
      status: 'needs-action',
      plan: {
        organizations: [
          { organizationId: 'org-a', class: 'owner-sole' },
          { organizationId: 'org-b', class: 'owner-awaiting-removal', otherOwnerCount: 1 },
          { organizationId: 'org-c', class: 'leave' },
        ],
        invitationCount: 0,
        canProceed: false,
      },
    });
    gate.listTransferCandidates.mockResolvedValue(LISTED);
    mount(gate);
    fireEvent.click(screen.getByTestId('open-delete'));
    const button = await screen.findByTestId('account-delete-transfer-org-a');
    expect(screen.queryByTestId('account-delete-transfer-org-b')).toBeNull();
    expect(screen.queryByTestId('account-delete-transfer-org-c')).toBeNull();
    expect(screen.getByTestId('account-delete-org-org-b').textContent).toContain(
      formatLine('nl', { key: 'accountDeleteClassOwnerAwaitingRemoval', params: { count: 1 } }),
    );
    fireEvent.click(button);
    await screen.findByTestId('transfer-member-list');
    expect(gate.listTransferCandidates).toHaveBeenCalledTimes(1);
    expect(gate.listTransferCandidates).toHaveBeenCalledWith('org-a');
  });

  it('switchToTransfer doet niets tijdens een lopende aanroep', async () => {
    const gate = fakeGate();
    const pending = deferred<unknown>();
    gate.leave.mockReturnValue(pending.promise);
    mount(gate);
    fireEvent.click(screen.getByTestId('open-leave'));
    fireEvent.click(screen.getByTestId('leave-org-confirm-btn'));
    latestFlow!.switchToTransfer('org-a', ORG);
    expect(gate.listTransferCandidates).not.toHaveBeenCalled();
    pending.resolve({ status: 'offline' });
    await screen.findByTestId('leave-org-result');
  });
});
