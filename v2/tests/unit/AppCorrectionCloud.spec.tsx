// @vitest-environment jsdom
//
// PR 7.6a (docs/pr-7.6-plan.md §D.1-D.5): corrigeren in cloudmodus via `App`.
// Een nepcomposite (geen Firestore) stuurt `correctionSyncStatus()` en
// `subscribe()`-notificaties; fictieve data. Bewijst: statusindicator per
// wedstrijd, "Opnieuw proberen", conflictmelding zonder verwerp-knop,
// `correctedBy` = uid (cloud) of `null` (lokaal), rolgating, uitgeschakeld
// zolang de afronding niet server-bevestigd is, en geen herhaalde afleiding.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent, act } from '@testing-library/preact';
import { App } from '../../src/app/App';
import { pendingFinalizeStorageKey } from '../../src/infrastructure/game/LocalStoragePendingFinalizeRepository';
import { completedGamesStorageKey } from '../../src/infrastructure/game/LocalStorageCompletedGameRepository';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import type {
  CompletedGameRepository,
  CompletedGamesReadResult,
  CorrectionSyncStatus,
} from '../../src/application/game/CompletedGameRepository';
import type { GameCloudWriterContext } from '../../src/application/game/projectGameForCloud';
import type { GameSyncCoordinator } from '../../src/application/game/GameSyncCoordinator';
import type { SyncStatusApi } from '../../src/application/sync/useSyncStatus';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import type { ActiveGame, CompletedGame, Segment } from '../../src/domain/game/types';
import type { SyncState } from '../../src/domain/syncState';

