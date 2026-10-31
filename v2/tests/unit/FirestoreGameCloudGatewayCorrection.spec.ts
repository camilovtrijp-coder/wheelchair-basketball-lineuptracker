// PR 7.5c (docs/pr-7.5-plan.md §D.3): `correctCompletedGame()` — één atomische
// updateDoc, geen pre-read, idempotent bij een retry en eerlijk over conflicten
// en nog-niet-bevestigde (wachtende) writes. Fictieve data; Firestore gemockt
// (de echte Rules-bewijzen staan in firebase/tests/rules).
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('firebase/firestore', () => ({
  arrayUnion: vi.fn((...items: unknown[]) => ({ __arrayUnion: items })),
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
  waitForPendingWrites: vi.fn(() => Promise.resolve()),
  writeBatch: vi.fn(),
}));

vi.mock('firebase-base/documents', () => ({
  gameConverter: { toFirestore: (data: unknown) => data },
  gameActionConverter: { toFirestore: (data: unknown) => data },
}));

import { doc, getDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { FirestoreGameCloudGateway } from '../../src/infrastructure/game/FirestoreGameCloudGateway';
import type { CompletedGameCorrectionPayload } from '../../src/application/game/GameCloudGateway';

const fakeDb = {} as unknown as Firestore;
const fakeRef = { withConverter: () => fakeRef } as unknown as ReturnType<typeof doc>;

const payload: CompletedGameCorrectionPayload = {
  segments: [
    {
      id: 's1',
      quarter: 1,
      beginSec: 600,
      endSec: 300,
      durSec: 300,
      lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
      pf: 9,
      pa: 4,
      classSum: 15,
      allowed: 14.5,
      over: true,
      tov: 3,
    },
  ],
  scoreFor: 17,
  scoreAgainst: 10,
  correction: {
    id: 'corr-1',
    segmentId: 's1',
    segmentIndex: 0,
    at: '2026-02-02T09:00:00.000Z',
    by: 'uid-coach',
    before: { quarter: 1, beginSec: 600, endSec: 420, pf: 6, pa: 4, tov: 2 },
    after: { quarter: 1, beginSec: 600, endSec: 300, pf: 9, pa: 4, tov: 3 },
  },
};

function snapshot(data: Record<string, unknown>, hasPendingWrites = false) {
  return {
    exists: () => true,
    metadata: { hasPendingWrites, fromCache: hasPendingWrites },
    data: vi.fn(() => data),
  };
}

const permissionDenied = Object.assign(new Error('Missing or insufficient permissions.'), {
  code: 'permission-denied',
});

function gateway(timeoutMs = 50) {
  return new FirestoreGameCloudGateway(fakeDb, timeoutMs);
}

describe('FirestoreGameCloudGateway.correctCompletedGame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (doc as Mock).mockReturnValue(fakeRef);
  });

  it('succespad: één updateDoc met de smalle velden, revisie +1, serverTimestamp; nul reads', async () => {
    (updateDoc as Mock).mockResolvedValue(undefined);
    const result = await gateway().correctCompletedGame('org-1', 'team-1', 'cg-1', 4, payload);

    expect(result).toEqual({ ok: true, revision: 5 });
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc).toHaveBeenCalledWith(fakeRef, {
      segments: payload.segments,
      scoreFor: 17,
      scoreAgainst: 10,
      corrections: { __arrayUnion: [payload.correction] },
      correctedAt: 'server-timestamp-sentinel',
      revision: 5,
    });
    expect(getDoc).not.toHaveBeenCalled();
    expect(doc).toHaveBeenCalledWith(
      fakeDb,
      'organizations',
      'org-1',
      'teams',
      'team-1',
      'completedGames',
      'cg-1',
    );
  });

  it('stuurt geen andere velden mee (players/date/organizationId/... blijven onaangeroerd)', async () => {
    (updateDoc as Mock).mockResolvedValue(undefined);
    await gateway().correctCompletedGame('org-1', 'team-1', 'cg-1', 0, payload);
    const sent = (updateDoc as Mock).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(
      ['corrections', 'correctedAt', 'revision', 'scoreAgainst', 'scoreFor', 'segments'].sort(),
    );
  });

  it('idempotente retry: write geweigerd maar het item staat server-bevestigd in het log → ok, alreadyApplied, geen tweede logregel', async () => {
    (updateDoc as Mock).mockRejectedValue(permissionDenied);
    (getDoc as Mock).mockResolvedValue(
      snapshot({ revision: 5, corrections: [payload.correction] }),
    );
    const result = await gateway().correctCompletedGame('org-1', 'team-1', 'cg-1', 4, payload);
    expect(result).toEqual({ ok: true, revision: 5, alreadyApplied: true });
    expect(updateDoc).toHaveBeenCalledTimes(1);
  });

  it('geen vals succes: item staat er wel, maar nog als wachtende lokale write → ok: false', async () => {
    (updateDoc as Mock).mockRejectedValue(new Error('offline'));
    (getDoc as Mock).mockResolvedValue(
      snapshot({ revision: 5, corrections: [payload.correction] }, true),
    );
    const result = await gateway().correctCompletedGame('org-1', 'team-1', 'cg-1', 4, payload);
    expect(result.ok).toBe(false);
    expect(result.alreadyApplied).toBeUndefined();
    expect(result.conflict).toBeUndefined();
  });

  it('readback met geschatte servertijden (zelfde patroon als de andere getDoc-paden)', async () => {
    (updateDoc as Mock).mockRejectedValue(permissionDenied);
    const snap = snapshot({ revision: 4, corrections: [] });
    (getDoc as Mock).mockResolvedValue(snap);
    await gateway().correctCompletedGame('org-1', 'team-1', 'cg-1', 4, payload);
    expect(snap.data).toHaveBeenCalledWith({ serverTimestamps: 'estimate' });
  });

  it('conflict: een ander apparaat was eerder (serverrevisie ≠ verwacht, item ontbreekt) → ok: false, conflict, serverrevisie', async () => {
    (updateDoc as Mock).mockRejectedValue(permissionDenied);
    (getDoc as Mock).mockResolvedValue(
      snapshot({
        revision: 5,
        corrections: [{ ...payload.correction, id: 'corr-ander-apparaat' }],
      }),
    );
    const result = await gateway().correctCompletedGame('org-1', 'team-1', 'cg-1', 4, payload);
    expect(result).toMatchObject({ ok: false, conflict: true, revision: 5 });
    expect(result.error).toBe(permissionDenied);
  });

  it('een Rules-afwijzing zonder revisieverschil (bijv. scorer/viewer) is een gewone fout, geen conflict', async () => {
    (updateDoc as Mock).mockRejectedValue(permissionDenied);
    (getDoc as Mock).mockResolvedValue(snapshot({ revision: 4 }));
    const result = await gateway().correctCompletedGame('org-1', 'team-1', 'cg-1', 4, payload);
    expect(result.ok).toBe(false);
    expect(result.conflict).toBeUndefined();
    expect(result.error).toBe(permissionDenied);
  });

  it('een legacy-document zonder revision/corrections: verwachte revisie 0 is geen conflict', async () => {
    (updateDoc as Mock).mockRejectedValue(new Error('netwerk'));
    (getDoc as Mock).mockResolvedValue(snapshot({}));
    const result = await gateway().correctCompletedGame('org-1', 'team-1', 'cg-1', 0, payload);
    expect(result.ok).toBe(false);
    expect(result.conflict).toBeUndefined();
  });

  it('timeout van de write: ok: false (retrybaar); readback zonder cache valt terug op de write-fout', async () => {
    (updateDoc as Mock).mockReturnValue(new Promise(() => undefined));
    (getDoc as Mock).mockRejectedValue(new Error('client is offline'));
    const result = await gateway(20).correctCompletedGame('org-1', 'team-1', 'cg-1', 4, payload);
    expect(result.ok).toBe(false);
    expect((result.error as Error).name).toBe('GameSyncTimeoutError');
  });

  it('nooit een gegooide fout: ook een niet-bestaand document geeft ok: false', async () => {
    (updateDoc as Mock).mockRejectedValue(new Error('not-found'));
    (getDoc as Mock).mockResolvedValue({
      exists: () => false,
      metadata: { hasPendingWrites: false },
    });
    const result = await gateway().correctCompletedGame('org-1', 'team-1', 'cg-1', 4, payload);
    expect(result.ok).toBe(false);
  });
});
