// @vitest-environment jsdom
//
// PR 8.3c-1c: bewijst de App-wiring van het verwijderverzoek — de melding voor
// alle organisatieleden (één read per organisatie, stil bij een fout) en het
// owner-only paneel (alleen cloudmodus, alleen `organizationOwner`). Zelfde
// aanpak als `AppListenerError.spec.tsx`: mock-repositories in plaats van een
// emulator; de emulator-e2e met echte Auth-sessie volgt in 8.3c-1c-ii.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/preact';
import { App } from '../../src/app/App';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import type { SyncStatusApi } from '../../src/application/sync/useSyncStatus';
import type {
  DeletionRequestGateway,
  DeletionRequestReadResult,
} from '../../src/application/deletion/DeletionRequestGateway';
import type { DeletionRequestCoordinator } from '../../src/application/deletion/DeletionRequestCoordinator';
import type { ResolvedAppRepositories } from '../../src/infrastructure/repositories/resolveAppRepositories';
import type { DeletionRequest } from '../../src/domain/deletion/types';
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

function requested(status: DeletionRequest['status'] = 'requested'): DeletionRequest {
  return {
    organizationId: 'org-test',
    status,
    attempt: 1,
    requestedBy: 'uid-owner',
    requestedAt: '2026-09-29T12:00:00.000Z',
    exportProof: {
      contentHash: 'h',
      exportedAt: '2026-09-29T12:00:00.000Z',
      counts: {
        organizationMembers: 1,
        invitations: 0,
        teams: 1,
        teamMembers: 0,
        settingsDocuments: 0,
        rosterPlayers: 0,
        games: 0,
        gameActions: 0,
        completedGames: 0,
        migrationRuns: 0,
      },
    },
    cancelledAt: null,
    revision: 0,
  };
}

function gateway(result: DeletionRequestReadResult | 'throw') {
  return {
    read: vi.fn(async () => {
      if (result === 'throw') throw new Error('offline');
      return result;
    }),
    create: vi.fn(),
    cancel: vi.fn(),
    restart: vi.fn(),
  } as unknown as DeletionRequestGateway & { read: ReturnType<typeof vi.fn> };
}

const coordinator = {
  assess: vi.fn(),
  request: vi.fn(),
  cancel: vi.fn(),
} as unknown as DeletionRequestCoordinator;

function repositories(overrides: Partial<ResolvedAppRepositories> = {}): ResolvedAppRepositories {
  return {
    mode: 'cloud',
    settings: new FakeSettingsRepository(),
    roster: new FakeRosterRepository(),
    gameSync: null,
    gameWriterContext: null,
    completedGames: null,
    migrationInventoryGateway: null,
    migrationCoordinator: null,
    exportCoordinator: null,
    deletionCoordinator: coordinator,
    deletionRequestGateway: gateway({ ok: true, request: null }),
    ...overrides,
  };
}

function mount(repos: ResolvedAppRepositories, role: OrganizationRole | null) {
  return render(
    <App
      repositories={repos}
      syncStatus={syncStatusApi()}
      canWrite={true}
      canWriteGame={true}
      organizationId="org-test"
      teamId="team-test"
      organizationName="Org Test"
      organizationRole={role}
    />,
  );
}

async function ready(utils: ReturnType<typeof mount>) {
  await waitFor(() => expect(utils.queryByTestId('nav-settings')).toBeTruthy());
  fireEvent.click(utils.getByTestId('nav-settings'));
}

describe('app/App — melding aan alle leden', () => {
  it.each(['organizationOwner', 'organizationAdmin', 'coach', 'scorer', 'viewer'] as const)(
    'toont de melding aan %s wanneer er een verzoek openstaat',
    async (role) => {
      const gw = gateway({ ok: true, request: requested() });
      const utils = mount(repositories({ deletionRequestGateway: gw }), role);
      await ready(utils);
      await waitFor(() => expect(utils.queryByTestId('deletion-banner')).toBeTruthy());
      expect(gw.read).toHaveBeenCalledWith('org-test');
      expect(gw.read).toHaveBeenCalledTimes(1);
    },
  );

  it('toont niets zonder verzoek', async () => {
    const utils = mount(repositories(), 'viewer');
    await ready(utils);
    await waitFor(() => expect(utils.queryByTestId('nav-settings')).toBeTruthy());
    expect(utils.queryByTestId('deletion-banner')).toBeNull();
  });

  it('toont niets bij een geannuleerd verzoek', async () => {
    const utils = mount(
      repositories({
        deletionRequestGateway: gateway({ ok: true, request: requested('cancelled') }),
      }),
      'viewer',
    );
    await ready(utils);
    expect(utils.queryByTestId('deletion-banner')).toBeNull();
  });

  it.each([
    ['een mislukte read', gateway({ ok: false, error: { code: 'read-failed', detail: 'x' } })],
    ['een gooiende read', gateway('throw')],
  ])('faalt stil bij %s: geen melding en geen crash', async (_naam, gw) => {
    const utils = mount(repositories({ deletionRequestGateway: gw }), 'coach');
    await ready(utils);
    expect(utils.queryByTestId('deletion-banner')).toBeNull();
    expect(utils.queryByTestId('nav-settings')).toBeTruthy();
  });

  it('leest niets in lokale modus, en toont geen melding', async () => {
    const gw = gateway({ ok: true, request: requested() });
    const utils = mount(
      repositories({ mode: 'local', deletionCoordinator: null, deletionRequestGateway: gw }),
      'organizationOwner',
    );
    await ready(utils);
    expect(gw.read).not.toHaveBeenCalled();
    expect(utils.queryByTestId('deletion-banner')).toBeNull();
  });
});

describe('app/App — verwijderpaneel', () => {
  it('rendert het paneel voor de owner in cloudmodus', async () => {
    const utils = mount(repositories(), 'organizationOwner');
    await ready(utils);
    await waitFor(() => expect(utils.queryByTestId('deletion-panel')).toBeTruthy());
  });

  it.each(['organizationAdmin', 'coach', 'scorer', 'viewer'] as const)(
    'rendert het paneel NIET voor %s',
    async (role) => {
      const utils = mount(repositories(), role);
      await ready(utils);
      expect(utils.queryByTestId('deletion-panel')).toBeNull();
    },
  );

  it('rendert het paneel niet zonder bekende rol', async () => {
    const utils = mount(repositories(), null);
    await ready(utils);
    expect(utils.queryByTestId('deletion-panel')).toBeNull();
  });

  it('rendert het paneel niet in lokale modus, ook niet voor een owner', async () => {
    const utils = mount(
      repositories({ mode: 'local', deletionCoordinator: null, deletionRequestGateway: null }),
      'organizationOwner',
    );
    await ready(utils);
    expect(utils.queryByTestId('deletion-panel')).toBeNull();
  });

  it('rendert het paneel niet zonder coordinator', async () => {
    const utils = mount(repositories({ deletionCoordinator: null }), 'organizationOwner');
    await ready(utils);
    expect(utils.queryByTestId('deletion-panel')).toBeNull();
  });
});
