// @vitest-environment jsdom
//
// PR 7.3b (docs/pr-7.3-plan.md §C 7.3b werk 3): bewijst de live-viewer-
// weergave end-to-end door `App` heen met een gescripte `GameViewerGateway` —
// geen echte Firestore/emulator nodig (die kant bewijst
// `tests/e2e-auth/game-viewer-second-client.spec.ts` tegen de echte Rules).
// Dekt: een andere schrijvers actieve wedstrijd verschijnt read-only i.p.v.
// `GameSetupPanel`; die viewer kan nooit schrijven (elke knop `disabled`);
// een listenerfout valt terug op `GameSetupPanel` i.p.v. te crashen of een
// stale weergave te tonen; zolang een andere wedstrijd actief is, claimt dit
// apparaat NOOIT automatisch zijn eigen 'setup'-opzet (het
// single-writer-per-team-contract, niet alleen per-`gameId`); alleen-lokale
// modus abonneert nooit.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/preact';
import { App } from '../../src/app/App';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import type { GameCloudWriterContext } from '../../src/application/game/projectGameForCloud';
import type { GameSyncCoordinator } from '../../src/application/game/GameSyncCoordinator';
import type {
  ActiveGameViewerSnapshot,
  GameViewerGateway,
} from '../../src/application/game/GameViewerGateway';
import type { SyncStatusApi } from '../../src/application/sync/useSyncStatus';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import type { Roster } from '../../src/domain/roster/types';
import type { SyncState } from '../../src/domain/syncState';
import type { ActiveGame } from '../../src/domain/game/types';
import type { CloudClaimStatus } from '../../src/domain/game/writerClaim';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const SYNCED: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };
const ORG_ID = 'org-live-viewer-test';
const TEAM_ID = 'team-live-viewer-test';

const FIVE_PLAYER_ROSTER: Roster = [1, 2, 3, 4, 5].map((n) => ({
  id: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '3.0',
  vrouw: false,
  jeugd: false,
}));

class ImmediateSettingsRepository implements AsyncSettingsRepository {
  async read(): Promise<Settings & Record<string, unknown>> {
    return { ...DEFAULT_SETTINGS, teamName: 'Team Live Viewer' };
  }
  async write(): Promise<never> {
    throw new Error('niet gebruikt in deze test');
  }
  async reset(): Promise<never> {
    throw new Error('niet gebruikt in deze test');
  }
  subscribe(
    onNext: (settings: Settings & Record<string, unknown>, sync: SyncState) => void,
  ): () => void {
    onNext({ ...DEFAULT_SETTINGS, teamName: 'Team Live Viewer' }, SYNCED);
    return () => undefined;
  }
}

