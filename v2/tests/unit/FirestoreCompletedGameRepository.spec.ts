import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
}));

vi.mock('firebase-base/documents', () => ({
  completedGameConverter: {
    toFirestore: (data: unknown) => data,
    fromFirestore: (snap: { data: () => unknown }) => snap.data(),
  },
}));

import { collection, query, orderBy, limit, onSnapshot, type Firestore } from 'firebase/firestore';
import type { CompletedGameDocument } from 'firebase-base/documents';
import {
  FirestoreCompletedGameRepository,
  completedGameFromDocument,
  COMPLETED_GAMES_QUERY_LIMIT,
} from '../../src/infrastructure/game/FirestoreCompletedGameRepository';
import type { CompletedGame } from '../../src/domain/game/types';

const fakeCollectionRef = { withConverter: () => fakeCollectionRef } as unknown as ReturnType<
  typeof collection
>;
const fakeQueryRef = {} as unknown as ReturnType<typeof query>;
const fakeDb = {} as unknown as Firestore;

function sampleDoc(overrides: Partial<CompletedGameDocument> = {}): CompletedGameDocument {
  return {
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
    // syncedAt heeft geen domeinequivalent — irrelevant voor deze tests, elke
    // waarde volstaat als stand-in.
    syncedAt: {} as CompletedGameDocument['syncedAt'],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (collection as Mock).mockReturnValue(fakeCollectionRef);
  (query as Mock).mockReturnValue(fakeQueryRef);
});

describe('completedGameFromDocument', () => {
  it('projecteert het document terug naar de domeinvorm, met id uit het pad en zonder syncedAt', () => {
    const out = completedGameFromDocument('completed-1', sampleDoc());
    const expected: CompletedGame = {
      id: 'completed-1',
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
    };
    expect(out).toEqual(expected);
    expect(out).not.toHaveProperty('syncedAt');
  });
});

describe('FirestoreCompletedGameRepository — query', () => {
  it('bouwt de query begrensd op orgId/teamId, gesorteerd op date desc, met een vaste bovengrens', () => {
    (onSnapshot as Mock).mockImplementation(() => () => undefined);
    const repo = new FirestoreCompletedGameRepository(fakeDb, 'org-1', 'team-1');
    repo.subscribe(() => undefined);
    expect(collection).toHaveBeenCalledWith(
      fakeDb,
      'organizations',
      'org-1',
      'teams',
      'team-1',
      'completedGames',
    );
    expect(orderBy).toHaveBeenCalledWith('date', 'desc');
    expect(limit).toHaveBeenCalledWith(COMPLETED_GAMES_QUERY_LIMIT);
  });
});

describe('FirestoreCompletedGameRepository — subscribe', () => {
  it('emitteert de volledige, actuele resultaatset plus afgeleide SyncState bij elke snapshot', () => {
    (onSnapshot as Mock).mockImplementationOnce(
      (
        _ref: unknown,
        _opts: unknown,
        onNext: (snap: {
          docs: Array<{ id: string; data: () => CompletedGameDocument }>;
          metadata: { fromCache: boolean; hasPendingWrites: boolean };
        }) => void,
      ) => {
        onNext({
          docs: [
            { id: 'completed-1', data: () => sampleDoc() },
            { id: 'completed-2', data: () => sampleDoc({ sourceGameId: 'active-2' }) },
          ],
          metadata: { fromCache: false, hasPendingWrites: false },
        });
        return () => undefined;
      },
    );
    const repo = new FirestoreCompletedGameRepository(fakeDb, 'org-1', 'team-1');
    const seen: Array<{ ids: string[]; status: string }> = [];
    repo.subscribe((games, sync) =>
      seen.push({ ids: games.map((g) => g.id), status: sync.status }),
    );
    expect(seen).toEqual([{ ids: ['completed-1', 'completed-2'], status: 'gesynchroniseerd' }]);
  });

  it('geeft een queryfout door aan onError', () => {
    const failure = new Error('permission-denied');
    (onSnapshot as Mock).mockImplementationOnce(
      (_ref: unknown, _opts: unknown, _onNext: unknown, onError: (err: unknown) => void) => {
        onError(failure);
        return () => undefined;
      },
    );
    const repo = new FirestoreCompletedGameRepository(fakeDb, 'org-1', 'team-1');
    const errors: unknown[] = [];
    repo.subscribe(
      () => undefined,
      (err) => errors.push(err),
    );
    expect(errors).toEqual([failure]);
  });

  it('geeft de unsubscribe-functie van onSnapshot door', () => {
    const unsub = vi.fn();
    (onSnapshot as Mock).mockReturnValueOnce(unsub);
    const repo = new FirestoreCompletedGameRepository(fakeDb, 'org-1', 'team-1');
    const returned = repo.subscribe(() => undefined);
    expect(returned).toBe(unsub);
  });
});
