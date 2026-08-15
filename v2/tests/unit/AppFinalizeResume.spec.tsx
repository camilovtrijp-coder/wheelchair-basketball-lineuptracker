// @vitest-environment jsdom
//
// PR 7.2a, P1-fix (externe review PR #61): bewijst dat een openstaande
// wedstrijdafronding een paginareload/app-herstart overleeft. `App.tsx`
// gebruikt `browserStorage`/`strictReadBrowserStorage` rechtstreeks (echte
// `window.localStorage`, niet via een injecteerbare mock) voor
// `completedGameRepo`/`pendingFinalizeRepo` — dit is dus bewust GEEN
// gemockte repository-test, maar een test tegen de echte jsdom-localStorage:
// eerst wordt een openstaande afronding rechtstreeks in localStorage gezet
// (zoals een vorige, gecrashte sessie zou hebben achtergelaten via
// `handleFinishGame()`), dan wordt een VERSE `<App>` gerenderd (nieuwe
// component-instantie, nieuwe `GameSyncCoordinator`-instantie — simuleert
// een reload) en bewezen dat die de afronding vanzelf hervat en de outbox-
// entry na succes opruimt.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/preact';
import { App } from '../../src/app/App';
import { GameSyncCoordinator } from '../../src/application/game/GameSyncCoordinator';
import { LocalStorageGameSyncCheckpointRepository } from '../../src/infrastructure/game/LocalStorageGameSyncCheckpointRepository';
import { pendingFinalizeStorageKey } from '../../src/infrastructure/game/LocalStoragePendingFinalizeRepository';
import { activeGameStorageKey } from '../../src/infrastructure/game/LocalStorageGameRepository';
import { completedGamesStorageKey } from '../../src/infrastructure/game/LocalStorageCompletedGameRepository';
import type { PendingFinalizeEntry } from '../../src/application/game/PendingFinalizeRepository';
import type {
  GameActionUploadOutcome,
  GameCloudGateway,
  GameSnapshotProjection,
  GameSnapshotWriteResult,
} from '../../src/application/game/GameCloudGateway';
import type { GameCloudWriterContext } from '../../src/application/game/projectGameForCloud';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import type { SyncStatusApi } from '../../src/application/sync/useSyncStatus';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import type { ActiveGame, CompletedGame } from '../../src/domain/game/types';
import type { SyncState } from '../../src/domain/syncState';
import type { GameActionEnvelopeDocument } from 'firebase-base/documents';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const SYNCED: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };
const ORG_ID = 'org-resume-test';
const TEAM_ID = 'team-resume-test';

