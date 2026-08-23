// @vitest-environment jsdom
//
// PR 7.3b (docs/pr-7.3-plan.md §C 7.3b werk 2/3/4): bewijst de viewer-gating
// end-to-end door `App` heen — zodra het cloud-parentdocument een ANDER
// apparaat als writer toont (bijv. na een overname, PR 7.3a
// `takeoverWriter()`), schakelt de tracking-UI naar read-only
// (`LiveTrackingPanel`'s bestaande `canWrite`-poort, PR 6.2) en toont een
// "wordt gescoord door"-banner met freshness. Zolang dit apparaat zelf de
// writer is (of de eerste snapshot nog niet binnen is) blijft scoren
// mogelijk — geen UI-await op de server (werk 4).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/preact';
import { App } from '../../src/app/App';
import { activeGameStorageKey } from '../../src/infrastructure/game/LocalStorageGameRepository';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import type { GameCloudWriterContext } from '../../src/application/game/projectGameForCloud';
import type { GameSyncCoordinator } from '../../src/application/game/GameSyncCoordinator';
import type {
  GameCloudParentUpdate,
  GameCloudSubscriptionCallbacks,
} from '../../src/application/game/GameCloudGateway';
import type { SyncStatusApi } from '../../src/application/sync/useSyncStatus';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import type { Roster } from '../../src/domain/roster/types';
import type { ActiveGame } from '../../src/domain/game/types';
import type { GameDocument } from 'firebase-base/documents';
import type { SyncState } from '../../src/domain/syncState';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const SYNCED: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };
const ORG_ID = 'org-viewer-test';
const TEAM_ID = 'team-viewer-test';

class ImmediateSettingsRepository implements AsyncSettingsRepository {
  async read(): Promise<Settings & Record<string, unknown>> {
    return { ...DEFAULT_SETTINGS, teamName: 'Team Viewer' };
  }
  async write(): Promise<never> {
    throw new Error('niet gebruikt in deze test');
  }
  async reset(): Promise<never> {
    throw new Error('niet gebruikt in deze test');
  }
  subscribe(onNext: (s: Settings & Record<string, unknown>, sync: SyncState) => void): () => void {
    onNext({ ...DEFAULT_SETTINGS, teamName: 'Team Viewer' }, SYNCED);
    return () => undefined;
  }
}

