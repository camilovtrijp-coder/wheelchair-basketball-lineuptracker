// PR 7.5c (docs/pr-7.5-plan.md §D.3/§D.4): revisiegestuurde merge, lokaal-eerst
// correcties en hervatbare upload in CompositeCompletedGameRepository.
// Fictieve data; echte LocalStorageCompletedGameRepository op een geheugen-
// opslag, cloudbron en -writer zijn bestuurbare fakes.
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

const SERVER: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };
const CACHE: SyncState = { status: 'lokaal-beschikbaar', fromCache: true, hasPendingWrites: false };

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

/** Pas een correctie toe met deterministische id/tijd. */
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

const PENDING: SyncState = {
  status: 'wacht-op-synchronisatie',
  fromCache: false,
  hasPendingWrites: true,
};

type CloudOnNext = Parameters<CloudCompletedGameSource['subscribe']>[0];

class FakeCloudSource implements CloudCompletedGameSource {
  private onNext: CloudOnNext | null = null;
  subscribe(onNext: CloudOnNext): () => void {
    this.onNext = onNext;
    return () => undefined;
  }
  emit(games: CompletedGame[], sync: SyncState = SERVER, pendingIds?: ReadonlySet<string>): void {
    this.onNext?.(games, sync, pendingIds);
  }
}

/** Latency-compensation-weergave van een eigen, nog niet bevestigde correctie:
 * `correctedAt` is een onopgeloste serverTimestamp (null) en dus afwezig. */
function optimistic(game: CompletedGame): CompletedGame {
  const copy: CompletedGame = { ...game };
  delete copy.correctedAt;
  return copy;
}

type CorrectCall = Parameters<CompletedGameCorrectionWriter['correctCompletedGame']>;

function harness(options: {
  local?: CompletedGame[];
  storage?: MemoryStorage;
  result?: CompletedGameCorrectionResult | (() => Promise<CompletedGameCorrectionResult>);
}) {
  const storage = options.storage ?? new MemoryStorage();
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

describe('merge — hogere revisie wint (PR 7.5c)', () => {
  it('cloud met hogere revisie wint van de lokale kopie', () => {
    const c1 = correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 });
    const h = harness({ local: [base()] });
    h.cloud.emit([c1]);
    const visible = h.repo.list();
    expect(visible).toHaveLength(1);
    expect(visible[0]?.revision).toBe(1);
    expect(visible[0]?.scoreFor).toBe(17);
  });

  it('lokale kopie met hogere revisie wint van de cloud', () => {
    const c1 = correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 });
    const h = harness({ local: [c1] });
    h.cloud.emit([base()]);
    expect(h.repo.list()[0]?.revision).toBe(1);
  });

  it('gelijke revisie: de lokale kopie (huidig gedrag)', () => {
    const local = base({ opponent: 'Lokaal' });
    const h = harness({ local: [local] });
    h.cloud.emit([base({ opponent: 'Cloud' })]);
    expect(h.repo.list()[0]?.opponent).toBe('Lokaal');
  });

  it('een cloud-tombstone wint altijd, ook van een lokale kopie met hogere revisie', () => {
    const c1 = correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 });
    const h = harness({ local: [c1] });
    h.cloud.emit([
      base({ revision: 5, deletedAt: '2026-03-01T00:00:00.000Z', deletedBy: 'uid-2' }),
    ]);
    expect(h.repo.list()).toEqual([]);
    expect(h.local.list()).toEqual([]);
  });
});

