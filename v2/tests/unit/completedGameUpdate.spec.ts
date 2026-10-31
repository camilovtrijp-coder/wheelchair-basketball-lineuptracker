import { describe, it, expect } from 'vitest';
import {
  completedGamesStorageKey,
  LocalStorageCompletedGameRepository,
} from '../../src/infrastructure/game/LocalStorageCompletedGameRepository';
import { CompositeCompletedGameRepository } from '../../src/infrastructure/game/CompositeCompletedGameRepository';
import type { CloudCompletedGameSource } from '../../src/infrastructure/game/FirestoreCompletedGameRepository';
import type { KeyValueStorage } from '../../src/i18n/persistence';
import type { CompletedGame, Segment } from '../../src/domain/game/types';
import { MAX_CORRECTIONS } from '../../src/domain/game/types';
import { correctSegment } from '../../src/domain/game/correction';

// PR 7.5a: CompletedGameRepository.update() — lokaal pad (fictieve data).

class MemoryStorage implements KeyValueStorage {
  public readonly store = new Map<string, string>();
  public failNextWrite = false;
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('quota exceeded');
    }
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
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

function game(overrides: Partial<CompletedGame> = {}): CompletedGame {
  return {
    id: 'cg-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'src-1',
    opponent: 'Fictief Team',
    competition: '',
    date: '2026-01-01T10:00:00.000Z',
    players: [],
    segments: [
      seg({ id: 's1' }),
      seg({ id: 's2', beginSec: 420, endSec: 180, durSec: 240, pf: 8, pa: 6, tov: 1 }),
    ],
    scoreFor: 14,
    scoreAgainst: 10,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: true,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

function corrected(base: CompletedGame, patch = { endSec: 300, pf: 9, tov: 3 }): CompletedGame {
  const r = correctSegment(base, 's1', patch, 'uid-1');
  if (!r.ok) throw new Error('verwacht ok');
  return r.game;
}

function setup(initial: CompletedGame[] = [game()]): {
  storage: MemoryStorage;
  repo: LocalStorageCompletedGameRepository;
  key: string;
} {
  const storage = new MemoryStorage();
  const key = completedGamesStorageKey('org-1', 'team-1');
  storage.setItem(key, JSON.stringify(initial));
  return {
    storage,
    repo: new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1'),
    key,
  };
}

describe('LocalStorageCompletedGameRepository.update — correctie opslaan', () => {
  it('slaat een gecorrigeerde wedstrijd op, op dezelfde plek in de lijst, zonder key-wijziging', () => {
    const other = game({ id: 'cg-2', sourceGameId: 'src-2' });
    const { repo, storage, key } = setup([other, game()]);
    const keysBefore = [...storage.store.keys()];
    expect(repo.update(corrected(game()))).toBe(true);
    const list = repo.list();
    expect(list.map((g) => g.id)).toEqual(['cg-2', 'cg-1']);
    expect(list[0]).toEqual(other);
    const updated = list[1] as CompletedGame;
    expect(updated.scoreFor).toBe(17);
    expect(updated.revision).toBe(1);
    expect(updated.segments[0]).toMatchObject({ durSec: 300, endSec: 300, pf: 9, tov: 3 });
    expect(updated.corrections).toHaveLength(1);
    expect([...storage.store.keys()]).toEqual(keysBefore);
    expect(key).toBe('lineup-tracker-v2-completed-games:org-1:team-1');
  });

  it('neemt alleen correctievelden over: id, sourceGameId, spelers, datum, tegenstander blijven', () => {
    const { repo } = setup();
    const tampered: CompletedGame = {
      ...corrected(game()),
      sourceGameId: 'ander',
      opponent: 'Gewijzigd',
      date: '2030-01-01T00:00:00.000Z',
      competition: 'X',
      quarterCount: 9,
      deletedAt: '2026-05-01T00:00:00.000Z',
      deletedBy: 'u',
    };
    expect(repo.update(tampered)).toBe(true);
    const stored = repo.list()[0] as CompletedGame;
    expect(stored).toMatchObject({
      id: 'cg-1',
      sourceGameId: 'src-1',
      opponent: 'Fictief Team',
      date: '2026-01-01T10:00:00.000Z',
      competition: '',
      quarterCount: 4,
      deletedAt: null,
      deletedBy: null,
      scoreFor: 17,
    });
  });

  it('een tweede correctie op een al gecorrigeerde wedstrijd lukt (revisie 2)', () => {
    const { repo } = setup();
    const first = corrected(game());
    expect(repo.update(first)).toBe(true);
    const r = correctSegment(first, 's2', { tov: 0 }, null);
    if (!r.ok) throw new Error('verwacht ok');
    expect(repo.update(r.game)).toBe(true);
    expect(repo.list()[0]?.revision).toBe(2);
    expect(repo.list()[0]?.corrections).toHaveLength(2);
  });
});

describe('LocalStorageCompletedGameRepository.update — weigeringen laten opslag ongemoeid', () => {
  function expectRejected(
    initial: CompletedGame[],
    attempt: CompletedGame,
    repoOverride?: (storage: MemoryStorage) => LocalStorageCompletedGameRepository,
  ): void {
    const { repo, storage, key } = setup(initial);
    const before = storage.store.get(key);
    const target = repoOverride ? repoOverride(storage) : repo;
    expect(target.update(attempt)).toBe(false);
    expect(storage.store.get(key)).toBe(before);
  }

  it('onbekend id', () => {
    expectRejected([game()], corrected(game({ id: 'onbekend' })));
  });

  it('ander team of andere organisatie', () => {
    expectRejected([game()], { ...corrected(game()), teamId: 'team-2' });
    expectRejected([game()], { ...corrected(game()), organizationId: 'org-2' });
  });

  it('wedstrijd van een ander team in dezelfde repository-instantie wordt niet bijgewerkt', () => {
    const storage = new MemoryStorage();
    const otherKey = completedGamesStorageKey('org-1', 'team-2');
    const otherGame = game({ teamId: 'team-2' });
    storage.setItem(otherKey, JSON.stringify([otherGame]));
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    expect(repo.update(corrected(otherGame))).toBe(false);
    expect(storage.store.get(otherKey)).toBe(JSON.stringify([otherGame]));
  });

  it('opslagfout bij schrijven geeft false en laat bestaande data ongemoeid', () => {
    const { repo, storage, key } = setup();
    const before = storage.store.get(key);
    storage.failNextWrite = true;
    expect(repo.update(corrected(game()))).toBe(false);
    expect(storage.store.get(key)).toBe(before);
    expect(repo.update(corrected(game()))).toBe(true);
  });

  it('onleesbare opslag (corrupte JSON) wordt niet overschreven', () => {
    const { repo, storage, key } = setup();
    storage.store.set(key, '{kapot');
    expect(repo.update(corrected(game()))).toBe(false);
    expect(storage.store.get(key)).toBe('{kapot');
  });

  it('getombstoned opgeslagen wedstrijd', () => {
    expectRejected(
      [game({ deletedAt: '2026-01-02T00:00:00.000Z', deletedBy: 'u' })],
      corrected(game()),
    );
  });

  it('revisie niet hoger dan de opgeslagen revisie', () => {
    expectRejected([game()], { ...corrected(game()), revision: 0 });
    const stored = corrected(game());
    expectRejected([stored], { ...stored });
  });

  it('afwijkende segmentstructuur: ander aantal, ander id, andere lineup, andere classificatie', () => {
    const good = corrected(game());
    const [s1, s2] = good.segments as [Segment, Segment];
    expectRejected([game()], { ...good, segments: [s1] });
    expectRejected([game()], { ...good, segments: [s1, { ...s2, id: 'zzz' }] });
    expectRejected([game()], {
      ...good,
      segments: [s1, { ...s2, lineup: ['p1', 'p2', 'p3', 'p4', 'p9'] }],
    });
    expectRejected([game()], { ...good, segments: [{ ...s1, classSum: 99 }, s2] });
    expectRejected([game()], { ...good, segments: [{ ...s1, over: false }, s2] });
  });

  it('inconsistente of niet-positieve durSec', () => {
    const good = corrected(game());
    const [s1, s2] = good.segments as [Segment, Segment];
    expectRejected([game()], { ...good, segments: [{ ...s1, durSec: 1 }, s2] });
    expectRejected([game()], {
      ...good,
      segments: [{ ...s1, beginSec: 100, endSec: 100, durSec: 0 }, s2],
    });
  });

  it('correctielog dat verdwijnt, krimt of de limiet overschrijdt', () => {
    const good = corrected(game());
    expectRejected([game()], { ...good, corrections: undefined });
    expectRejected([good], {
      ...corrected(good, { endSec: 200, pf: 9, tov: 3 }),
      corrections: [],
    });
    const entry = good.corrections?.[0];
    if (!entry) throw new Error('verwacht logitem');
    expectRejected([game()], {
      ...good,
      corrections: Array.from({ length: MAX_CORRECTIONS + 1 }, () => entry),
    });
  });
});

describe('LocalStorageCompletedGameRepository.update — sterkere invarianten (review)', () => {
  it('niet-gecorrigeerd segment zonder tov blijft zonder tov (byte-identiek)', () => {
    const { tov: _tov, ...noTov } = seg({ id: 's2', beginSec: 420, endSec: 180, durSec: 240 });
    void _tov;
    const base = game({ segments: [seg({ id: 's1' }), noTov], scoreFor: 12, scoreAgainst: 8 });
    const { repo, storage, key } = setup([base]);
    expect(repo.update(corrected(base))).toBe(true);
    const stored = JSON.parse(storage.store.get(key) as string) as CompletedGame[];
    const s2 = stored[0]?.segments[1] as Segment;
    expect('tov' in s2).toBe(false);
    expect(JSON.stringify(s2)).toBe(JSON.stringify(noTov));
  });

  it('vervalste score met hogere revisie wordt geweigerd', () => {
    expectRejectedLocal({ ...corrected(game()), scoreFor: 99, revision: 7 });
    expectRejectedLocal({ ...corrected(game()), scoreAgainst: 0 });
  });

  it('niet-gelogd gewijzigd segment (pf/pa/tov/tijd/kwart) wordt geweigerd', () => {
    const good = corrected(game());
    const [s1, s2] = good.segments as [Segment, Segment];
    expectRejectedLocal({ ...good, segments: [s1, { ...s2, pf: s2.pf + 1 }] });
    expectRejectedLocal({ ...good, segments: [s1, { ...s2, tov: 9 }] });
    expectRejectedLocal({ ...good, segments: [s1, { ...s2, quarter: 2 }] });
    expectRejectedLocal({ ...good, segments: [s1, { ...s2, endSec: 100, durSec: 320 }] });
  });

  it('log dat een ander dan het toegevoegde item wijzigt, of een ongeldig item toevoegt, wordt geweigerd', () => {
    const first = corrected(game());
    const second = correctSegment(first, 's2', { tov: 0 }, null);
    if (!second.ok) throw new Error('verwacht ok');
    const log = second.game.corrections ?? [];
    const e0 = log[0];
    if (!e0) throw new Error('verwacht item');
    // opgeslagen item gewijzigd
    expectRejectedLocal(
      { ...second.game, corrections: [{ ...e0, after: { ...e0.after, pf: 1 } }, ...log.slice(1)] },
      [first],
    );
    // nieuw item met afwijkende before
    const e1 = log[1];
    if (!e1) throw new Error('verwacht item');
    expectRejectedLocal(
      { ...second.game, corrections: [e0, { ...e1, before: { ...e1.before, pf: 5 } }] },
      [first],
    );
    // nieuw item met onbekend segment
    expectRejectedLocal({ ...second.game, corrections: [e0, { ...e1, segmentId: 'x' }] }, [first]);
    // log gelijk gebleven (geen groei)
    expectRejectedLocal({ ...first, revision: 5 }, [first]);
  });

  it('correctie van alleen pf op een segment met oude data (beginSec 720) wordt geaccepteerd', () => {
    const oldSeg = seg({ id: 's1', beginSec: 720, endSec: 420, durSec: 300 });
    const base = game({ segments: [oldSeg, game().segments[1] as Segment], scoreFor: 14 });
    const next = correctSegment(base, 's1', { pf: 9 }, null);
    if (!next.ok) throw new Error('verwacht ok');
    const { repo } = setup([base]);
    expect(repo.update(next.game)).toBe(true);
    expect(repo.list()[0]?.segments[0]).toMatchObject({ beginSec: 720, pf: 9 });
    expect(repo.list()[0]?.scoreFor).toBe(17);
  });

  it('ondersteunt een cloudkopie met meerdere extra logitems, hogere revisie en segmentIndex', () => {
    const one = corrected(game());
    const two = correctSegment(one, 's2', { tov: 0 }, null);
    if (!two.ok) throw new Error('verwacht ok');
    const withIndex = {
      ...two.game,
      revision: 5,
      corrections: two.game.corrections?.map((c, i) => ({ ...c, segmentIndex: i })),
    } as CompletedGame;
    const { repo } = setup();
    expect(repo.update(withIndex)).toBe(true);
    expect(repo.list()[0]?.revision).toBe(5);
    expect(repo.list()[0]?.corrections).toHaveLength(2);
    expect(repo.list()[0]?.scoreFor).toBe(17);
  });
});

function expectRejectedLocal(attempt: CompletedGame, initial: CompletedGame[] = [game()]): void {
  const { repo, storage, key } = setup(initial);
  const before = storage.store.get(key);
  expect(repo.update(attempt)).toBe(false);
  expect(storage.store.get(key)).toBe(before);
}

describe('CompositeCompletedGameRepository.update — alleen lokaal pad', () => {
  function composite(): {
    repo: CompositeCompletedGameRepository;
    local: LocalStorageCompletedGameRepository;
    notifications: number[];
  } {
    const storage = new MemoryStorage();
    storage.setItem(completedGamesStorageKey('org-1', 'team-1'), JSON.stringify([game()]));
    const local = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    const cloud: CloudCompletedGameSource = {
      subscribe: () => () => undefined,
    } as unknown as CloudCompletedGameSource;
    const repo = new CompositeCompletedGameRepository(local, cloud, {
      tombstoneCompletedGame: () => Promise.reject(new Error('geen cloud in 7.5a')),
    });
    const notifications: number[] = [];
    repo.subscribe((result) => notifications.push(result.games.length));
    return { repo, local, notifications };
  }

  it('delegeert naar lokaal, meldt de nieuwe lijst en raakt geen cloudwriter aan', () => {
    const { repo, local, notifications } = composite();
    expect(repo.update(corrected(game()))).toBe(true);
    expect(local.list()[0]?.revision).toBe(1);
    expect(repo.list()[0]?.scoreFor).toBe(17);
    expect(notifications.length).toBe(2); // mount + update
  });

  it('een geweigerde update meldt niets en geeft false', () => {
    const { repo, notifications } = composite();
    expect(repo.update({ ...corrected(game()), revision: 0 })).toBe(false);
    expect(notifications.length).toBe(1);
  });
});
