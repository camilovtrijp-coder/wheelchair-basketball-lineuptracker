import { describe, it, expect, vi } from 'vitest';
import {
  CompositeCompletedGameRepository,
  type CompletedGameTombstoneWriter,
} from '../../src/infrastructure/game/CompositeCompletedGameRepository';
import type { CloudCompletedGameSource } from '../../src/infrastructure/game/FirestoreCompletedGameRepository';
import type {
  CompletedGameRepository,
  CompletedGamesReadResult,
} from '../../src/application/game/CompletedGameRepository';
import type { CompletedGame } from '../../src/domain/game/types';
import type { SyncState } from '../../src/domain/syncState';

function completedGame(overrides: Partial<CompletedGame> = {}): CompletedGame {
  return {
    id: 'g1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'active-1',
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
    ...overrides,
  };
}

/** Bestuurbare fake voor de tombstone-schrijfmethode — `mode` bepaalt of de
 * "server" de patch accepteert of weigert, `calls` bewijst welke argumenten
 * de composite doorgeeft. */
class FakeCloudWriter implements CompletedGameTombstoneWriter {
  public mode: 'ok' | 'error' = 'ok';
  public calls: Array<{
    organizationId: string;
    teamId: string;
    completedGameId: string;
    deletedBy: string;
    expectedRevision: number;
  }> = [];

  async tombstoneCompletedGame(
    organizationId: string,
    teamId: string,
    completedGameId: string,
    deletedBy: string,
    expectedRevision: number,
  ) {
    this.calls.push({ organizationId, teamId, completedGameId, deletedBy, expectedRevision });
    if (this.mode === 'error') return { ok: false, error: new Error('rejected') };
    return { ok: true, revision: expectedRevision + 1 };
  }
}

const SYNCED: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };

/** In-memory stand-in voor `LocalStorageCompletedGameRepository`, zodat deze
 * tests puur de samenvoeglogica van de composite toetsen, niet localStorage. */
class FakeLocalRepo implements CompletedGameRepository {
  public games: CompletedGame[] = [];
  public status: CompletedGamesReadResult['status'] = 'ok';

  list(): CompletedGame[] {
    return this.games;
  }

  safeList(): CompletedGamesReadResult {
    return { status: this.status, games: this.status === 'error' ? [] : this.games };
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
}

/** Bestuurbare cloudbron: `emit()`/`emitError()` sturen de laatst-geregistreerde
 * `subscribe()`-callback aan, net als een echte Firestore `onSnapshot`. */
class FakeCloudSource implements CloudCompletedGameSource {
  private onNext: ((games: CompletedGame[], sync: SyncState) => void) | null = null;
  private onError: ((error: unknown) => void) | null = null;
  public unsubscribeCount = 0;

  subscribe(
    onNext: (games: CompletedGame[], sync: SyncState) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    this.onNext = onNext;
    this.onError = onError ?? null;
    return () => {
      this.unsubscribeCount += 1;
    };
  }

  emit(games: CompletedGame[], sync: SyncState = SYNCED): void {
    this.onNext?.(games, sync);
  }

  emitError(error: unknown): void {
    this.onError?.(error);
  }
}

describe('CompositeCompletedGameRepository — merge/dedupe', () => {
  it('list() geeft lokale games terug wanneer de cloud nog niets heeft gestuurd', () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'local-1' }));
    const repo = new CompositeCompletedGameRepository(
      local,
      new FakeCloudSource(),
      new FakeCloudWriter(),
    );
    expect(repo.list().map((g) => g.id)).toEqual(['local-1']);
  });

  it('voegt een cloud-only item toe (afgerond op een ander apparaat)', () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'local-1', date: '2026-01-02T00:00:00.000Z' }));
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
    repo.subscribe(() => undefined);
    cloud.emit([completedGame({ id: 'cloud-1', date: '2026-01-01T00:00:00.000Z' })]);
    expect(repo.list().map((g) => g.id)).toEqual(['local-1', 'cloud-1']);
  });

  it('dedupliceert op id en laat de lokale versie winnen', () => {
    const local = new FakeLocalRepo();
    const localVersion = completedGame({ id: 'shared', opponent: 'Lokale versie' });
    local.add(localVersion);
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
    repo.subscribe(() => undefined);
    cloud.emit([completedGame({ id: 'shared', opponent: 'Cloudversie' })]);
    const merged = repo.list();
    expect(merged).toHaveLength(1);
    expect(merged[0]!.opponent).toBe('Lokale versie');
  });

  it('sorteert de samengevoegde lijst op datum aflopend (nieuwste eerst)', () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'oud-lokaal', date: '2026-01-01T00:00:00.000Z' }));
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
    repo.subscribe(() => undefined);
    cloud.emit([completedGame({ id: 'nieuw-cloud', date: '2026-02-01T00:00:00.000Z' })]);
    expect(repo.list().map((g) => g.id)).toEqual(['nieuw-cloud', 'oud-lokaal']);
  });

  it('een lokale leesfout levert status "error" met een lege lijst, ook als de cloud games heeft', () => {
    const local = new FakeLocalRepo();
    local.status = 'error';
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
    repo.subscribe(() => undefined);
    cloud.emit([completedGame({ id: 'cloud-1' })]);
    expect(repo.safeList()).toEqual({ status: 'error', games: [] });
  });

  it('status blijft "missing" wanneer zowel lokaal als cloud leeg zijn', () => {
    const local = new FakeLocalRepo();
    local.status = 'missing';
    const repo = new CompositeCompletedGameRepository(
      local,
      new FakeCloudSource(),
      new FakeCloudWriter(),
    );
    expect(repo.safeList()).toEqual({ status: 'missing', games: [] });
  });
});

