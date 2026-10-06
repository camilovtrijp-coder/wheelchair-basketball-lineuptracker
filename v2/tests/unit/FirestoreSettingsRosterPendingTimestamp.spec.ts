// Pending-serverTimestamp voor SETTINGS en ROSTER (zelfde mechanisme als de
// game-fix in PR #100). Een write met `updatedAt: serverTimestamp()` die de
// server nog niet heeft bevestigd (offline, trage verbinding) staat in
// Firestores lokale schrijfwachtrij. Zolang dat zo is, leveren
// getDocFromCache()/getDoc() en de onSnapshot-listener de lokale
// (latency-compensated) weergave, waarin `updatedAt` met de Firestore-default
// `serverTimestamps: 'none'` `null` is. De strikte converter
// (`assertTimestamp`) wees dat af ('veld "updatedAt" moet een Firestore
// Timestamp zijn'): read() rejectte en de listener gooide in zijn callback.
//
// Deze tests gebruiken bewust de ECHTE settings-/rosterConverter uit
// firebase-base (niet gemockt): de nep-DocumentSnapshot roept de converter
// aan zoals de SDK dat doet (`converter.fromFirestore(inner, options)`), en
// de binnenste snapshot geeft alleen bij `'estimate'` een Timestamp. Zo faalt
// een test zowel wanneer de repository de opties niet meegeeft als wanneer de
// converter ze niet doorgeeft aan `snapshot.data()`.
//
// Invariant (les uit de review van PR #100): 'estimate' is uitsluitend voor
// weergave. De syncstatus komt uit `snap.metadata` (`hasPendingWrites`/
// `fromCache`) en blijft dus 'wacht-op-synchronisatie' zolang de write
// alleen lokaal staat — een geschatte `updatedAt` maakt een document nooit
// 'gesynchroniseerd'.
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: vi.fn(),
    getDoc: vi.fn(),
    getDocFromCache: vi.fn(),
    setDoc: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  };
});

import {
  Timestamp,
  doc,
  getDoc,
  getDocFromCache,
  onSnapshot,
  type FirestoreDataConverter,
  type Firestore,
  type SnapshotOptions,
} from 'firebase/firestore';
import { FirestoreSettingsRepository } from '../../src/infrastructure/settings/FirestoreSettingsRepository';
import { FirestoreRosterRepository } from '../../src/infrastructure/roster/FirestoreRosterRepository';
import { DEFAULT_SETTINGS } from '../../src/domain/settings/types';
import type { SyncState } from '../../src/domain/syncState';

const fakeDb = {} as unknown as Firestore;
const ESTIMATE_MILLIS = 1_786_278_840_000;
const SERVER_MILLIS = 1_786_278_900_000;

interface Metadata {
  fromCache: boolean;
  hasPendingWrites: boolean;
}

/** Laatste converter die via `withConverter()` aan de ref is gehangen. */
let converter: FirestoreDataConverter<Record<string, unknown>> | null = null;
const fakeRef = {
  withConverter: (c: FirestoreDataConverter<Record<string, unknown>>) => {
    converter = c;
    return fakeRef;
  },
} as unknown as ReturnType<typeof doc>;

/**
 * Nep-DocumentSnapshot. `updatedAt`:
 * - 'pending': nog-onbevestigde lokale serverTimestamp() — `null` bij de
 *   default `'none'`, een schatting bij `'estimate'`;
 * - 'server': een door de server bevestigde Timestamp.
 */
function fakeSnap(
  fields: Record<string, unknown>,
  updatedAt: 'pending' | 'server',
  metadata: Metadata,
) {
  const inner = {
    data: (options?: SnapshotOptions) => ({
      ...fields,
      updatedAt:
        updatedAt === 'server'
          ? Timestamp.fromMillis(SERVER_MILLIS)
          : options?.serverTimestamps === 'estimate'
            ? Timestamp.fromMillis(ESTIMATE_MILLIS)
            : null,
    }),
    ref: { path: 'mock/doc' },
  };
  return {
    exists: () => true,
    metadata,
    data: (options?: SnapshotOptions) => {
      if (converter === null) throw new Error('test: geen converter gekoppeld');
      return converter.fromFirestore(inner as never, options);
    },
  };
}

