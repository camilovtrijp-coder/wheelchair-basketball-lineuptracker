// PR 7.7c (docs/pr-7.7-plan.md §C.4): cloudkant van de lineupcorrectie — projectie
// naar de cloudpayload, lokaal opslaan via update(), upload door de Composite-
// repository en merge/lineage op een tweede apparaat. Fictieve, handmatig
// nagerekende data (zelfde fixture-opzet als gameCorrectionLineup.spec.ts):
//   p1..p5 klasse 3.0, p6 klasse 2.0 (vrouw), p7 klasse 1.0 maar doet niet mee.
//   S1 lineup p1..p5: som 15, toegestaan 14.5 -> over.
//   Wissel p5 -> p6: som 14, bonus 1.0 => toegestaan 15.5 -> niet over.
import { describe, it, expect, vi } from 'vitest';
import { projectCompletedGameCorrection } from '../../src/application/game/projectCompletedGameForCloud';
import type { CompletedGameCorrectionResult } from '../../src/application/game/GameCloudGateway';
import { correctSegment, replayCorrectionLog } from '../../src/domain/game/correction';
import { compareCorrectionLineage } from '../../src/domain/game/correctionLineage';
import type { ClassificationConfig } from '../../src/domain/game/tracking';
import type {
  CompletedGame,
  CompletedGameCorrection,
  GamePlayer,
  Segment,
} from '../../src/domain/game/types';
import type { SyncState } from '../../src/domain/syncState';
import type { KeyValueStorage } from '../../src/i18n/persistence';
import {
  CompositeCompletedGameRepository,
  type CompletedGameCorrectionWriter,
  type CompletedGameTombstoneWriter,
} from '../../src/infrastructure/game/CompositeCompletedGameRepository';
import type { CloudCompletedGameSource } from '../../src/infrastructure/game/FirestoreCompletedGameRepository';
import {
  completedGamesStorageKey,
  LocalStorageCompletedGameRepository,
} from '../../src/infrastructure/game/LocalStorageCompletedGameRepository';

const CONFIG: ClassificationConfig = {
  useClassLimit: true,
  classBaseLimit: 14.5,
  maxBonus: 1.5,
  bonusTag1Only: 1,
  bonusTag2Only: 0.5,
  bonusBoth: 1.5,
};

const SERVER: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };
const NEW_LINEUP = ['p1', 'p2', 'p3', 'p4', 'p6'];

class MemoryStorage implements KeyValueStorage {
  public readonly store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

function player(n: number, extra: Partial<GamePlayer> = {}): GamePlayer {
  return {
    id: `p${n}`,
    rosterId: n,
    nr: String(n),
    naam: `Speler ${n}`,
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: n <= 5,
    ...extra,
  };
}

function seg(overrides: Partial<Segment>): Segment {
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
    over: true,
    tov: 2,
    ...overrides,
  };
}