describe('CompositeCompletedGameRepository — add/remove/replaceAll delegeren naar lokaal', () => {
  it('add() slaat lokaal op en meldt abonnees', () => {
    const local = new FakeLocalRepo();
    const repo = new CompositeCompletedGameRepository(
      local,
      new FakeCloudSource(),
      new FakeCloudWriter(),
    );
    const seen: CompletedGamesReadResult[] = [];
    repo.subscribe((result) => seen.push(result));
    const ok = repo.add(completedGame({ id: 'new-1' }));
    expect(ok).toBe(true);
    expect(local.games.map((g) => g.id)).toEqual(['new-1']);
    expect(seen.at(-1)?.games.map((g) => g.id)).toEqual(['new-1']);
  });

  it('remove() verwijdert uitsluitend lokaal (het echte cloud-verwijderpad is tombstone(), zie hieronder)', () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'to-remove' }));
    const repo = new CompositeCompletedGameRepository(
      local,
      new FakeCloudSource(),
      new FakeCloudWriter(),
    );
    expect(repo.remove('to-remove')).toBe(true);
    expect(local.games).toHaveLength(0);
  });

  it('replaceAll() delegeert naar lokaal', () => {
    const local = new FakeLocalRepo();
    const repo = new CompositeCompletedGameRepository(
      local,
      new FakeCloudSource(),
      new FakeCloudWriter(),
    );
    const games = [completedGame({ id: 'a' }), completedGame({ id: 'b' })];
    expect(repo.replaceAll(games)).toBe(true);
    expect(local.games).toEqual(games);
  });
});