describe('lokaal eerst en geen vals succes (PR 7.5c)', () => {
  it('offline (nog geen cloud-snapshot): update slaat lokaal op, roept de cloud niet aan, status lokaal-beschikbaar', async () => {
    const h = harness({ local: [base()] });
    expect(h.repo.update(correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 }))).toBe(
      true,
    );
    await flush();
    expect(h.calls).toHaveLength(0);
    expect(h.local.list()[0]?.revision).toBe(1);
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('lokaal-beschikbaar');
  });

  it('cloudbasis alleen uit cache: wacht met uploaden, status wacht-op-synchronisatie, lokaal bewaard', async () => {
    const h = harness({ local: [base()] });
    h.cloud.emit([base()], CACHE);
    h.repo.update(correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 }));
    await flush();
    expect(h.calls).toHaveLength(0);
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('wacht-op-synchronisatie');
    // Zodra de server antwoordt wordt de achterstand alsnog geüpload.
    h.cloud.emit([base()], SERVER);
    await flush();
    expect(h.calls).toHaveLength(1);
  });

  it('online: uploadt de correctie met de cloudrevisie als verwachte revisie en het ene logitem', async () => {
    let resolveUpload!: (value: CompletedGameCorrectionResult) => void;
    const h = harness({
      local: [base()],
      result: () => new Promise((resolve) => (resolveUpload = resolve)),
    });
    h.cloud.emit([base()]);
    h.repo.update(correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 }));
    await flush();

    expect(h.calls).toHaveLength(1);
    const [org, team, id, expectedRevision, payload] = h.calls[0]!;
    expect([org, team, id, expectedRevision]).toEqual(['org-1', 'team-1', 'cg-1', 0]);
    expect(payload.correction).toMatchObject({
      id: 'corr-1',
      segmentId: 's1',
      segmentIndex: 0,
      by: 'uid-1',
      at: '2026-02-02T09:00:00.000Z',
      after: { quarter: 1, beginSec: 600, endSec: 300, pf: 9, pa: 4, tov: 3 },
    });
    expect(payload.scoreFor).toBe(17);
    expect(payload.segments[0]).toMatchObject({
      id: 's1',
      endSec: 300,
      durSec: 300,
      pf: 9,
      tov: 3,
    });

    // Geen vals succes: zolang de server niet bevestigde, blijft de status wachtend.
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('wacht-op-synchronisatie');
    resolveUpload({ ok: true, revision: 1 });
    await flush();
    // Ook na `ok` is "gesynchroniseerd" pas waar als de cloudkopie het log toont.
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('wacht-op-synchronisatie');
    h.cloud.emit([correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 })]);
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('gesynchroniseerd');
  });

  it('een tweede snapshot tijdens een lopende upload start geen parallelle dubbele upload', async () => {
    const h = harness({
      local: [base()],
      result: () => new Promise(() => undefined),
    });
    h.cloud.emit([base()]);
    h.repo.update(correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 }));
    await flush();
    h.cloud.emit([base()]);
    h.cloud.emit([base()]);
    await flush();
    expect(h.calls).toHaveLength(1);
  });

  it('een bevestigde upload met alreadyApplied (idempotente retry) telt als ok, zonder fout', async () => {
    const h = harness({ local: [base()], result: { ok: true, revision: 1, alreadyApplied: true } });
    h.cloud.emit([base()]);
    h.repo.update(correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 }));
    await flush();
    expect(h.calls).toHaveLength(1);
    h.cloud.emit([correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 })]);
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('gesynchroniseerd');
    await flush();
    expect(h.calls).toHaveLength(1);
  });
});

