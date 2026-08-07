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

describe('FirestoreSettingsRepository — write (sync-status + setDoc-count)', () => {
  it('resulteert in gesynchroniseerd bij geslaagde write', async () => {
    (setDoc as Mock).mockResolvedValueOnce(undefined);
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    const result = await repo.write({ ...DEFAULT_SETTINGS, teamName: 'X' });
    expect(result.ok).toBe(true);
    expect(result.syncState.status).toBe('gesynchroniseerd');
  });

  it(
    'resulteert in actie-nodig bij geweigerde write (Rules-afwijzing na reconnect) ' +
      '— geen stille val naar defaults, fout blijft beschikbaar voor het Actie-nodig-paneel',
    async () => {
      const rejection = new Error('permission-denied');
      (setDoc as Mock).mockRejectedValueOnce(rejection);
      const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
      const result = await repo.write({ ...DEFAULT_SETTINGS, teamName: 'X' });
      expect(result.ok).toBe(false);
      expect(result.syncState.status).toBe('actie-nodig');
      expect(result.error).toBe(rejection);
    },
  );

  it('één save-actie veroorzaakt precies één setDoc-call (geen retry-duplicatie)', async () => {
    (setDoc as Mock).mockResolvedValue(undefined);
    const repo = new FirestoreSettingsRepository(fakeDb, 'org-1', 'team-1');
    await repo.write({ ...DEFAULT_SETTINGS, teamName: 'Eén' });
    await repo.write({ ...DEFAULT_SETTINGS, teamName: 'Twee' });
    expect(setDoc).toHaveBeenCalledTimes(2);
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
});