class ImmediateSettingsRepository implements AsyncSettingsRepository {
  async read(): Promise<Settings & Record<string, unknown>> {
    return { ...DEFAULT_SETTINGS, teamName: 'Team Resume' };
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
    onNext({ ...DEFAULT_SETTINGS, teamName: 'Team Resume' }, SYNCED);
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

function pendingGame(): ActiveGame {
  return {
    id: 'game-crashed',
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    phase: 'tracking',
    players: [],
    opponent: 'Tegenstander',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: [],
    curQuarter: 4,
    beginSec: 0,
    endSec: 0,
    pendingSwapLineup: null,
    actions: [
      { type: 'score-delta', id: 'a1', team: 'for', delta: 6, at: '2026-01-01T00:10:00.000Z' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:05:00.000Z',
  };
}

function pendingCompleted(): CompletedGame {
  return {
    id: 'completed-crashed',
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    sourceGameId: 'game-crashed',
    opponent: 'Tegenstander',
    competition: '',
    date: '2026-01-01T01:00:00.000Z',
    players: [],
    segments: [],
    scoreFor: 6,
    scoreAgainst: 0,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
  };
}

/** Een altijd-succesvolle gateway — bewijst alleen dat de outbox-entry
 * daadwerkelijk aan finalize() wordt aangeboden en na succes wordt opgeruimd. */
function alwaysSucceedsGateway(): GameCloudGateway {
  return {
    async ensureGame(): Promise<GameSnapshotWriteResult> {
      return {
        ok: true,
        revision: 0,
        writerUid: writer.authorUid,
        deviceId: writer.deviceId,
        completedGameId: null,
      };
    },
    async uploadActions(
      _o: string,
      _t: string,
      _g: string,
      actions: readonly GameActionEnvelopeDocument[],
    ): Promise<GameActionUploadOutcome[]> {
      return actions.map((a) => ({ actionId: a.actionId, ok: true }));
    },
    async patchSnapshot(
      _o: string,
      _t: string,
      _g: string,
      _patch: Partial<GameSnapshotProjection>,
      expectedRevision: number,
    ): Promise<GameSnapshotWriteResult> {
      return { ok: true, revision: expectedRevision + 1 };
    },
    async finalizeCompletedGame(
      _o: string,
      _t: string,
      _g: string,
      completedGameId: string,
      _snapshot,
      expectedRevision: number,
    ): Promise<GameSnapshotWriteResult> {
      return { ok: true, revision: expectedRevision + 1, completedGameId };
    },
  };
}

describe('app/App — hervat een openstaande afronding na reload (PR 7.2a, P1-fix PR #61)', () => {
  it('leest een outbox-entry uit localStorage en biedt deze aan een NIEUWE coordinator-instantie aan; ruimt op na succes', async () => {
    // Simuleert een vorige, gecrashte sessie: de outbox-entry staat al in
    // localStorage vóórdat deze <App> ooit gemount is.
    const entry: PendingFinalizeEntry = { game: pendingGame(), completed: pendingCompleted() };
    window.localStorage.setItem(
      pendingFinalizeStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify([entry]),
    );

    // Verse coordinator-instantie (nieuwe gateway/checkpoints) — exact zoals
    // een reload een nieuwe `selectRepositories()`-aanroep zou opleveren.
    const gateway = alwaysSucceedsGateway();
    const finalizeSpy = vi.spyOn(gateway, 'finalizeCompletedGame');
    const coordinator = new GameSyncCoordinator({
      gateway,
      checkpoints: new LocalStorageGameSyncCheckpointRepository(window.localStorage),
    });

    const repositories = {
      mode: 'cloud' as const,
      settings: new ImmediateSettingsRepository(),
      roster: new ImmediateRosterRepository(),
      gameSync: coordinator,
      gameWriterContext: writer,
    };

    render(
      <App
        repositories={repositories}
        syncStatus={fakeSyncStatusApi()}
        canWrite={true}
        canWriteGame={true}
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Org Resume Test"
      />,
    );

    // De outbox-entry wordt vanzelf (zonder enige gebruikersactie) opnieuw
    // aan finalize() aangeboden — dit is de reload-herstelroute zelf.
    await waitFor(() => expect(finalizeSpy).toHaveBeenCalledTimes(1));
    const [, , gameIdArg, completedGameIdArg] = finalizeSpy.mock.calls[0]!;
    expect(gameIdArg).toBe('game-crashed');
    expect(completedGameIdArg).toBe('completed-crashed');

    // Na een geslaagde hervatting is de outbox-entry opgeruimd — geen
    // oneindige herhaalde retries van een al-bevestigde afronding.
    await waitFor(() => {
      const raw = window.localStorage.getItem(pendingFinalizeStorageKey(ORG_ID, TEAM_ID));
      expect(raw === null || JSON.parse(raw).length === 0).toBe(true);
    });
  });

  it('doet niets met de outbox in lokale modus (gameSync: null) — geen enkele netwerkaanroep mogelijk', async () => {
    const entry: PendingFinalizeEntry = { game: pendingGame(), completed: pendingCompleted() };
    window.localStorage.setItem(
      pendingFinalizeStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify([entry]),
    );

    const repositories = {
      mode: 'local' as const,
      settings: new ImmediateSettingsRepository(),
      roster: new ImmediateRosterRepository(),
      gameSync: null,
      gameWriterContext: null,
    };

    const { queryByTestId } = render(
      <App
        repositories={repositories}
        syncStatus={fakeSyncStatusApi()}
        canWrite={true}
        canWriteGame={true}
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Org Resume Test"
      />,
    );

    await waitFor(() => expect(queryByTestId('nav-settings')).toBeTruthy());

    // De entry blijft ongemoeid in localStorage (lokale modus syncet nooit).
    const raw = window.localStorage.getItem(pendingFinalizeStorageKey(ORG_ID, TEAM_ID));
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual([entry]);
  });
});

/** Wedstrijd met minstens één opgeslagen segment — `canFinishGame()` (en dus
 * de "Afronden"-knop) vereist dat er iets is afgeleid om te bevriezen. */
function trackingGameReadyToFinish(): ActiveGame {
  return {
    id: 'game-live',
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    phase: 'tracking',
    players: [],
    opponent: 'Tegenstander',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: [],
    curQuarter: 1,
    beginSec: 600,
    endSec: 480,
    pendingSwapLineup: null,
    actions: [
      {
        type: 'segment-saved',
        id: 'seg-action-1',
        segment: {
          id: 'seg-1',
          quarter: 1,
          beginSec: 600,
          endSec: 480,
          durSec: 120,
          lineup: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
          pf: 4,
          pa: 2,
          classSum: 14,
          allowed: 14.5,
          over: false,
        },
        at: '2026-01-01T00:10:00.000Z',
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:05:00.000Z',
  };
}

/**
 * Simuleert een échte storage-fout (bijv. quota) die specifiek de
 * pending-finalize-write raakt — settings/roster/completedGames/de actieve-
 * wedstrijdsleutel blijven allemaal gewoon schrijfbaar, exact zoals een
 * quotafout in de praktijk slechts één write zou raken. Vervangt
 * `window.localStorage` volledig i.p.v. `vi.spyOn(window.localStorage,
 * 'setItem')`: jsdom's `Storage` is een Proxy die een PROPERTY-assignment als
 * `storage.setItem = fn` zelf al als "sla een item met sleutel 'setItem' op"
 * interpreteert (dezelfde magie die `storage.foo = 'x'` laat werken als
 * `setItem('foo','x')`) — `vi.spyOn` (dat intern precies zo'n assignment
 * doet) raakt dus nooit de echte `setItem()`-aanroepen die de app zelf doet.
 * Een volledige vervanging van het `window.localStorage`-object omzeilt die
 * eigenaardigheid.
 */
class SelectiveFailStorage {
  private readonly store = new Map<string, string>();
  constructor(private readonly failOnSetKeys: ReadonlySet<string>) {}
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failOnSetKeys.has(key)) throw new Error('quota overschreden (test)');
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

describe('app/App — een mislukte outbox-write is een echte precondition (PR 7.2a, P1-fix tweede ronde PR #61)', () => {
  it('bij een mislukte pendingFinalizeRepo-write blijft de bronwedstrijd ONGERESET en wordt finalize() nooit aangeroepen', async () => {
    const originalLocalStorage = window.localStorage;
    const pendingKey = pendingFinalizeStorageKey(ORG_ID, TEAM_ID);
    const customStorage = new SelectiveFailStorage(new Set([pendingKey]));
    customStorage.setItem(
      activeGameStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify(trackingGameReadyToFinish()),
    );
    Object.defineProperty(window, 'localStorage', { value: customStorage, configurable: true });

    try {
      // "Afronden" vraagt een window.confirm(); in jsdom bestaat dat niet
      // standaard, dus altijd bevestigen.
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      const gateway = alwaysSucceedsGateway();
      const finalizeSpy = vi.spyOn(gateway, 'finalizeCompletedGame');
      const coordinator = new GameSyncCoordinator({
        gateway,
        checkpoints: new LocalStorageGameSyncCheckpointRepository(customStorage),
      });

      const repositories = {
        mode: 'cloud' as const,
        settings: new ImmediateSettingsRepository(),
        roster: new ImmediateRosterRepository(),
        gameSync: coordinator,
        gameWriterContext: writer,
      };

      const { getByTestId } = render(
        <App
          repositories={repositories}
          syncStatus={fakeSyncStatusApi()}
          canWrite={true}
          canWriteGame={true}
          organizationId={ORG_ID}
          teamId={TEAM_ID}
          organizationName="Org Resume Test"
        />,
      );

      await waitFor(() => expect(getByTestId('nav-settings')).toBeTruthy());
      getByTestId('nav-game').click();
      const finishBtn = await waitFor(() => getByTestId('finish-game-btn') as HTMLButtonElement);
      expect(finishBtn.disabled).toBe(false);
      finishBtn.click();

      // De foutmelding wordt getoond...
      await waitFor(() => expect(getByTestId('game-save-error')).toBeTruthy());

      // ...en de bronwedstrijd blijft EXACT zoals ze was: geen reset naar een
      // verse opzet. Dit is de kern van de fix — zonder deze precondition zou
      // de reset alsnog doorgaan en de enige retrybron verliezen.
      const stored = customStorage.getItem(activeGameStorageKey(ORG_ID, TEAM_ID));
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toMatchObject({ id: 'game-live', phase: 'tracking' });
      expect(JSON.parse(stored!).actions).toHaveLength(1);

      // finalize() is nooit aangeroepen op basis van niet-duurzame invoer.
      expect(finalizeSpy).not.toHaveBeenCalled();

      // De lokale CompletedGame/CSV zijn wél al bevestigd (die write ging
      // vooraf aan de mislukte outbox-write en is niet geraakt door de mock).
      const completedRaw = customStorage.getItem(completedGamesStorageKey(ORG_ID, TEAM_ID));
      expect(completedRaw).not.toBeNull();
      expect(JSON.parse(completedRaw!)).toHaveLength(1);
    } finally {
      Object.defineProperty(window, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      });
    }
  });
});
