// @vitest-environment jsdom
// PR 8.3c-2c-i — wiring van verlaten en accountverwijdering in `AuthGate`
// (docs/pr-8.3c-2c-plan.md §2/§4). Firebase, de organisatiegateway en `App` zijn nep; de
// echte `AuthGate`, `useAccountFlow`, `AccountActionGate` en het echte dialoog draaien.
// Bewijst: (1) de flow overleeft een membership-snapshot die het scherm vervangt, zonder
// een tweede coördinatoraanroep; (2) na een geslaagd vertrek wist Sluiten de context en
// start het abonnement opnieuw; (3) B7: na `deleted` `wipeLocalFirebaseData()` en NOOIT
// `clearLocalDeviceData()`, en de bevestiging blijft staan als het loginscherm verschijnt;
// (4) de diensten worden één keer per login gebouwd; (5) de taal volgt `App`.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/preact';
import type { Membership, TeamOnlyContext } from '../../src/domain/organizations/types';

const firebase = vi.hoisted(() => ({
  wipeLocalFirebaseData: vi.fn(async () => undefined),
  initFirebase: vi.fn(),
  clearLocalDeviceData: vi.fn(),
}));

vi.mock('../../src/infrastructure/firebase/firebaseClient', () => ({
  getFirestoreDb: () => ({}),
  getFirebaseAuth: () => ({}),
  initFirebase: firebase.initFirebase,
  reinitFirestoreForTrustLevel: vi.fn(async () => undefined),
  wipeLocalFirebaseData: firebase.wipeLocalFirebaseData,
}));

vi.mock('../../src/infrastructure/device/clearLocalDeviceData', () => ({
  clearLocalDeviceData: firebase.clearLocalDeviceData,
}));

vi.mock('../../src/infrastructure/repositories/selectRepositories', () => ({
  selectRepositories: () => ({ kind: 'local' }),
}));

const subscriptions = vi.hoisted(() => ({
  memberships: [] as ((m: Membership[]) => void)[],
  teamOnly: [] as ((c: TeamOnlyContext[]) => void)[],
}));

vi.mock('../../src/infrastructure/organizations/FirestoreOrganizationGateway', () => ({
  FirestoreOrganizationGateway: class {
    subscribeMyMemberships(onData: (m: Membership[]) => void) {
      subscriptions.memberships.push(onData);
      return () => undefined;
    }
    subscribeMyTeamOnlyContexts(onData: (c: TeamOnlyContext[]) => void) {
      subscriptions.teamOnly.push(onData);
      return () => undefined;
    }
    async listTeams() {
      return [];
    }
    async validateSelectedTeam() {
      return { valid: true, canManageTeamData: false, canWriteGameData: false };
    }
  },
}));

vi.mock('../../src/app/App', () => ({
  App: (props: {
    accountActions?: {
      organizationName: string;
      onLeaveOrganization: () => void;
      onDeleteAccount: () => void;
      onTransferOwnership?: () => void;
      onRemoveOtherOwner?: () => void;
    };
    onLangChange?: (lang: 'nl' | 'en') => void;
  }) => (
    <div data-testid="app-stub">
      <span data-testid="stub-account-org-name">{props.accountActions?.organizationName}</span>
      <button
        type="button"
        data-testid="stub-leave"
        onClick={() => props.accountActions?.onLeaveOrganization()}
      >
        leave
      </button>
      <button
        type="button"
        data-testid="stub-delete"
        onClick={() => props.accountActions?.onDeleteAccount()}
      >
        delete
      </button>
      <button
        type="button"
        data-testid="stub-transfer"
        onClick={() => props.accountActions?.onTransferOwnership?.()}
      >
        transfer
      </button>
      <button
        type="button"
        data-testid="stub-remove-owner"
        onClick={() => props.accountActions?.onRemoveOtherOwner?.()}
      >
        remove owner
      </button>
      <button type="button" data-testid="stub-lang-en" onClick={() => props.onLangChange?.('en')}>
        en
      </button>
    </div>
  ),
}));

