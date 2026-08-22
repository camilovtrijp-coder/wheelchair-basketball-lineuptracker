// @vitest-environment jsdom
//
// PR 7.2c (docs/pr-7.2-plan.md §C 7.2c werk 1): bewijst `App.
// handleDeleteCompletedGame()`'s tombstone-flow end-to-end door de UI heen —
// een server-bevestigd item verdwijnt via `completedGameRepo.tombstone()`
// (niet meer via de PR 7.2b-blokkade), een mislukte patch toont
// `deleteError` en laat het item staan, en een nog niet gesynchroniseerd
// item blijft (net als vóór PR 7.2c) geblokkeerd.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/preact';
import { App } from '../../src/app/App';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import type {
  CompletedGameRepository,
  CompletedGamesReadResult,
} from '../../src/application/game/CompletedGameRepository';
import type { GameCloudWriterContext } from '../../src/application/game/projectGameForCloud';
import type { GameSyncCoordinator } from '../../src/application/game/GameSyncCoordinator';
import type { SyncStatusApi } from '../../src/application/sync/useSyncStatus';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import type { CompletedGame } from '../../src/domain/game/types';
import type { SyncState } from '../../src/domain/syncState';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const SYNCED: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };
const ORG_ID = 'org-tombstone-test';
const TEAM_ID = 'team-tombstone-test';

class ImmediateSettingsRepository implements AsyncSettingsRepository {
  async read(): Promise<Settings & Record<string, unknown>> {
    return { ...DEFAULT_SETTINGS, teamName: 'Team Tombstone' };
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
    onNext({ ...DEFAULT_SETTINGS, teamName: 'Team Tombstone' }, SYNCED);
    return () => undefined;
  }
}