type FakeSnap = ReturnType<typeof fakeSnap>;

/** Laat onSnapshot de gegeven snapshots synchroon, in volgorde, afleveren. */
function deliverSnapshots(...snaps: FakeSnap[]) {
  (onSnapshot as Mock).mockImplementationOnce(
    (_ref: unknown, _opts: unknown, onNext: (snap: FakeSnap) => void) => {
      for (const snap of snaps) onNext(snap);
      return () => undefined;
    },
  );
}

const PENDING_OFFLINE: Metadata = { fromCache: true, hasPendingWrites: true };
const CACHE_ONLY: Metadata = { fromCache: true, hasPendingWrites: false };
const SERVER_CONFIRMED: Metadata = { fromCache: false, hasPendingWrites: false };

const PLAYER = { id: 1, nr: '7', naam: 'Fictief Speler', kl: '3.0', vrouw: false, jeugd: false };
const OTHER_PLAYER = {
  id: 2,
  nr: '9',
  naam: 'Fictieve Invaller',
  kl: '1.5',
  vrouw: true,
  jeugd: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  // mockReset i.p.v. alleen clear: een niet-geconsumeerde
  // mockResolvedValueOnce (bijv. de getDoc()-terugval in de cache-tests) mag
  // niet naar de volgende test lekken.
  (getDoc as Mock).mockReset();
  (getDocFromCache as Mock).mockReset();
  (onSnapshot as Mock).mockReset();
  converter = null;
  (doc as Mock).mockReturnValue(fakeRef);
});

