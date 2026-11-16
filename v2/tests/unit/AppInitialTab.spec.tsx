// @vitest-environment jsdom
//
// R6 (docs/wedstrijdscherm-rustig-bouwplan.md): na een herlaad opent de app op
// het Wedstrijd-tabblad als er een lopende wedstrijd (fase 'tracking') wordt
// hervat; anders blijft Instellingen het startpunt. Geen nieuwe opslag: alleen
// de bestaande actieve-wedstrijdsleutel bepaalt het. Lokale modus, echte
// jsdom-localStorage, fictieve spelers. Het live paneel is een stub.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/preact';
import { App } from '../../src/app/App';
import { activeGameStorageKey } from '../../src/infrastructure/game/LocalStorageGameRepository';
import { completedGamesStorageKey } from '../../src/infrastructure/game/LocalStorageCompletedGameRepository';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import type { SyncStatusApi } from '../../src/application/sync/useSyncStatus';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';
import type { SyncState } from '../../src/domain/syncState';

vi.mock('../../src/ui/game/LiveTrackingPanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ui/game/LiveTrackingPanel')>();
  const { h } = await import('preact');
  return { ...actual, LiveTrackingPanel: () => h('div', { 'data-testid': 'stub-live' }, 'live') };
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const SYNCED: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };
const ORG_ID = 'org-tab-test';
const TEAM_ID = 'team-tab-test';

class ImmediateSettingsRepository implements AsyncSettingsRepository {
  async read(): Promise<Settings & Record<string, unknown>> {
    return { ...DEFAULT_SETTINGS, teamName: 'Team Tab' };
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
    onNext({ ...DEFAULT_SETTINGS, teamName: 'Team Tab' }, SYNCED);
    return () => undefined;
  }
}

class ImmediateRosterRepository implements AsyncRosterRepository {
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

function fakeSyncStatusApi(): SyncStatusApi {
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

const PLAYERS: GamePlayer[] = [4, 7, 9, 11, 13].map((nr) => ({
  id: `gp-${nr}`,
  rosterId: nr,
  nr: String(nr),
  naam: `Speler ${nr}`,
  kl: '3.0',
  vrouw: false,
  jeugd: false,
  participate: true,
  start: true,
}));

function storedGame(phase: ActiveGame['phase']): ActiveGame {
  return {
    id: 'game-tab',
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    phase,
    players: PLAYERS,
    opponent: 'Tegenstander',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: PLAYERS.map((p) => p.id),
    curQuarter: 1,
    beginSec: 600,
    endSec: 600,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: phase === 'tracking' ? '2026-01-01T00:05:00.000Z' : null,
  } as ActiveGame;
}

function renderApp() {
  const repositories = {
    mode: 'local' as const,
    settings: new ImmediateSettingsRepository(),
    roster: new ImmediateRosterRepository(),
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
      syncStatus={fakeSyncStatusApi()}
      canWrite={true}
      canWriteGame={true}
      organizationId={ORG_ID}
      teamId={TEAM_ID}
      organizationName="Org Tab Test"
    />,
  );
}

const current = (el: HTMLElement) => el.getAttribute('aria-current');

describe('app/App: openingstabblad na herladen (R6)', () => {
  it('opent op Wedstrijd als er een lopende wedstrijd (tracking) wordt hervat', async () => {
    window.localStorage.setItem(
      activeGameStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify(storedGame('tracking')),
    );
    const keysBefore = Object.keys(window.localStorage);
    const { getByTestId } = renderApp();
    await waitFor(() => expect(getByTestId('stub-live')).toBeTruthy());
    expect(current(getByTestId('nav-game'))).toBe('page');
    expect(current(getByTestId('nav-settings'))).toBeNull();
    // Geen opslagsleutel voor het tabblad: het is afgeleid uit de wedstrijd.
    const added = Object.keys(window.localStorage).filter((k) => !keysBefore.includes(k));
    expect(added.filter((k) => /tab/i.test(k))).toEqual([]);
  });

  it('opent op Instellingen zonder opgeslagen wedstrijd', async () => {
    const { getByTestId } = renderApp();
    await waitFor(() => expect(current(getByTestId('nav-settings'))).toBe('page'));
    expect(current(getByTestId('nav-game'))).toBeNull();
  });

  it('opent op Instellingen bij een nog niet gestarte opzet (setup)', async () => {
    window.localStorage.setItem(
      activeGameStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify(storedGame('setup')),
    );
    const { getByTestId } = renderApp();
    await waitFor(() => expect(current(getByTestId('nav-settings'))).toBe('page'));
    expect(current(getByTestId('nav-game'))).toBeNull();
  });

  it('opent op Instellingen als de opgeslagen tracking-wedstrijd al is afgerond', async () => {
    window.localStorage.setItem(
      activeGameStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify(storedGame('tracking')),
    );
    window.localStorage.setItem(
      completedGamesStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify([
        {
          id: 'done-1',
          sourceGameId: 'game-tab',
          organizationId: ORG_ID,
          teamId: TEAM_ID,
          opponent: 'Tegenstander',
          competition: '',
          players: PLAYERS,
          segments: [],
          scoreFor: 0,
          scoreAgainst: 0,
          date: '2026-01-01T01:00:00.000Z',
          quarterCount: 4,
          periodLabel: 'Kwart',
          useClassLimit: false,
        },
      ]),
    );
    const { getByTestId } = renderApp();
    await waitFor(() => expect(current(getByTestId('nav-settings'))).toBe('page'));
    expect(current(getByTestId('nav-game'))).toBeNull();
  });

  it('de gebruiker kan daarna gewoon naar een ander tabblad', async () => {
    window.localStorage.setItem(
      activeGameStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify(storedGame('tracking')),
    );
    const { getByTestId } = renderApp();
    await waitFor(() => expect(current(getByTestId('nav-game'))).toBe('page'));
    fireEvent.click(getByTestId('nav-settings'));
    expect(current(getByTestId('nav-settings'))).toBe('page');
  });
});