describe('falen, herstel en conflict (PR 7.5c)', () => {
  it('netwerkfout/timeout: lokaal blijft staan, status wacht-op-synchronisatie, volgende server-snapshot probeert opnieuw', async () => {
    const h = harness({ local: [base()], result: { ok: false, error: new Error('timeout') } });
    h.cloud.emit([base()]);
    h.repo.update(correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 }));
    await flush();
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('wacht-op-synchronisatie');
    expect(h.local.list()[0]?.revision).toBe(1);
    h.state.result = { ok: true, revision: 1 };
    h.cloud.emit([base()]);
    await flush();
    expect(h.calls).toHaveLength(2);
  });

  it('Rules-afwijzing (permission-denied): status actie-nodig, GEEN automatische herhaling, wel via retryCorrectionUploads()', async () => {
    const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });
    const h = harness({ local: [base()], result: { ok: false, error: denied } });
    h.cloud.emit([base()]);
    h.repo.update(correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 }));
    await flush();
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('actie-nodig');
    h.cloud.emit([base()]);
    await flush();
    expect(h.calls).toHaveLength(1);

    h.state.result = { ok: true, revision: 1 };
    h.repo.retryCorrectionUploads();
    await flush();
    expect(h.calls).toHaveLength(2);
  });

  it('revisieconflict van de server: status conflict, lokale data ongemoeid, geen herhaling', async () => {
    const h = harness({ local: [base()], result: { ok: false, conflict: true, revision: 1 } });
    h.cloud.emit([base()]);
    h.repo.update(correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 }));
    await flush();
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('conflict');
    const stored = h.local.list()[0];
    expect(stored?.revision).toBe(1);
    expect(stored?.corrections?.map((c) => c.id)).toEqual(['corr-1']);
    h.cloud.emit([base()]);
    await flush();
    expect(h.calls).toHaveLength(1);
  });

  it('uiteengelopen kopieën (beide apparaten corrigeerden): conflict, niets overschreven, niets geüpload', async () => {
    const mine = correct(base(), 'corr-mine', 's1', { endSec: 300, pf: 9, tov: 3 });
    const theirs = correct(base(), 'corr-theirs', 's2', { pa: 7 }, 'uid-2');
    const h = harness({ local: [mine] });
    h.cloud.emit([theirs]);
    await flush();
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('conflict');
    expect(h.calls).toHaveLength(0);
    // Lokale opslag is niet stil overschreven.
    expect(h.local.list()[0]?.corrections?.map((c) => c.id)).toEqual(['corr-mine']);
    // Gelijke revisie → lokaal blijft de zichtbare versie.
    expect(h.repo.list()[0]?.corrections?.[0]?.id).toBe('corr-mine');
  });

  it('uiteengelopen met lagere lokale revisie: cloud is zichtbaar, lokale opslag blijft onaangeroerd', () => {
    const mine = correct(base(), 'corr-mine', 's1', { endSec: 300, pf: 9, tov: 3 });
    const theirs = correct(
      correct(base(), 'corr-t1', 's2', { pa: 7 }, 'uid-2'),
      'corr-t2',
      's2',
      { pa: 8 },
      'uid-2',
      '2026-02-03T09:00:00.000Z',
    );
    const h = harness({ local: [mine] });
    h.cloud.emit([theirs]);
    expect(h.repo.list()[0]?.revision).toBe(2);
    expect(h.local.list()[0]?.corrections?.map((c) => c.id)).toEqual(['corr-mine']);
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('conflict');
  });

  it('lokale kopie loopt achter: wordt via local.update() bijgewerkt zonder cloudwrite', async () => {
    const theirs = correct(base(), 'corr-theirs', 's2', { pa: 7 }, 'uid-2');
    const h = harness({ local: [base()] });
    h.cloud.emit([theirs]);
    await flush();
    expect(h.local.list()[0]?.revision).toBe(1);
    expect(h.local.list()[0]?.corrections?.[0]?.id).toBe('corr-theirs');
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('gesynchroniseerd');
    expect(h.calls).toHaveLength(0);
  });
});

