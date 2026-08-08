import { describe, it, expect } from 'vitest';
import type { Roster } from '../../src/domain/roster/types';
import { ROSTER_STORAGE_KEY } from '../../src/domain/roster/types';
import type { RosterRepository } from '../../src/application/roster/RosterRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import type { WriteResult } from '../../src/domain/syncState';
import type { KeyValueStorage } from '../../src/i18n/persistence';
import {
  getRoster,
  saveRoster,
  migrateLocalStorageToCloud,
} from '../../src/application/roster/usecases';
import { isCloudImported } from '../../src/infrastructure/cloudImportFlag';

class TrackingRepository implements RosterRepository {
  public writeCalls: Roster[] = [];
  public writeResult = true;
  private current: Roster;

  constructor(initial: Roster = []) {
    this.current = initial;
  }
  read(): Roster {
    return this.current;
  }
  write(players: Roster): boolean {
    this.writeCalls.push(players);
    if (this.writeResult) this.current = players;
    return this.writeResult;
  }
}

class TrackingStorage implements KeyValueStorage {
  private store = new Map<string, string>();
  public readonly writtenKeys: string[] = [];

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writtenKeys.push(key);
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  seed(key: string, value: string): void {
    this.store.set(key, value);
  }
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.store);
  }
}

class TrackingAsyncRepository implements AsyncRosterRepository {
  public writeCalls: Roster[] = [];
  public nextWriteResult: WriteResult = {
    ok: true,
    syncState: { status: 'wacht-op-synchronisatie', fromCache: true, hasPendingWrites: true },
    settled: Promise.resolve({ ok: true }),
  };
  async read(): Promise<Roster> {
    return [];
  }
  async write(players: Roster) {
    this.writeCalls.push(players);
    return this.nextWriteResult;
  }
  subscribe(): () => void {
    return () => undefined;
  }
}

const SAMPLE: Roster = [
  { id: 1, nr: '7', naam: 'Speler A', kl: '3.0', vrouw: false, jeugd: false },
];

describe('application/roster/usecases', () => {
  it('getRoster delegeert naar de repository', () => {
    const repo = new TrackingRepository(SAMPLE);
    expect(getRoster(repo)).toEqual(SAMPLE);
  });

  it('saveRoster schrijft expliciet naar de repository en geeft het resultaat door', () => {
    const repo = new TrackingRepository();
    expect(saveRoster(repo, SAMPLE)).toBe(true);
    expect(repo.writeCalls).toEqual([SAMPLE]);

    repo.writeResult = false;
    expect(saveRoster(repo, SAMPLE)).toBe(false);
  });
});

describe('migrateLocalStorageToCloud — roster (PR 5.3b)', () => {
  it('kopieert v1-roster naar de cloud en zet de import-vlag', async () => {
    const local = new TrackingRepository(SAMPLE);
    const cloud = new TrackingAsyncRepository();
    const storage = new TrackingStorage();

    const result = await migrateLocalStorageToCloud(local, cloud, storage);

    expect(result).toEqual({ ok: true, imported: true, errors: [] });
    expect(cloud.writeCalls).toEqual([SAMPLE]);
    expect(isCloudImported(storage, 'roster')).toBe(true);
  });

  it('RAakt de v1-key NIET: byte-equality van lineup-tracker-roster vóór en ná', async () => {
    const v1Raw = JSON.stringify([
      { id: 1, nr: '7', naam: 'Origineel', kl: '3.0', vrouw: false, jeugd: false },
    ]);
    const local = new TrackingRepository([
      { id: 1, nr: '7', naam: 'Origineel', kl: '3.0', vrouw: false, jeugd: false },
    ]);
    const cloud = new TrackingAsyncRepository();
    const storage = new TrackingStorage();
    storage.seed(ROSTER_STORAGE_KEY, v1Raw);

    expect(storage.snapshot()[ROSTER_STORAGE_KEY]).toBe(v1Raw);

    await migrateLocalStorageToCloud(local, cloud, storage);

    expect(storage.snapshot()[ROSTER_STORAGE_KEY]).toBe(v1Raw);
    expect(storage.writtenKeys).not.toContain(ROSTER_STORAGE_KEY);
  });

  it('zonder v1-data: schrijft lege array naar de cloud en markeert imported', async () => {
    const local = new TrackingRepository();
    const cloud = new TrackingAsyncRepository();
    const storage = new TrackingStorage();

    const result = await migrateLocalStorageToCloud(local, cloud, storage);

    expect(result.ok).toBe(true);
    expect(cloud.writeCalls).toEqual([[]]);
    expect(isCloudImported(storage, 'roster')).toBe(true);
  });

  it('cloud-write direct geweigerd (write() zelf ok:false) → ok=false, geen vlag, errors[] gevuld', async () => {
    const local = new TrackingRepository(SAMPLE);
    const cloud = new TrackingAsyncRepository();
    cloud.nextWriteResult = {
      ok: false,
      syncState: { status: 'actie-nodig', fromCache: false, hasPendingWrites: false },
      settled: Promise.resolve({ ok: false }),
    };
    const storage = new TrackingStorage();

    const result = await migrateLocalStorageToCloud(local, cloud, storage);

    expect(result.ok).toBe(false);
    expect(result.imported).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(isCloudImported(storage, 'roster')).toBe(false);
    expect(storage.writtenKeys).not.toContain(ROSTER_STORAGE_KEY);
  });

  it(
    'cloud-write lokaal geaccepteerd maar via settled alsnog afgewezen (PR 5.3d) → ' +
      'geen importvlag, ok=false',
    async () => {
      const local = new TrackingRepository(SAMPLE);
      const cloud = new TrackingAsyncRepository();
      cloud.nextWriteResult = {
        ok: true,
        syncState: { status: 'wacht-op-synchronisatie', fromCache: true, hasPendingWrites: true },
        settled: Promise.resolve({ ok: false, error: new Error('permission-denied') }),
      };
      const storage = new TrackingStorage();

      const result = await migrateLocalStorageToCloud(local, cloud, storage);

      expect(result.ok).toBe(false);
      expect(result.imported).toBe(false);
      expect(isCloudImported(storage, 'roster')).toBe(false);
    },
  );
});
