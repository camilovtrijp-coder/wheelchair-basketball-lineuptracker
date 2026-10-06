// Offline wedstrijd: een `setDoc()` die op `withTimeout()` afketst, blijft in
// Firestores lokale schrijfwachtrij staan. Elke volgende sync-cyclus stuurde
// dezelfde action opnieuw, wat de wachtrij liet oplopen met dubbele creates die
// na reconnect door de Rules worden geweigerd (follow-up uit de review van #100).
// `uploadActions()` kijkt daarom eerst cache-only (`getDocFromCache`, geen netwerk,
// dus geen hang) of dezelfde action al in de wachtrij staat of al bevestigd is.
// De SDK-aanname zelf (offline `setDoc` is daarna lokaal leesbaar met
// `hasPendingWrites`) is tegen de echte SDK bewezen in
// firebase/tests/rules/sdk-offline-write-queue.spec.ts.
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocFromCache: vi.fn(),
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

import { doc, getDoc, getDocFromCache, setDoc, type Firestore } from 'firebase/firestore';
import type { GameActionEnvelopeDocument } from 'firebase-base/documents';
import { FirestoreGameCloudGateway } from '../../src/infrastructure/game/FirestoreGameCloudGateway';

const fakeDb = {} as unknown as Firestore;
const TIMEOUT_MS = 20;
const never = () => new Promise<void>(() => {});

function makeAction(id: string, delta = 2): GameActionEnvelopeDocument {
  return {
    organizationId: 'org-1',
    teamId: 'team-1',
    gameId: 'game-1',
    actionId: id,
    authorUid: 'uid-fictief',
    deviceId: 'device-fictief',
    writerEpoch: 0,
    sequence: 0,
    occurredAt: '2026-01-01T00:10:00.000Z',
    schemaVersion: 1,
    action: { type: 'score-delta', team: 'for', delta },
  };
}

const refFor = (id: string) => {
  const ref: Record<string, unknown> = { id };
  ref.withConverter = () => ref;
  return ref;
};

function cached(action: GameActionEnvelopeDocument, pending: boolean) {
  return {
    exists: () => true,
    metadata: { hasPendingWrites: pending, fromCache: true },
    data: () => action,
  };
}

const miss = () => Promise.reject(new Error('Failed to get document from cache'));