describe('hervatbare upload (PR 7.5c)', () => {
  it('na een herstart (nieuwe instantie, zelfde opslag) uploadt NIET automatisch: actie-nodig, pas na een expliciete retryCorrectionUploads()', async () => {
    const storage = new MemoryStorage();
    const first = harness({ storage, local: [base()] });
    first.repo.update(correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 })); // offline
    expect(first.calls).toHaveLength(0);

    // "App herstart": nieuwe composite op dezelfde opslag. Er is geen bewijs
    // (in-memory markering) dat deze correctie op dit apparaat is gemaakt.
    const second = harness({ storage });
    second.cloud.emit([base()]);
    await flush();
    expect(second.calls).toHaveLength(0);
    expect(second.repo.correctionSyncStatus('cg-1')).toBe('actie-nodig');

    // Een bewuste gebruikersactie geeft wél toestemming.
    second.repo.retryCorrectionUploads();
    await flush();
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0]?.[3]).toBe(0);
    expect(second.calls[0]?.[4].correction.id).toBe('corr-1');
  });

  it('twee offline correcties gaan een voor een omhoog; de tweede krijgt de nieuwe cloudrevisie', async () => {
    const c1 = correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 });
    const c2 = correct(c1, 'corr-2', 's2', { pa: 7 }, 'uid-1', '2026-02-03T09:00:00.000Z');
    const h = harness({ local: [base()] });
    h.repo.update(c1);
    h.repo.update(c2);
    h.cloud.emit([base()]);
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.[3]).toBe(0);
    expect(h.calls[0]?.[4].correction.id).toBe('corr-1');
    // De payload van stap 1 bevat de uitkomst van ALLEEN stap 1.
    expect(h.calls[0]?.[4].scoreAgainst).toBe(10);

    h.cloud.emit([c1]);
    await flush();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]?.[3]).toBe(1);
    expect(h.calls[1]?.[4].correction.id).toBe('corr-2');
    expect(h.calls[1]?.[4].scoreAgainst).toBe(11);
    expect(h.calls[1]?.[4].correction.segmentIndex).toBe(1);

    h.cloud.emit([c2]);
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('gesynchroniseerd');
    await flush();
    expect(h.calls).toHaveLength(2);
  });

  it('een lokale kopie die niet bij de cloudbasis past (andere segmentwaarden) wordt niet geüpload maar als conflict gemeld', async () => {
    const mine = correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 });
    // Cloudbasis met afwijkende oorspronkelijke waarden (pf 7 i.p.v. 6).
    const odd = base({
      segments: [seg({ id: 's1', pf: 7 }), base().segments[1] as Segment],
      scoreFor: 15,
    });
    const h = harness({ local: [base()] });
    h.repo.update(mine);
    h.cloud.emit([odd]);
    await flush();
    expect(h.calls).toHaveLength(0);
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('conflict');
  });

  it('een wedstrijd zonder correcties heeft status null en veroorzaakt nooit een upload', async () => {
    const h = harness({ local: [base()] });
    h.cloud.emit([base()]);
    await flush();
    expect(h.repo.correctionSyncStatus('cg-1')).toBeNull();
    expect(h.calls).toHaveLength(0);
  });
});

describe('geen vals "gesynchroniseerd" vóór serverbevestiging (review PR #134, fix 1)', () => {
  const c1 = () => correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 });

  it('snapshot met hasPendingWrites (per document) is nog niet gesynchroniseerd; pas de serverbevestigde snapshot is dat', async () => {
    let resolveUpload!: (value: CompletedGameCorrectionResult) => void;
    const h = harness({
      local: [base()],
      result: () => new Promise((resolve) => (resolveUpload = resolve)),
    });
    h.cloud.emit([base()]);
    h.repo.update(c1());
    await flush();

    // Latency compensation: de cloudquery toont al je eigen, onbevestigde write.
    h.cloud.emit([optimistic(c1())], PENDING, new Set(['cg-1']));
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('wacht-op-synchronisatie');

    // Ook als de writer-promise al bevestigt, blijft de status wachtend zolang
    // de snapshot pending is; het statusrecord is niet gewist.
    resolveUpload({ ok: true, revision: 1 });
    await flush();
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('wacht-op-synchronisatie');

    h.cloud.emit([c1()], SERVER);
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('gesynchroniseerd');
    expect(h.seen.filter((s) => s.status === 'gesynchroniseerd')).toHaveLength(1);
  });

  it('zonder per-document-vlag telt snapshot-niveau hasPendingWrites als pending (conservatief)', async () => {
    const h = harness({ local: [base()], result: () => new Promise(() => undefined) });
    h.cloud.emit([base()]);
    h.repo.update(c1());
    await flush();
    h.cloud.emit([optimistic(c1())], PENDING);
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('wacht-op-synchronisatie');
    expect(h.seen.some((s) => s.status === 'gesynchroniseerd')).toBe(false);
  });

  it('een door Rules geweigerde write toont actie-nodig, zonder eerst succes te hebben getoond', async () => {
    let rejectUpload!: (value: CompletedGameCorrectionResult) => void;
    const h = harness({
      local: [base()],
      result: () => new Promise((resolve) => (rejectUpload = resolve)),
    });
    h.cloud.emit([base()]);
    h.repo.update(c1());
    await flush();
    h.cloud.emit([optimistic(c1())], PENDING, new Set(['cg-1']));
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('wacht-op-synchronisatie');

    rejectUpload({
      ok: false,
      error: Object.assign(new Error('denied'), { code: 'permission-denied' }),
    });
    await flush();
    // De SDK draait de optimistische weergave terug.
    h.cloud.emit([base()], SERVER);
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('actie-nodig');
    expect(h.seen.some((s) => s.status === 'gesynchroniseerd')).toBe(false);
    expect(h.calls).toHaveLength(1);
  });
});