import { AuthGate } from '../../src/app/AuthGate';
import type { AuthGateway } from '../../src/application/auth/AuthGateway';
import type { AuthUser } from '../../src/domain/auth/types';
import { TRUSTED_DEVICE_STORAGE_KEY } from '../../src/infrastructure/device/trustedDevice';
import { SELECTED_CONTEXT_STORAGE_KEY } from '../../src/infrastructure/context/selectedContext';
import { translate } from '../../src/i18n/strings';

const USER: AuthUser = { uid: 'uid-fictief', email: 'coach@example.test', emailVerified: true };
const PASSWORD = 'fictief-wachtwoord-2';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeAuth() {
  let listener: ((u: AuthUser | null) => void) | null = null;
  const gateway = {
    getCurrentUser: () => USER,
    subscribe: (cb: (u: AuthUser | null) => void) => {
      listener = cb;
      cb(USER);
      return () => undefined;
    },
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(async () => undefined),
    sendVerificationEmail: vi.fn(async () => true),
    refreshIdToken: vi.fn(async () => undefined),
  } as unknown as AuthGateway;
  return { gateway, emit: (u: AuthUser | null) => listener?.(u) };
}

function coordinators() {
  return {
    leaveCoordinator: { leave: vi.fn() },
    accountDeletionCoordinator: {
      assess: vi.fn(),
      clearFirestoreData: vi.fn(),
      deleteAuthAccount: vi.fn(),
    },
    ownershipTransferCoordinator: {
      listTransferCandidates: vi.fn(),
      promote: vi.fn(),
      completeTransfer: vi.fn(),
    },
  };
}

function emitMemberships(memberships: Membership[], teamOnly: TeamOnlyContext[] = []) {
  subscriptions.memberships.at(-1)?.(memberships);
  subscriptions.teamOnly.at(-1)?.(teamOnly);
}

const ORG_A: Membership = { orgId: 'org-a', orgName: 'Fictieve Adelaars', role: 'coach' };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(TRUSTED_DEVICE_STORAGE_KEY, 'false');
  localStorage.setItem('lineup-tracker-lang', 'nl');
  subscriptions.memberships.length = 0;
  subscriptions.teamOnly.length = 0;
  firebase.wipeLocalFirebaseData.mockClear();
  firebase.initFirebase.mockClear();
  firebase.clearLocalDeviceData.mockClear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function mount() {
  const auth = fakeAuth();
  const c = coordinators();
  const factory = vi.fn(() => c);
  render(<AuthGate authGateway={auth.gateway} accountServicesFactory={factory as never} />);
  return { auth, c, factory };
}

async function toActive(membership: Membership = ORG_A) {
  localStorage.setItem(
    SELECTED_CONTEXT_STORAGE_KEY,
    JSON.stringify({ orgId: 'org-a', teamId: 'team-a' }),
  );
  const utils = mount();
  emitMemberships([membership]);
  await screen.findByTestId('app-stub');
  return utils;
}

