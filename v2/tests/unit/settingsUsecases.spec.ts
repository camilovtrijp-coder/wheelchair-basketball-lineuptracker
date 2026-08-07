import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import type { SettingsRepository } from '../../src/application/settings/SettingsRepository';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { WriteResult } from '../../src/domain/syncState';
import type { KeyValueStorage } from '../../src/i18n/persistence';
import { SETTINGS_STORAGE_KEY } from '../../src/domain/settings/types';
import {
  getSettings,
  resetSettings,
  saveSettings,
  updateSetting,
  migrateLocalStorageToCloud,
} from '../../src/application/settings/usecases';
import { isCloudImported } from '../../src/infrastructure/cloudImportFlag';

type SettingsLike = Settings & Record<string, unknown>;

class TrackingRepository implements SettingsRepository {
  public writeCalls: SettingsLike[] = [];
  public writeResult = true;
  private current: SettingsLike;

  constructor(initial: SettingsLike = { ...DEFAULT_SETTINGS }) {
    this.current = initial;
  }

  read(): SettingsLike {
    return this.current;
  }

  write(settings: SettingsLike): boolean {
    this.writeCalls.push(settings);
    if (this.writeResult) this.current = settings;
    return this.writeResult;
  }

  reset(): SettingsLike {
    this.current = { ...DEFAULT_SETTINGS };
    this.write(this.current);
    return this.current;
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

class TrackingAsyncRepository implements AsyncSettingsRepository {
  public writeCalls: SettingsLike[] = [];
  public nextWriteResult: WriteResult = {
    ok: true,
    syncState: { status: 'wacht-op-synchronisatie', fromCache: true, hasPendingWrites: true },
    settled: Promise.resolve({ ok: true }),
  };

  async read(): Promise<SettingsLike> {
    return { ...DEFAULT_SETTINGS };
  }
  async write(settings: SettingsLike) {
    this.writeCalls.push(settings);
    return this.nextWriteResult;
  }
  async reset(): Promise<SettingsLike> {
    return { ...DEFAULT_SETTINGS };
  }
  subscribe(): () => void {
    return () => undefined;
  }
}

describe('application/settings/usecases', () => {
  it('updateSetting past het veld toe in het geheugen zonder te persisteren', () => {
    const repo = new TrackingRepository();
    const current = { ...DEFAULT_SETTINGS };
    const next = updateSetting(current, 'teamName', 'Nieuwe naam');

    expect(next.teamName).toBe('Nieuwe naam');
    expect(repo.writeCalls).toEqual([]);
  });

  it('saveSettings schrijft expliciet naar de repository en geeft het resultaat door', () => {
    const repo = new TrackingRepository();
    const next = { ...DEFAULT_SETTINGS, teamName: 'Opgeslagen' };

    expect(saveSettings(repo, next)).toBe(true);
    expect(repo.writeCalls).toEqual([next]);

    repo.writeResult = false;
    expect(saveSettings(repo, next)).toBe(false);
  });

  it('getSettings en resetSettings delegeren naar de repository', () => {
    const repo = new TrackingRepository({ ...DEFAULT_SETTINGS, teamName: 'X' });
    expect(getSettings(repo).teamName).toBe('X');

    const reset = resetSettings(repo);
    expect(reset).toEqual(DEFAULT_SETTINGS);
  });
});

describe('migrateLocalStorageToCloud — settings (PR 5.3b)', () => {
  it('kopieert v1-settings naar de cloud en zet de import-vlag', async () => {
    const local = new TrackingRepository({ ...DEFAULT_SETTINGS, teamName: 'Cloud-klaar' });
    const cloud = new TrackingAsyncRepository();
    const storage = new TrackingStorage();
    storage.seed(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_SETTINGS, teamName: 'v1-origineel' }),
    );

    const result = await migrateLocalStorageToCloud(local, cloud, storage);

    expect(result).toEqual({ ok: true, imported: true, errors: [] });
    expect(cloud.writeCalls).toEqual([{ ...DEFAULT_SETTINGS, teamName: 'Cloud-klaar' }]);
    expect(isCloudImported(storage, 'settings')).toBe(true);
  });

  it('RAakt de v1-key NIET: byte-equality van lineup-tracker-settings vóór en ná', async () => {
    const v1Raw = JSON.stringify({ ...DEFAULT_SETTINGS, teamName: 'v1-origineel' });
    const local = new TrackingRepository({ ...DEFAULT_SETTINGS, teamName: 'v1-origineel' });
    const cloud = new TrackingAsyncRepository();
    const storage = new TrackingStorage();
    storage.seed(SETTINGS_STORAGE_KEY, v1Raw);

    expect(storage.snapshot()[SETTINGS_STORAGE_KEY]).toBe(v1Raw);

    await migrateLocalStorageToCloud(local, cloud, storage);

    expect(storage.snapshot()[SETTINGS_STORAGE_KEY]).toBe(v1Raw);
    expect(storage.writtenKeys).not.toContain(SETTINGS_STORAGE_KEY);
  });

  it('zonder v1-data: schrijft defaults naar de cloud en markeert imported', async () => {
    const local = new TrackingRepository();
    const cloud = new TrackingAsyncRepository();
    const storage = new TrackingStorage();

    const result = await migrateLocalStorageToCloud(local, cloud, storage);

    expect(result.ok).toBe(true);
    expect(cloud.writeCalls).toEqual([{ ...DEFAULT_SETTINGS }]);
    expect(isCloudImported(storage, 'settings')).toBe(true);
  });

  it('cloud-write direct geweigerd (write() zelf ok:false) → ok=false, geen vlag, errors[] gevuld', async () => {
    const local = new TrackingRepository({ ...DEFAULT_SETTINGS, teamName: 'X' });
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
    expect(isCloudImported(storage, 'settings')).toBe(false);
    expect(storage.writtenKeys).not.toContain(SETTINGS_STORAGE_KEY);
  });

  it(
    'cloud-write lokaal geaccepteerd maar via settled alsnog afgewezen (PR 5.3d) → ' +
      'geen importvlag, ok=false',
    async () => {
      const local = new TrackingRepository({ ...DEFAULT_SETTINGS, teamName: 'X' });
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
      expect(isCloudImported(storage, 'settings')).toBe(false);
    },
  );
});