function base(overrides: Partial<CompletedGame> = {}): CompletedGame {
  return {
    id: 'cg-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'src-1',
    opponent: 'Fictief Team',
    competition: '',
    date: '2026-01-01T10:00:00.000Z',
    players: [
      player(1),
      player(2),
      player(3),
      player(4),
      player(5),
      player(6, { kl: '2.0', vrouw: true, start: false }),
      player(7, { kl: '1.0', participate: false, start: false }),
    ],
    segments: [seg({ id: 's1' }), seg({ id: 's2', beginSec: 420, endSec: 240, durSec: 180 })],
    scoreFor: 12,
    scoreAgainst: 8,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: true,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

function correct(
  game: CompletedGame,
  id: string,
  segmentId: string,
  patch: Parameters<typeof correctSegment>[2],
  at = '2026-02-02T09:00:00.000Z',
): CompletedGame {
  const r = correctSegment(game, segmentId, patch, 'uid-1', {
    id,
    now: new Date(at),
    classification: CONFIG,
  });
  if (!r.ok) throw new Error(`correctie mislukt: ${r.error}`);
  return r.game;
}

function lastCorrection(game: CompletedGame): CompletedGameCorrection {
  const log = game.corrections ?? [];
  const entry = log[log.length - 1];
  if (!entry) throw new Error('geen correctie');
  return entry;
}

describe('projectCompletedGameCorrection: lineup (PR 7.7c)', () => {
  it('neemt lineup/allowed over en voegt de cloud-only spelerindexen toe (positie in players)', () => {
    const game = correct(base(), 'c-1', 's1', { lineup: NEW_LINEUP });
    const payload = projectCompletedGameCorrection(game, lastCorrection(game));
    expect(payload).not.toBeNull();
    expect(payload?.correction.before).toMatchObject({
      lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
      allowed: 14.5,
    });
    expect(payload?.correction.after).toMatchObject({ lineup: NEW_LINEUP, allowed: 15.5 });
    // p1..p4 staan op index 0..3, p6 op index 5
    expect(payload?.correction.lineupPlayerIndexes).toEqual([0, 1, 2, 3, 5]);
    expect(payload?.segments[0]).toMatchObject({
      lineup: NEW_LINEUP,
      classSum: 14,
      allowed: 15.5,
      over: false,
    });
  });

  it('deelt geen lineup-array met het domeinlogitem (kopie)', () => {
    const game = correct(base(), 'c-1', 's1', { lineup: NEW_LINEUP });
    const entry = lastCorrection(game);
    const payload = projectCompletedGameCorrection(game, entry);
    expect(payload?.correction.after.lineup).toEqual(entry.after.lineup);
    expect(payload?.correction.after.lineup).not.toBe(entry.after.lineup);
    expect(payload?.correction.before.lineup).not.toBe(entry.before.lineup);
  });

  it('een correctie zonder lineup (oud logitem) krijgt geen lineup, allowed of spelerindexen', () => {
    const game = correct(base(), 'c-1', 's1', { pf: 7 });
    const payload = projectCompletedGameCorrection(game, lastCorrection(game));
    expect(payload?.correction).not.toHaveProperty('lineupPlayerIndexes');
    expect(payload?.correction.after).not.toHaveProperty('lineup');
    expect(payload?.correction.after).not.toHaveProperty('allowed');
  });

  it('fail-closed (null) bij een afwijkende vorm', () => {
    const game = correct(base(), 'c-1', 's1', { lineup: NEW_LINEUP });
    const entry = lastCorrection(game);
    const withEntry = (after: object, before: object = entry.before) =>
      ({ ...entry, before, after }) as unknown as CompletedGameCorrection;
    // lineup alleen in after
    const { lineup: _l, allowed: _a, ...beforeBase } = entry.before;
    void _l;
    void _a;
    expect(
      projectCompletedGameCorrection(game, withEntry({ ...entry.after }, beforeBase)),
    ).toBeNull();
    // 4 spelers, dubbele speler, niet-eindige of ontbrekende allowed
    for (const after of [
      { ...entry.after, lineup: ['p1', 'p2', 'p3', 'p4'] },
      { ...entry.after, lineup: ['p1', 'p1', 'p3', 'p4', 'p6'] },
      { ...entry.after, allowed: Number.NaN },
      { ...entry.after, allowed: undefined },
    ]) {
      expect(projectCompletedGameCorrection(game, withEntry(after))).toBeNull();
    }
    // speler die niet in players staat
    expect(
      projectCompletedGameCorrection(
        game,
        withEntry({ ...entry.after, lineup: ['p1', 'p2', 'p3', 'p4', 'p99'] }),
      ),
    ).toBeNull();
  });
});

describe('LocalStorageCompletedGameRepository.update: lineup (PR 7.7c)', () => {
  function repoWith(game: CompletedGame) {
    const storage = new MemoryStorage();
    storage.setItem(completedGamesStorageKey('org-1', 'team-1'), JSON.stringify([game]));
    return new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
  }

  it('slaat een gelogde lineupcorrectie op', () => {
    const repo = repoWith(base());
    const corrected = correct(base(), 'c-1', 's1', { lineup: NEW_LINEUP });
    expect(repo.update(corrected)).toBe(true);
    expect(repo.list()[0]?.segments[0]?.lineup).toEqual(NEW_LINEUP);
    expect(repo.list()[0]?.segments[0]?.allowed).toBe(15.5);
  });

  it('weigert een lineupwijziging zonder passend logitem', () => {
    const repo = repoWith(base());
    const good = correct(base(), 'c-1', 's1', { pf: 7 });
    const forged: CompletedGame = {
      ...good,
      segments: good.segments.map((s) => (s.id === 's1' ? { ...s, lineup: NEW_LINEUP } : s)),
    };
    expect(repo.update(forged)).toBe(false);
    expect(repo.list()[0]?.segments[0]?.lineup).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('weigert een gelogde lineup waarvan classSum/allowed/over niet bij het log passen', () => {
    const repo = repoWith(base());
    const good = correct(base(), 'c-1', 's1', { lineup: NEW_LINEUP });
    const forged: CompletedGame = {
      ...good,
      segments: good.segments.map((s) => (s.id === 's1' ? { ...s, over: true } : s)),
    };
    expect(repo.update(forged)).toBe(false);
  });

  it('weigert een lineupwijziging in een ander segment dan het gelogde', () => {
    const repo = repoWith(base());
    const good = correct(base(), 'c-1', 's1', { lineup: NEW_LINEUP });
    const forged: CompletedGame = {
      ...good,
      segments: good.segments.map((s) => (s.id === 's2' ? { ...s, lineup: NEW_LINEUP } : s)),
    };
    expect(repo.update(forged)).toBe(false);
  });
});

describe('lineage en replay op een tweede apparaat (PR 7.7c)', () => {
  it('replayCorrectionLog voegt een lineupcorrectie van apparaat A samen op de basis van apparaat B', () => {
    const a1 = correct(base(), 'c-1', 's1', { lineup: NEW_LINEUP });
    const a2 = correct(a1, 'c-2', 's2', { pf: 9 });
    const replayed = replayCorrectionLog(base(), a2.corrections ?? [], 0);
    expect(replayed).not.toBeNull();
    expect(replayed?.segments).toEqual(a2.segments);
    expect(replayed?.segments[0]).toMatchObject({
      lineup: NEW_LINEUP,
      classSum: 14,
      allowed: 15.5,
      over: false,
    });
    expect([replayed?.scoreFor, replayed?.scoreAgainst, replayed?.revision]).toEqual([15, 8, 2]);
    // Alleen de ontbrekende staart afspelen: B kent c-1 al.
    const tail = replayCorrectionLog(a1, a2.corrections ?? [], 1);
    expect(tail?.segments).toEqual(a2.segments);
  });

  it('een lineupcorrectie waarvan before.lineup niet bij de basis past wordt geweigerd (null)', () => {
    const a1 = correct(base(), 'c-1', 's1', { lineup: NEW_LINEUP });
    // Basis van een ander apparaat waar s1 al een andere lineup had.
    const other = base({
      segments: [
        seg({ id: 's1', lineup: ['p1', 'p2', 'p3', 'p4', 'p6'], classSum: 14 }),
        seg({ id: 's2' }),
      ],
    });
    expect(replayCorrectionLog(other, a1.corrections ?? [], 0)).toBeNull();
  });

  it('lineage: cloud met lineupcorrectie loopt voor op de lokale basis; ongelijke logs blijven diverged', () => {
    const cloud = correct(base(), 'c-1', 's1', { lineup: NEW_LINEUP });
    expect(compareCorrectionLineage(base(), cloud)).toBe('cloud-ahead');
    expect(compareCorrectionLineage(cloud, base())).toBe('local-ahead');
    // Apparaat B corrigeerde onafhankelijk een ander segment: nooit samenvoegen.
    const local = correct(base(), 'c-b', 's2', { pf: 9 }, '2026-02-03T09:00:00.000Z');
    expect(compareCorrectionLineage(local, cloud)).toBe('diverged');
    expect(compareCorrectionLineage(cloud, local)).toBe('diverged');
  });
});

type CorrectCall = Parameters<CompletedGameCorrectionWriter['correctCompletedGame']>;
type CloudOnNext = Parameters<CloudCompletedGameSource['subscribe']>[0];

function harness(
  local: CompletedGame[],
  result: CompletedGameCorrectionResult = { ok: true, revision: 1 },
) {
  const storage = new MemoryStorage();
  storage.setItem(completedGamesStorageKey('org-1', 'team-1'), JSON.stringify(local));
  const localRepo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
  let onNext: CloudOnNext | null = null;
  const cloud: CloudCompletedGameSource = {
    subscribe(cb) {
      onNext = cb;
      return () => undefined;
    },
  };
  const calls: CorrectCall[] = [];
  const writer: CompletedGameTombstoneWriter & CompletedGameCorrectionWriter = {
    tombstoneCompletedGame: vi.fn(async () => ({ ok: true })),
    correctCompletedGame: vi.fn(async (...args: CorrectCall) => {
      calls.push(args);
      return result;
    }),
  };
  const repo = new CompositeCompletedGameRepository(localRepo, cloud, writer);
  repo.subscribe(() => undefined);
  const emit = (games: CompletedGame[]) => {
    (onNext as CloudOnNext | null)?.(games, SERVER);
  };
  return { repo, localRepo, calls, emit };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('CompositeCompletedGameRepository: lineupcorrectie (PR 7.7c)', () => {
  it('uploadt een lokale lineupcorrectie met lineup/allowed en spelerindexen, op de cloudrevisie', async () => {
    const h = harness([base()]);
    h.emit([base()]);
    expect(h.repo.update(correct(base(), 'c-1', 's1', { lineup: NEW_LINEUP }))).toBe(true);
    await flush();
    expect(h.calls).toHaveLength(1);
    const [, , id, expectedRevision, payload] = h.calls[0] as CorrectCall;
    expect([id, expectedRevision]).toEqual(['cg-1', 0]);
    expect(payload.correction).toMatchObject({
      id: 'c-1',
      segmentId: 's1',
      segmentIndex: 0,
      before: { lineup: ['p1', 'p2', 'p3', 'p4', 'p5'], allowed: 14.5 },
      after: { lineup: NEW_LINEUP, allowed: 15.5 },
      lineupPlayerIndexes: [0, 1, 2, 3, 5],
    });
    expect(payload.segments[1]).toMatchObject({ id: 's2', lineup: ['p1', 'p2', 'p3', 'p4', 'p5'] });
  });

  it('tweede apparaat: een cloudkopie met lineupcorrectie werkt de lokale kopie bij (cloud-ahead)', () => {
    const h = harness([base()]);
    const cloudGame = correct(base(), 'c-1', 's1', { lineup: NEW_LINEUP });
    h.emit([cloudGame]);
    const visible = h.repo.list()[0];
    expect(visible?.segments[0]?.lineup).toEqual(NEW_LINEUP);
    expect(h.localRepo.list()[0]?.segments[0]?.lineup).toEqual(NEW_LINEUP);
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('gesynchroniseerd');
  });

  it('lineupcorrectie op apparaat A, scorecorrectie op B (volgend op A): alleen de staart wordt geüpload', async () => {
    const cloudGame = correct(base(), 'c-1', 's1', { lineup: NEW_LINEUP });
    const local = correct(cloudGame, 'c-2', 's2', { pf: 9 }, '2026-02-03T09:00:00.000Z');
    const h = harness([cloudGame]);
    // Apparaat B kent de lineupcorrectie van A al en voegt bewust een eigen correctie toe.
    h.repo.update(local);
    h.emit([cloudGame]);
    await flush();
    expect(h.calls).toHaveLength(1);
    const [, , , expectedRevision, payload] = h.calls[0] as CorrectCall;
    expect(expectedRevision).toBe(1);
    expect(payload.correction.id).toBe('c-2');
    expect(payload.correction).not.toHaveProperty('lineupPlayerIndexes');
    expect(payload.segments[0]).toMatchObject({ lineup: NEW_LINEUP, allowed: 15.5 });
  });

  it('diverged blijft diverged: twee apparaten corrigeerden onafhankelijk, niets geüpload of overschreven', async () => {
    const cloudGame = correct(base(), 'c-a', 's1', { lineup: NEW_LINEUP });
    const local = correct(base(), 'c-b', 's2', { pf: 9 }, '2026-02-03T09:00:00.000Z');
    const h = harness([local]);
    h.emit([cloudGame]);
    await flush();
    expect(h.calls).toHaveLength(0);
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('conflict');
    expect(h.localRepo.list()[0]?.corrections?.map((c) => c.id)).toEqual(['c-b']);
    expect(h.localRepo.list()[0]?.segments[0]?.lineup).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });
});
