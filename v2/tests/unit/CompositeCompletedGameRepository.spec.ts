import { describe, it, expect, vi } from 'vitest';
import { CompositeCompletedGameRepository } from '../../src/infrastructure/game/CompositeCompletedGameRepository';
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
    ...overrides,
  };
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
    const repo = new CompositeCompletedGameRepository(local, new FakeCloudSource());
    expect(repo.list().map((g) => g.id)).toEqual(['local-1']);
  });

  it('voegt een cloud-only item toe (afgerond op een ander apparaat)', () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'local-1', date: '2026-01-02T00:00:00.000Z' }));
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud);
    repo.subscribe(() => undefined);
    cloud.emit([completedGame({ id: 'cloud-1', date: '2026-01-01T00:00:00.000Z' })]);
    expect(repo.list().map((g) => g.id)).toEqual(['local-1', 'cloud-1']);
  });

  it('dedupliceert op id en laat de lokale versie winnen', () => {
    const local = new FakeLocalRepo();
    const localVersion = completedGame({ id: 'shared', opponent: 'Lokale versie' });
    local.add(localVersion);
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud);
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
    const repo = new CompositeCompletedGameRepository(local, cloud);
    repo.subscribe(() => undefined);
    cloud.emit([completedGame({ id: 'nieuw-cloud', date: '2026-02-01T00:00:00.000Z' })]);
    expect(repo.list().map((g) => g.id)).toEqual(['nieuw-cloud', 'oud-lokaal']);
  });

  it('een lokale leesfout levert status "error" met een lege lijst, ook als de cloud games heeft', () => {
    const local = new FakeLocalRepo();
    local.status = 'error';
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud);
    repo.subscribe(() => undefined);
    cloud.emit([completedGame({ id: 'cloud-1' })]);
    expect(repo.safeList()).toEqual({ status: 'error', games: [] });
  });

  it('status blijft "missing" wanneer zowel lokaal als cloud leeg zijn', () => {
    const local = new FakeLocalRepo();
    local.status = 'missing';
    const repo = new CompositeCompletedGameRepository(local, new FakeCloudSource());
    expect(repo.safeList()).toEqual({ status: 'missing', games: [] });
  });
});

describe('CompositeCompletedGameRepository — add/remove/replaceAll delegeren naar lokaal', () => {
  it('add() slaat lokaal op en meldt abonnees', () => {
    const local = new FakeLocalRepo();
    const repo = new CompositeCompletedGameRepository(local, new FakeCloudSource());
    const seen: CompletedGamesReadResult[] = [];
    repo.subscribe((result) => seen.push(result));
    const ok = repo.add(completedGame({ id: 'new-1' }));
    expect(ok).toBe(true);
    expect(local.games.map((g) => g.id)).toEqual(['new-1']);
    expect(seen.at(-1)?.games.map((g) => g.id)).toEqual(['new-1']);
  });

  it('remove() verwijdert uitsluitend lokaal (cloud-tombstones zijn PR 7.2c-scope)', () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'to-remove' }));
    const repo = new CompositeCompletedGameRepository(local, new FakeCloudSource());
    expect(repo.remove('to-remove')).toBe(true);
    expect(local.games).toHaveLength(0);
  });

  it('replaceAll() delegeert naar lokaal', () => {
    const local = new FakeLocalRepo();
    const repo = new CompositeCompletedGameRepository(local, new FakeCloudSource());
    const games = [completedGame({ id: 'a' }), completedGame({ id: 'b' })];
    expect(repo.replaceAll(games)).toBe(true);
    expect(local.games).toEqual(games);
  });
});

describe('CompositeCompletedGameRepository — subscribe', () => {
  it('roept onNext synchroon en direct aan met de actuele safeList()-uitkomst', () => {
    const local = new FakeLocalRepo();
    local.add(completedGame({ id: 'local-1' }));
    const repo = new CompositeCompletedGameRepository(local, new FakeCloudSource());
    const onNext = vi.fn();
    repo.subscribe(onNext);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext.mock.calls[0]![0].games.map((g: CompletedGame) => g.id)).toEqual(['local-1']);
    expect(onNext.mock.calls[0]![1]).toBeNull();
  });

  it('meldt alle geregistreerde abonnees bij een cloud-update, met de bijbehorende SyncState', () => {
    const local = new FakeLocalRepo();
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud);
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
    const repo = new CompositeCompletedGameRepository(local, cloud);
    const unsubA = repo.subscribe(() => undefined);
    repo.subscribe(() => undefined);
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    unsubA();
    expect(cloud.unsubscribeCount).toBe(0);
  });

  it('geeft een cloud-queryfout door aan de onError van elke abonnee', () => {
    const local = new FakeLocalRepo();
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud);
    const onErrorA = vi.fn();
    const onErrorB = vi.fn();
    repo.subscribe(() => undefined, onErrorA);
    repo.subscribe(() => undefined, onErrorB);
    const failure = new Error('permission-denied');
    cloud.emitError(failure);
    expect(onErrorA).toHaveBeenCalledWith(failure);
    expect(onErrorB).toHaveBeenCalledWith(failure);
  });

  it('stopt de cloud-subscribe zodra de laatste abonnee zich afmeldt', () => {
    const local = new FakeLocalRepo();
    const cloud = new FakeCloudSource();
    const repo = new CompositeCompletedGameRepository(local, cloud);
    const unsub = repo.subscribe(() => undefined);
    unsub();
    expect(cloud.unsubscribeCount).toBe(1);
  });
});