describe('AuthGate — accountflow boven de unmount-grens', () => {
  it('een membership-snapshot die het geen-organisatiesscherm vervangt, breekt de beoordeling niet af en roept niets opnieuw aan', async () => {
    const { c, factory } = mount();
    emitMemberships([]);
    const pending = deferred<unknown>();
    c.accountDeletionCoordinator.assess.mockReturnValue(pending.promise);
    fireEvent.click(await screen.findByTestId('no-org-delete-account-btn'));
    expect(c.accountDeletionCoordinator.assess).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('account-delete-checking')).toBeTruthy();

    // Een nieuw membership komt binnen: het scherm wordt de contextwisselaar.
    emitMemberships([ORG_A]);
    await screen.findByTestId('context-org-org-a');
    expect(screen.queryByTestId('no-org-delete-account-btn')).toBeNull();
    expect(screen.getByTestId('account-delete-checking')).toBeTruthy();
    expect(c.accountDeletionCoordinator.assess).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('de uitkomst van een lopende beoordeling verschijnt nog nadat het scherm wisselde', async () => {
    const { c } = mount();
    emitMemberships([]);
    const pending = deferred<unknown>();
    c.accountDeletionCoordinator.assess.mockReturnValue(pending.promise);
    fireEvent.click(await screen.findByTestId('no-org-delete-account-btn'));
    emitMemberships([ORG_A]);
    await screen.findByTestId('context-org-org-a');
    pending.resolve({
      status: 'needs-action',
      plan: {
        organizations: [{ organizationId: 'org-a', class: 'creator-needs-owner' }],
        invitationCount: 0,
        canProceed: false,
      },
    });
    const row = await screen.findByTestId('account-delete-org-org-a');
    // De naam komt uit de (nieuwe) memberships van AuthGate.
    expect(row.textContent).toContain('Fictieve Adelaars');
    expect(c.accountDeletionCoordinator.assess).toHaveBeenCalledTimes(1);
  });

  it('verlaten vanuit App: Sluiten na ok wist de gekozen context en start het abonnement opnieuw', async () => {
    const { c } = await toActive();
    c.leaveCoordinator.leave.mockResolvedValue({
      status: 'ok',
      removed: { teamMembers: 1, invitations: 0, organizationMember: true },
      organizationDeletionPending: false,
      invitationsChecked: true,
    });
    fireEvent.click(screen.getByTestId('stub-leave'));
    fireEvent.click(screen.getByTestId('leave-org-confirm-btn'));
    await screen.findByTestId('leave-org-result');
    expect(c.leaveCoordinator.leave).toHaveBeenCalledWith('org-a');
    // Nog niets gewist zolang het resultaat open staat.
    expect(localStorage.getItem(SELECTED_CONTEXT_STORAGE_KEY)).not.toBeNull();
    const subscriptionsBefore = subscriptions.memberships.length;

    fireEvent.click(screen.getByTestId('leave-org-close-btn'));
    expect(localStorage.getItem(SELECTED_CONTEXT_STORAGE_KEY)).toBeNull();
    await waitFor(() => expect(subscriptions.memberships.length).toBe(subscriptionsBefore + 1));
    emitMemberships([]);
    await screen.findByTestId('no-org-delete-account-btn');
    expect(firebase.wipeLocalFirebaseData).not.toHaveBeenCalled();
  });

  it('een geweigerd vertrek wist niets en start geen nieuw abonnement', async () => {
    const { c } = await toActive();
    c.leaveCoordinator.leave.mockResolvedValue({ status: 'denied', reason: 'creator-needs-owner' });
    fireEvent.click(screen.getByTestId('stub-leave'));
    fireEvent.click(screen.getByTestId('leave-org-confirm-btn'));
    await screen.findByTestId('leave-org-result');
    const subscriptionsBefore = subscriptions.memberships.length;
    fireEvent.click(screen.getByTestId('leave-org-close-btn'));
    expect(localStorage.getItem(SELECTED_CONTEXT_STORAGE_KEY)).not.toBeNull();
    expect(subscriptions.memberships.length).toBe(subscriptionsBefore);
    expect(screen.getByTestId('app-stub')).toBeTruthy();
  });

  it('B7: na deleted wipeLocalFirebaseData() + herinitialisatie, nooit clearLocalDeviceData(); de bevestiging staat over het loginscherm', async () => {
    const { c, auth } = await toActive();
    localStorage.setItem('lineup-tracker-settings', '{"teamName":"Lokaal"}');
    c.accountDeletionCoordinator.assess.mockResolvedValue({ status: 'ready-for-auth-deletion' });
    c.accountDeletionCoordinator.deleteAuthAccount.mockImplementation(async () => {
      // `deleteUser` meldt de gebruiker af: AuthGate valt terug naar het loginscherm
      // terwijl de flow nog loopt.
      auth.emit(null);
      return { status: 'deleted' };
    });
    fireEvent.click(screen.getByTestId('stub-delete'));
    fireEvent.click(await screen.findByTestId('account-delete-continue-btn'));
    fireEvent.input(screen.getByTestId('account-delete-password-input'), {
      target: { value: PASSWORD },
    });
    fireEvent.click(screen.getByTestId('account-delete-confirm-btn'));

    const deleted = await screen.findByTestId('account-delete-deleted');
    expect(deleted.textContent).toContain(translate('nl', 'accountDeleteDeleted'));
    expect(screen.getByTestId('auth-email')).toBeTruthy();
    expect(screen.queryByTestId('app-stub')).toBeNull();
    expect(firebase.wipeLocalFirebaseData).toHaveBeenCalledTimes(1);
    expect(firebase.initFirebase).toHaveBeenCalledWith(false);
    expect(firebase.clearLocalDeviceData).not.toHaveBeenCalled();
    expect(c.accountDeletionCoordinator.deleteAuthAccount).toHaveBeenCalledWith(PASSWORD);
    // Lokale-modusdata en de taalkeuze blijven; alleen de contextpointer is weg.
    expect(localStorage.getItem('lineup-tracker-settings')).toBe('{"teamName":"Lokaal"}');
    expect(localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY)).toBe('false');
    expect(localStorage.getItem(SELECTED_CONTEXT_STORAGE_KEY)).toBeNull();
    expect(document.body.innerHTML).not.toContain(PASSWORD);

    fireEvent.click(screen.getByTestId('account-delete-close-btn'));
    expect(screen.queryByTestId('account-flow-dialog')).toBeNull();
  });

  it('geen B7 bij firestore-cleared-auth-present', async () => {
    const { c } = await toActive();
    c.accountDeletionCoordinator.assess.mockResolvedValue({ status: 'ready-for-auth-deletion' });
    c.accountDeletionCoordinator.deleteAuthAccount.mockResolvedValue({
      status: 'firestore-cleared-auth-present',
      reason: 'requires-recent-login',
    });
    fireEvent.click(screen.getByTestId('stub-delete'));
    fireEvent.click(await screen.findByTestId('account-delete-continue-btn'));
    fireEvent.input(screen.getByTestId('account-delete-password-input'), {
      target: { value: PASSWORD },
    });
    fireEvent.click(screen.getByTestId('account-delete-confirm-btn'));
    await screen.findByTestId('account-delete-result');
    expect(firebase.wipeLocalFirebaseData).not.toHaveBeenCalled();
    expect(localStorage.getItem(SELECTED_CONTEXT_STORAGE_KEY)).not.toBeNull();
  });

  it('één poort: terwijl een vertrek loopt, geeft verwijderen geen tweede flow en geen aanroep', async () => {
    const { c } = await toActive();
    const pending = deferred<unknown>();
    c.leaveCoordinator.leave.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByTestId('stub-leave'));
    fireEvent.click(screen.getByTestId('leave-org-confirm-btn'));
    fireEvent.click(screen.getByTestId('stub-delete'));
    expect(c.accountDeletionCoordinator.assess).not.toHaveBeenCalled();
    expect(screen.getByTestId('leave-org-confirm-btn')).toBeTruthy();
  });

  it('de taal van App bereikt het dialoog', async () => {
    await toActive();
    fireEvent.click(screen.getByTestId('stub-lang-en'));
    fireEvent.click(screen.getByTestId('stub-leave'));
    await waitFor(() =>
      expect(screen.getByTestId('account-flow-dialog').getAttribute('aria-label')).toBe(
        'Leave organization Fictieve Adelaars?',
      ),
    );
  });
});

