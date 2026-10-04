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

import { doc, getDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { FirestoreGameCloudGateway } from '../../src/infrastructure/game/FirestoreGameCloudGateway';
import type { GameSnapshotProjection } from '../../src/application/game/GameCloudGateway';

const fakeDb = {} as unknown as Firestore;
const fakeGameRef = { withConverter: () => fakeGameRef } as unknown as ReturnType<typeof doc>;

/** Document met een nog-onbevestigde lokale write: alleen 'estimate' levert een bruikbaar resultaat. */
function pendingWriteSnapshot(revision: number) {
  return {
    exists: () => true,
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

describe('FirestoreGameCloudGateway — nog-onbevestigde serverTimestamp() in de lokale weergave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (doc as Mock).mockReturnValue(fakeGameRef);
  });

  it('ensureGame() leest een bestaand document met een wachtende write als ok, met de lokale revisie', async () => {
    const snapshot = pendingWriteSnapshot(3);
    (getDoc as Mock).mockResolvedValue(snapshot);
    const gateway = new FirestoreGameCloudGateway(fakeDb);

    const result = await gateway.ensureGame(
      'org-fictief',
      'team-fictief',
      'game-fictief',
      {} as GameSnapshotProjection,
    );

    expect(result).toMatchObject({ ok: true, revision: 3, writerUid: 'uid-fictief' });
    expect(snapshot.data).toHaveBeenCalledWith({ serverTimestamps: 'estimate' });
  });

  it('patchSnapshot()-readback gebruikt dezelfde leesopties', async () => {
    const snapshot = pendingWriteSnapshot(5);
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

    expect(result).toMatchObject({ ok: true, revision: 5 });
    expect(snapshot.data).toHaveBeenCalledWith({ serverTimestamps: 'estimate' });
  });
});
