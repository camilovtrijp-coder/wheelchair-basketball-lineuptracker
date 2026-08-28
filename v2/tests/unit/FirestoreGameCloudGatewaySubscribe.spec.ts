// P1-fix (vierde ronde externe review PR #81): `FirestoreGameCloudGateway.
// subscribeToGame()` had geen eigen unit-tests (alleen indirect gedekt via de
// echte-emulator e2e-suite, tests/e2e-auth/game-sync-takeover.spec.ts) — deze
// jsdom-tests dekken de conversiefout-afhandeling in isolatie, zonder de
// Firestore-emulator nodig te hebben. Zelfde mockpatroon als
// FirestoreCompletedGameRepository.spec.ts (`vi.mock('firebase/firestore', ...)`).
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock('firebase-base/documents', () => ({
  gameConverter: { toFirestore: (data: unknown) => data },
  gameActionConverter: { toFirestore: (data: unknown) => data },
}));

import { collection, doc, onSnapshot, orderBy, query, type Firestore } from 'firebase/firestore';
import { FirestoreGameCloudGateway } from '../../src/infrastructure/game/FirestoreGameCloudGateway';
import type {
  GameCloudParentUpdate,
  GameCloudActionsUpdate,
} from '../../src/application/game/GameCloudGateway';

const fakeDb = {} as unknown as Firestore;
const fakeGameRef = { withConverter: () => fakeGameRef } as unknown as ReturnType<typeof doc>;
const fakeActionsCollectionRef = {} as unknown as ReturnType<typeof collection>;
const fakeActionsQueryRef = { withConverter: () => fakeActionsQueryRef } as unknown as ReturnType<
  typeof query
>;

type SnapshotCallback = (snapshot: unknown) => void;
type ErrorCallback = (error: unknown) => void;

function setup() {
  let parentOnNext: SnapshotCallback | undefined;
  let parentOnError: ErrorCallback | undefined;
  let actionsOnNext: SnapshotCallback | undefined;
  let actionsOnError: ErrorCallback | undefined;

  (onSnapshot as Mock).mockImplementation(
    (ref: unknown, _opts: unknown, onNext: SnapshotCallback, onError: ErrorCallback) => {
      if (ref === fakeGameRef) {
        parentOnNext = onNext;
        parentOnError = onError;
      } else if (ref === fakeActionsQueryRef) {
        actionsOnNext = onNext;
        actionsOnError = onError;
      }
      return vi.fn();
    },
  );

  const onParent = vi.fn<(update: GameCloudParentUpdate) => void>();
  const onActions = vi.fn<(update: GameCloudActionsUpdate) => void>();
  const onError = vi.fn<(error: unknown) => void>();

  const gateway = new FirestoreGameCloudGateway(fakeDb);
  gateway.subscribeToGame('org-1', 'team-1', 'game-1', { onParent, onActions, onError });

  return {
    onParent,
    onActions,
    onError,
    emitParent: (snapshot: unknown) => parentOnNext?.(snapshot),
    emitActions: (snapshot: unknown) => actionsOnNext?.(snapshot),
    failParent: (error: unknown) => parentOnError?.(error),
    failActions: (error: unknown) => actionsOnError?.(error),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (doc as Mock).mockReturnValue(fakeGameRef);
  (collection as Mock).mockReturnValue(fakeActionsCollectionRef);
  (query as Mock).mockReturnValue(fakeActionsQueryRef);
  (orderBy as Mock).mockReturnValue(undefined);
});