// PR 8.3c-2c-ii (docs/pr-8.3c-2c-plan.md §8): de overdracht in dezelfde flow en poort.
const OWNER_ORG_A: Membership = { ...ORG_A, role: 'organizationOwner' };
const CANDIDATE = { uid: 'uid-fictief-b', role: 'coach' as const, email: 'b.fictief@example.test' };
const OTHER_OWNER = {
  uid: 'uid-fictief-a',
  role: 'organizationOwner' as const,
  email: 'a.fictief@example.test',
};

describe('AuthGate — overdracht', () => {
  it('opent vanuit App, roept de lijst één keer aan en overleeft het verdwijnen van App', async () => {
    const { c, factory } = await toActive(OWNER_ORG_A);
    const pending = deferred<unknown>();
    c.ownershipTransferCoordinator.listTransferCandidates.mockReturnValue(pending.promise);
    expect(c.ownershipTransferCoordinator.listTransferCandidates).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('stub-transfer'));
    expect(c.ownershipTransferCoordinator.listTransferCandidates).toHaveBeenCalledTimes(1);
    expect(c.ownershipTransferCoordinator.listTransferCandidates).toHaveBeenCalledWith('org-a');

    // Terug naar de wisselaar: App unmount, het dialoog en de lopende aanroep niet.
    fireEvent.click(screen.getByTestId('switch-context'));
    await screen.findByTestId('context-org-org-a');
    expect(screen.queryByTestId('app-stub')).toBeNull();
    expect(screen.getByTestId('transfer-loading')).toBeTruthy();
    pending.resolve({ status: 'ok', candidates: [CANDIDATE], otherOwners: [] });
    fireEvent.click(await screen.findByTestId('transfer-member-0'));
    c.ownershipTransferCoordinator.promote.mockResolvedValue({
      status: 'ok',
      outcome: 'promoted',
    });
    fireEvent.click(screen.getByTestId('transfer-confirm-btn'));
    expect((await screen.findByTestId('transfer-result')).textContent).toContain(
      translate('nl', 'transferPromoteOk')
        .replace('{member}', CANDIDATE.email)
        .replace('{org}', 'Fictieve Adelaars'),
    );
    expect(c.ownershipTransferCoordinator.listTransferCandidates).toHaveBeenCalledTimes(1);
    expect(c.ownershipTransferCoordinator.promote).toHaveBeenCalledWith('org-a', CANDIDATE.uid);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('andere eigenaar verwijderen: getypte bevestiging, dan completeTransfer via dezelfde poort', async () => {
    const { c } = await toActive(OWNER_ORG_A);
    c.ownershipTransferCoordinator.listTransferCandidates.mockResolvedValue({
      status: 'ok',
      candidates: [CANDIDATE],
      otherOwners: [OTHER_OWNER],
    });
    c.ownershipTransferCoordinator.completeTransfer.mockResolvedValue({
      status: 'ok',
      revokedInvitations: 1,
      skippedMalformedInvitations: 0,
      removedTeamMemberships: 2,
      organizationMember: 'deleted',
    });
    fireEvent.click(screen.getByTestId('stub-remove-owner'));
    fireEvent.click(await screen.findByTestId('transfer-member-0'));
    expect((screen.getByTestId('transfer-confirm-btn') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(screen.getByTestId('transfer-remove-owner-input'), {
      target: { value: OTHER_OWNER.email },
    });
    fireEvent.click(screen.getByTestId('transfer-confirm-btn'));
    await screen.findByTestId('transfer-result');
    expect(c.ownershipTransferCoordinator.completeTransfer).toHaveBeenCalledWith(
      'org-a',
      OTHER_OWNER.uid,
    );
    // Een geslaagde overdracht door B verandert B's eigen context niet.
    const subscriptionsBefore = subscriptions.memberships.length;
    fireEvent.click(screen.getByTestId('transfer-close-btn'));
    expect(localStorage.getItem(SELECTED_CONTEXT_STORAGE_KEY)).not.toBeNull();
    expect(subscriptions.memberships.length).toBe(subscriptionsBefore);
    expect(screen.getByTestId('app-stub')).toBeTruthy();
  });

  it('één poort: terwijl de lijst wordt gelezen, starten verlaten en verwijderen niets', async () => {
    const { c } = await toActive(OWNER_ORG_A);
    const pending = deferred<unknown>();
    c.ownershipTransferCoordinator.listTransferCandidates.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByTestId('stub-transfer'));
    fireEvent.click(screen.getByTestId('stub-leave'));
    fireEvent.click(screen.getByTestId('stub-delete'));
    fireEvent.click(screen.getByTestId('stub-remove-owner'));
    expect(c.leaveCoordinator.leave).not.toHaveBeenCalled();
    expect(c.accountDeletionCoordinator.assess).not.toHaveBeenCalled();
    expect(c.ownershipTransferCoordinator.listTransferCandidates).toHaveBeenCalledTimes(1);
    pending.resolve({ status: 'offline' });
    expect((await screen.findByTestId('transfer-result')).textContent).toContain(
      translate('nl', 'transferOffline'),
    );
  });

  it('één poort: terwijl een vertrek loopt, start de overdracht niets', async () => {
    const { c } = await toActive();
    const pending = deferred<unknown>();
    c.leaveCoordinator.leave.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByTestId('stub-leave'));
    fireEvent.click(screen.getByTestId('leave-org-confirm-btn'));
    fireEvent.click(screen.getByTestId('stub-transfer'));
    fireEvent.click(screen.getByTestId('stub-remove-owner'));
    expect(c.ownershipTransferCoordinator.listTransferCandidates).not.toHaveBeenCalled();
    expect(c.ownershipTransferCoordinator.promote).not.toHaveBeenCalled();
    expect(c.ownershipTransferCoordinator.completeTransfer).not.toHaveBeenCalled();
  });
});

describe('AuthGate — organisatienaam zonder ruwe ID (reviewpunt op 2c-i)', () => {
  it.each(['nl', 'en'] as const)(
    'een organisatie buiten de lijsten krijgt in het plan het neutrale label (%s)',
    async (lang) => {
      localStorage.setItem('lineup-tracker-lang', lang);
      const { c } = mount();
      emitMemberships([]);
      c.accountDeletionCoordinator.assess.mockResolvedValue({
        status: 'needs-action',
        plan: {
          organizations: [{ organizationId: 'org-fictief-weg', class: 'creator-needs-owner' }],
          invitationCount: 0,
          canProceed: false,
        },
      });
      fireEvent.click(await screen.findByTestId('no-org-delete-account-btn'));
      const row = await screen.findByTestId('account-delete-org-org-fictief-weg');
      expect(row.textContent).toContain(translate(lang, 'accountOrganizationNameUnknown'));
      expect(row.textContent).not.toContain('org-fictief-weg');
    },
  );

  it('accountpaneel (reviewnit 1 van #111): een lege organisatienaam geeft App het neutrale label, niet de ID', async () => {
    await toActive({ ...ORG_A, orgName: '  ' });
    const name = screen.getByTestId('stub-account-org-name').textContent ?? '';
    expect(name).toBe(translate('nl', 'accountOrganizationNameUnknown'));
  });

  it('accountpaneel: een team-only lid krijgt de organisatienaam uit de team-only context, niet de ID', async () => {
    localStorage.setItem(
      SELECTED_CONTEXT_STORAGE_KEY,
      JSON.stringify({ orgId: 'org-a', teamId: 'team-a' }),
    );
    mount();
    emitMemberships(
      [],
      [
        {
          orgId: 'org-a',
          orgName: 'Fictieve Valken',
          teamId: 'team-a',
          teamName: 'Valken U18',
          role: 'coach',
        },
      ],
    );
    await screen.findByTestId('app-stub');
    expect(screen.getByTestId('stub-account-org-name').textContent).toBe('Fictieve Valken');
  });

  it('een lege organisatienaam valt ook terug op het neutrale label, niet op de ID', async () => {
    await toActive({ ...ORG_A, orgName: '  ' });
    fireEvent.click(screen.getByTestId('stub-leave'));
    const title = screen.getByTestId('account-flow-dialog').getAttribute('aria-label') ?? '';
    expect(title).toContain(translate('nl', 'accountOrganizationNameUnknown'));
    expect(title).not.toContain('org-a');
  });
});
