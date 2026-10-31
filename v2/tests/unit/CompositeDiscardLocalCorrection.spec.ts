// PR 7.6b (docs/pr-7.6-plan.md §D.3): `discardLocalCorrection()` op de
// CompositeCompletedGameRepository. Verwijdert uitsluitend de lokale kopie,
// raakt de cloud nooit aan en weigert zonder (niet-getombstoned) cloudkopie.
// Fictieve data; echte LocalStorageCompletedGameRepository op een
// geheugenopslag, cloudbron en -writer zijn bestuurbare fakes.
import { describe, it, expect, vi } from 'vitest';
import {
  CompositeCompletedGameRepository,
  type CompletedGameCorrectionWriter,
  type CompletedGameTombstoneWriter,
} from '../../src/infrastructure/game/CompositeCompletedGameRepository';
import {
  completedGamesStorageKey,
  LocalStorageCompletedGameRepository,
} from '../../src/infrastructure/game/LocalStorageCompletedGameRepository';
import type { CloudCompletedGameSource } from '../../src/infrastructure/game/FirestoreCompletedGameRepository';
import type { CompletedGameCorrectionResult } from '../../src/application/game/GameCloudGateway';
import type { KeyValueStorage } from '../../src/i18n/persistence';
import type { CompletedGame, Segment } from '../../src/domain/game/types';
import type { SyncState } from '../../src/domain/syncState';
import { correctSegment } from '../../src/domain/game/correction';

class MemoryStorage implements KeyValueStorage {
  public readonly store = new Map<string, string>();
  public failWrites = false;
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota exceeded');
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const SERVER: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };

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

function correct(
  game: CompletedGame,
  id: string,
  segmentId: string,
  patch: Parameters<typeof correctSegment>[2],
  by: string | null = 'uid-1',
  at = '2026-02-02T09:00:00.000Z',
): CompletedGame {
  const r = correctSegment(game, segmentId, patch, by, { id, now: new Date(at) });
  if (!r.ok) throw new Error(`correctie mislukt: ${r.error}`);
  return r.game;
}

type CloudOnNext = Parameters<CloudCompletedGameSource['subscribe']>[0];

class FakeCloudSource implements CloudCompletedGameSource {
  private onNext: CloudOnNext | null = null;
  subscribe(onNext: CloudOnNext): () => void {
    this.onNext = onNext;
    return () => undefined;
  }
  emit(games: CompletedGame[], sync: SyncState = SERVER): void {
    this.onNext?.(games, sync, undefined);
  }
}

type CorrectCall = Parameters<CompletedGameCorrectionWriter['correctCompletedGame']>;