class ImmediateRosterRepository implements AsyncRosterRepository {
  async read(): Promise<Roster> {
    return FIVE_PLAYER_ROSTER;
  }
  async write(): Promise<never> {
    throw new Error('niet gebruikt in deze test');
  }
  subscribe(onNext: (roster: Roster, sync: SyncState) => void): () => void {
    onNext(FIVE_PLAYER_ROSTER, SYNCED);
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

const writer: GameCloudWriterContext = {
  authorUid: 'uid-alice',
  deviceId: 'device-alice',
  writerEpoch: 0,
};

/** Nooit-oplossende `ensureWriterClaim()` — genoeg voor deze specs, die
 * uitsluitend bewijzen OF een claimpoging start, niet wat 'm oplost. */
function neverResolvingGameSync(claimCalls: unknown[]): GameSyncCoordinator {
  return {
    async ensureWriterClaim(game: unknown, w: unknown) {
      claimCalls.push([game, w]);
      return new Promise<CloudClaimStatus>(() => undefined);
    },
  } as unknown as GameSyncCoordinator;
}

/** Gescripte `GameViewerGateway`: `emit()`/`fail()` sturen de laatst
 * geabonneerde callback aan — spiegelt hoe een echte `onSnapshot`-listener
 * asynchroon opnieuw aanroept. */
class ScriptedGameViewerGateway implements GameViewerGateway {
  subscribeCalls = 0;
  unsubscribeCalls = 0;
  private onNext: ((snapshot: ActiveGameViewerSnapshot) => void) | null = null;
  private onError: ((error: unknown) => void) | null = null;

  subscribeActiveGame(
    onNext: (snapshot: ActiveGameViewerSnapshot) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    this.subscribeCalls += 1;
    this.onNext = onNext;
    this.onError = onError ?? null;
    return () => {
      this.unsubscribeCalls += 1;
      this.onNext = null;
      this.onError = null;
    };
  }

  emit(snapshot: ActiveGameViewerSnapshot): void {
    this.onNext?.(snapshot);
  }

  fail(error: unknown): void {
    this.onError?.(error);
  }
}

function foreignActiveGameFixture(): ActiveGame {
  return {
    id: 'game-bob',
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    phase: 'tracking',
    players: [1, 2, 3, 4, 5].map((n) => ({
      id: `gp-${n}`,
      rosterId: n,
      nr: String(n),
      naam: `Speler ${n}`,
      kl: '3.0',
      vrouw: false,
      jeugd: false,
      participate: true,
      start: true,
    })),
    opponent: 'Bezoekers',
    competition: 'Competitie',
    clockDown: true,
    limitStr: '14.5',
    onCourt: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
    curQuarter: 1,
    beginSec: 600,
    endSec: 480,
    pendingSwapLineup: null,
    actions: [
      { type: 'score-delta', id: 'a1', team: 'for', delta: 2, at: '2026-01-01T00:00:00.000Z' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
  };
}

const ACTIVE_SNAPSHOT: ActiveGameViewerSnapshot = {
  kind: 'active',
  game: foreignActiveGameFixture(),
  writer: { writerUid: 'uid-bob', deviceId: 'device-bob', writerEpoch: 0 },
  lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
  sync: SYNCED,
};

describe('app/App: live-viewerweergave van andermans actieve cloudwedstrijd (PR 7.3b)', () => {
  it('toont een read-only LiveTrackingPanel i.p.v. GameSetupPanel zodra de gateway een actieve wedstrijd meldt, en claimt NOOIT zelf', async () => {
    const claimCalls: unknown[] = [];
    const gameViewer = new ScriptedGameViewerGateway();
    const repositories = {
      mode: 'cloud' as const,
      settings: new ImmediateSettingsRepository(),
      roster: new ImmediateRosterRepository(),
      gameSync: neverResolvingGameSync(claimCalls),
      gameWriterContext: writer,
      gameViewer,
      completedGames: null,
    };

    const { getByTestId, queryByTestId } = render(
      <App
        repositories={repositories}
        syncStatus={fakeSyncStatusApi()}
        canWrite={true}
        canWriteGame={true}
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Org Live Viewer Test"
      />,
    );

    await act(async () => {
      getByTestId('nav-game').click();
    });
    await waitFor(() => expect(gameViewer.subscribeCalls).toBe(1));

    await act(async () => {
      gameViewer.emit(ACTIVE_SNAPSHOT);
    });

    await waitFor(() => expect(getByTestId('live-viewer-banner')).toBeTruthy());
    expect(queryByTestId('game-start-btn')).toBeNull();
    expect((getByTestId('score-select-for') as HTMLSelectElement).disabled).toBe(true);
    expect((getByTestId('score-plus1-for') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('finish-game-btn') as HTMLButtonElement).disabled).toBe(true);
    // Toont ANDERMANS score, niet dit apparaat se eigen verse 'setup'-opzet.
    expect((getByTestId('score-select-for') as HTMLSelectElement).value).toBe('2');

    // Geef eventuele (foutieve) claim-effect-cycli de kans om te vuren.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(claimCalls.length).toBe(0);
  });

  it('valt terug op GameSetupPanel wanneer de gateway meldt dat er geen actieve wedstrijd is', async () => {
    const claimCalls: unknown[] = [];
    const gameViewer = new ScriptedGameViewerGateway();
    const repositories = {
      mode: 'cloud' as const,
      settings: new ImmediateSettingsRepository(),
      roster: new ImmediateRosterRepository(),
      gameSync: neverResolvingGameSync(claimCalls),
      gameWriterContext: writer,
      gameViewer,
      completedGames: null,
    };

    const { getByTestId } = render(
      <App
        repositories={repositories}
        syncStatus={fakeSyncStatusApi()}
        canWrite={true}
        canWriteGame={true}
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Org Live Viewer Test"
      />,
    );

    await act(async () => {
      getByTestId('nav-game').click();
    });
    await waitFor(() => expect(gameViewer.subscribeCalls).toBe(1));

    await act(async () => {
      gameViewer.emit({ kind: 'none', sync: SYNCED });
    });

    await waitFor(() => expect(getByTestId('game-start-btn')).toBeTruthy());
    // Nu WEL een claimpoging voor de eigen 'setup'-opzet, want er is geen
    // andere actieve wedstrijd (meer).
    await waitFor(() => expect(claimCalls.length).toBe(1));
  });

  it('een listenerfout valt terug op GameSetupPanel i.p.v. te crashen of stil te blijven hangen', async () => {
    const claimCalls: unknown[] = [];
    const gameViewer = new ScriptedGameViewerGateway();
    const repositories = {
      mode: 'cloud' as const,
      settings: new ImmediateSettingsRepository(),
      roster: new ImmediateRosterRepository(),
      gameSync: neverResolvingGameSync(claimCalls),
      gameWriterContext: writer,
      gameViewer,
      completedGames: null,
    };

    const { getByTestId, queryByTestId } = render(
      <App
        repositories={repositories}
        syncStatus={fakeSyncStatusApi()}
        canWrite={true}
        canWriteGame={true}
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Org Live Viewer Test"
      />,
    );

    await act(async () => {
      getByTestId('nav-game').click();
    });
    await waitFor(() => expect(gameViewer.subscribeCalls).toBe(1));

    // Eerst een geldige actieve weergave...
    await act(async () => {
      gameViewer.emit(ACTIVE_SNAPSHOT);
    });
    await waitFor(() => expect(getByTestId('live-viewer-banner')).toBeTruthy());

    // ...dan een listenerfout (bijv. een ingetrokken membership).
    await act(async () => {
      gameViewer.fail(new Error('permission-denied'));
    });

    await waitFor(() => expect(getByTestId('game-start-btn')).toBeTruthy());
    expect(queryByTestId('live-viewer-banner')).toBeNull();
  });

  it('alleen-lokale modus abonneert nooit op de live-viewergateway', async () => {
    const repositories = {
      mode: 'local' as const,
      settings: new ImmediateSettingsRepository(),
      roster: new ImmediateRosterRepository(),
      gameSync: null,
      gameWriterContext: null,
      gameViewer: null,
      completedGames: null,
    };

    const { getByTestId } = render(
      <App
        repositories={repositories}
        syncStatus={fakeSyncStatusApi()}
        canWrite={true}
        canWriteGame={true}
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Org Local Test"
      />,
    );

    await act(async () => {
      getByTestId('nav-game').click();
    });
    await waitFor(() => expect(getByTestId('game-start-btn')).toBeTruthy());
  });
});