describe('FirestoreGameCloudGateway.subscribeToGame — parentlistener conversiefouten', () => {
  it('slaat een tussentijdse snapshot met hasPendingWrites:true en een onopgeloste serverTimestamp() stil over', () => {
    const { onParent, onError, emitParent } = setup();
    const pendingError = new Error('game: veld "updatedAt" moet een Firestore Timestamp zijn');

    emitParent({
      exists: () => true,
      data: () => {
        throw pendingError;
      },
      metadata: { fromCache: false, hasPendingWrites: true },
    });

    expect(onParent).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('verwerkt een latere, wél geldige snapshot na een overgeslagen tussentijdse snapshot gewoon', () => {
    const { onParent, onError, emitParent } = setup();
    emitParent({
      exists: () => true,
      data: () => {
        throw new Error('nog pending');
      },
      metadata: { fromCache: false, hasPendingWrites: true },
    });

    const confirmedDoc = { revision: 3 };
    emitParent({
      exists: () => true,
      data: () => confirmedDoc,
      metadata: { fromCache: false, hasPendingWrites: false },
    });

    expect(onError).not.toHaveBeenCalled();
    expect(onParent).toHaveBeenCalledTimes(1);
    expect(onParent).toHaveBeenCalledWith({
      doc: confirmedDoc,
      meta: { fromCache: false, hasPendingWrites: false },
    });
  });

  it('meldt een conversiefout op een bevestigde (hasPendingWrites:false) snapshot via onError, nooit via onParent', () => {
    const { onParent, onError, emitParent } = setup();
    const corruptError = new Error('game: veld "revision" moet een geheel getal zijn');

    emitParent({
      exists: () => true,
      data: () => {
        throw corruptError;
      },
      metadata: { fromCache: false, hasPendingWrites: false },
    });

    expect(onParent).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(corruptError);
  });

  it('meldt een conversiefout op een snapshot uit cache (hasPendingWrites:false) ook via onError', () => {
    const { onParent, onError, emitParent } = setup();
    const corruptError = new Error('corrupt');

    emitParent({
      exists: () => true,
      data: () => {
        throw corruptError;
      },
      metadata: { fromCache: true, hasPendingWrites: false },
    });

    expect(onParent).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(corruptError);
  });
});

describe('FirestoreGameCloudGateway.subscribeToGame — actionslistener conversiefouten', () => {
  it('meldt een corrupt actiondocument altijd via onError, nooit een gedeeltelijke onActions', () => {
    const { onActions, onError, emitActions } = setup();
    const corruptError = new Error('gameAction: veld "sequence" moet een geheel getal zijn');

    emitActions({
      docs: [
        { data: () => ({ actionId: 'a-1', sequence: 0 }) },
        {
          data: () => {
            throw corruptError;
          },
        },
      ],
      metadata: { fromCache: false, hasPendingWrites: false },
    });

    expect(onActions).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(corruptError);
  });

  it('meldt een corrupt actiondocument via onError zelfs met hasPendingWrites:true (geen serverTimestamp-veld om dat te verklaren)', () => {
    const { onActions, onError, emitActions } = setup();
    const corruptError = new Error('corrupt');

    emitActions({
      docs: [
        {
          data: () => {
            throw corruptError;
          },
        },
      ],
      metadata: { fromCache: false, hasPendingWrites: true },
    });

    expect(onActions).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(corruptError);
  });

  it('verwerkt een latere, wél geldige actions-snapshot na een gemelde conversiefout gewoon', () => {
    const { onActions, onError, emitActions } = setup();
    emitActions({
      docs: [
        {
          data: () => {
            throw new Error('corrupt');
          },
        },
      ],
      metadata: { fromCache: false, hasPendingWrites: false },
    });

    const validAction = { actionId: 'a-1', sequence: 0 };
    emitActions({
      docs: [{ data: () => validAction }],
      metadata: { fromCache: false, hasPendingWrites: false },
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onActions).toHaveBeenCalledTimes(1);
    expect(onActions).toHaveBeenCalledWith({
      actions: [validAction],
      meta: { fromCache: false, hasPendingWrites: false },
    });
  });
});

describe('FirestoreGameCloudGateway.subscribeToGame — listenerfouten', () => {
  it('geeft een parent-queryfout door aan onError', () => {
    const { onError, failParent } = setup();
    const failure = new Error('permission-denied');
    failParent(failure);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('geeft een actions-queryfout door aan onError', () => {
    const { onError, failActions } = setup();
    const failure = new Error('permission-denied');
    failActions(failure);
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