describe('FirestoreSettingsRepository — nog-onbevestigde serverTimestamp() in de lokale weergave', () => {
  const optimistic = { ...DEFAULT_SETTINGS, teamName: 'Offline Nieuw' };

  it('read() uit de cache levert de eigen optimistische waarde i.p.v. te rejecten', async () => {
    (getDocFromCache as Mock).mockResolvedValueOnce(
      fakeSnap(optimistic, 'pending', PENDING_OFFLINE),
    );
    // Op main viel read() na de converterfout terug op getDoc(), dat offline
    // dezelfde lokale weergave geeft en dus opnieuw faalt.
    (getDoc as Mock).mockResolvedValueOnce(fakeSnap(optimistic, 'pending', PENDING_OFFLINE));
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-fictief', 'team-fictief');

    const out = await repo.read();

    expect(out.teamName).toBe('Offline Nieuw');
    expect(out).not.toHaveProperty('updatedAt');
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('read() via de getDoc()-terugval (cache-miss) leest een wachtende write ook met de schatting', async () => {
    (getDocFromCache as Mock).mockRejectedValueOnce(new Error('niet in cache'));
    (getDoc as Mock).mockResolvedValueOnce(fakeSnap(optimistic, 'pending', PENDING_OFFLINE));
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-fictief', 'team-fictief');

    await expect(repo.read()).resolves.toMatchObject({ teamName: 'Offline Nieuw' });
  });

  it('subscribe() emit de optimistische waarde met wacht-op-synchronisatie (niet gesynchroniseerd)', () => {
    deliverSnapshots(fakeSnap(optimistic, 'pending', PENDING_OFFLINE));
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-fictief', 'team-fictief');
    const seen: Array<{ teamName: unknown; sync: SyncState; updatedAt?: number }> = [];

    repo.subscribe((s, sync, updatedAt) => seen.push({ teamName: s.teamName, sync, updatedAt }));

    expect(seen).toEqual([
      {
        teamName: 'Offline Nieuw',
        sync: { status: 'wacht-op-synchronisatie', fromCache: true, hasPendingWrites: true },
        updatedAt: ESTIMATE_MILLIS,
      },
    ]);
  });

  it(
    'een eerdere cache-snapshot met de oude waarde wordt door de volgende pending-snapshot ' +
      'overschreven, en pas de serverbevestiging geeft gesynchroniseerd',
    () => {
      deliverSnapshots(
        fakeSnap({ ...DEFAULT_SETTINGS, teamName: 'Oud' }, 'server', CACHE_ONLY),
        fakeSnap(optimistic, 'pending', PENDING_OFFLINE),
        fakeSnap(optimistic, 'server', SERVER_CONFIRMED),
      );
      const repo = new FirestoreSettingsRepository(fakeDb, 'org-fictief', 'team-fictief');
      const seen: Array<[unknown, string, number | undefined]> = [];

      repo.subscribe((s, sync, updatedAt) => seen.push([s.teamName, sync.status, updatedAt]));

      expect(seen).toEqual([
        ['Oud', 'lokaal-beschikbaar', SERVER_MILLIS],
        ['Offline Nieuw', 'wacht-op-synchronisatie', ESTIMATE_MILLIS],
        ['Offline Nieuw', 'gesynchroniseerd', SERVER_MILLIS],
      ]);
    },
  );
});

describe('FirestoreRosterRepository — nog-onbevestigde serverTimestamp() in de lokale weergave', () => {
  it('read() uit de cache levert de eigen optimistische spelerslijst i.p.v. te rejecten', async () => {
    (getDocFromCache as Mock).mockResolvedValueOnce(
      fakeSnap({ players: [PLAYER, OTHER_PLAYER] }, 'pending', PENDING_OFFLINE),
    );
    (getDoc as Mock).mockResolvedValueOnce(
      fakeSnap({ players: [PLAYER, OTHER_PLAYER] }, 'pending', PENDING_OFFLINE),
    );
    const repo = new FirestoreRosterRepository(fakeDb, 'org-fictief', 'team-fictief');

    const out = await repo.read();

    expect(out).toEqual([PLAYER, OTHER_PLAYER]);
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('read() via de getDoc()-terugval (cache-miss) leest een wachtende write ook met de schatting', async () => {
    (getDocFromCache as Mock).mockRejectedValueOnce(new Error('niet in cache'));
    (getDoc as Mock).mockResolvedValueOnce(
      fakeSnap({ players: [PLAYER, OTHER_PLAYER] }, 'pending', PENDING_OFFLINE),
    );
    const repo = new FirestoreRosterRepository(fakeDb, 'org-fictief', 'team-fictief');

    await expect(repo.read()).resolves.toEqual([PLAYER, OTHER_PLAYER]);
  });

  it('subscribe() emit de optimistische spelerslijst met wacht-op-synchronisatie', () => {
    deliverSnapshots(fakeSnap({ players: [PLAYER, OTHER_PLAYER] }, 'pending', PENDING_OFFLINE));
    const repo = new FirestoreRosterRepository(fakeDb, 'org-fictief', 'team-fictief');
    const seen: Array<{ count: number; sync: SyncState; updatedAt?: number }> = [];

    repo.subscribe((players, sync, updatedAt) =>
      seen.push({ count: players.length, sync, updatedAt }),
    );

    expect(seen).toEqual([
      {
        count: 2,
        sync: { status: 'wacht-op-synchronisatie', fromCache: true, hasPendingWrites: true },
        updatedAt: ESTIMATE_MILLIS,
      },
    ]);
  });

  it(
    'een eerdere cache-snapshot met de oude lijst wordt door de volgende pending-snapshot ' +
      'overschreven, en pas de serverbevestiging geeft gesynchroniseerd',
    () => {
      deliverSnapshots(
        fakeSnap({ players: [PLAYER] }, 'server', CACHE_ONLY),
        fakeSnap({ players: [PLAYER, OTHER_PLAYER] }, 'pending', PENDING_OFFLINE),
        fakeSnap({ players: [PLAYER, OTHER_PLAYER] }, 'server', SERVER_CONFIRMED),
      );
      const repo = new FirestoreRosterRepository(fakeDb, 'org-fictief', 'team-fictief');
      const seen: Array<[number, string, number | undefined]> = [];

      repo.subscribe((players, sync, updatedAt) =>
        seen.push([players.length, sync.status, updatedAt]),
      );

      expect(seen).toEqual([
        [1, 'lokaal-beschikbaar', SERVER_MILLIS],
        [2, 'wacht-op-synchronisatie', ESTIMATE_MILLIS],
        [2, 'gesynchroniseerd', SERVER_MILLIS],
      ]);
    },
  );
});