describe('correctie van een wedstrijd die alleen in de cloud staat (review PR #134, fix 2)', () => {
  const c1 = () => correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 });

  it('neemt de cloudkopie lokaal op, slaat de correctie lokaal op en uploadt die', async () => {
    const h = harness({});
    h.cloud.emit([base()]);
    expect(h.local.list()).toEqual([]);

    expect(h.repo.update(c1())).toBe(true);
    await flush();

    const stored = h.local.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.revision).toBe(1);
    expect(stored[0]?.corrections?.map((c) => c.id)).toEqual(['corr-1']);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.[3]).toBe(0);
    expect(h.calls[0]?.[4].correction.id).toBe('corr-1');
  });

  it('een herhaalde aanroep maakt geen duplicaat en verliest niets', async () => {
    const h = harness({});
    h.cloud.emit([base()]);
    const second = correct(c1(), 'corr-2', 's2', { pa: 7 }, 'uid-1', '2026-02-03T09:00:00.000Z');
    expect(h.repo.update(c1())).toBe(true);
    expect(h.repo.update(second)).toBe(true);
    expect(h.repo.update(second)).toBe(false); // zelfde revisie: geweigerd door 7.5a-regels
    await flush();
    expect(h.local.list()).toHaveLength(1);
    expect(h.local.list()[0]?.corrections?.map((c) => c.id)).toEqual(['corr-1', 'corr-2']);
    expect(h.repo.list()).toHaveLength(1);
  });

  it('een getombstonede cloudkopie wordt niet lokaal opgenomen', () => {
    const h = harness({});
    h.cloud.emit([
      base({ revision: 3, deletedAt: '2026-03-01T00:00:00.000Z', deletedBy: 'uid-2' }),
    ]);
    expect(h.repo.update(c1())).toBe(false);
    expect(h.local.list()).toEqual([]);
  });

  it('zonder cloudkopie (onbekend id) blijft update false en blijft de opslag leeg', () => {
    const h = harness({});
    h.cloud.emit([]);
    expect(h.repo.update(c1())).toBe(false);
    expect(h.local.list()).toEqual([]);
  });

  it('een cloudkopie van een ander team wordt niet lokaal opgenomen', () => {
    const h = harness({});
    h.cloud.emit([base({ teamId: 'team-2' })]);
    expect(h.repo.update(c1())).toBe(false);
    expect(h.local.list()).toEqual([]);
  });

  it('weigert de lokale regel de correctie, dan wordt de opgenomen cloudkopie weer verwijderd', () => {
    const h = harness({});
    h.cloud.emit([base()]);
    // Revisie niet hoger dan die van de cloudkopie: local.update weigert.
    expect(h.repo.update(base())).toBe(false);
    expect(h.local.list()).toEqual([]);
  });
});

describe('replay valideert alleen gewijzigde velden (review PR #134, fix 3)', () => {
  it('een correctie van alleen pf op een segment met oude data (beginSec 720) wordt geüpload, geen conflict', async () => {
    const oldSeg = seg({ id: 's1', beginSec: 720, endSec: 420, durSec: 300 });
    const old = base({ segments: [oldSeg, base().segments[1] as Segment] });
    const corrected = correct(old, 'corr-1', 's1', { pf: 9 });
    const h = harness({ local: [old] });
    h.cloud.emit([old]);
    expect(h.repo.update(corrected)).toBe(true);
    await flush();

    expect(h.calls).toHaveLength(1);
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('wacht-op-synchronisatie');
    const payload = h.calls[0]?.[4];
    expect(payload?.correction.after).toMatchObject({ beginSec: 720, pf: 9 });
    expect(payload?.segments[0]).toMatchObject({ beginSec: 720, durSec: 300, pf: 9 });
    expect(payload?.scoreFor).toBe(17);
  });

  it('vergelijkt vóór/ná per veld: een andere sleutelvolgorde in het lokale log is geen conflict', async () => {
    const c1 = correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 });
    type Fields = NonNullable<CompletedGame['corrections']>[number]['before'];
    const reorder = (f: Fields): Fields =>
      Object.fromEntries(Object.entries(f).reverse()) as unknown as Fields;
    const first = c1.corrections?.[0];
    if (!first) throw new Error('fixture');
    const reordered: CompletedGame = {
      ...c1,
      corrections: [{ ...first, before: reorder(first.before), after: reorder(first.after) }],
    };
    const h = harness({ local: [base()] });
    h.cloud.emit([base()]);
    expect(h.repo.update(reordered)).toBe(true);
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('wacht-op-synchronisatie');
  });
});

