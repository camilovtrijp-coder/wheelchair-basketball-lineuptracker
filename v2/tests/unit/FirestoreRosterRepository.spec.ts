import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocFromCache: vi.fn(),
  setDoc: vi.fn(),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));

vi.mock('firebase-base/documents', () => ({
  rosterConverter: {
    toFirestore: (data: unknown) => data,
    fromFirestore: (snap: { data: () => unknown }) => snap.data(),
  },
}));

import {
  doc,
  getDoc,
  getDocFromCache,
  setDoc,
  onSnapshot,
  type Firestore,
} from 'firebase/firestore';
import { FirestoreRosterRepository } from '../../src/infrastructure/roster/FirestoreRosterRepository';
import type { Roster } from '../../src/domain/roster/types';

function fakeRosterSnap(players: Roster | null) {
  return {
    exists: () => players !== null,
    data: () => (players === null ? null : { players }),
    metadata: { fromCache: false, hasPendingWrites: false },
  };
}

const fakeRef = { withConverter: () => fakeRef } as unknown as ReturnType<typeof doc>;
const fakeDb = {} as unknown as Firestore;

const SAMPLE_PLAYERS: Roster = [
  { id: 1, nr: '7', naam: 'Speler A', kl: '3.0', vrouw: false, jeugd: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  (doc as Mock).mockReturnValue(fakeRef);
});

describe('FirestoreRosterRepository — read', () => {
  it('leest uit cache bij bestaand document', async () => {
    (getDocFromCache as Mock).mockResolvedValueOnce(fakeRosterSnap(SAMPLE_PLAYERS));
    const repo = new FirestoreRosterRepository(fakeDb, 'org-1', 'team-1');
    const out = await repo.read();
    expect(out).toEqual(SAMPLE_PLAYERS);
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('valt terug op server bij cache-fout', async () => {
    (getDocFromCache as Mock).mockRejectedValueOnce(new Error('no-cache'));
    (getDoc as Mock).mockResolvedValueOnce(fakeRosterSnap(SAMPLE_PLAYERS));
    const repo = new FirestoreRosterRepository(fakeDb, 'org-1', 'team-1');
    const out = await repo.read();
    expect(out).toEqual(SAMPLE_PLAYERS);
  });

  it('retourneert een lege array wanneer het document niet bestaat', async () => {
    (getDocFromCache as Mock).mockResolvedValueOnce(fakeRosterSnap(null));
    const repo = new FirestoreRosterRepository(fakeDb, 'org-1', 'team-1');
    expect(await repo.read()).toEqual([]);
  });
});

describe('FirestoreRosterRepository — write (PR 5.3d-vervolgonderzoek: wacht niet op setDoc-ack)', () => {
  it('resolvet meteen met ok:true/wacht-op-synchronisatie, zonder op setDoc() te wachten', async () => {
    let resolveSetDoc!: () => void;
    (setDoc as Mock).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveSetDoc = resolve;
      }),
    );
    const repo = new FirestoreRosterRepository(fakeDb, 'org-1', 'team-1');
    const result = await repo.write(SAMPLE_PLAYERS);
    expect(result.ok).toBe(true);
    expect(result.syncState.status).toBe('wacht-op-synchronisatie');
    resolveSetDoc();
    await result.settled;
  });

  it('settled resolvet {ok:true} zodra setDoc() de backend bevestigt', async () => {
    (setDoc as Mock).mockResolvedValueOnce(undefined);
    const repo = new FirestoreRosterRepository(fakeDb, 'org-1', 'team-1');
    const result = await repo.write(SAMPLE_PLAYERS);
    await expect(result.settled).resolves.toEqual({ ok: true });
  });

  it('settled resolvet {ok:false, error} bij een geweigerde write, reject zelf nooit', async () => {
    const rejection = new Error('permission-denied');
    (setDoc as Mock).mockRejectedValueOnce(rejection);
    const repo = new FirestoreRosterRepository(fakeDb, 'org-1', 'team-1');
    const result = await repo.write(SAMPLE_PLAYERS);
    await expect(result.settled).resolves.toEqual({ ok: false, error: rejection });
  });

  it('één save veroorzaakt precies één setDoc-call (idempotentie / geen retry-duplicatie)', async () => {
    (setDoc as Mock).mockResolvedValue(undefined);
    const repo = new FirestoreRosterRepository(fakeDb, 'org-1', 'team-1');
    const result = await repo.write(SAMPLE_PLAYERS);
    await result.settled;
    expect(setDoc).toHaveBeenCalledTimes(1);
  });
});

describe('FirestoreRosterRepository — subscribe', () => {
  it('emitteert niets bij niet-bestaand document (geen stille lege roster)', () => {
    // Regressietest voor het asymmetrie-gat uit de PR-review: een ongecachete,
    // offline context mag niet ononderscheidbaar zijn van een team met écht nul
    // spelers. Spiegelt FirestoreSettingsRepository — zie ook SPIKE_REPORT.md §5.7.
    (onSnapshot as Mock).mockImplementationOnce(
      (
        _ref: unknown,
        _opts: unknown,
        onNext: (snap: { exists: () => boolean; data: () => unknown; metadata: object }) => void,
      ) => {
        onNext({
          exists: () => false,
          data: () => null,
          metadata: { fromCache: false, hasPendingWrites: false },
        });
        return () => undefined;
      },
    );
    const repo = new FirestoreRosterRepository(fakeDb, 'org-1', 'team-1');
    const seen: Roster[] = [];
    repo.subscribe((players) => seen.push(players));
    expect(seen).toHaveLength(0);
  });

  it('emitteert roster + syncState bij bestaand document', () => {
    (onSnapshot as Mock).mockImplementationOnce(
      (
        _ref: unknown,
        _opts: unknown,
        onNext: (snap: { exists: () => boolean; data: () => unknown; metadata: object }) => void,
      ) => {
        onNext({
          exists: () => true,
          data: () => ({ players: SAMPLE_PLAYERS }),
          metadata: { fromCache: false, hasPendingWrites: false },
        });
        return () => undefined;
      },
    );
    const repo = new FirestoreRosterRepository(fakeDb, 'org-1', 'team-1');
    const seen: Array<{ players: Roster; status: string }> = [];
    repo.subscribe((players, sync) => seen.push({ players, status: sync.status }));
    expect(seen).toEqual([{ players: SAMPLE_PLAYERS, status: 'gesynchroniseerd' }]);
  });
});