function harness(options: {
  local?: CompletedGame[];
  result?: CompletedGameCorrectionResult | (() => Promise<CompletedGameCorrectionResult>);
}) {
  const storage = new MemoryStorage();
  if (options.local) {
    storage.setItem(completedGamesStorageKey('org-1', 'team-1'), JSON.stringify(options.local));
  }
  const local = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
  const cloud = new FakeCloudSource();
  const calls: CorrectCall[] = [];
  const state = {
    result: options.result ?? ({ ok: true, revision: 1 } as CompletedGameCorrectionResult),
  };
  const writer: CompletedGameTombstoneWriter & CompletedGameCorrectionWriter = {
    tombstoneCompletedGame: vi.fn(async () => ({ ok: true })),
    correctCompletedGame: vi.fn(async (...args: CorrectCall) => {
      calls.push(args);
      return typeof state.result === 'function' ? state.result() : state.result;
    }),
  };
  const repo = new CompositeCompletedGameRepository(local, cloud, writer);
  const seen: Array<{ games: CompletedGame[]; status: string | null }> = [];
  repo.subscribe((result) => {
    seen.push({ games: result.games, status: repo.correctionSyncStatus('cg-1') });
  });
  return { storage, local, cloud, repo, writer, calls, state, seen };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const mine = () => correct(base(), 'corr-mine', 's1', { endSec: 300, pf: 9, tov: 3 });
const theirs = () => correct(base(), 'corr-theirs', 's2', { pa: 7 }, 'uid-2');
const other = () => base({ id: 'cg-2', sourceGameId: 'src-2', date: '2026-01-05T10:00:00.000Z' });

async function conflictHarness() {
  const h = harness({ local: [mine(), other()] });
  h.cloud.emit([theirs(), other()]);
  await flush();
  expect(h.repo.correctionSyncStatus('cg-1')).toBe('conflict');
  return h;
}

describe('lokale versie verwerpen na een conflict (PR 7.6b, plan §D.3)', () => {
  it('verwijdert alleen de lokale kopie: de cloud wordt niet aangeraakt en andere wedstrijden blijven', async () => {
    const h = await conflictHarness();
    const before = h.seen.length;
    expect(h.repo.discardLocalCorrection('cg-1')).toBe(true);

    expect(h.local.list().map((g) => g.id)).toEqual(['cg-2']);
    expect(h.repo.list().map((g) => g.id)).toEqual(['cg-2', 'cg-1']);
    // Geen enkele cloudaanroep: geen tombstone en geen correctiewrite.
    expect(h.writer.tombstoneCompletedGame).not.toHaveBeenCalled();
    expect(h.writer.correctCompletedGame).not.toHaveBeenCalled();
    expect(h.calls).toHaveLength(0);
    // De samenvoeging toont de cloudversie weer; er is geen tombstone ontstaan.
    const visible = h.repo.list().find((g) => g.id === 'cg-1');
    expect(visible?.corrections?.map((c) => c.id)).toEqual(['corr-theirs']);
    expect(visible?.deletedAt).toBeNull();
    expect(h.repo.hasCloudCopy('cg-1')).toBe(true);
    // De andere wedstrijd is ongemoeid.
    expect(h.local.list()[0]).toEqual(other());
    // Luisteraars zijn genotificeerd en zien de cloudversie.
    expect(h.seen.length).toBeGreaterThan(before);
    expect(h.seen.at(-1)?.status).toBe('gesynchroniseerd');
  });

  it('de wedstrijd keert terug als cloud-only en kan daarna opnieuw gecorrigeerd en geüpload worden', async () => {
    const h = await conflictHarness();
    expect(h.repo.discardLocalCorrection('cg-1')).toBe(true);
    const again = correct(
      theirs(),
      'corr-again',
      's1',
      { pf: 7 },
      'uid-1',
      '2026-02-04T09:00:00.000Z',
    );
    expect(h.repo.update(again)).toBe(true);
    await flush();
    expect(
      h.local
        .list()
        .find((g) => g.id === 'cg-1')
        ?.corrections?.map((c) => c.id),
    ).toEqual(['corr-theirs', 'corr-again']);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.[2]).toBe('cg-1');
    expect(h.calls[0]?.[3]).toBe(1);
    expect(h.calls[0]?.[4].correction.id).toBe('corr-again');
  });

  it('wist de uitkomst: een conflict uit een revisieweigering verdwijnt met de lokale kopie', async () => {
    const h = harness({ local: [base()], result: { ok: false, conflict: true, revision: 1 } });
    h.cloud.emit([base()]);
    h.repo.update(mine());
    await flush();
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('conflict');
    expect(h.repo.discardLocalCorrection('cg-1')).toBe(true);
    // De cloud heeft geen correcties: nooit gecorrigeerd, dus geen oude uitkomst meer.
    expect(h.repo.correctionSyncStatus('cg-1')).toBeNull();
    expect(h.calls).toHaveLength(1);
    // Een nieuwe cloudsnapshot start geen herhaalde upload.
    h.cloud.emit([base()]);
    await flush();
    expect(h.calls).toHaveLength(1);
  });

  it('wist de toestemmingen: dezelfde correctie, buiten update() teruggezet, gaat niet stil omhoog', async () => {
    const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });
    const h = harness({ local: [base()], result: { ok: false, error: denied } });
    h.cloud.emit([base()]);
    h.repo.update(mine());
    await flush();
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('actie-nodig');
    expect(h.repo.discardLocalCorrection('cg-1')).toBe(true);
    expect(h.local.list()).toEqual([]);
    // Terugzetten buiten update() om (back-up/herstart): niet goedgekeurd.
    h.storage.setItem(completedGamesStorageKey('org-1', 'team-1'), JSON.stringify([mine()]));
    h.state.result = { ok: true, revision: 1 };
    h.cloud.emit([base()]);
    await flush();
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('actie-nodig');
    expect(h.calls).toHaveLength(1);
  });

  it('zonder cloudkopie: false en niets gewijzigd (de lokale kopie is de enige)', () => {
    const h = harness({ local: [mine()] });
    h.cloud.emit([]);
    const before = h.seen.length;
    expect(h.repo.discardLocalCorrection('cg-1')).toBe(false);
    expect(h.local.list()).toEqual([mine()]);
    expect(h.seen.length).toBe(before);
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('lokaal-beschikbaar');
  });

  it('getombstoned cloudkopie: false en niets gewijzigd', () => {
    const h = harness({ local: [mine()] });
    h.cloud.emit([
      base({ revision: 3, deletedAt: '2026-03-01T00:00:00.000Z', deletedBy: 'uid-2' }),
    ]);
    expect(h.repo.discardLocalCorrection('cg-1')).toBe(false);
    expect(h.writer.tombstoneCompletedGame).not.toHaveBeenCalled();
    expect(h.writer.correctCompletedGame).not.toHaveBeenCalled();
  });

  it('getombstoned cloudkopie terwijl er nog een lokale kopie staat: false, lokaal ongemoeid', () => {
    const storage = new MemoryStorage();
    storage.setItem(completedGamesStorageKey('org-1', 'team-1'), JSON.stringify([mine()]));
    const local = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    const writer = {
      tombstoneCompletedGame: vi.fn(async () => ({ ok: true })),
      correctCompletedGame: vi.fn(),
    } as unknown as CompletedGameTombstoneWriter & CompletedGameCorrectionWriter;
    const repo = new CompositeCompletedGameRepository(local, new FakeCloudSource(), writer);
    // Zonder subscribe draait de cloud-tombstone-opruiming niet; zo staat de
    // tombstonecontrole van discardLocalCorrection op zichzelf.
    (repo as unknown as { cloudGames: CompletedGame[] }).cloudGames = [
      base({ revision: 3, deletedAt: '2026-03-01T00:00:00.000Z', deletedBy: 'uid-2' }),
    ];
    expect(repo.discardLocalCorrection('cg-1')).toBe(false);
    expect(local.list()).toEqual([mine()]);
    expect(writer.tombstoneCompletedGame).not.toHaveBeenCalled();
  });

  it('onbekend id: false', () => {
    const h = harness({ local: [mine()] });
    h.cloud.emit([theirs()]);
    expect(h.repo.discardLocalCorrection('cg-onbekend')).toBe(false);
    expect(h.local.list()).toEqual([mine()]);
  });

  it('cloudkopie van een andere organisatie of ander team telt niet: false', () => {
    const h = harness({ local: [mine()] });
    h.cloud.emit([base({ teamId: 'team-2' })]);
    expect(h.repo.discardLocalCorrection('cg-1')).toBe(false);
    h.cloud.emit([base({ organizationId: 'org-2' })]);
    expect(h.repo.discardLocalCorrection('cg-1')).toBe(false);
    expect(h.local.list()).toEqual([mine()]);
  });

  it('opslagfout: false, geen halve toestand (kopie, status en notificaties ongewijzigd)', async () => {
    const h = await conflictHarness();
    h.storage.failWrites = true;
    const before = h.seen.length;
    expect(h.repo.discardLocalCorrection('cg-1')).toBe(false);
    h.storage.failWrites = false;
    expect(
      h.local
        .list()
        .map((g) => g.id)
        .sort(),
    ).toEqual(['cg-1', 'cg-2']);
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('conflict');
    expect(h.seen.length).toBe(before);
    expect(h.writer.tombstoneCompletedGame).not.toHaveBeenCalled();
    // Na herstel van de opslag lukt verwerpen alsnog.
    expect(h.repo.discardLocalCorrection('cg-1')).toBe(true);
  });

  it('tijdens een lopende upload: false (eerst laten afronden)', async () => {
    let resolveUpload!: (value: CompletedGameCorrectionResult) => void;
    const h = harness({
      local: [base()],
      result: () => new Promise((resolve) => (resolveUpload = resolve)),
    });
    h.cloud.emit([base()]);
    h.repo.update(mine());
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.repo.discardLocalCorrection('cg-1')).toBe(false);
    expect(h.local.list()).toHaveLength(1);
    resolveUpload({ ok: true, revision: 1 });
    await flush();
  });

  it('eigen, onbevestigde cloudwrite (latency-gecompenseerde cloudkopie): false, niets gewijzigd', async () => {
    const h = harness({ local: [mine()] });
    h.cloud.emit([theirs()], {
      status: 'gesynchroniseerd',
      fromCache: false,
      hasPendingWrites: true,
    });
    await flush();
    const before = h.seen.length;
    expect(h.repo.discardLocalCorrection('cg-1')).toBe(false);
    expect(h.local.list()).toHaveLength(1);
    expect(h.seen.length).toBe(before);
    expect(h.writer.tombstoneCompletedGame).not.toHaveBeenCalled();
    // Zodra de server de write bevestigt, kan verwerpen weer.
    h.cloud.emit([theirs()], SERVER);
    await flush();
    expect(h.repo.discardLocalCorrection('cg-1')).toBe(true);
  });
});