describe('geen automatische upload door een back-up-herstel (review PR #134, fix 5)', () => {
  const c1 = () => correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 });

  it('replaceAll met een gecorrigeerde wedstrijd doet nooit een gatewaywrite, ook niet bij latere cloud-snapshots', async () => {
    const h = harness({ local: [base()] });
    h.cloud.emit([base()]);
    expect(h.repo.replaceAll([c1()])).toBe(true);
    await flush();
    h.cloud.emit([base()]);
    h.cloud.emit([base()], SERVER);
    await flush();
    expect(h.calls).toHaveLength(0);
    expect(h.writer.correctCompletedGame).not.toHaveBeenCalled();
    // Eerlijke status: lokaal loopt voor, een gebruiker moet bewust uploaden.
    expect(h.repo.correctionSyncStatus('cg-1')).toBe('actie-nodig');

    h.repo.retryCorrectionUploads();
    await flush();
    expect(h.calls).toHaveLength(1);
  });

  it('een replaceAll na een update() wist de toestemming: ook die correctie gaat niet automatisch omhoog', async () => {
    const h = harness({ local: [base()] });
    h.repo.update(c1()); // offline gemaakt
    h.repo.replaceAll([c1()]);
    h.cloud.emit([base()]);
    await flush();
    expect(h.calls).toHaveLength(0);
  });

  it('zonder replaceAll uploadt een offline via update() gemaakte correctie na reconnect in dezelfde sessie', async () => {
    const h = harness({ local: [base()] });
    h.repo.update(c1());
    h.cloud.emit([base()]);
    await flush();
    expect(h.calls).toHaveLength(1);
  });
});

describe('volgende wachtende correctie na een bevestigde upload (review PR #134, fix 6)', () => {
  it('na result.ok wordt de volgende correctie opgepakt zonder nieuwe snapshot', async () => {
    const c1 = correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 });
    const c2 = correct(c1, 'corr-2', 's2', { pa: 7 }, 'uid-1', '2026-02-03T09:00:00.000Z');
    const resolvers: Array<(v: CompletedGameCorrectionResult) => void> = [];
    const h = harness({
      local: [base()],
      result: () => new Promise((resolve) => resolvers.push(resolve)),
    });
    h.cloud.emit([base()]);
    h.repo.update(c1);
    h.repo.update(c2);
    await flush();
    expect(h.calls).toHaveLength(1);

    // Tijdens de lopende upload komt de optimistische snapshot binnen (wordt
    // overgeslagen: er loopt al een upload voor deze wedstrijd).
    h.cloud.emit([optimistic(c1)], PENDING, new Set(['cg-1']));
    expect(h.calls).toHaveLength(1);

    resolvers[0]?.({ ok: true, revision: 1 });
    await flush();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]?.[3]).toBe(1);
    expect(h.calls[1]?.[4].correction.id).toBe('corr-2');
  });

  it('start na result.ok geen tweede upload van dezelfde correctie zolang de snapshot nog achterloopt (geen lus)', async () => {
    const h = harness({ local: [base()] });
    h.cloud.emit([base()]);
    h.repo.update(correct(base(), 'corr-1', 's1', { endSec: 300, pf: 9, tov: 3 }));
    await flush();
    await flush();
    expect(h.calls).toHaveLength(1);
  });
});
