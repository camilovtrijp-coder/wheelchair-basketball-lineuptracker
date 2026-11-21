// @vitest-environment jsdom
//
// R6: na een paginaherlaad opent de app op het Wedstrijd-tabblad zodra er een lopende
// wedstrijd (fase 'tracking') in de lokale opslag staat. Zonder lopende wedstrijd blijft
// Instellingen het beginscherm. Geen nieuwe opslag: afgeleid uit de bestaande actieve-wedstrijdsleutel.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/preact';
import { App } from '../../src/app/App';
import { activeGameStorageKey } from '../../src/infrastructure/game/LocalStorageGameRepository';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import type { SyncStatusApi } from '../../src/application/sync/useSyncStatus';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import type { ActiveGame } from '../../src/domain/game/types';
import type { SyncState } from '../../src/domain/syncState';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const SYNCED: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };
const ORG_ID = 'org-reload-test';
const TEAM_ID = 'team-reload-test';

class Settings0 implements AsyncSettingsRepository {
  async read(): Promise<Settings & Record<string, unknown>> {
    return { ...DEFAULT_SETTINGS, teamName: 'Team Herlaad' };
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
    onNext({ ...DEFAULT_SETTINGS, teamName: 'Team Herlaad' }, SYNCED);
    return () => undefined;
  }
}

class Roster0 implements AsyncRosterRepository {
  async read() {
    return [];
  }
  async write(): Promise<never> {
    throw new Error('niet gebruikt');
  }
  subscribe(): () => void {
    return () => undefined;
  }
}

function syncApi(): SyncStatusApi {
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

function game(phase: ActiveGame['phase']): ActiveGame {
  return {
    id: 'game-reload',
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    phase,
    players: [],
    opponent: 'Tegenstander',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: [],
    curQuarter: 1,
    beginSec: 600,
    endSec: 600,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:05:00.000Z',
  };
}

function renderApp() {
  const repositories = {
    mode: 'local' as const,
    settings: new Settings0(),
    roster: new Roster0(),
    gameSync: null,
    gameWriterContext: null,
    completedGames: null,
    migrationInventoryGateway: null,
    migrationCoordinator: null,
    exportCoordinator: null,
    deletionCoordinator: null,
    deletionRequestGateway: null,
  };
  return render(
    <App
      repositories={repositories}
      syncStatus={syncApi()}
      canWrite={true}
      canWriteGame={true}
      organizationId={ORG_ID}
      teamId={TEAM_ID}
      organizationName="Org Herlaad"
    />,
  );
}

describe('app/App — beginscherm na herladen (R6)', () => {
  it('opent op Wedstrijd bij een lopende wedstrijd (fase tracking)', async () => {
    window.localStorage.setItem(
      activeGameStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify(game('tracking')),
    );
    const { getByTestId } = renderApp();
    await waitFor(() => expect(getByTestId('nav-game').getAttribute('aria-current')).toBe('page'));
    expect(getByTestId('nav-roster').getAttribute('aria-current')).toBeNull();
  });

  it('blijft op Instellingen zonder lopende wedstrijd (alleen opzet opgeslagen)', async () => {
    window.localStorage.setItem(
      activeGameStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify(game('setup')),
    );
    const { getByTestId } = renderApp();
    await waitFor(() => expect(getByTestId('nav-game')).toBeTruthy());
    // Geef de laad-effecten de kans; het tabblad mag niet verspringen.
    await new Promise((r) => setTimeout(r, 50));
    expect(getByTestId('nav-game').getAttribute('aria-current')).toBeNull();
    expect(getByTestId('nav-settings')).toBeTruthy();
  });

  it('opent zonder opgeslagen wedstrijd op Instellingen', async () => {
    const { getByTestId } = renderApp();
    await waitFor(() => expect(getByTestId('nav-game')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 50));
    expect(getByTestId('nav-game').getAttribute('aria-current')).toBeNull();
  });
});
