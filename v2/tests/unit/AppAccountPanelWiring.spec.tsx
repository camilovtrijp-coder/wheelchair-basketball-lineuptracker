// @vitest-environment jsdom
//
// PR 8.3c-2c-i: App-wiring van het accountpaneel (alleen cloudmodus, owner krijgt de
// uitleg i.p.v. een verlaatknop) en de taalmelding aan AuthGate. Zelfde aanpak als
// `AppDeletionWiring.spec.tsx`: nep-repositories, geen emulator.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/preact';
import { App } from '../../src/app/App';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import type { SyncStatusApi } from '../../src/application/sync/useSyncStatus';
import type { ResolvedAppRepositories } from '../../src/infrastructure/repositories/resolveAppRepositories';
import type { OrganizationRole } from '../../src/domain/organizations/types';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import type { Roster } from '../../src/domain/roster/types';
import type { SyncState } from '../../src/domain/syncState';

afterEach(cleanup);

const SYNCED: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };

class FakeSettingsRepository implements AsyncSettingsRepository {
  async read(): Promise<Settings & Record<string, unknown>> {
    return { ...DEFAULT_SETTINGS, teamName: 'Team-Init' };
  }
  async write(): Promise<never> {
    throw new Error('niet gebruikt');
  }
  async reset(): Promise<never> {
    throw new Error('niet gebruikt');
  }
  subscribe(
    onNext: (settings: Settings & Record<string, unknown>, sync: SyncState) => void,
  ): () => void {
    onNext({ ...DEFAULT_SETTINGS, teamName: 'Team-Init' }, SYNCED);
    return () => undefined;
  }
}

class FakeRosterRepository implements AsyncRosterRepository {
  async read(): Promise<Roster> {
    return [];
  }
  async write(): Promise<never> {
    throw new Error('niet gebruikt');
  }
  subscribe(): () => void {
    return () => undefined;
  }
}

function syncStatusApi(): SyncStatusApi {
  return {
    status: 'gesynchroniseerd',
    fromCache: false,
    pending: [],
    onSettingsSync: vi.fn(),
    onRosterSync: vi.fn(),
    saveSettings: vi.fn(async () => true),
    saveRoster: vi.fn(async () => true),
    resetSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
    retry: vi.fn(async () => undefined),
    dismiss: vi.fn(),
  };
}

function repositories(mode: 'cloud' | 'local'): ResolvedAppRepositories {
  return {
    mode,
    settings: new FakeSettingsRepository(),
    roster: new FakeRosterRepository(),
    gameSync: null,
    gameWriterContext: null,
    completedGames: null,
    migrationInventoryGateway: null,
    migrationCoordinator: null,
    exportCoordinator: null,
    deletionCoordinator: null,
    deletionRequestGateway: null,
  };
}

function mount(mode: 'cloud' | 'local', role: OrganizationRole | null, withActions = true) {
  const accountActions = { busy: false, onLeaveOrganization: vi.fn(), onDeleteAccount: vi.fn() };
  const onLangChange = vi.fn();
  const utils = render(
    <App
      repositories={repositories(mode)}
      syncStatus={syncStatusApi()}
      canWrite={true}
      canWriteGame={true}
      organizationId="org-test"
      teamId="team-test"
      organizationName="Org Test"
      organizationRole={role}
      accountActions={withActions ? accountActions : undefined}
      onLangChange={onLangChange}
    />,
  );
  return { utils, accountActions, onLangChange };
}

async function ready(utils: ReturnType<typeof render>) {
  await waitFor(() => expect(utils.queryByTestId('nav-settings')).toBeTruthy());
  fireEvent.click(utils.getByTestId('nav-settings'));
}

describe('app/App — accountpaneel', () => {
  it('cloudmodus: paneel met beide knoppen, klikken gaan naar AuthGate', async () => {
    const { utils, accountActions } = mount('cloud', 'coach');
    await ready(utils);
    fireEvent.click(utils.getByTestId('leave-org-start-btn'));
    fireEvent.click(utils.getByTestId('account-delete-start-btn'));
    expect(accountActions.onLeaveOrganization).toHaveBeenCalledTimes(1);
    expect(accountActions.onDeleteAccount).toHaveBeenCalledTimes(1);
  });

  it('owner: uitleg in plaats van een verlaatknop', async () => {
    const { utils } = mount('cloud', 'organizationOwner');
    await ready(utils);
    expect(utils.queryByTestId('leave-org-start-btn')).toBeNull();
    expect(utils.getByTestId('leave-org-owner-note').textContent).toContain('Org Test');
  });

  it('niet in lokale modus', async () => {
    const { utils } = mount('local', 'coach');
    await ready(utils);
    expect(utils.queryByTestId('account-panel')).toBeNull();
  });

  it('niet zonder accountActions', async () => {
    const { utils } = mount('cloud', 'coach', false);
    await ready(utils);
    expect(utils.queryByTestId('account-panel')).toBeNull();
  });

  it('meldt elke taalwissel aan AuthGate', async () => {
    const { utils, onLangChange } = mount('cloud', 'coach');
    await ready(utils);
    const initial = onLangChange.mock.calls.at(-1)?.[0];
    fireEvent.click(utils.getByTestId('lang-switch'));
    await waitFor(() =>
      expect(onLangChange.mock.calls.at(-1)?.[0]).toBe(initial === 'nl' ? 'en' : 'nl'),
    );
  });
});