describe('CompositeCompletedGameRepository — subscribe', () => {
  it('roept onNext synchroon en direct aan met de actuele safeList()-uitkomst', () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'local-1' }));
    const repo = new CompositeCompletedGameRepository(
      local,
      new FakeCloudSource(),
      new FakeCloudWriter(),
    );
    const onNext = vi.fn();
    repo.subscribe(onNext);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext.mock.calls[0]![0].games.map((g: CompletedGame) => g.id)).toEqual(['local-1']);
    expect(onNext.mock.calls[0]![1]).toBeNull();
  });

  it('meldt alle geregistreerde abonnees bij een cloud-update, met de bijbehorende SyncState', () => {
    const local = new FakeLocalRepo();
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
    const seenA: Array<SyncState | null> = [];
    const seenB: Array<SyncState | null> = [];
    repo.subscribe((_r, sync) => seenA.push(sync));
    repo.subscribe((_r, sync) => seenB.push(sync));
    const pendingSync: SyncState = {
      status: 'lokaal-beschikbaar',
      fromCache: true,
      hasPendingWrites: false,
    };
    cloud.emit([], pendingSync);
    expect(seenA.at(-1)).toEqual(pendingSync);
    expect(seenB.at(-1)).toEqual(pendingSync);
  });

  it('start de cloud-subscribe maar één keer voor meerdere abonnees, en stopt hem pas als de laatste zich afmeldt', () => {
    const local = new FakeLocalRepo();
    const cloud = new FakeCloudSource();
    const subscribeSpy = vi.spyOn(cloud, 'subscribe');
    const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
    const unsubA = repo.subscribe(() => undefined);
    repo.subscribe(() => undefined);
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    unsubA();
    expect(cloud.unsubscribeCount).toBe(0);
  });

  it('geeft een cloud-queryfout door aan de onError van elke abonnee', () => {
    const local = new FakeLocalRepo();
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
    const onErrorA = vi.fn();
    const onErrorB = vi.fn();
    repo.subscribe(() => undefined, onErrorA);
    repo.subscribe(() => undefined, onErrorB);
    const failure = new Error('permission-denied');
    cloud.emitError(failure);
    expect(onErrorA).toHaveBeenCalledWith(failure);
    expect(onErrorB).toHaveBeenCalledWith(failure);
  });

  it(
    'externe review PR #64 (plan §C 7.2b werk 5, "ongecachete context"): een cloudquery-' +
      'fout (bijv. een malformed serverdocument of een ingetrokken membership) laat de ' +
      'lokale historie gewoon zichtbaar in list()/safeList() — een leesfout is nooit ' +
      'gelijk aan lege historie',
    () => {
      const local = new FakeLocalRepo();
      local.add(completedGame({ id: 'local-1' }));
      local.add(completedGame({ id: 'local-2' }));
      const cloud = new FakeCloudSource();
      const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
      const results: CompletedGamesReadResult[] = [];
      repo.subscribe((result) => results.push(result));
      cloud.emitError(new Error('permission-denied (revoked membership)'));
      const last = results.at(-1)!;
      expect(last.status).toBe('ok');
      expect(last.games.map((g) => g.id).sort()).toEqual(['local-1', 'local-2']);
    },
  );

  it(
    'plan §C 7.2b werk 5 ("offline cached history"): een cache-only cloud-emissie ' +
      '(fromCache:true) levert toch de samengevoegde lijst en geeft fromCache door, zodat ' +
      'de UI cache-/serveractualiteit kan tonen',
    () => {
      const local = new FakeLocalRepo();
      local.add(completedGame({ id: 'local-1', date: '2026-01-01T00:00:00.000Z' }));
      const cloud = new FakeCloudSource();
      const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
      let lastSync: SyncState | null = null;
      let lastGames: string[] = [];
      repo.subscribe((result, sync) => {
        lastSync = sync;
        lastGames = result.games.map((g) => g.id);
      });
      const cachedOffline: SyncState = {
        status: 'lokaal-beschikbaar',
        fromCache: true,
        hasPendingWrites: false,
      };
      cloud.emit(
        [completedGame({ id: 'cloud-cached-1', date: '2026-01-02T00:00:00.000Z' })],
        cachedOffline,
      );
      expect(lastSync).toEqual(cachedOffline);
      expect(lastGames.sort()).toEqual(['cloud-cached-1', 'local-1']);
    },
  );

  it('stopt de cloud-subscribe zodra de laatste abonnee zich afmeldt', () => {
    const local = new FakeLocalRepo();
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
    const unsub = repo.subscribe(() => undefined);
    unsub();
    expect(cloud.unsubscribeCount).toBe(1);
  });
});

// PR 7.2c (docs/pr-7.2-plan.md §C 7.2c werk 1/2) — tombstone() en
// resurrectie-preventie.
describe('CompositeCompletedGameRepository — tombstone() (PR 7.2c)', () => {
  it("geeft 'not-synced' terug als er nog geen cloud-tegenhanger bekend is (nooit gepatcht)", async () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'not-yet-synced' }));
    const writer = new FakeCloudWriter();
    const repo = new CompositeCompletedGameRepository(local, new FakeCloudSource(), writer);
    const result = await repo.tombstone('not-yet-synced', 'uid-alice');
    expect(result).toBe('not-synced');
    expect(writer.calls).toHaveLength(0);
    expect(local.games.map((g) => g.id)).toEqual(['not-yet-synced']);
  });

  it("patcht de cloudkant met de bekende revisie en geeft 'ok' terug bij een server-bevestigd item", async () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'synced-1', revision: 3 }));
    const cloud = new FakeCloudSource();
    const writer = new FakeCloudWriter();
    const repo = new CompositeCompletedGameRepository(local, cloud, writer);
    repo.subscribe(() => undefined);
    cloud.emit([completedGame({ id: 'synced-1', revision: 3 })]);

    const result = await repo.tombstone('synced-1', 'uid-alice');
    expect(result).toBe('ok');
    expect(writer.calls).toEqual([
      {
        organizationId: 'org-1',
        teamId: 'team-1',
        completedGameId: 'synced-1',
        deletedBy: 'uid-alice',
        expectedRevision: 3,
      },
    ]);
  });

  it('ruimt de lokale kopie proactief op na een geslaagde tombstone', async () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'synced-1' }));
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
    repo.subscribe(() => undefined);
    cloud.emit([completedGame({ id: 'synced-1' })]);

    await repo.tombstone('synced-1', 'uid-alice');
    expect(local.games).toHaveLength(0);
  });

  it("geeft 'error' terug en laat de lokale kopie ONGEMOEID als de serverpatch faalt", async () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'synced-1' }));
    const cloud = new FakeCloudSource();
    const writer = new FakeCloudWriter();
    writer.mode = 'error';
    const repo = new CompositeCompletedGameRepository(local, cloud, writer);
    repo.subscribe(() => undefined);
    cloud.emit([completedGame({ id: 'synced-1' })]);

    const result = await repo.tombstone('synced-1', 'uid-alice');
    expect(result).toBe('error');
    expect(local.games.map((g) => g.id)).toEqual(['synced-1']);
  });
});