beforeEach(() => {
  window.localStorage.setItem('lineup-tracker-lang', 'nl');
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const SYNCED: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };
const ORG_ID = 'org-corr-cloud';
const TEAM_ID = 'team-corr-cloud';
const writer: GameCloudWriterContext = {
  authorUid: 'uid-alice',
  deviceId: 'device-alice',
  writerEpoch: 0,
};

class ImmediateSettingsRepository implements AsyncSettingsRepository {
  async read(): Promise<Settings & Record<string, unknown>> {
    return { ...DEFAULT_SETTINGS, teamName: 'Team Correctie' };
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
    onNext({ ...DEFAULT_SETTINGS, teamName: 'Team Correctie' }, SYNCED);
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

function seg(o: Partial<Segment>): Segment {
  return {
    id: 's1',
    quarter: 1,
    beginSec: 600,
    endSec: 420,
    durSec: 180,
    lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
    pf: 6,
    pa: 4,
    classSum: 15,
    allowed: 14.5,
    over: false,
    tov: 2,
    ...o,
  };
}

function game(id: string, corrected = false): CompletedGame {
  return {
    id,
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    sourceGameId: `src-${id}`,
    opponent: 'Fictief Team',
    competition: '',
    date: '2026-01-01T10:00:00.000Z',
    players: [],
    segments: [
      seg({}),
      seg({ id: 's2', beginSec: 420, endSec: 180, durSec: 240, pf: 8, pa: 6, tov: 1 }),
    ],
    scoreFor: 14,
    scoreAgainst: 10,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    revision: corrected ? 1 : 0,
    deletedAt: null,
    deletedBy: null,
    ...(corrected
      ? {
          corrections: [
            {
              id: `c-${id}`,
              at: '2026-01-02T10:00:00.000Z',
              by: null,
              segmentId: 's1',
              before: { quarter: 1, beginSec: 600, endSec: 420, pf: 6, pa: 4, tov: 2 },
              after: { quarter: 1, beginSec: 600, endSec: 400, pf: 6, pa: 4, tov: 2 },
            },
          ],
        }
      : {}),
  };
}

type Listener = (result: CompletedGamesReadResult, sync: SyncState | null) => void;

/** Nepcomposite: lokale lijst in het geheugen, status per id en een `emit()` als `notify()`. */
class FakeCompositeRepo implements CompletedGameRepository {
  public games: CompletedGame[];
  public statuses = new Map<string, CorrectionSyncStatus | null>();
  public updateCalls: CompletedGame[] = [];
  public statusCalls = 0;
  public retry = vi.fn();
  /** ID's met een server-bevestigde cloudkopie (`hasConfirmedCloudCopy`). */
  public confirmedCloud = new Set<string>();
  private listener: Listener | null = null;

  constructor(games: CompletedGame[]) {
    this.games = games;
  }
  list(): CompletedGame[] {
    return this.games;
  }
  safeList(): CompletedGamesReadResult {
    return { status: 'ok', games: this.games };
  }
  add(g: CompletedGame): boolean {
    this.games = [g, ...this.games];
    return true;
  }
  remove(id: string): boolean {
    this.games = this.games.filter((g) => g.id !== id);
    return true;
  }
  update(g: CompletedGame): boolean {
    this.updateCalls.push(g);
    this.games = this.games.map((x) => (x.id === g.id ? g : x));
    this.statuses.set(g.id, 'wacht-op-synchronisatie');
    this.emit();
    return true;
  }
  replaceAll(games: CompletedGame[]): boolean {
    this.games = games;
    return true;
  }
  subscribe(onNext: Listener): () => void {
    this.listener = onNext;
    onNext(this.safeList(), SYNCED);
    return () => {
      this.listener = null;
    };
  }
  correctionSyncStatus(id: string): CorrectionSyncStatus | null {
    this.statusCalls += 1;
    return this.statuses.get(id) ?? null;
  }
  retryCorrectionUploads(): void {
    this.retry();
  }
  hasConfirmedCloudCopy(id: string): boolean {
    return this.confirmedCloud.has(id);
  }
  emit(): void {
    this.listener?.(this.safeList(), SYNCED);
  }
}

/** PR 7.6b: nepcomposite met `discardLocalCorrection` (alleen lokale kopie weg, cloudversie terug). */
class FakeDiscardRepo extends FakeCompositeRepo {
  public discardCalls: string[] = [];
  public discardOk = true;
  /** De cloudversie die na verwerpen weer zichtbaar is. */
  public cloudVersion: CompletedGame | null = null;
  discardLocalCorrection(id: string): boolean {
    this.discardCalls.push(id);
    if (!this.discardOk || this.cloudVersion === null) return false;
    const cloud = this.cloudVersion;
    this.games = this.games.map((g) => (g.id === id ? cloud : g));
    this.statuses.set(id, 'gesynchroniseerd');
    this.emit();
    return true;
  }
}

interface RenderOpts {
  canWrite?: boolean;
  gameSync?: GameSyncCoordinator | null;
  writerContext?: GameCloudWriterContext | null;
  local?: boolean;
}

function renderApp(repo: FakeCompositeRepo | null, opts: RenderOpts = {}) {
  const inertGameSync = {
    async ensureWriterClaim() {
      return {
        kind: 'confirmed' as const,
        identity: { writerUid: writer.authorUid, deviceId: writer.deviceId, writerEpoch: 0 },
      };
    },
  } as unknown as GameSyncCoordinator;
  const local = opts.local === true;
  const repositories = {
    mode: local ? ('local' as const) : ('cloud' as const),
    settings: new ImmediateSettingsRepository(),
    roster: new ImmediateRosterRepository(),
    gameSync: local ? null : opts.gameSync === undefined ? inertGameSync : opts.gameSync,
    gameWriterContext: local
      ? null
      : opts.writerContext === undefined
        ? writer
        : opts.writerContext,
    completedGames: repo,
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
      canWrite={opts.canWrite ?? true}
      canWriteGame={true}
      organizationId={ORG_ID}
      teamId={TEAM_ID}
      organizationName="Org Correctie"
    />,
  );
}

async function openHistory(q: ReturnType<typeof renderApp>) {
  await waitFor(() => expect(q.getByTestId('nav-history')).toBeTruthy());
  fireEvent.click(q.getByTestId('nav-history'));
}

async function openDetail(q: ReturnType<typeof renderApp>, id: string) {
  await openHistory(q);
  const item = await waitFor(() => q.getByTestId(`history-item-${id}`));
  fireEvent.click(item);
  await waitFor(() => expect(q.getByTestId('history-back-btn')).toBeTruthy());
}

describe('app/App — correctie in cloudmodus (PR 7.6a): statusindicator per wedstrijd', () => {
  const cases: Array<[CorrectionSyncStatus, string, string]> = [
    ['wacht-op-synchronisatie', 'wacht-op-synchronisatie', 'Wacht op synchronisatie'],
    // Gesynchroniseerde correctie: terug naar de afrondstatus (een wedstrijd zonder
    // lokale kopie geldt als cloud-only -> 'gesynchroniseerd'), zie plan §D.2.
    ['gesynchroniseerd', 'gesynchroniseerd', 'Gesynchroniseerd'],
    ['actie-nodig', 'actie-nodig', 'Actie nodig'],
    ['conflict', 'conflict', 'Conflict'],
    ['lokaal-beschikbaar', 'lokaal-beschikbaar', 'Lokaal beschikbaar'],
  ];

  for (const [status, expectedData, text] of cases) {
    it(`status ${status}: één indicator in lijst en detail (${text})`, async () => {
      const repo = new FakeCompositeRepo([game('cg-1', true)]);
      repo.statuses.set('cg-1', status);
      const q = renderApp(repo);
      await openHistory(q);
      const inList = await waitFor(() => q.getByTestId('history-sync-status-cg-1'));
      expect(inList.getAttribute('data-status')).toBe(expectedData);
      expect(inList.textContent).toBe(text);
      expect(q.container.querySelectorAll('[data-testid="history-sync-status-cg-1"]').length).toBe(
        1,
      );
      fireEvent.click(q.getByTestId('history-item-cg-1'));
      const inDetail = await waitFor(() => q.getByTestId('history-sync-status-cg-1'));
      expect(inDetail.getAttribute('data-status')).toBe(expectedData);
    });
  }

  it('de indicator volgt een notificatie van de composite (wacht -> actie nodig -> gesynchroniseerd)', async () => {
    const repo = new FakeCompositeRepo([game('cg-1', true)]);
    repo.statuses.set('cg-1', 'wacht-op-synchronisatie');
    const q = renderApp(repo);
    await openHistory(q);
    const statusOf = () => q.getByTestId('history-sync-status-cg-1').getAttribute('data-status');
    await waitFor(() => expect(statusOf()).toBe('wacht-op-synchronisatie'));
    repo.statuses.set('cg-1', 'actie-nodig');
    act(() => repo.emit());
    await waitFor(() => expect(statusOf()).toBe('actie-nodig'));
    repo.statuses.set('cg-1', 'gesynchroniseerd');
    act(() => repo.emit());
    await waitFor(() => expect(statusOf()).toBe('gesynchroniseerd'));
  });
});

describe('app/App — correctie in cloudmodus (PR 7.6a): herstelacties', () => {
  it('actie-nodig: hint en "Opnieuw proberen" roept retryCorrectionUploads aan', async () => {
    const repo = new FakeCompositeRepo([game('cg-1', true)]);
    repo.statuses.set('cg-1', 'actie-nodig');
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    expect(q.getByTestId('history-correction-hint').textContent).toContain('niet worden geüpload');
    fireEvent.click(q.getByTestId('history-correction-retry-btn'));
    expect(repo.retry).toHaveBeenCalledTimes(1);
  });

  it('lokaal-beschikbaar met correctie (geen cloudkopie): geen nutteloze "Opnieuw proberen" en geen onjuiste hint', async () => {
    const repo = new FakeCompositeRepo([game('cg-1', true)]);
    repo.statuses.set('cg-1', 'lokaal-beschikbaar');
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    expect(q.queryByTestId('history-correction-retry-btn')).toBeNull();
    expect(q.queryByTestId('history-correction-hint')).toBeNull();
  });

  it('conflict: alleen de melding, geen retry- of verwerp-knop', async () => {
    const repo = new FakeCompositeRepo([game('cg-1', true)]);
    repo.statuses.set('cg-1', 'conflict');
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    expect(q.getByTestId('history-correction-conflict').textContent).toBe(
      'Deze wedstrijd is ondertussen op een ander apparaat gewijzigd.',
    );
    expect(q.queryByTestId('history-correction-retry-btn')).toBeNull();
    expect(q.queryByTestId('history-correction-discard-btn')).toBeNull();
  });

  it('wacht-op-synchronisatie: veilig-lokaal-hint, geen retry-knop', async () => {
    const repo = new FakeCompositeRepo([game('cg-1', true)]);
    repo.statuses.set('cg-1', 'wacht-op-synchronisatie');
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    expect(q.getByTestId('history-correction-hint').textContent).toContain(
      'veilig op dit apparaat',
    );
    expect(q.queryByTestId('history-correction-retry-btn')).toBeNull();
  });

  it('viewer/scorer (canWrite=false): geen retry, geen hint, geen aantikbare segmenten; conflictmelding blijft zichtbaar', async () => {
    const repo = new FakeCompositeRepo([game('cg-1', true)]);
    repo.statuses.set('cg-1', 'conflict');
    const q = renderApp(repo, { canWrite: false });
    await openDetail(q, 'cg-1');
    expect(q.queryByTestId('history-correction-retry-btn')).toBeNull();
    expect(q.queryByTestId('history-correction-hint')).toBeNull();
    expect(q.queryByTestId('history-correct-hint')).toBeNull();
    expect(q.getByTestId('history-segment-s1').tagName).toBe('DIV');
    expect(q.getByTestId('history-correction-conflict')).toBeTruthy();

    repo.statuses.set('cg-1', 'actie-nodig');
    act(() => repo.emit());
    await waitFor(() => expect(q.queryByTestId('history-correction-conflict')).toBeNull());
    expect(q.queryByTestId('history-correction-retry-btn')).toBeNull();
  });
});

describe('app/App — correctie in cloudmodus (PR 7.6a): correctedBy en lokale modus', () => {
  async function correctFirstSegment(q: ReturnType<typeof renderApp>) {
    fireEvent.click(q.getByTestId('history-segment-s1'));
    fireEvent.input(q.getByTestId('correct-pf'), { target: { value: '9' } });
    fireEvent.click(q.getByTestId('correct-segment-review'));
    fireEvent.click(q.getByTestId('correct-segment-confirm'));
  }

  it('cloudmodus: het correctielogitem krijgt by = uid van de schrijver', async () => {
    const repo = new FakeCompositeRepo([game('cg-1')]);
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    await correctFirstSegment(q);
    expect(repo.updateCalls).toHaveLength(1);
    expect(repo.updateCalls[0]?.corrections?.[0]?.by).toBe('uid-alice');
    // Na het opslaan toont de detailweergave de status uit de composite.
    await waitFor(() =>
      expect(q.getByTestId('history-sync-status-cg-1').getAttribute('data-status')).toBe(
        'wacht-op-synchronisatie',
      ),
    );
  });

  it('cloudmodus zonder gameWriterContext: niet aantikbaar', async () => {
    const repo = new FakeCompositeRepo([game('cg-1')]);
    const q = renderApp(repo, { writerContext: null });
    await openDetail(q, 'cg-1');
    expect(q.getByTestId('history-segment-s1').tagName).toBe('DIV');
  });

  it('lokale modus ongewijzigd: by = null, geen statusindicator, geen retry', async () => {
    window.localStorage.setItem(
      completedGamesStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify([game('cg-local')]),
    );
    const q = renderApp(null, { local: true });
    await openDetail(q, 'cg-local');
    expect(q.queryByTestId('history-sync-status-cg-local')).toBeNull();
    await correctFirstSegment(q);
    await waitFor(() => expect(q.getByTestId('history-correction-saved')).toBeTruthy());
    const stored = JSON.parse(
      window.localStorage.getItem(completedGamesStorageKey(ORG_ID, TEAM_ID)) ?? '[]',
    ) as CompletedGame[];
    expect(stored[0]?.corrections?.[0]?.by).toBeNull();
    expect(q.queryByTestId('history-sync-status-cg-local')).toBeNull();
    expect(q.queryByTestId('history-correction-retry-btn')).toBeNull();
  });
});

function pendingGame(): ActiveGame {
  return {
    id: 'src-cg-pending',
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    phase: 'tracking',
    players: [],
    opponent: 'Fictief Team',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: [],
    curQuarter: 4,
    beginSec: 0,
    endSec: 0,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:05:00.000Z',
  };
}

describe('app/App — correctie in cloudmodus (PR 7.6a): afronding nog niet bevestigd (plan §D.5)', () => {
  it('uitgeschakeld tot de afronding gesynchroniseerd is; cloud-only wedstrijd blijft corrigeerbaar', async () => {
    let resolveFinalize: (v: { status: 'idle' }) => void = () => undefined;
    const finalize = vi.fn(
      () =>
        new Promise<{ status: 'idle' }>((resolve) => {
          resolveFinalize = resolve;
        }),
    );
    const gameSync = {
      async ensureWriterClaim() {
        return {
          kind: 'confirmed' as const,
          identity: { writerUid: writer.authorUid, deviceId: writer.deviceId, writerEpoch: 0 },
        };
      },
      finalize,
    } as unknown as GameSyncCoordinator;
    const pending = game('cg-pending');
    // De lokale kopie staat in de echte lokale opslag (zoals na een afronding op
    // dit apparaat); zonder lokale kopie telt een wedstrijd als cloud-only.
    window.localStorage.setItem(
      completedGamesStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify([pending]),
    );
    window.localStorage.setItem(
      pendingFinalizeStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify([{ game: pendingGame(), completed: pending }]),
    );
    const repo = new FakeCompositeRepo([pending, game('cg-cloud-only')]);
    const q = renderApp(repo, { gameSync });

    await waitFor(() => expect(finalize).toHaveBeenCalledTimes(1));
    await openDetail(q, 'cg-pending');
    expect(q.getByTestId('history-segment-s1').tagName).toBe('DIV');
    expect(q.queryByTestId('history-correct-hint')).toBeNull();
    expect(q.getByTestId('history-correction-waiting').textContent).toContain(
      'Wacht tot de wedstrijd is gesynchroniseerd',
    );

    // Zodra de afronding server-bevestigd is, gaat corrigeren open.
    await act(async () => {
      resolveFinalize({ status: 'idle' });
    });
    await waitFor(() => expect(q.getByTestId('history-segment-s1').tagName).toBe('BUTTON'));
    expect(q.queryByTestId('history-correction-waiting')).toBeNull();

    // Een wedstrijd van een ander apparaat (geen finalizestatus hier) is nooit geblokkeerd.
    fireEvent.click(q.getByTestId('history-back-btn'));
    fireEvent.click(await waitFor(() => q.getByTestId('history-item-cg-cloud-only')));
    await waitFor(() => expect(q.getByTestId('history-segment-s1').tagName).toBe('BUTTON'));
    expect(q.queryByTestId('history-correction-waiting')).toBeNull();
  });
});

describe('app/App — lokale kopie zonder checkpoint met bevestigde cloudkopie (review PR #136)', () => {
  function gameSyncWithoutCheckpoint(): GameSyncCoordinator {
    return {
      async ensureWriterClaim() {
        return {
          kind: 'confirmed' as const,
          identity: { writerUid: writer.authorUid, deviceId: writer.deviceId, writerEpoch: 0 },
        };
      },
      // Zonder lokaal checkpoint leest de echte coordinator 'lokaal-beschikbaar'.
      readFinalizeStatus: () => 'lokaal-beschikbaar' as const,
      finalize: vi.fn(() => new Promise<never>(() => undefined)),
    } as unknown as GameSyncCoordinator;
  }

  function seedLocal(g: CompletedGame) {
    window.localStorage.setItem(completedGamesStorageKey(ORG_ID, TEAM_ID), JSON.stringify([g]));
  }

  it('na een correctie op een cloud-only wedstrijd: indicator gesynchroniseerd en segmenten aantikbaar', async () => {
    const g = game('cg-1', true);
    seedLocal(g);
    const repo = new FakeCompositeRepo([g]);
    repo.statuses.set('cg-1', 'gesynchroniseerd');
    repo.confirmedCloud.add('cg-1');
    const q = renderApp(repo, { gameSync: gameSyncWithoutCheckpoint() });
    await openDetail(q, 'cg-1');
    await waitFor(() =>
      expect(q.getByTestId('history-sync-status-cg-1').getAttribute('data-status')).toBe(
        'gesynchroniseerd',
      ),
    );
    expect(q.getByTestId('history-segment-s1').tagName).toBe('BUTTON');
    expect(q.queryByTestId('history-correction-waiting')).toBeNull();
  });

  it('zonder bevestigde cloudkopie blijft de wedstrijd lokaal-beschikbaar en geblokkeerd', async () => {
    const g = game('cg-1', true);
    seedLocal(g);
    const repo = new FakeCompositeRepo([g]);
    repo.statuses.set('cg-1', 'gesynchroniseerd');
    const q = renderApp(repo, { gameSync: gameSyncWithoutCheckpoint() });
    await openDetail(q, 'cg-1');
    expect(q.getByTestId('history-sync-status-cg-1').getAttribute('data-status')).toBe(
      'lokaal-beschikbaar',
    );
    expect(q.getByTestId('history-segment-s1').tagName).toBe('DIV');
    expect(q.getByTestId('history-correction-waiting')).toBeTruthy();
  });

  it('een onbevestigde afronding in de outbox deblokkeert niet, ook niet met een cloudkopie (latency-snapshot)', async () => {
    const g = game('cg-pending');
    seedLocal(g);
    window.localStorage.setItem(
      pendingFinalizeStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify([{ game: pendingGame(), completed: g }]),
    );
    const repo = new FakeCompositeRepo([g]);
    repo.confirmedCloud.add('cg-pending');
    const q = renderApp(repo, { gameSync: gameSyncWithoutCheckpoint() });
    await openDetail(q, 'cg-pending');
    expect(q.getByTestId('history-segment-s1').tagName).toBe('DIV');
    expect(q.getByTestId('history-correction-waiting')).toBeTruthy();
  });

  it('een cloudkopie met eigen onbevestigde write (hasConfirmedCloudCopy=false) deblokkeert niet', async () => {
    const g = game('cg-1', true);
    seedLocal(g);
    const repo = new FakeCompositeRepo([g]);
    repo.statuses.set('cg-1', 'gesynchroniseerd');
    // confirmedCloud leeg = cloudkopie ontbreekt of is pending.
    const q = renderApp(repo, { gameSync: gameSyncWithoutCheckpoint() });
    await openDetail(q, 'cg-1');
    expect(q.getByTestId('history-segment-s1').tagName).toBe('DIV');
  });
});

describe('app/App — correctie in cloudmodus (PR 7.6a): geen herhaalde afleiding', () => {
  it('statusafleiding gebeurt per notificatie, alleen voor gecorrigeerde wedstrijden, en niet in een lus', async () => {
    const repo = new FakeCompositeRepo([game('cg-1', true), game('cg-2'), game('cg-3', true)]);
    repo.statuses.set('cg-1', 'wacht-op-synchronisatie');
    repo.statuses.set('cg-3', 'gesynchroniseerd');
    const listSpy = vi.spyOn(repo, 'list');
    const q = renderApp(repo);
    await openHistory(q);
    await waitFor(() => expect(q.getByTestId('history-item-cg-1')).toBeTruthy());
    // Laat eventuele vervolgrenders uitlopen.
    await new Promise((r) => setTimeout(r, 50));
    const settled = repo.statusCalls;
    const settledLists = listSpy.mock.calls.length;
    // Alleen de twee gecorrigeerde wedstrijden worden bevraagd, per notificatie.
    expect(settled % 2).toBe(0);
    expect(settled).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 100));
    expect(repo.statusCalls).toBe(settled);
    expect(listSpy.mock.calls.length).toBe(settledLists);

    // Eén notificatie zonder statuswijziging = precies één nieuwe afleidingsronde (2 bevragingen).
    act(() => repo.emit());
    await new Promise((r) => setTimeout(r, 50));
    expect(repo.statusCalls).toBe(settled + 2);
    expect(listSpy.mock.calls.length).toBe(settledLists);
  });
});

describe('app/App — correctieconflict, lokale versie verwerpen (PR 7.6b, plan §D.3)', () => {
  function conflictRepo(): FakeDiscardRepo {
    const repo = new FakeDiscardRepo([game('cg-1', true), game('cg-2')]);
    repo.statuses.set('cg-1', 'conflict');
    const theirs = game('cg-1', true);
    repo.cloudVersion = {
      ...theirs,
      corrections: [{ ...theirs.corrections![0]!, id: 'c-theirs', by: 'uid-bob' }],
    };
    return repo;
  }

  it('knop alleen bij conflict én canWrite; niet bij andere statussen of zonder rol', async () => {
    const repo = conflictRepo();
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    expect(q.getByTestId('history-correction-discard-btn').textContent).toBe(
      'Mijn lokale versie verwerpen',
    );
    expect(q.getByTestId('history-correction-discard-hint').textContent).toContain(
      'Alleen de kopie op dit apparaat',
    );
    // Andere statussen: geen verwerp-knop.
    for (const status of [
      'wacht-op-synchronisatie',
      'gesynchroniseerd',
      'lokaal-beschikbaar',
    ] as const) {
      repo.statuses.set('cg-1', status);
      act(() => repo.emit());
      await waitFor(() => expect(q.queryByTestId('history-correction-conflict')).toBeNull());
      expect(q.queryByTestId('history-correction-discard-btn')).toBeNull();
    }
    cleanup();

    const viewer = renderApp(conflictRepo(), { canWrite: false });
    await openDetail(viewer, 'cg-1');
    expect(viewer.getByTestId('history-correction-conflict')).toBeTruthy();
    expect(viewer.queryByTestId('history-correction-discard-btn')).toBeNull();
  });

  it('actie-nodig (HOOG-2): knop met eigen uitleg voor canWrite; niet voor viewer of scorer', async () => {
    const repo = conflictRepo();
    repo.statuses.set('cg-1', 'actie-nodig');
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    expect(q.getByTestId('history-correction-discard-btn').textContent).toBe(
      'Mijn lokale versie verwerpen',
    );
    expect(q.queryByTestId('history-correction-conflict')).toBeNull();
    const hint = q.getByTestId('history-correction-discard-hint').textContent ?? '';
    expect(hint).toContain('door een andere gebruiker');
    expect(hint).toContain('versie van het team');
    cleanup();

    // Viewer en scorer hebben canWrite=false.
    const viewer = renderApp(
      (() => {
        const r = conflictRepo();
        r.statuses.set('cg-1', 'actie-nodig');
        return r;
      })(),
      { canWrite: false },
    );
    await openDetail(viewer, 'cg-1');
    expect(viewer.queryByTestId('history-correction-discard-btn')).toBeNull();
    expect(viewer.queryByTestId('history-correction-discard-hint')).toBeNull();
  });

  it('actie-nodig: verwerpen werkt en de cloudversie keert terug; bevestigingstekst blijft volledig', async () => {
    const repo = conflictRepo();
    repo.statuses.set('cg-1', 'actie-nodig');
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    fireEvent.click(q.getByTestId('history-correction-discard-btn'));
    expect(q.getByTestId('history-correction-discard-text').textContent).toContain(
      'nog niet is geüpload gaat verloren',
    );
    fireEvent.click(q.getByTestId('history-correction-discard-confirm'));
    expect(repo.discardCalls).toEqual(['cg-1']);
    await waitFor(() => expect(q.queryByTestId('history-correction-discard-btn')).toBeNull());
    expect(q.queryByTestId('history-correction-discard-dialog')).toBeNull();
    expect(q.getByTestId('history-correction-c-theirs')).toBeTruthy();
    expect(q.queryByTestId('history-correction-c-cg-1')).toBeNull();
    expect(q.getByTestId('history-sync-status-cg-1').getAttribute('data-status')).toBe(
      'gesynchroniseerd',
    );
  });

  it('actie-nodig: Engelse uitleg', async () => {
    window.localStorage.setItem('lineup-tracker-lang', 'en');
    const repo = conflictRepo();
    repo.statuses.set('cg-1', 'actie-nodig');
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    expect(q.getByTestId('history-correction-discard-hint').textContent).toContain('another user');
  });

  it('focus na succesvol verwerpen staat op de wedstrijdkop, niet op body (a11y)', async () => {
    const repo = conflictRepo();
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    fireEvent.click(q.getByTestId('history-correction-discard-btn'));
    fireEvent.click(q.getByTestId('history-correction-discard-confirm'));
    await waitFor(() => expect(q.queryByTestId('history-correction-discard-dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(q.getByTestId('history-detail-heading')),
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it('lokale modus ongewijzigd: geen verwerp-actie', async () => {
    window.localStorage.setItem(
      completedGamesStorageKey(ORG_ID, TEAM_ID),
      JSON.stringify([game('cg-local', true)]),
    );
    const q = renderApp(null, { local: true });
    await openDetail(q, 'cg-local');
    expect(q.queryByTestId('history-correction-discard-btn')).toBeNull();
    expect(q.queryByTestId('history-correction-conflict')).toBeNull();
  });

  it('een repository zonder discardLocalCorrection krijgt geen knop', async () => {
    const repo = new FakeCompositeRepo([game('cg-1', true)]);
    repo.statuses.set('cg-1', 'conflict');
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    expect(q.getByTestId('history-correction-conflict')).toBeTruthy();
    expect(q.queryByTestId('history-correction-discard-btn')).toBeNull();
  });

  it('bevestiging vereist: de knop opent een eigen dialoog (geen window.confirm) en verwerpt nog niets', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const repo = conflictRepo();
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    fireEvent.click(q.getByTestId('history-correction-discard-btn'));
    const dialog = q.getByRole('dialog', { name: 'Lokale versie verwerpen?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // Focus-trap: de focus staat binnen de dialoog.
    expect(dialog.contains(document.activeElement)).toBe(true);
    const text = q.getByTestId('history-correction-discard-text').textContent ?? '';
    expect(text).toContain('Alleen de kopie van deze wedstrijd op dit apparaat');
    expect(text).toContain('versie van het team');
    expect(text).toContain('nog niet is geüpload gaat verloren');
    expect(q.getByTestId('history-correction-discard-confirm').textContent).toBe('Verwerpen');
    expect(q.getByTestId('history-correction-discard-cancel').textContent).toBe('Annuleren');
    expect(repo.discardCalls).toEqual([]);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('annuleren (knop, Escape, achtergrond) doet niets: data en conflict blijven', async () => {
    const repo = conflictRepo();
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    const before = JSON.stringify(repo.games);

    fireEvent.click(q.getByTestId('history-correction-discard-btn'));
    fireEvent.click(q.getByTestId('history-correction-discard-cancel'));
    expect(q.queryByTestId('history-correction-discard-dialog')).toBeNull();

    fireEvent.click(q.getByTestId('history-correction-discard-btn'));
    fireEvent.keyDown(q.getByTestId('history-correction-discard-dialog'), { key: 'Escape' });
    expect(q.queryByTestId('history-correction-discard-dialog')).toBeNull();

    fireEvent.click(q.getByTestId('history-correction-discard-btn'));
    fireEvent.click(q.getByTestId('history-correction-discard-dialog'));
    expect(q.queryByTestId('history-correction-discard-dialog')).toBeNull();

    expect(repo.discardCalls).toEqual([]);
    expect(JSON.stringify(repo.games)).toBe(before);
    expect(q.getByTestId('history-correction-conflict')).toBeTruthy();
    expect(q.getByTestId('history-correction-discard-btn')).toBeTruthy();
  });

  it('verwerpen: conflictmelding weg, cloudversie terug, opnieuw corrigeren mogelijk', async () => {
    const repo = conflictRepo();
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    fireEvent.click(q.getByTestId('history-correction-discard-btn'));
    fireEvent.click(q.getByTestId('history-correction-discard-confirm'));

    expect(repo.discardCalls).toEqual(['cg-1']);
    await waitFor(() => expect(q.queryByTestId('history-correction-conflict')).toBeNull());
    expect(q.queryByTestId('history-correction-discard-dialog')).toBeNull();
    expect(q.queryByTestId('history-correction-discard-btn')).toBeNull();
    // De versie van het team staat er weer.
    expect(q.getByTestId('history-correction-c-theirs')).toBeTruthy();
    expect(q.queryByTestId('history-correction-c-cg-1')).toBeNull();
    expect(q.getByTestId('history-sync-status-cg-1').getAttribute('data-status')).toBe(
      'gesynchroniseerd',
    );
    // Opnieuw corrigeren kan.
    expect(q.getByTestId('history-segment-s1').tagName).toBe('BUTTON');
    // De andere wedstrijd is ongemoeid.
    expect(repo.games.find((g) => g.id === 'cg-2')).toEqual(game('cg-2'));
  });

  it('foutpad: bij false blijft alles staan en volgt een korte foutmelding', async () => {
    const repo = conflictRepo();
    repo.discardOk = false;
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    fireEvent.click(q.getByTestId('history-correction-discard-btn'));
    fireEvent.click(q.getByTestId('history-correction-discard-confirm'));
    expect(repo.discardCalls).toEqual(['cg-1']);
    expect(q.getByTestId('history-correction-discard-error').textContent).toContain(
      'Verwerpen is niet gelukt',
    );
    expect(q.getByTestId('history-correction-discard-dialog')).toBeTruthy();
    expect(q.getByTestId('history-correction-conflict')).toBeTruthy();
    // Annuleren sluit de dialoog en wist de fout bij een volgende poging.
    fireEvent.click(q.getByTestId('history-correction-discard-cancel'));
    fireEvent.click(q.getByTestId('history-correction-discard-btn'));
    expect(q.queryByTestId('history-correction-discard-error')).toBeNull();
  });

  it('een conflict dat verdwijnt sluit een open bevestiging en laat geen oude dialoog terugkeren', async () => {
    const repo = conflictRepo();
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    fireEvent.click(q.getByTestId('history-correction-discard-btn'));
    repo.statuses.set('cg-1', 'gesynchroniseerd');
    act(() => repo.emit());
    await waitFor(() => expect(q.queryByTestId('history-correction-discard-dialog')).toBeNull());
    repo.statuses.set('cg-1', 'conflict');
    act(() => repo.emit());
    await waitFor(() => expect(q.getByTestId('history-correction-discard-btn')).toBeTruthy());
    expect(q.queryByTestId('history-correction-discard-dialog')).toBeNull();
  });

  it('Engelse teksten', async () => {
    window.localStorage.setItem('lineup-tracker-lang', 'en');
    const repo = conflictRepo();
    const q = renderApp(repo);
    await openDetail(q, 'cg-1');
    expect(q.getByTestId('history-correction-discard-btn').textContent).toBe(
      'Discard my local version',
    );
    fireEvent.click(q.getByTestId('history-correction-discard-btn'));
    const dialog = q.getByRole('dialog', { name: 'Discard local version?' });
    expect(dialog.textContent).toContain('A local correction that has not been uploaded is lost');
    expect(q.getByTestId('history-correction-discard-confirm').textContent).toBe('Discard');
    expect(q.getByTestId('history-correction-discard-cancel').textContent).toBe('Cancel');
  });
});
