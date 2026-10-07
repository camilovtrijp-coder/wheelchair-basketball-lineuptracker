import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Mock firebase/firestore vóór de import van de adapter — anders pakt de
// adapter de echte firebase-functies en kunnen we setDoc/getDoc niet spy'en.
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocFromCache: vi.fn(),
  setDoc: vi.fn(),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));

vi.mock('firebase-base/documents', () => ({
  settingsConverter: {
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
import { FirestoreSettingsRepository } from '../../src/infrastructure/settings/FirestoreSettingsRepository';
import { DEFAULT_SETTINGS } from '../../src/domain/settings/types';

function fakeSnap(data: Record<string, unknown> | null) {
  return {
    exists: () => data !== null,
    data: () => data,
    metadata: { fromCache: false, hasPendingWrites: false },
  };
}

const fakeRef = { withConverter: () => fakeRef } as unknown as ReturnType<typeof doc>;
const fakeDb = {} as unknown as Firestore;

beforeEach(() => {
  vi.clearAllMocks();
  (doc as Mock).mockReturnValue(fakeRef);
});

describe('FirestoreSettingsRepository — read', () => {
  it('probeert eerst de cache en retourneert cache-data bij bestaand document', async () => {
    (getDocFromCache as Mock).mockResolvedValueOnce(
      fakeSnap({ ...DEFAULT_SETTINGS, teamName: 'Uit Cache' }),
    );
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    const out = await repo.read();
    expect(out.teamName).toBe('Uit Cache');
    expect(getDocFromCache).toHaveBeenCalledTimes(1);
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('valt terug op server-read wanneer de cache faalt (geen IndexedDB of lege cache)', async () => {
    (getDocFromCache as Mock).mockRejectedValueOnce(new Error('no-cache'));
    (getDoc as Mock).mockResolvedValueOnce(
      fakeSnap({ ...DEFAULT_SETTINGS, teamName: 'Van Server' }),
    );
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    const out = await repo.read();
    expect(out.teamName).toBe('Van Server');
    expect(getDocFromCache).toHaveBeenCalledTimes(1);
    expect(getDoc).toHaveBeenCalledTimes(1);
  });

  it('retourneert DEFAULT_SETTINGS wanneer het document niet bestaat (cache noch server)', async () => {
    (getDocFromCache as Mock).mockResolvedValueOnce(fakeSnap(null));
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    const out = await repo.read();
    expect(out).toEqual({ ...DEFAULT_SETTINGS });
  });
});

describe('FirestoreSettingsRepository — write (PR 5.3d-vervolgonderzoek: wacht niet op setDoc-ack)', () => {
  it('resolvet meteen met ok:true/wacht-op-synchronisatie, zonder op setDoc() te wachten', async () => {
    let resolveSetDoc!: () => void;
    (setDoc as Mock).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveSetDoc = resolve;
      }),
    );
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    // Als write() intern op setDoc() zou awaiten, zou deze await nooit
    // resolven vóór resolveSetDoc() hieronder wordt aangeroepen — dat gebeurt
    // hier bewust pas ná de assertions.
    const result = await repo.write({ ...DEFAULT_SETTINGS, teamName: 'X' });
    expect(result.ok).toBe(true);
    expect(result.syncState.status).toBe('wacht-op-synchronisatie');
    resolveSetDoc();
    await result.settled;
  });

  it('settled resolvet {ok:true} zodra setDoc() de backend bevestigt', async () => {
    (setDoc as Mock).mockResolvedValueOnce(undefined);
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    const result = await repo.write({ ...DEFAULT_SETTINGS, teamName: 'X' });
    await expect(result.settled).resolves.toEqual({ ok: true });
  });

  it(
    'settled resolvet {ok:false, error} bij een afgewezen write (Rules-afwijzing na reconnect) ' +
      '— reject zelf nooit, dus geen unhandled rejection voor een aanroeper die niet awaitet',
    async () => {
      const rejection = new Error('permission-denied');
      (setDoc as Mock).mockRejectedValueOnce(rejection);
      const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
      const result = await repo.write({ ...DEFAULT_SETTINGS, teamName: 'X' });
      await expect(result.settled).resolves.toEqual({ ok: false, error: rejection });
    },
  );

  it('één save-actie veroorzaakt precies één setDoc-call (geen retry-duplicatie)', async () => {
    (setDoc as Mock).mockResolvedValue(undefined);
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    const r1 = await repo.write({ ...DEFAULT_SETTINGS, teamName: 'Eén' });
    const r2 = await repo.write({ ...DEFAULT_SETTINGS, teamName: 'Twee' });
    await Promise.all([r1.settled, r2.settled]);
    expect(setDoc).toHaveBeenCalledTimes(2);
  });

  it('patcht alleen gewijzigde velden zodra het document bestaat', async () => {
    (getDocFromCache as Mock).mockResolvedValueOnce(
      fakeSnap({ ...DEFAULT_SETTINGS, teamName: 'Basis', updatedAt: 'OLD' }),
    );
    (setDoc as Mock).mockResolvedValueOnce(undefined);
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    await repo.read();

    const result = await repo.write(
      { ...DEFAULT_SETTINGS, teamName: 'Nieuw', tag1Label: 'Ongewijzigd lokaal' },
      ['teamName'],
    );
    await result.settled;

    expect(setDoc).toHaveBeenCalledWith(
      fakeRef,
      { teamName: 'Nieuw', updatedAt: 'SERVER_TIMESTAMP' },
      { merge: true },
    );
  });

  it('schrijft bij een nieuw document altijd een volledig geldig document', async () => {
    (getDocFromCache as Mock).mockResolvedValueOnce(fakeSnap(null));
    (setDoc as Mock).mockResolvedValueOnce(undefined);
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    await repo.read();

    const payload = { ...DEFAULT_SETTINGS, teamName: 'Nieuw team' };
    const result = await repo.write(payload, ['teamName']);
    await result.settled;

    expect(setDoc).toHaveBeenCalledWith(fakeRef, {
      ...payload,
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it('probeert na een afgewezen create opnieuw met een volledig document', async () => {
    const rejection = new Error('permission-denied');
    (getDocFromCache as Mock).mockResolvedValueOnce(fakeSnap(null));
    (setDoc as Mock).mockRejectedValueOnce(rejection).mockResolvedValueOnce(undefined);
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    await repo.read();

    const firstPayload = { ...DEFAULT_SETTINGS, teamName: 'Eerste poging' };
    const first = await repo.write(firstPayload, ['teamName']);
    await expect(first.settled).resolves.toEqual({ ok: false, error: rejection });

    const retryPayload = { ...DEFAULT_SETTINGS, teamName: 'Nieuwe poging' };
    const retry = await repo.write(retryPayload, ['teamName']);
    await retry.settled;

    expect(setDoc).toHaveBeenLastCalledWith(fakeRef, {
      ...retryPayload,
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it('slaat een lege patch op een bestaand document over', async () => {
    (getDocFromCache as Mock).mockResolvedValueOnce(
      fakeSnap({ ...DEFAULT_SETTINGS, updatedAt: 'OLD' }),
    );
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    await repo.read();

    const result = await repo.write({ ...DEFAULT_SETTINGS }, []);

    expect(result.unchanged).toBe(true);
    // Laatst waargenomen status (hier een server-bevestigde lezing), niet verzonnen.
    expect(result.syncState.status).toBe('gesynchroniseerd');
    expect(setDoc).not.toHaveBeenCalled();
    await expect(result.settled).resolves.toEqual({ ok: true });
  });

  it('een lege patch na een nog wachtende write meldt geen gesynchroniseerd (reviewnit #101)', async () => {
    (getDocFromCache as Mock).mockResolvedValueOnce(
      fakeSnap({ ...DEFAULT_SETTINGS, updatedAt: 'OLD' }),
    );
    (setDoc as Mock).mockReturnValueOnce(new Promise<void>(() => {})); // offline: nooit bevestigd
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    await repo.read();
    await repo.write({ ...DEFAULT_SETTINGS, teamName: 'Offline' }, ['teamName']);

    const result = await repo.write({ ...DEFAULT_SETTINGS, teamName: 'Offline' }, []);

    expect(result.unchanged).toBe(true);
    expect(result.syncState.status).toBe('wacht-op-synchronisatie');
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('geen merge-patch zolang een create nog kan worden afgewezen, ook niet na de afwijzing (reviewnit #101)', async () => {
    const rejection = new Error('permission-denied');
    let rejectCreate!: (error: unknown) => void;
    let confirmSecond!: () => void;
    (getDocFromCache as Mock).mockResolvedValueOnce(fakeSnap(null));
    (setDoc as Mock)
      .mockReturnValueOnce(
        new Promise<void>((_resolve, reject) => {
          rejectCreate = reject;
        }),
      )
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          confirmSecond = resolve;
        }),
      )
      .mockResolvedValue(undefined);
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    await repo.read();

    const create = await repo.write({ ...DEFAULT_SETTINGS, teamName: 'Eerste' }, ['teamName']);
    // Tweede save terwijl de create nog openstaat: volledig document, geen patch.
    const secondPayload = { ...DEFAULT_SETTINGS, teamName: 'Tweede' };
    const second = await repo.write(secondPayload, ['teamName']);
    expect(setDoc).toHaveBeenNthCalledWith(2, fakeRef, {
      ...secondPayload,
      updatedAt: 'SERVER_TIMESTAMP',
    });

    // Firestore handelt de wachtrij in volgorde af: eerst de afwijzing van de
    // create, daarna de bevestiging van de tweede (volledige) write.
    rejectCreate(rejection);
    await expect(create.settled).resolves.toEqual({ ok: false, error: rejection });
    confirmSecond();
    await expect(second.settled).resolves.toEqual({ ok: true });

    // Pas nu bestaat het document server-bevestigd en mag er weer worden gepatcht.
    const third = await repo.write({ ...DEFAULT_SETTINGS, teamName: 'Derde' }, ['teamName']);
    await third.settled;
    expect(setDoc).toHaveBeenLastCalledWith(
      fakeRef,
      { teamName: 'Derde', updatedAt: 'SERVER_TIMESTAMP' },
      { merge: true },
    );
  });

  it('patcht weer zodra de create door de server is bevestigd', async () => {
    (getDocFromCache as Mock).mockResolvedValueOnce(fakeSnap(null));
    (setDoc as Mock).mockResolvedValue(undefined);
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    await repo.read();

    const create = await repo.write({ ...DEFAULT_SETTINGS, teamName: 'Eerste' }, ['teamName']);
    await create.settled;
    const patch = await repo.write({ ...DEFAULT_SETTINGS, teamName: 'Tweede' }, ['teamName']);
    await patch.settled;

    expect(setDoc).toHaveBeenLastCalledWith(
      fakeRef,
      { teamName: 'Tweede', updatedAt: 'SERVER_TIMESTAMP' },
      { merge: true },
    );
  });
});

describe('FirestoreSettingsRepository — subscribe', () => {
  it('geeft een unsubscribe-functie terug en emitteert niets bij niet-bestaand document', () => {
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
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    const emitted: unknown[] = [];
    const unsub = repo.subscribe((s) => emitted.push(s));
    expect(typeof unsub).toBe('function');
    expect(emitted).toHaveLength(0);
  });

  it('emitteert settings + syncState bij bestaand document', () => {
    (onSnapshot as Mock).mockImplementationOnce(
      (
        _ref: unknown,
        _opts: unknown,
        onNext: (snap: { exists: () => boolean; data: () => unknown; metadata: object }) => void,
      ) => {
        onNext({
          exists: () => true,
          data: () => ({ ...DEFAULT_SETTINGS, teamName: 'Live' }),
          metadata: { fromCache: false, hasPendingWrites: false },
        });
        return () => undefined;
      },
    );
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    const seen: Array<{ teamName: string; status: string }> = [];
    repo.subscribe((settings, sync) =>
      seen.push({ teamName: settings.teamName as string, status: sync.status }),
    );
    expect(seen).toEqual([{ teamName: 'Live', status: 'gesynchroniseerd' }]);
  });

  it('levert updatedAt als epoch-milliseconden door', () => {
    (onSnapshot as Mock).mockImplementationOnce(
      (_ref: unknown, _opts: unknown, onNext: (snap: ReturnType<typeof fakeSnap>) => void) => {
        onNext(
          fakeSnap({
            ...DEFAULT_SETTINGS,
            updatedAt: { toMillis: () => 1_786_278_840_000 },
          }),
        );
        return () => undefined;
      },
    );
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    const seen: Array<number | undefined> = [];
    repo.subscribe((_settings, _sync, updatedAt) => {
      seen.push(updatedAt);
    });
    expect(seen).toEqual([1_786_278_840_000]);
  });
});
