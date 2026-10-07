// @vitest-environment jsdom
// PR 8.3c-2c-i — DOM-tests voor de flow "organisatie verlaten" en "account verwijderen":
// de echte `useAccountFlow`-hook met het echte dialoog, tegen een nep-`AccountActionGate`.
// De beslissingen zelf zijn bewezen in de coördinatortests (2b); hier: welke aanroep op
// welke klik, welke tekst bij welke uitkomst (NL en EN), wachtwoordbehandeling, focus,
// Escape/backdrop en B7 (via `onAccountDeleted`).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/preact';
import { useAccountFlow } from '../../src/application/account/useAccountFlow';
import type { AccountActionGate } from '../../src/application/account/AccountActionGate';
import { AccountFlowDialog } from '../../src/ui/account/AccountFlowDialog';
import { translate, type Lang } from '../../src/i18n/strings';
import type { AccountDeletionPlan } from '../../src/domain/account/plan';

afterEach(cleanup);

const PASSWORD = 'fictief-wachtwoord-1';

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
    isBusy: false,
  };
}
type FakeGate = ReturnType<typeof fakeGate>;

const NAMES: Record<string, string> = { 'org-a': 'Fictieve Adelaars', 'org-b': 'Testclub B' };

function Harness({
  gate,
  lang,
  onLeft,
  onDeleted,
  onResend,
}: {
  gate: FakeGate;
  lang: Lang;
  onLeft: (id: string) => void;
  onDeleted: () => Promise<void>;
  onResend?: () => Promise<boolean>;
}) {
  const flow = useAccountFlow({
    gate: gate as unknown as AccountActionGate,
    onLeft,
    onAccountDeleted: onDeleted,
  });
  return (
    <>
      <button
        type="button"
        data-testid="open-leave"
        onClick={() => flow.openLeave('org-a', 'Fictieve Adelaars')}
      >
        leave
      </button>
      <button type="button" data-testid="open-delete" onClick={flow.openDelete}>
        delete
      </button>
      <AccountFlowDialog
        lang={lang}
        flow={flow}
        organizationName={(id) => NAMES[id] ?? id}
        onResendVerification={onResend}
      />
    </>
  );
}

function mount(
  gate: FakeGate,
  lang: Lang = 'nl',
  extra: { onResend?: () => Promise<boolean> } = {},
) {
  const onLeft = vi.fn();
  const onDeleted = vi.fn(async () => undefined);
  const utils = render(
    <Harness
      gate={gate}
      lang={lang}
      onLeft={onLeft}
      onDeleted={onDeleted}
      onResend={extra.onResend}
    />,
  );
  return { ...utils, onLeft, onDeleted };
}

const t = (lang: Lang, key: Parameters<typeof translate>[1]) => translate(lang, key);

function plan(overrides: Partial<AccountDeletionPlan> = {}): AccountDeletionPlan {
  return {
    organizations: [
      { organizationId: 'org-a', class: 'leave' },
      { organizationId: 'org-b', class: 'leave-team-only' },
    ],
    invitationCount: 2,
    canProceed: true,
    ...overrides,
  };
}

