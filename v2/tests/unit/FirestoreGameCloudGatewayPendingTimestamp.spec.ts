// e2e-stabiliteit (game-sync-offline-reconnect/-weak-network): een
// `updateDoc()` die op `withTimeout()` afketst, blijft in Firestores lokale
// schrijfwachtrij staan. Zolang die nog niet bevestigd is, levert `getDoc()`
// het parent-gamedocument met een onopgeloste `serverTimestamp()` op — met de
// Firestore-default als `updatedAt: null`, wat `gameConverter` afwijst. Deze
// tests leggen vast dat elke game-`getDoc()` in de sync-paden de lokale
// schatting opvraagt (`serverTimestamps: 'estimate'`), zodat de volgende
// sync-cyclus (bijv. de reconnect-trigger) niet op `actie-nodig` strandt.
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocFromCache: vi.fn(() => Promise.reject(new Error('cache miss'))),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  serverTimestamp: vi.fn(() => 'server-timestamp-sentinel'),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock('firebase-base/documents', () => ({
  gameConverter: { toFirestore: (data: unknown) => data },
  gameActionConverter: { toFirestore: (data: unknown) => data },
}));

import { doc, getDoc, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { FirestoreGameCloudGateway } from '../../src/infrastructure/game/FirestoreGameCloudGateway';
import type {
  CompletedGameSnapshotProjection,
  GameSnapshotProjection,
} from '../../src/application/game/GameCloudGateway';

const fakeDb = {} as unknown as Firestore;
const fakeGameRef = { withConverter: () => fakeGameRef } as unknown as ReturnType<typeof doc>;

/**
 * Document met een nog-onbevestigde lokale write: alleen 'estimate' levert
 * een bruikbaar resultaat; `metadata.hasPendingWrites` staat aan. De revisie
 * wijkt in elke test bewust af van de fallback-waarde die de gateway zonder
 * bruikbare readback zou teruggeven, zodat een revert van de leesopties in
 * ELK van de vijf leespunten zichtbaar faalt.
 */
function pendingWriteSnapshot(revision: number) {
  return {
    exists: () => true,
    metadata: { hasPendingWrites: true, fromCache: true },
    data: vi.fn((options?: { serverTimestamps?: string }) => {
      if (options?.serverTimestamps !== 'estimate') {
        throw new Error('game: veld "updatedAt" moet een Firestore Timestamp zijn');
      }
      return {
        revision,
        writerUid: 'uid-fictief',
        deviceId: 'device-fictief',
        writerEpoch: 0,
        claimedAt: '2026-01-01T00:00:00.000Z',
        completedGameId: null,
      };
    }),
  };
}

const missingSnapshot = { exists: () => false, metadata: { hasPendingWrites: false } };

describe('FirestoreGameCloudGateway — nog-onbevestigde serverTimestamp() in de lokale weergave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (doc as Mock).mockReturnValue(fakeGameRef);
  });

  it('1/5 ensureGame(): bestaand document met een wachtende write → ok, lokale revisie, hasPendingWrites', async () => {
    const snapshot = pendingWriteSnapshot(3);
    (getDoc as Mock).mockResolvedValue(snapshot);
    const gateway = new FirestoreGameCloudGateway(fakeDb);

    const result = await gateway.ensureGame(
      'org-fictief',
      'team-fictief',
      'game-fictief',
      {} as GameSnapshotProjection,
    );

    expect(result).toMatchObject({ ok: true, revision: 3, hasPendingWrites: true });
    expect(snapshot.data).toHaveBeenCalledWith({ serverTimestamps: 'estimate' });
    // Rechtstreeks uit de eerste lezing, niet pas via de catch-readback.
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(snapshot.data).toHaveBeenCalledTimes(1);
  });

  it('2/5 ensureGame()-readback na een mislukte create → ok, lokale revisie, hasPendingWrites', async () => {
    const snapshot = pendingWriteSnapshot(2);
    (getDoc as Mock).mockResolvedValueOnce(missingSnapshot).mockResolvedValueOnce(snapshot);
    (setDoc as Mock).mockRejectedValue(new Error('permission-denied (fictief)'));
    const gateway = new FirestoreGameCloudGateway(fakeDb);

    const result = await gateway.ensureGame(
      'org-fictief',
      'team-fictief',
      'game-fictief',
      {} as GameSnapshotProjection,
    );

    expect(result).toMatchObject({ ok: true, revision: 2, hasPendingWrites: true });
    expect(snapshot.data).toHaveBeenCalledWith({ serverTimestamps: 'estimate' });
  });

  it('3/5 classifyClaimFailure()-readback classificeert met de lokale revisie (stale-revision)', async () => {
    const snapshot = pendingWriteSnapshot(6);
    (updateDoc as Mock).mockRejectedValue(new Error('permission-denied (fictief)'));
    (getDoc as Mock).mockResolvedValue(snapshot);
    const gateway = new FirestoreGameCloudGateway(fakeDb);

    const result = await gateway.claimWriter(
      'org-fictief',
      'team-fictief',
      'game-fictief',
      { authorUid: 'uid-fictief', deviceId: 'device-fictief' },
      4,
      '2026-01-01T00:00:00.000Z',
    );

    // Zonder 'estimate' gooit de readback en valt dit terug op 'unknown'.
    expect(result).toMatchObject({ ok: false, code: 'stale-revision' });
    expect(snapshot.data).toHaveBeenCalledWith({ serverTimestamps: 'estimate' });
  });

  it('4/5 patchSnapshot()-readback gebruikt de lokale revisie i.p.v. de fallback', async () => {
    const snapshot = pendingWriteSnapshot(7);
    (updateDoc as Mock).mockResolvedValue(undefined);
    (getDoc as Mock).mockResolvedValue(snapshot);
    const gateway = new FirestoreGameCloudGateway(fakeDb);

    const result = await gateway.patchSnapshot(
      'org-fictief',
      'team-fictief',
      'game-fictief',
      {},
      4,
    );

    // Fallback zonder bruikbare readback zou revision 5 (= 4 + 1) zijn.
    expect(result).toMatchObject({ ok: true, revision: 7, hasPendingWrites: true });
    expect(snapshot.data).toHaveBeenCalledWith({ serverTimestamps: 'estimate' });
  });

  it('5/5 finalizeCompletedGame()-readback gebruikt de lokale revisie i.p.v. de fallback', async () => {
    const snapshot = pendingWriteSnapshot(9);
    (writeBatch as Mock).mockReturnValue({
      set: vi.fn(),
      update: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    });
    (getDoc as Mock).mockResolvedValue(snapshot);
    const gateway = new FirestoreGameCloudGateway(fakeDb);

    const result = await gateway.finalizeCompletedGame(
      'org-fictief',
      'team-fictief',
      'game-fictief',
      'completed-fictief',
      {} as CompletedGameSnapshotProjection,
      3,
    );

    // Fallback zonder bruikbare readback zou revision 4 (= 3 + 1) zijn.
    expect(result).toMatchObject({ ok: true, revision: 9, hasPendingWrites: true });
    expect(snapshot.data).toHaveBeenCalledWith({ serverTimestamps: 'estimate' });
  });
});
