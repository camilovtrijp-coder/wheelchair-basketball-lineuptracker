// @vitest-environment jsdom
//
// Compact-bouwplan C3, onderzoek + regressie: `handleFinishGame` in App.tsx las
// `game` uit de render-closure. Roept een scherm eerst `onGameChange(next)` en
// direct daarna `onFinishGame()` aan (zoals "laatste segment vastleggen en
// afronden"), dan verwerkt Preact `setGame(next)` pas bij de volgende render en
// rondde `handleFinishGame` de VEROUDERDE stand af (laatste segment ontbreekt).
// `onFinishGame(next)` rondt af met de actuele stand. Het paneel is hier een
// minimale stub zodat de test alleen de App-koppeling raakt (lokale modus,
// echte jsdom-localStorage, fictieve data).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/preact';
import { App } from '../../src/app/App';
import { activeGameStorageKey } from '../../src/infrastructure/game/LocalStorageGameRepository';
import { completedGamesStorageKey } from '../../src/infrastructure/game/LocalStorageCompletedGameRepository';
import { commitSegment } from '../../src/domain/game/liveCommands';
import {
  deriveGameHistory,
  scoreDeltaAction,
  scoreSetAction,
} from '../../src/domain/game/tracking';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import type { SyncStatusApi } from '../../src/application/sync/useSyncStatus';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import type { ActiveGame, CompletedGame, GamePlayer } from '../../src/domain/game/types';
import type { SyncState } from '../../src/domain/syncState';
import type { LiveTrackingPanelProps } from '../../src/ui/game/LiveTrackingPanel';

const stub = vi.hoisted(() => ({ passLatest: false, finishCalls: 0 }));

vi.mock('../../src/ui/game/LiveTrackingPanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ui/game/LiveTrackingPanel')>();
  const { h } = await import('preact');
  return {
    ...actual,
    LiveTrackingPanel: (props: LiveTrackingPanelProps) =>
      h(
        'button',
        {
          'data-testid': 'stub-record-and-finish',
          onClick: () => {
            const result = commitSegment(props.game, {
              endSec: 300,
              classification: props.classification,
            });
            if (!result.ok) throw new Error(result.error);
            props.onGameChange(result.game);
            stub.finishCalls += 1;
            if (stub.passLatest) props.onFinishGame(result.game);
            else props.onFinishGame();
          },
        },
        'stub',
      ),
  };
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  stub.passLatest = false;
  stub.finishCalls = 0;
});

const SYNCED: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };
const ORG_ID = 'org-latest-test';
const TEAM_ID = 'team-latest-test';

class ImmediateSettingsRepository implements AsyncSettingsRepository {
  async read(): Promise<Settings & Record<string, unknown>> {
    return { ...DEFAULT_SETTINGS, teamName: 'Team Latest' };
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
    onNext({ ...DEFAULT_SETTINGS, teamName: 'Team Latest' }, SYNCED);
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

const PLAYERS: GamePlayer[] = [
  [4, 'Alex'],
  [7, 'Sam'],
  [9, 'Robin'],
  [11, 'Kim'],
  [13, 'Dani'],
].map(([nr, naam]) => ({
  id: `gp-${nr}`,
  rosterId: nr as number,
  nr: String(nr),
  naam: naam as string,
  kl: '3.0',
  vrouw: false,
  jeugd: false,
  participate: true,
  start: true,
}));

const LINEUP = PLAYERS.map((p) => p.id);

/** Q1 afgetikt tot 8:00 met één vastgelegd segment (8-6); daarna open: +3 eigen punten, 1 TO. */
function gameWithOpenPoints(): ActiveGame {
  return {
    id: 'game-latest',
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    phase: 'tracking',
    players: PLAYERS,
    opponent: 'Tegenstander',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: LINEUP,
    curQuarter: 1,
    beginSec: 480,
    endSec: 480,
    pendingSwapLineup: null,
    actions: [
      scoreSetAction('for', 8),
      scoreSetAction('against', 6),
      {
        type: 'segment-saved',
        id: 'act-seg-1',
        segment: {
          id: 'seg-1',
          quarter: 1,
          beginSec: 600,
          endSec: 480,
          durSec: 120,
          lineup: LINEUP,
          pf: 8,
          pa: 6,
          classSum: 0,
          allowed: 0,
          over: false,
          tov: 0,
        },
        at: '2026-01-01T00:10:00.000Z',
      },
      scoreDeltaAction('for', 3),
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:05:00.000Z',
  };
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
      organizationName="Org Latest Test"
    />,
  );
}

function storedCompleted(): CompletedGame[] {
  const raw = window.localStorage.getItem(completedGamesStorageKey(ORG_ID, TEAM_ID));
  return raw ? (JSON.parse(raw) as CompletedGame[]) : [];
}

async function recordAndFinish() {
  window.localStorage.setItem(
    activeGameStorageKey(ORG_ID, TEAM_ID),
    JSON.stringify(gameWithOpenPoints()),
  );
  const { getByTestId } = renderApp();
  await waitFor(() => expect(getByTestId('nav-settings')).toBeTruthy());
  fireEvent.click(getByTestId('nav-game'));
  fireEvent.click(await waitFor(() => getByTestId('stub-record-and-finish')));
  await waitFor(() => expect(storedCompleted()).toHaveLength(1));
  return storedCompleted()[0]!;
}

describe('app/App: afronden direct na onGameChange (C3 closure-onderzoek)', () => {
  it('onFinishGame() zonder argument rondt de stand van VOOR onGameChange af (bevestigt de closure-claim)', async () => {
    const completed = await recordAndFinish();
    // Het zojuist vastgelegde laatste segment (+3) ontbreekt in de afgeronde wedstrijd.
    expect(completed.segments.map((s) => s.id)).toEqual(['seg-1']);
    expect([completed.scoreFor, completed.scoreAgainst]).toEqual([11, 6]);
  });

  it('onFinishGame(next) rondt af met de actuele stand: laatste segment aanwezig, geen dubbel, identieke score/tijden', async () => {
    stub.passLatest = true;
    const completed = await recordAndFinish();
    expect(completed.segments).toHaveLength(2);
    expect(new Set(completed.segments.map((s) => s.id)).size).toBe(2);
    expect(completed.segments[0]!.id).toBe('seg-1');
    const last = completed.segments[1]!;
    expect([last.pf, last.pa, last.beginSec, last.endSec, last.durSec]).toEqual([
      3, 0, 480, 300, 180,
    ]);
    expect([completed.scoreFor, completed.scoreAgainst]).toEqual([11, 6]);
    expect(completed.segments.reduce((n, s) => n + s.pf, 0)).toBe(completed.scoreFor);
    expect(completed.sourceGameId).toBe('game-latest');
    // Precies één afronding, en de actieve wedstrijd is gereset naar een verse opzet.
    expect(storedCompleted()).toHaveLength(1);
    const active = JSON.parse(
      window.localStorage.getItem(activeGameStorageKey(ORG_ID, TEAM_ID)) ?? 'null',
    ) as ActiveGame;
    expect(active.id).not.toBe('game-latest');
    expect(deriveGameHistory(active).segments).toHaveLength(0);
    expect(stub.finishCalls).toBe(1);
  });
});