describe('organisatie verlaten', () => {
  it('opent een bevestiging zonder iets aan te roepen; bevestigen roept leave() precies één keer', async () => {
    const gate = fakeGate();
    const pending = deferred<unknown>();
    gate.leave.mockReturnValue(pending.promise);
    mount(gate);
    fireEvent.click(screen.getByTestId('open-leave'));
    expect(screen.getByTestId('account-flow-dialog').getAttribute('aria-label')).toBe(
      'Organisatie Fictieve Adelaars verlaten?',
    );
    expect(gate.leave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('leave-org-confirm-btn'));
    expect(gate.leave).toHaveBeenCalledWith('org-a');
    // Tijdens het lopen: geen tweede klik, geen sluiten.
    const confirm = screen.getByTestId('leave-org-confirm-btn') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    fireEvent.keyDown(screen.getByTestId('account-flow-dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('account-flow-dialog'));
    expect(screen.queryByTestId('account-flow-dialog')).toBeTruthy();
    expect(gate.leave).toHaveBeenCalledTimes(1);

    pending.resolve({
      status: 'ok',
      removed: { teamMembers: 1, invitations: 1, organizationMember: true },
      organizationDeletionPending: false,
      invitationsChecked: true,
    });
    await screen.findByTestId('leave-org-result');
  });

  it.each(['nl', 'en'] as const)(
    'ok (%s): succesmelding, geen opnieuw-knop, Sluiten meldt het vertrek aan AuthGate',
    async (lang) => {
      const gate = fakeGate();
      gate.leave.mockResolvedValue({
        status: 'ok',
        removed: { teamMembers: 0, invitations: 0, organizationMember: true },
        organizationDeletionPending: true,
        invitationsChecked: false,
      });
      const { onLeft } = mount(gate, lang);
      fireEvent.click(screen.getByTestId('open-leave'));
      fireEvent.click(screen.getByTestId('leave-org-confirm-btn'));
      const result = await screen.findByTestId('leave-org-result');
      expect(result.getAttribute('role')).toBe('status');
      expect(result.textContent).toContain(
        t(lang, 'leaveOrgOk').replace('{org}', 'Fictieve Adelaars'),
      );
      expect(result.textContent).toContain(t(lang, 'leaveOrgOkInvitationsUnchecked'));
      expect(result.textContent).toContain(t(lang, 'leaveOrgOkDeletionPending'));
      expect(screen.queryByTestId('leave-org-retry-btn')).toBeNull();
      expect(onLeft).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('leave-org-close-btn'));
      expect(onLeft).toHaveBeenCalledWith('org-a');
      expect(screen.queryByTestId('account-flow-dialog')).toBeNull();
    },
  );

  it.each([
    [
      'owner-sole',
      { status: 'denied', reason: 'owner-sole', otherOwnerCount: 0 },
      'leaveOrgDeniedOwnerSole',
    ],
    [
      'creator-needs-owner',
      { status: 'denied', reason: 'creator-needs-owner' },
      'leaveOrgDeniedCreatorNeedsOwner',
    ],
    [
      'awaiting-organization-deletion',
      { status: 'denied', reason: 'awaiting-organization-deletion' },
      'leaveOrgDeniedAwaitingDeletion',
    ],
    [
      'organization-unsupported',
      { status: 'denied', reason: 'organization-unsupported' },
      'leaveOrgDeniedUnsupported',
    ],
    [
      'organization-missing',
      { status: 'denied', reason: 'organization-missing' },
      'leaveOrgDeniedMissing',
    ],
    [
      'organization-deletion-failed',
      { status: 'denied', reason: 'organization-deletion-failed' },
      'leaveOrgDeniedDeletionFailed',
    ],
    ['not-a-member', { status: 'not-a-member' }, 'leaveOrgNotAMember'],
    ['not-signed-in', { status: 'not-signed-in' }, 'leaveOrgNotSignedIn'],
  ] as const)(
    '%s: uitleg als alert, geen opnieuw-knop, Sluiten meldt geen vertrek',
    async (_n, outcome, key) => {
      for (const lang of ['nl', 'en'] as const) {
        const gate = fakeGate();
        gate.leave.mockResolvedValue(outcome);
        const { onLeft, unmount } = mount(gate, lang);
        fireEvent.click(screen.getByTestId('open-leave'));
        fireEvent.click(screen.getByTestId('leave-org-confirm-btn'));
        const result = await screen.findByTestId('leave-org-result');
        expect(result.getAttribute('role')).toBe('alert');
        expect(result.textContent).toContain(t(lang, key));
        expect(screen.queryByTestId('leave-org-retry-btn')).toBeNull();
        fireEvent.click(screen.getByTestId('leave-org-close-btn'));
        expect(onLeft).not.toHaveBeenCalled();
        unmount();
      }
    },
  );

  it('owner-awaiting-removal toont het aantal andere owners', async () => {
    const gate = fakeGate();
    gate.leave.mockResolvedValue({
      status: 'denied',
      reason: 'owner-awaiting-removal',
      otherOwnerCount: 2,
    });
    mount(gate, 'en');
    fireEvent.click(screen.getByTestId('open-leave'));
    fireEvent.click(screen.getByTestId('leave-org-confirm-btn'));
    expect((await screen.findByTestId('leave-org-result')).textContent).toContain('count: 2');
  });

  it('lokaal onbevestigd werk blokkeert met het aantal, zonder opnieuw-knop', async () => {
    const gate = fakeGate();
    gate.leave.mockResolvedValue({ status: 'blocked', reason: 'local-unsynced-work', count: 3 });
    mount(gate);
    fireEvent.click(screen.getByTestId('open-leave'));
    fireEvent.click(screen.getByTestId('leave-org-confirm-btn'));
    const result = await screen.findByTestId('leave-org-result');
    expect(result.textContent).toContain('aantal: 3');
    expect(result.textContent).toContain(t('nl', 'accountNothingChanged'));
    expect(screen.queryByTestId('leave-org-retry-btn')).toBeNull();
  });

  it.each([
    ['offline', { status: 'offline' }, 'leaveOrgOffline'],
    ['timeout', { status: 'failed', reason: 'timeout' }, 'leaveOrgFailedTimeout'],
    ['read-failed', { status: 'failed', reason: 'read-failed' }, 'leaveOrgFailedRead'],
    ['in-progress', { status: 'in-progress' }, 'accountActionBusy'],
    [
      'incomplete',
      { status: 'incomplete', stage: 'organization-member', error: { code: 'timeout' } },
      'leaveOrgIncomplete',
    ],
  ] as const)(
    '%s: melding met opnieuw-knop die leave() opnieuw aanroept',
    async (_n, outcome, key) => {
      const gate = fakeGate();
      gate.leave.mockResolvedValueOnce(outcome).mockResolvedValueOnce({ status: 'not-a-member' });
      mount(gate);
      fireEvent.click(screen.getByTestId('open-leave'));
      fireEvent.click(screen.getByTestId('leave-org-confirm-btn'));
      const result = await screen.findByTestId('leave-org-result');
      expect(result.textContent).toContain(t('nl', key));
      fireEvent.click(screen.getByTestId('leave-org-retry-btn'));
      await waitFor(() =>
        expect(screen.getByTestId('leave-org-result').textContent).toContain(
          t('nl', 'leaveOrgNotAMember'),
        ),
      );
      expect(gate.leave).toHaveBeenCalledTimes(2);
    },
  );

  it('incomplete noemt de stap en de fout', async () => {
    const gate = fakeGate();
    gate.leave.mockResolvedValue({
      status: 'incomplete',
      stage: 'team-members',
      error: { code: 'rejected' },
    });
    mount(gate, 'en');
    fireEvent.click(screen.getByTestId('open-leave'));
    fireEvent.click(screen.getByTestId('leave-org-confirm-btn'));
    const text = (await screen.findByTestId('leave-org-result')).textContent ?? '';
    expect(text).toContain(t('en', 'accountStageTeamMembers'));
    expect(text).toContain(t('en', 'accountStepErrorRejected'));
  });

  it('een gooiende poort eindigt in een hervatbare melding, niet in een crash', async () => {
    const gate = fakeGate();
    gate.leave.mockRejectedValue(new Error('onverwacht'));
    mount(gate);
    fireEvent.click(screen.getByTestId('open-leave'));
    fireEvent.click(screen.getByTestId('leave-org-confirm-btn'));
    expect((await screen.findByTestId('leave-org-result')).textContent).toContain(
      t('nl', 'leaveOrgIncomplete'),
    );
    expect(screen.getByTestId('leave-org-retry-btn')).toBeTruthy();
  });

  it('terwijl een flow open is, opent een tweede geen nieuwe (één ingang)', () => {
    const gate = fakeGate();
    mount(gate);
    fireEvent.click(screen.getByTestId('open-leave'));
    fireEvent.click(screen.getByTestId('open-delete'));
    expect(gate.assess).not.toHaveBeenCalled();
    expect(screen.getByTestId('leave-org-confirm-btn')).toBeTruthy();
  });
});

describe('dialooggedrag', () => {
  it('vangt de focus bij openen, cyclet Tab en geeft focus terug bij Escape', () => {
    const gate = fakeGate();
    mount(gate);
    const opener = screen.getByTestId('open-leave');
    opener.focus();
    fireEvent.click(opener);
    const confirm = screen.getByTestId('leave-org-confirm-btn');
    const back = screen.getByTestId('leave-org-back-btn');
    expect(document.activeElement).toBe(confirm);
    back.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(back);
    fireEvent.keyDown(screen.getByTestId('account-flow-dialog'), { key: 'Escape' });
    expect(screen.queryByTestId('account-flow-dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('geeft de focus ook terug als de openende knop tijdens de flow disabled was (Chromium-focusverlies, 2d)', () => {
    // Zoals `AccountPanel`: de knop staat uit zolang er een flow open is. Chromium zet de
    // focus dan meteen op <body> (vóór het effect van de focustrap); jsdom doet dat niet,
    // dus de test bootst het na met `blur()` direct na het openen.
    function DisablingHarness({ gate }: { gate: FakeGate }) {
      const flow = useAccountFlow({
        gate: gate as unknown as AccountActionGate,
        onLeft: () => undefined,
        onAccountDeleted: async () => undefined,
      });
      return (
        <>
          <button
            type="button"
            data-testid="open-leave"
            disabled={flow.state !== null}
            onClick={(event) => {
              flow.openLeave('org-a', 'Fictieve Adelaars');
              event.currentTarget.blur();
            }}
          >
            leave
          </button>
          <AccountFlowDialog lang="nl" flow={flow} organizationName={(id) => NAMES[id] ?? id} />
        </>
      );
    }
    render(<DisablingHarness gate={fakeGate()} />);
    const opener = screen.getByTestId('open-leave');
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByTestId('account-flow-dialog')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId('leave-org-confirm-btn'));
    fireEvent.keyDown(screen.getByTestId('account-flow-dialog'), { key: 'Escape' });
    expect(screen.queryByTestId('account-flow-dialog')).toBeNull();
    expect(opener.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('backdrop-klik sluit, een klik in het dialoog niet', () => {
    const gate = fakeGate();
    mount(gate);
    fireEvent.click(screen.getByTestId('open-leave'));
    fireEvent.click(screen.getByRole('document'));
    expect(screen.queryByTestId('account-flow-dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('account-flow-dialog'));
    expect(screen.queryByTestId('account-flow-dialog')).toBeNull();
  });

  it('na een stapwissel staat de focus op het eerste element van de nieuwe stap', async () => {
    const gate = fakeGate();
    gate.leave.mockResolvedValue({ status: 'offline' });
    mount(gate);
    fireEvent.click(screen.getByTestId('open-leave'));
    fireEvent.click(screen.getByTestId('leave-org-confirm-btn'));
    await screen.findByTestId('leave-org-result');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('leave-org-retry-btn')),
    );
  });
});

async function openPlan(gate: FakeGate, lang: Lang = 'nl') {
  const utils = mount(gate, lang);
  fireEvent.click(screen.getByTestId('open-delete'));
  return utils;
}

async function toPassword(gate: FakeGate, lang: Lang = 'nl') {
  gate.assess.mockResolvedValue({ status: 'ready-to-clear', plan: plan() });
  const utils = await openPlan(gate, lang);
  fireEvent.click(await screen.findByTestId('account-delete-continue-btn'));
  return utils;
}

function typePassword(value: string) {
  fireEvent.input(screen.getByTestId('account-delete-password-input'), { target: { value } });
}

describe('account verwijderen: beoordeling', () => {
  it('beoordeelt bij openen precies één keer en toont "bezig"', async () => {
    const gate = fakeGate();
    const pending = deferred<unknown>();
    gate.assess.mockReturnValue(pending.promise);
    await openPlan(gate);
    expect(gate.assess).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('account-delete-checking').textContent).toBe(
      t('nl', 'accountDeleteChecking'),
    );
    // Tijdens de beoordeling sluit Escape niets.
    fireEvent.keyDown(screen.getByTestId('account-flow-dialog'), { key: 'Escape' });
    expect(screen.queryByTestId('account-flow-dialog')).toBeTruthy();
    pending.resolve({ status: 'ready-to-clear', plan: plan() });
    await screen.findByTestId('account-delete-plan');
  });

  it.each(['nl', 'en'] as const)(
    'ready-to-clear (%s): plan per organisatie met naam, uitnodigingen en Doorgaan',
    async (lang) => {
      const gate = fakeGate();
      gate.assess.mockResolvedValue({ status: 'ready-to-clear', plan: plan() });
      await openPlan(gate, lang);
      await screen.findByTestId('account-delete-plan');
      expect(screen.getByTestId('account-delete-org-org-a').textContent).toContain(
        'Fictieve Adelaars',
      );
      expect(screen.getByTestId('account-delete-org-org-a').textContent).toContain(
        t(lang, 'accountDeleteClassLeave'),
      );
      expect(screen.getByTestId('account-delete-org-org-b').textContent).toContain(
        t(lang, 'accountDeleteClassLeaveTeamOnly'),
      );
      expect(screen.getByTestId('account-delete-invitations').textContent).toContain('2');
      expect(screen.getByTestId('account-delete-ready').textContent).toBe(
        t(lang, 'accountDeleteReadyIntro'),
      );
      expect(screen.getByTestId('account-delete-continue-btn')).toBeTruthy();
      expect(gate.clearFirestoreData).not.toHaveBeenCalled();
    },
  );

  it('needs-action: blokkades met reden, GEEN Doorgaan, wel opnieuw controleren', async () => {
    const gate = fakeGate();
    gate.assess
      .mockResolvedValueOnce({
        status: 'needs-action',
        plan: plan({
          organizations: [
            { organizationId: 'org-a', class: 'owner-sole', otherOwnerCount: 0 },
            { organizationId: 'org-b', class: 'local-unsynced-work', localUnsyncedWork: 4 },
            { organizationId: 'org-c', class: 'invitations-only' },
          ],
          canProceed: false,
        }),
      })
      .mockResolvedValueOnce({ status: 'ready-for-auth-deletion' });
    await openPlan(gate);
    await screen.findByTestId('account-delete-plan');
    expect(screen.getByTestId('account-delete-org-org-a').dataset.blocked).toBe('true');
    expect(screen.getByTestId('account-delete-org-org-a').textContent).toContain(
      t('nl', 'accountDeleteClassOwnerSole'),
    );
    expect(screen.getByTestId('account-delete-org-org-b').textContent).toContain('aantal: 4');
    expect(screen.getByTestId('account-delete-org-org-c').dataset.blocked).toBe('false');
    // Onbekende naam: de ID.
    expect(screen.getByTestId('account-delete-org-org-c').textContent).toContain('org-c');
    expect(screen.getByTestId('account-delete-blocked').textContent).toBe(
      t('nl', 'accountDeleteBlockedTitle'),
    );
    expect(screen.queryByTestId('account-delete-continue-btn')).toBeNull();
    fireEvent.click(screen.getByTestId('account-delete-recheck-btn'));
    await screen.findByTestId('account-delete-auth-only');
    expect(gate.assess).toHaveBeenCalledTimes(2);
  });

  it('ready-for-auth-deletion: "alleen je account bestaat nog", Doorgaan gaat naar alleen de Auth-stap', async () => {
    const gate = fakeGate();
    gate.assess.mockResolvedValue({ status: 'ready-for-auth-deletion' });
    gate.deleteAuthAccount.mockResolvedValue({ status: 'deleted' });
    await openPlan(gate, 'en');
    expect((await screen.findByTestId('account-delete-auth-only')).textContent).toBe(
      t('en', 'accountDeleteAuthOnly'),
    );
    fireEvent.click(screen.getByTestId('account-delete-continue-btn'));
    typePassword(PASSWORD);
    fireEvent.click(screen.getByTestId('account-delete-confirm-btn'));
    await screen.findByTestId('account-delete-deleted');
    expect(gate.clearFirestoreData).not.toHaveBeenCalled();
    expect(gate.deleteAuthAccount).toHaveBeenCalledWith(PASSWORD);
  });

  it.each([
    ['not-signed-in', { status: 'not-signed-in' }, 'accountDeleteNotSignedIn', false],
    ['offline', { status: 'offline' }, 'accountDeleteOffline', true],
    ['read-failed', { status: 'failed', reason: 'read-failed' }, 'accountDeleteFailedRead', true],
    ['timeout', { status: 'failed', reason: 'timeout' }, 'accountDeleteFailedTimeout', true],
    ['in-progress', { status: 'in-progress' }, 'accountActionBusy', true],
    [
      'auth-state-unknown',
      { status: 'auth-state-unknown' },
      'accountDeleteAuthStateUnknown',
      false,
    ],
  ] as const)(
    'assess %s: melding (NL+EN), opnieuw alleen als zinvol',
    async (_n, outcome, key, retry) => {
      for (const lang of ['nl', 'en'] as const) {
        const gate = fakeGate();
        gate.assess.mockResolvedValue(outcome);
        const { unmount } = await openPlan(gate, lang);
        const result = await screen.findByTestId('account-delete-result');
        expect(result.textContent).toContain(t(lang, key));
        expect(!!screen.queryByTestId('account-delete-retry-btn')).toBe(retry);
        unmount();
      }
    },
  );

  it('email-not-verified: bevestigingsmail opnieuw sturen en opnieuw controleren', async () => {
    const gate = fakeGate();
    gate.assess
      .mockResolvedValueOnce({ status: 'email-not-verified' })
      .mockResolvedValueOnce({ status: 'ready-for-auth-deletion' });
    const onResend = vi.fn(async () => true);
    mount(gate, 'nl', { onResend });
    fireEvent.click(screen.getByTestId('open-delete'));
    expect((await screen.findByTestId('account-delete-result')).textContent).toContain(
      t('nl', 'accountDeleteEmailNotVerified'),
    );
    fireEvent.click(screen.getByTestId('account-delete-resend-verification-btn'));
    expect((await screen.findByTestId('account-delete-verification-result')).textContent).toBe(
      t('nl', 'accountDeleteVerificationSent'),
    );
    expect(onResend).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('account-delete-retry-btn'));
    await screen.findByTestId('account-delete-auth-only');
  });
});

describe('account verwijderen: wachtwoord en uitvoering', () => {
  it('wachtwoordveld: type=password, autocomplete=current-password, knop uit zonder invoer', async () => {
    const gate = fakeGate();
    await toPassword(gate);
    const input = screen.getByTestId('account-delete-password-input') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('current-password');
    expect(document.activeElement).toBe(input);
    expect((screen.getByTestId('account-delete-confirm-btn') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByTestId('account-flow-dialog').getAttribute('aria-label')).toBe(
      t('nl', 'accountDeletePasswordTitle'),
    );
  });

  it('volledige flow: clear → deleteAuthAccount met hetzelfde wachtwoord, veld meteen leeg, B7 vóór de bevestiging', async () => {
    const gate = fakeGate();
    const clear = deferred<unknown>();
    gate.clearFirestoreData.mockReturnValue(clear.promise);
    gate.deleteAuthAccount.mockResolvedValue({ status: 'deleted' });
    const { onDeleted } = await toPassword(gate);
    typePassword(PASSWORD);
    fireEvent.click(screen.getByTestId('account-delete-confirm-btn'));
    const input = screen.getByTestId('account-delete-password-input') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.disabled).toBe(true);
    expect(screen.getByTestId('account-delete-confirm-btn').textContent).toBe(
      t('nl', 'accountDeleteInProgress'),
    );
    // Tijdens het lopen sluit niets het dialoog.
    fireEvent.keyDown(screen.getByTestId('account-flow-dialog'), { key: 'Escape' });
    expect(screen.queryByTestId('account-flow-dialog')).toBeTruthy();
    expect(gate.clearFirestoreData).toHaveBeenCalledWith(PASSWORD);
    clear.resolve({ status: 'ready-for-auth-deletion' });
    const deleted = await screen.findByTestId('account-delete-deleted');
    expect(gate.deleteAuthAccount).toHaveBeenCalledWith(PASSWORD);
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(deleted.textContent).toContain(t('nl', 'accountDeleteDeleted'));
    expect(deleted.textContent).not.toContain(t('nl', 'accountDeleteLocalWipeFailed'));
    // Het wachtwoord staat nergens in de DOM.
    expect(document.body.innerHTML).not.toContain(PASSWORD);
  });

  it('een mislukte lokale wipe na deleted toont nog steeds "verwijderd", met de waarschuwing', async () => {
    const gate = fakeGate();
    gate.clearFirestoreData.mockResolvedValue({ status: 'ready-for-auth-deletion' });
    gate.deleteAuthAccount.mockResolvedValue({ status: 'deleted' });
    const onLeft = vi.fn();
    const onDeleted = vi.fn(async () => {
      throw new Error('indexeddb kapot');
    });
    gate.assess.mockResolvedValue({ status: 'ready-to-clear', plan: plan() });
    render(<Harness gate={gate} lang="en" onLeft={onLeft} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByTestId('open-delete'));
    fireEvent.click(await screen.findByTestId('account-delete-continue-btn'));
    typePassword(PASSWORD);
    fireEvent.click(screen.getByTestId('account-delete-confirm-btn'));
    const deleted = await screen.findByTestId('account-delete-deleted');
    expect(deleted.textContent).toContain(t('en', 'accountDeleteDeleted'));
    expect(deleted.textContent).toContain(t('en', 'accountDeleteLocalWipeFailed'));
  });

  it.each([
    ['wrong-password', 'accountDeleteWrongPassword'],
    ['too-many-requests', 'accountDeleteTooManyRequests'],
    ['network', 'accountDeleteReauthNetwork'],
    ['other', 'accountDeleteReauthOther'],
  ] as const)(
    'reauth %s bij clear: fout in het dialoog, veld leeg en weer bruikbaar, geen deleteAuthAccount',
    async (reason, key) => {
      const gate = fakeGate();
      gate.clearFirestoreData.mockResolvedValue({ status: 'reauth-failed', reason });
      const { onDeleted } = await toPassword(gate, 'en');
      typePassword(PASSWORD);
      fireEvent.click(screen.getByTestId('account-delete-confirm-btn'));
      expect((await screen.findByTestId('account-delete-password-error')).textContent).toBe(
        t('en', key),
      );
      const input = screen.getByTestId('account-delete-password-input') as HTMLInputElement;
      expect(input.value).toBe('');
      expect(input.disabled).toBe(false);
      await waitFor(() => expect(document.activeElement).toBe(input));
      expect(gate.deleteAuthAccount).not.toHaveBeenCalled();
      expect(onDeleted).not.toHaveBeenCalled();
    },
  );

  it('reauth-fout ná een geslaagde opruiming probeert daarna alleen de Auth-stap', async () => {
    const gate = fakeGate();
    gate.clearFirestoreData.mockResolvedValue({ status: 'ready-for-auth-deletion' });
    gate.deleteAuthAccount
      .mockResolvedValueOnce({ status: 'reauth-failed', reason: 'wrong-password' })
      .mockResolvedValueOnce({ status: 'deleted' });
    await toPassword(gate);
    typePassword(PASSWORD);
    fireEvent.click(screen.getByTestId('account-delete-confirm-btn'));
    await screen.findByTestId('account-delete-password-error');
    typePassword('ander-fictief');
    fireEvent.click(screen.getByTestId('account-delete-confirm-btn'));
    await screen.findByTestId('account-delete-deleted');
    expect(gate.clearFirestoreData).toHaveBeenCalledTimes(1);
    expect(gate.deleteAuthAccount).toHaveBeenLastCalledWith('ander-fictief');
  });

  it.each(['nl', 'en'] as const)(
    'firestore-cleared-auth-present (%s): "je account bestaat nog", opnieuw = alleen Auth-stap',
    async (lang) => {
      const gate = fakeGate();
      gate.clearFirestoreData.mockResolvedValue({ status: 'ready-for-auth-deletion' });
      gate.deleteAuthAccount
        .mockResolvedValueOnce({ status: 'firestore-cleared-auth-present', reason: 'network' })
        .mockResolvedValueOnce({ status: 'deleted' });
      const { onDeleted } = await toPassword(gate, lang);
      typePassword(PASSWORD);
      fireEvent.click(screen.getByTestId('account-delete-confirm-btn'));
      const result = await screen.findByTestId('account-delete-result');
      expect(result.textContent).toContain(t(lang, 'accountDeleteClearedAuthPresent'));
      expect(result.textContent).toContain(t(lang, 'accountDeleteReasonNetwork'));
      expect(result.textContent).not.toContain(t(lang, 'accountDeleteDeleted'));
      expect(onDeleted).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('account-delete-retry-btn'));
      typePassword(PASSWORD);
      fireEvent.click(screen.getByTestId('account-delete-confirm-btn'));
      await screen.findByTestId('account-delete-deleted');
      expect(gate.clearFirestoreData).toHaveBeenCalledTimes(1);
      expect(gate.deleteAuthAccount).toHaveBeenCalledTimes(2);
    },
  );

  it('auth-state-unknown na deleteAuthAccount: nooit "verwijderd", geen B7, geen opnieuw-knop', async () => {
    const gate = fakeGate();
    gate.clearFirestoreData.mockResolvedValue({ status: 'ready-for-auth-deletion' });
    gate.deleteAuthAccount.mockResolvedValue({ status: 'auth-state-unknown' });
    const { onDeleted } = await toPassword(gate);
    typePassword(PASSWORD);
    fireEvent.click(screen.getByTestId('account-delete-confirm-btn'));
    const result = await screen.findByTestId('account-delete-result');
    expect(result.textContent).toContain(t('nl', 'accountDeleteAuthStateUnknown'));
    expect(screen.queryByTestId('account-delete-retry-btn')).toBeNull();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('een gooiende deleteAuthAccount geldt als onbekende afloop, niet als verwijderd', async () => {
    const gate = fakeGate();
    gate.clearFirestoreData.mockResolvedValue({ status: 'ready-for-auth-deletion' });
    gate.deleteAuthAccount.mockRejectedValue(new Error('boem'));
    const { onDeleted } = await toPassword(gate);
    typePassword(PASSWORD);
    fireEvent.click(screen.getByTestId('account-delete-confirm-btn'));
    expect((await screen.findByTestId('account-delete-result')).textContent).toContain(
      t('nl', 'accountDeleteAuthStateUnknown'),
    );
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('incomplete na clear: hervatbare melding met stap; opnieuw beoordeelt opnieuw', async () => {
    const gate = fakeGate();
    gate.clearFirestoreData.mockResolvedValue({
      status: 'incomplete',
      stage: 'invitations',
      organizationId: 'org-a',
      error: { code: 'timeout' },
    });
    await toPassword(gate);
    typePassword(PASSWORD);
    fireEvent.click(screen.getByTestId('account-delete-confirm-btn'));
    const text = (await screen.findByTestId('account-delete-result')).textContent ?? '';
    expect(text).toContain(t('nl', 'accountDeleteIncomplete'));
    expect(text).toContain(t('nl', 'accountStageInvitations'));
    expect(text).toContain(t('nl', 'accountStepErrorTimeout'));
    expect(gate.deleteAuthAccount).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('account-delete-retry-btn'));
    await screen.findByTestId('account-delete-plan');
    expect(gate.assess).toHaveBeenCalledTimes(2);
  });

  it('incomplete final-gate bij deleteAuthAccount toont de resterende aantallen', async () => {
    const gate = fakeGate();
    gate.clearFirestoreData.mockResolvedValue({ status: 'ready-for-auth-deletion' });
    gate.deleteAuthAccount.mockResolvedValue({
      status: 'incomplete',
      stage: 'final-gate',
      organizationId: null,
      remaining: { organizationMembers: 0, teamMembers: 0, invitations: 1 },
    });
    await toPassword(gate, 'en');
    typePassword(PASSWORD);
    fireEvent.click(screen.getByTestId('account-delete-confirm-btn'));
    expect((await screen.findByTestId('account-delete-result')).textContent).toContain(
      'invitations: 1',
    );
  });

  it('needs-action na clear: terug naar het plan met "situatie veranderd", niets verwijderd', async () => {
    const gate = fakeGate();
    gate.clearFirestoreData.mockResolvedValue({
      status: 'needs-action',
      plan: plan({
        organizations: [{ organizationId: 'org-a', class: 'creator-needs-owner' }],
        canProceed: false,
      }),
    });
    await toPassword(gate);
    typePassword(PASSWORD);
    fireEvent.click(screen.getByTestId('account-delete-confirm-btn'));
    expect((await screen.findByTestId('account-delete-plan-changed')).textContent).toBe(
      t('nl', 'accountDeletePlanChanged'),
    );
    expect(screen.getByTestId('account-delete-org-org-a').textContent).toContain(
      t('nl', 'accountDeleteClassCreatorNeedsOwner'),
    );
    expect(screen.queryByTestId('account-delete-continue-btn')).toBeNull();
    expect(gate.deleteAuthAccount).not.toHaveBeenCalled();
  });

  it('annuleren in het wachtwoordscherm sluit zonder aanroep en zonder wachtwoord te bewaren', async () => {
    const gate = fakeGate();
    await toPassword(gate);
    typePassword(PASSWORD);
    fireEvent.click(screen.getByTestId('account-delete-cancel-btn'));
    expect(screen.queryByTestId('account-flow-dialog')).toBeNull();
    expect(gate.clearFirestoreData).not.toHaveBeenCalled();
    // Opnieuw openen: leeg veld.
    gate.assess.mockResolvedValue({ status: 'ready-to-clear', plan: plan() });
    fireEvent.click(screen.getByTestId('open-delete'));
    fireEvent.click(await screen.findByTestId('account-delete-continue-btn'));
    expect((screen.getByTestId('account-delete-password-input') as HTMLInputElement).value).toBe(
      '',
    );
  });
});