describe('CompositeCompletedGameRepository — resurrectie-preventie (PR 7.2c)', () => {
  it('filtert een getombstoned cloud-item altijd uit de zichtbare lijst, ook met een niet-getombstoned lokale kopie', () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'shared', revision: 0, deletedAt: null }));
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
    repo.subscribe(() => undefined);
    cloud.emit([
      completedGame({
        id: 'shared',
        revision: 1,
        deletedAt: '2026-01-05T00:00:00.000Z',
        deletedBy: 'uid-alice',
      }),
    ]);
    expect(repo.list().map((g) => g.id)).toEqual([]);
  });

  it("ruimt een lokale kopie op zodra een binnenkomende cloud-snapshot 'm als getombstoned toont (late/offline client leert de tombstone)", () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'stale-local', deletedAt: null }));
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
    repo.subscribe(() => undefined);
    cloud.emit([
      completedGame({
        id: 'stale-local',
        revision: 1,
        deletedAt: '2026-01-05T00:00:00.000Z',
        deletedBy: 'uid-alice',
      }),
    ]);
    expect(local.games).toHaveLength(0);
  });

  it('een niet-getombstoned cloud-item blijft gewoon zichtbaar naast een getombstoned ander item', () => {
    const local = new FakeLocalRepo();
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
    repo.subscribe(() => undefined);
    cloud.emit([
      completedGame({ id: 'still-here', date: '2026-01-02T00:00:00.000Z' }),
      completedGame({
        id: 'gone',
        date: '2026-01-01T00:00:00.000Z',
        deletedAt: '2026-01-05T00:00:00.000Z',
        deletedBy: 'uid-alice',
      }),
    ]);
    expect(repo.list().map((g) => g.id)).toEqual(['still-here']);
  });
});

// PR 7.2c, externe review op PR #65 (P1 — "een late client verliest zijn
// lokale bron niet stil"): `subscribe()`'s derde, optionele `onNext`-
// argument moet exact de ID's dragen die dit apparaat OP DEZE notificatie
// voor het eerst als getombstoned leerde terwijl het zelf nog een lokale
// kopie had — nooit gevuld op een andere notificatie.
describe('CompositeCompletedGameRepository — "niet stil" tombstone-notificatie (PR 7.2c)', () => {
  it('geeft de ID door als de eerste cloud-snapshot direct een tombstone toont voor een lokaal item', () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'stale-local' }));
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
    const calls: Array<readonly string[] | undefined> = [];
    repo.subscribe((_r, _s, removed) => calls.push(removed));
    cloud.emit([
      completedGame({
        id: 'stale-local',
        deletedAt: '2026-01-05T00:00:00.000Z',
        deletedBy: 'uid-alice',
      }),
    ]);
    expect(calls).toEqual([undefined, ['stale-local']]);
  });

  it('geeft GEEN ID door voor een getombstoned cloud-item dat dit apparaat nooit lokaal had', () => {
    const local = new FakeLocalRepo();
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
    const calls: Array<readonly string[] | undefined> = [];
    repo.subscribe((_r, _s, removed) => calls.push(removed));
    cloud.emit([
      completedGame({
        id: 'never-local',
        deletedAt: '2026-01-05T00:00:00.000Z',
        deletedBy: 'uid-alice',
      }),
    ]);
    expect(calls).toEqual([undefined, undefined]);
  });

  it('geeft GEEN ID meer door op een VOLGENDE, ongewijzigde cloud-snapshot (alleen op de transitie zelf)', () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'stale-local' }));
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
    const calls: Array<readonly string[] | undefined> = [];
    repo.subscribe((_r, _s, removed) => calls.push(removed));
    const tombstoned = completedGame({
      id: 'stale-local',
      deletedAt: '2026-01-05T00:00:00.000Z',
      deletedBy: 'uid-alice',
    });
    cloud.emit([tombstoned]);
    cloud.emit([tombstoned]);
    expect(calls).toEqual([undefined, ['stale-local'], undefined]);
  });

  it('geeft GEEN ID door bij een eigen tombstone()-aanroep (dat is geen "late"/verrassende leergebeurtenis)', async () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'synced-1' }));
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud, new FakeCloudWriter());
    const calls: Array<readonly string[] | undefined> = [];
    repo.subscribe((_r, _s, removed) => calls.push(removed));
    cloud.emit([completedGame({ id: 'synced-1' })]);
    await repo.tombstone('synced-1', 'uid-alice');
    expect(calls.every((c) => c === undefined)).toBe(true);
  });
});