describe('FirestoreGameCloudGateway.uploadActions() — niet opnieuw versturen wat al in de wachtrij staat', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (doc as Mock).mockImplementation((_db: unknown, ...path: string[]) => refFor(path.join('/')));
    (getDoc as Mock).mockImplementation(miss);
  });

  const gateway = () => new FirestoreGameCloudGateway(fakeDb, TIMEOUT_MS);

  it('een identieke action die al in de wachtrij staat wordt NIET opnieuw verstuurd en is niet bevestigd', async () => {
    const action = makeAction('a-1');
    (getDocFromCache as Mock).mockResolvedValue(cached(action, true));

    const outcomes = await gateway().uploadActions('org-1', 'team-1', 'game-1', [action]);

    expect(setDoc).not.toHaveBeenCalled();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ actionId: 'a-1', ok: false, alreadyQueued: true });
    expect(outcomes[0]?.alreadyConfirmed).toBeUndefined();
    expect(outcomes[0]?.error).toBeInstanceOf(Error);
  });

  it('een server-bevestigde identieke action in de cache is alreadyConfirmed, zonder setDoc', async () => {
    const action = makeAction('a-1');
    (getDocFromCache as Mock).mockResolvedValue(cached(action, false));

    const outcomes = await gateway().uploadActions('org-1', 'team-1', 'game-1', [action]);

    expect(setDoc).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ actionId: 'a-1', ok: true, alreadyConfirmed: true }]);
  });

  it('een cache-miss valt terug op gewoon versturen', async () => {
    const action = makeAction('a-1');
    (getDocFromCache as Mock).mockImplementation(miss);
    (setDoc as Mock).mockResolvedValue(undefined);

    const outcomes = await gateway().uploadActions('org-1', 'team-1', 'game-1', [action]);

    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([{ actionId: 'a-1', ok: true }]);
  });

  it('een lokale kopie met een ANDERE payload blokkeert het versturen niet', async () => {
    const action = makeAction('a-1', 2);
    (getDocFromCache as Mock).mockResolvedValue(cached(makeAction('a-1', 3), true));
    (setDoc as Mock).mockResolvedValue(undefined);

    const outcomes = await gateway().uploadActions('org-1', 'team-1', 'game-1', [action]);

    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(outcomes[0]).toMatchObject({ actionId: 'a-1', ok: true });
  });

  it('een bestaande-maar-onleesbare cache (leesfout) valt terug op gewoon versturen', async () => {
    const action = makeAction('a-1');
    (getDocFromCache as Mock).mockResolvedValue({
      exists: () => true,
      metadata: { hasPendingWrites: true },
      data: () => {
        throw new Error('onleesbaar');
      },
    });
    (setDoc as Mock).mockResolvedValue(undefined);

    const outcomes = await gateway().uploadActions('org-1', 'team-1', 'game-1', [action]);

    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([{ actionId: 'a-1', ok: true }]);
  });

  it('gemengd: alleen de nieuwe action wordt verstuurd, de uitkomsten blijven in volgorde', async () => {
    const queued = makeAction('a-1');
    const confirmed = makeAction('a-2');
    const fresh = makeAction('a-3');
    (getDocFromCache as Mock).mockImplementation((ref: { id: string }) => {
      if (ref.id.endsWith('a-1')) return Promise.resolve(cached(queued, true));
      if (ref.id.endsWith('a-2')) return Promise.resolve(cached(confirmed, false));
      return miss();
    });
    (setDoc as Mock).mockResolvedValue(undefined);

    const outcomes = await gateway().uploadActions('org-1', 'team-1', 'game-1', [
      queued,
      confirmed,
      fresh,
    ]);

    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(((setDoc as Mock).mock.calls[0]?.[1] as GameActionEnvelopeDocument).actionId).toBe(
      'a-3',
    );
    expect(outcomes.map((o) => [o.actionId, o.ok])).toEqual([
      ['a-1', false],
      ['a-2', true],
      ['a-3', true],
    ]);
  });

  it('offline over meerdere sync-cycli: de wachtrij groeit niet (één setDoc per action)', async () => {
    const actions = [makeAction('a-1'), makeAction('a-2'), makeAction('a-3')];
    const queue = new Set<string>();
    // Simuleert Firestore: een setDoc die nooit bevestigt staat daarna in de wachtrij.
    (setDoc as Mock).mockImplementation((ref: { id: string }) => {
      queue.add(ref.id);
      return never();
    });
    (getDocFromCache as Mock).mockImplementation((ref: { id: string }) => {
      const action = actions.find((a) => ref.id.endsWith(a.actionId));
      return queue.has(ref.id) && action ? Promise.resolve(cached(action, true)) : miss();
    });
    (getDoc as Mock).mockImplementation((ref: { id: string }) => {
      const action = actions.find((a) => ref.id.endsWith(a.actionId));
      return queue.has(ref.id) && action ? Promise.resolve(cached(action, true)) : miss();
    });

    for (let cycle = 0; cycle < 5; cycle++) {
      const outcomes = await gateway().uploadActions('org-1', 'team-1', 'game-1', actions);
      expect(outcomes.every((o) => !o.ok)).toBe(true);
    }

    expect(setDoc).toHaveBeenCalledTimes(actions.length);
  });

  it('na de reconnect: een bevestigde action wordt niet meer verstuurd, ook niet als de wachtrij leeg is', async () => {
    const action = makeAction('a-1');
    // Wachtrij is afgeleverd: de cache toont het document zonder wachtende write.
    (getDocFromCache as Mock).mockResolvedValue(cached(action, false));

    const outcomes = await gateway().uploadActions('org-1', 'team-1', 'game-1', [action]);

    expect(setDoc).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ ok: true, alreadyConfirmed: true });
  });
});