class ImmediateRosterRepository implements AsyncRosterRepository {
  async read() {
    return [];
  }
  async write(): Promise<never> {
    throw new Error('niet gebruikt in deze test');
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

const writer: GameCloudWriterContext = {
  authorUid: 'uid-alice',
  deviceId: 'device-alice',
  writerEpoch: 0,
};

function syncedGame(id: string): CompletedGame {
  return {
    id,
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    sourceGameId: `src-${id}`,
    opponent: 'Tegenstander',
    competition: '',
    date: '2026-01-01T12:00:00.000Z',
    players: [],
    segments: [],
    scoreFor: 10,
    scoreAgainst: 8,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
  };
}

type TombstoneMode = 'ok' | 'error' | 'not-synced';

/** Minimale `CompletedGameRepository`-stand-in: één server-bevestigd item,
 * `tombstone()` gestuurd door `mode` — precies genoeg om
 * `App.handleDeleteCompletedGame()`'s tombstone-tak te bewijzen zonder de
 * volledige `CompositeCompletedGameRepository`/Firestore-laag erbij te
 * hoeven (die heeft z'n eigen, uitgebreide dekking in
 * `CompositeCompletedGameRepository.spec.ts`). */
class FakeCompletedGameRepo implements CompletedGameRepository {
  public games: CompletedGame[];
  public mode: TombstoneMode;
  public tombstoneCalls: Array<{ id: string; deletedBy: string }> = [];
  private listener: ((result: CompletedGamesReadResult, sync: SyncState | null) => void) | null =
    null;

  constructor(games: CompletedGame[], mode: TombstoneMode) {
    this.games = games;
    this.mode = mode;
  }

  list(): CompletedGame[] {
    return this.games;
  }

  safeList(): CompletedGamesReadResult {
    return { status: 'ok', games: this.games };
  }

  add(game: CompletedGame): boolean {
    this.games = [game, ...this.games];
    return true;
  }

  remove(id: string): boolean {
    this.games = this.games.filter((g) => g.id !== id);
    return true;
  }

  replaceAll(games: CompletedGame[]): boolean {
    this.games = games;
    return true;
  }

  subscribe(
    onNext: (result: CompletedGamesReadResult, sync: SyncState | null) => void,
  ): () => void {
    this.listener = onNext;
    onNext(this.safeList(), SYNCED);
    return () => {
      this.listener = null;
    };
  }

  async tombstone(id: string, deletedBy: string): Promise<'ok' | 'not-synced' | 'error'> {
    this.tombstoneCalls.push({ id, deletedBy });
    if (this.mode === 'not-synced') return 'not-synced';
    if (this.mode === 'error') return 'error';
    this.games = this.games.filter((g) => g.id !== id);
    this.listener?.(this.safeList(), SYNCED);
    return 'ok';
  }
}

function renderHistoryWith(repo: FakeCompletedGameRepo) {
  // PR 7.3a: `App`'s pre-game-gate roept nu `ensureWriterClaim()` aan zodra er
  // een 'setup'-wedstrijd is in cloud-modus (los van deze test se
  // tombstone-scenario) — een kale `{}`-stub volstaat daardoor niet meer.
  const inertGameSync = {
    async ensureWriterClaim() {
      return {
        kind: 'confirmed' as const,
        identity: { writerUid: writer.authorUid, deviceId: writer.deviceId, writerEpoch: 0 },
      };
    },
  } as unknown as GameSyncCoordinator;
  const repositories = {
    mode: 'cloud' as const,
    settings: new ImmediateSettingsRepository(),
    roster: new ImmediateRosterRepository(),
    gameSync: inertGameSync,
    gameWriterContext: writer,
    gameViewer: null,
    completedGames: repo,
  };
  return render(
    <App
      repositories={repositories}
      syncStatus={fakeSyncStatusApi()}
      canWrite={true}
      canWriteGame={true}
      organizationId={ORG_ID}
      teamId={TEAM_ID}
      organizationName="Org Tombstone Test"
    />,
  );
}

describe('app/App — handleDeleteCompletedGame() tombstone-flow (PR 7.2c)', () => {
  it('een server-bevestigd item wordt getombstoned: repo.tombstone() aangeroepen met de uid, item verdwijnt', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const repo = new FakeCompletedGameRepo([syncedGame('completed-1')], 'ok');
    const { getByTestId, queryByTestId } = renderHistoryWith(repo);

    await waitFor(() => expect(getByTestId('nav-history')).toBeTruthy());
    getByTestId('nav-history').click();
    const item = await waitFor(() => getByTestId('history-item-completed-1'));
    item.click();
    const deleteBtn = await waitFor(() => getByTestId('history-delete-btn') as HTMLButtonElement);
    deleteBtn.click();

    await waitFor(() =>
      expect(repo.tombstoneCalls).toEqual([{ id: 'completed-1', deletedBy: 'uid-alice' }]),
    );
    await waitFor(() => expect(queryByTestId('history-empty')).toBeTruthy());
    expect(queryByTestId('history-delete-blocked')).toBeNull();
    expect(queryByTestId('history-delete-error')).toBeNull();
  });

  it('een afgewezen tombstone-patch toont deleteError en laat het item staan', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const repo = new FakeCompletedGameRepo([syncedGame('completed-1')], 'error');
    const { getByTestId } = renderHistoryWith(repo);

    await waitFor(() => expect(getByTestId('nav-history')).toBeTruthy());
    getByTestId('nav-history').click();
    const item = await waitFor(() => getByTestId('history-item-completed-1'));
    item.click();
    const deleteBtn = await waitFor(() => getByTestId('history-delete-btn') as HTMLButtonElement);
    deleteBtn.click();

    await waitFor(() => expect(getByTestId('history-delete-error')).toBeTruthy());
    // Item blijft open/zichtbaar in de detailweergave (niet verwijderd).
    expect(getByTestId('history-sync-status-completed-1')).toBeTruthy();
  });

  it('een nog niet gesynchroniseerd item (geen cloud-tegenhanger) blijft geblokkeerd, net als vóór PR 7.2c', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const repo = new FakeCompletedGameRepo([syncedGame('completed-1')], 'not-synced');
    const { getByTestId } = renderHistoryWith(repo);

    await waitFor(() => expect(getByTestId('nav-history')).toBeTruthy());
    getByTestId('nav-history').click();
    const item = await waitFor(() => getByTestId('history-item-completed-1'));
    item.click();
    const deleteBtn = await waitFor(() => getByTestId('history-delete-btn') as HTMLButtonElement);
    deleteBtn.click();

    await waitFor(() => expect(getByTestId('history-delete-blocked')).toBeTruthy());
    // Item blijft open/zichtbaar in de detailweergave (niet verwijderd).
    expect(getByTestId('history-sync-status-completed-1')).toBeTruthy();
  });
});