class ImmediateRosterRepository implements AsyncRosterRepository {
  async read(): Promise<Roster> {
    return [];
  }
  async write(): Promise<never> {
    throw new Error('niet gebruikt in deze test');
  }
  subscribe(onNext: (roster: Roster, sync: SyncState) => void): () => void {
    onNext([], SYNCED);
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

const SELF: GameCloudWriterContext = {
  authorUid: 'uid-self',
  deviceId: 'device-self',
  writerEpoch: 0,
};
const OTHER = { authorUid: 'uid-other', deviceId: 'device-other' };

function trackingGame(): ActiveGame {
  return {
    id: 'game-live',
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    phase: 'tracking',
    players: [
      {
        id: 'gp-1',
        rosterId: 1,
        nr: '4',
        naam: 'Speler 4',
        kl: '3.0',
        vrouw: false,
        jeugd: false,
        participate: true,
        start: true,
      },
    ],
    opponent: 'Tegenstander',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: ['gp-1'],
    curQuarter: 1,
    beginSec: 600,
    endSec: 590,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:05:00.000Z',
  };
}

function parentDocFor(writer: { authorUid: string; deviceId: string }): GameDocument {
  return {
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    phase: 'tracking',
    players: [],
    opponent: 'Tegenstander',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: ['gp-1'],
    curQuarter: 1,
    beginSec: 600,
    endSec: 590,
    pendingSwapLineup: null,
    scoreFor: 0,
    scoreAgainst: 0,
    segmentCount: 0,
    writerUid: writer.authorUid,
    deviceId: writer.deviceId,
    writerEpoch: 1,
    claimedAt: '2026-01-01T00:10:00.000Z',
    lastWriterActivityAt: '2026-01-01T00:10:00.000Z',
    revision: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:05:00.000Z',
    completedGameId: null,
    updatedAt: {} as GameDocument['updatedAt'],
  };
}

function fakeGameSync(): {
  coordinator: GameSyncCoordinator;
  emitParent: (u: GameCloudParentUpdate) => void;
} {
  let callbacks: GameCloudSubscriptionCallbacks | null = null;
  const coordinator = {
    subscribeGame(
      _org: string,
      _team: string,
      _gameId: string,
      cb: GameCloudSubscriptionCallbacks,
    ) {
      callbacks = cb;
      return () => undefined;
    },
    async sync() {
      return { status: 'idle' as const, confirmedActionIds: [], serverRevision: 0 };
    },
  } as unknown as GameSyncCoordinator;
  return {
    coordinator,
    emitParent: (u) => callbacks?.onParent(u),
  };
}

describe('app/App: cloud-viewer-gating tijdens tracking (PR 7.3b)', () => {
  it('een bevestigde ANDERE writer schakelt de tracking-UI naar read-only en toont de viewer-banner', async () => {
    window.localStorage.setItem(
      activeGameStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify(trackingGame()),
    );
    const { coordinator, emitParent } = fakeGameSync();
    const repositories = {
      mode: 'cloud' as const,
      settings: new ImmediateSettingsRepository(),
      roster: new ImmediateRosterRepository(),
      gameSync: coordinator,
      gameWriterContext: SELF,
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
        organizationName="Org Viewer Test"
      />,
    );
    act(() => getByTestId('nav-game').click());

    // Vóór de eerste parent-snapshot: geen await op de server — dit apparaat
    // kan gewoon scoren (werk 4).
    await waitFor(() => expect(getByTestId('score-plus1-for')).toBeTruthy());
    expect(queryByTestId('cloud-viewer-banner')).toBeNull();
    expect((getByTestId('score-plus1-for') as HTMLButtonElement).disabled).toBe(false);

    act(() =>
      emitParent({ doc: parentDocFor(OTHER), meta: { fromCache: false, hasPendingWrites: false } }),
    );

    await waitFor(() => expect(queryByTestId('cloud-viewer-banner')).not.toBeNull());
    expect((getByTestId('score-plus1-for') as HTMLButtonElement).disabled).toBe(true);
  });

  it('dit apparaat als bevestigde writer: geen banner, bediening blijft actief', async () => {
    window.localStorage.setItem(
      activeGameStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify(trackingGame()),
    );
    const { coordinator, emitParent } = fakeGameSync();
    const repositories = {
      mode: 'cloud' as const,
      settings: new ImmediateSettingsRepository(),
      roster: new ImmediateRosterRepository(),
      gameSync: coordinator,
      gameWriterContext: SELF,
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
        organizationName="Org Viewer Test"
      />,
    );
    act(() => getByTestId('nav-game').click());

    act(() =>
      emitParent({
        doc: parentDocFor(SELF),
        meta: { fromCache: false, hasPendingWrites: false },
      }),
    );

    await waitFor(() =>
      expect((getByTestId('score-plus1-for') as HTMLButtonElement).disabled).toBe(false),
    );
    expect(queryByTestId('cloud-viewer-banner')).toBeNull();
  });

  it('alleen-lokale modus: geen abonnement, geen banner, bediening blijft altijd actief', async () => {
    window.localStorage.setItem(
      activeGameStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify(trackingGame()),
    );
    const repositories = {
      mode: 'local' as const,
      settings: new ImmediateSettingsRepository(),
      roster: new ImmediateRosterRepository(),
      gameSync: null,
      gameWriterContext: null,
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
        organizationName="Org Viewer Test"
      />,
    );
    act(() => getByTestId('nav-game').click());

    await waitFor(() =>
      expect((getByTestId('score-plus1-for') as HTMLButtonElement).disabled).toBe(false),
    );
    expect(queryByTestId('cloud-viewer-banner')).toBeNull();
  });
});
