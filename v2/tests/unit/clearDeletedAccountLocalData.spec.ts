import { describe, it, expect } from 'vitest';
import { clearDeletedAccountLocalData } from '../../src/infrastructure/device/clearDeletedAccountLocalData';
import { activeGameStorageKey } from '../../src/infrastructure/game/LocalStorageGameRepository';
import { completedGamesStorageKey } from '../../src/infrastructure/game/LocalStorageCompletedGameRepository';
import { pendingFinalizeStorageKey } from '../../src/infrastructure/game/LocalStoragePendingFinalizeRepository';
import { gameSyncCheckpointStorageKey } from '../../src/infrastructure/game/LocalStorageGameSyncCheckpointRepository';
import { migrationRunStorageKey } from '../../src/infrastructure/migration/LocalStorageMigrationRunRepository';
import { ROSTER_STORAGE_KEY } from '../../src/domain/roster/types';
import { SETTINGS_STORAGE_KEY } from '../../src/domain/settings/types';
import { V1_ACTIVE_GAME_STORAGE_KEY } from '../../src/domain/game/v1Migration';
import { V1_GAMES_STORAGE_KEY } from '../../src/domain/backup/migrateV1';
import { DEVICE_ID_STORAGE_KEY } from '../../src/infrastructure/device/deviceId';
import { TRUSTED_DEVICE_STORAGE_KEY } from '../../src/infrastructure/device/trustedDevice';
import { LANG_STORAGE_KEY } from '../../src/i18n/strings';
import { BOOTSTRAP_ORG_ID_STORAGE_KEY } from '../../src/infrastructure/onboarding/bootstrapProgress';
import { ROSTER_FLAG_KEY, SETTINGS_FLAG_KEY } from '../../src/infrastructure/cloudImportFlag';
import type { KeyValueStorage } from '../../src/i18n/persistence';

class FakeStorage implements KeyValueStorage {
  private readonly store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  has(key: string): boolean {
    return this.store.has(key);
  }
  keys(): string[] {
    return Array.from(this.store.keys());
  }
}

describe('infrastructure/device/clearDeletedAccountLocalData (besluit R7)', () => {
  it('wist alle org-gescoopte families voor ELKE org/team, het apparaat-ID en de vlaggen', () => {
    const storage = new FakeStorage();
    const doomed: string[] = [DEVICE_ID_STORAGE_KEY, BOOTSTRAP_ORG_ID_STORAGE_KEY];
    doomed.push(SETTINGS_FLAG_KEY, ROSTER_FLAG_KEY);
    for (const [org, team] of [
      ['org-1', 'team-1'],
      ['org-2', 'team-2'],
    ] as const) {
      doomed.push(
        activeGameStorageKey(org, team),
        completedGamesStorageKey(org, team),
        pendingFinalizeStorageKey(org, team),
        migrationRunStorageKey(org, team),
        gameSyncCheckpointStorageKey(`game-${team}`),
      );
    }
    for (const key of doomed) storage.setItem(key, 'x');

    clearDeletedAccountLocalData(storage, storage.keys());

    for (const key of doomed) expect(storage.has(key)).toBe(false);
  });

  it('laat lokale-modusdata, taal, vertrouwd-apparaat en onbekende sleutels staan', () => {
    const storage = new FakeStorage();
    const kept = [
      SETTINGS_STORAGE_KEY,
      ROSTER_STORAGE_KEY,
      V1_GAMES_STORAGE_KEY,
      V1_ACTIVE_GAME_STORAGE_KEY,
      LANG_STORAGE_KEY,
      TRUSTED_DEVICE_STORAGE_KEY,
      'lineup-tracker-onbekende-toekomstige-sleutel',
    ];
    for (const key of kept) storage.setItem(key, 'x');
    storage.setItem(DEVICE_ID_STORAGE_KEY, 'device-1');

    clearDeletedAccountLocalData(storage, storage.keys());

    for (const key of kept) expect(storage.has(key)).toBe(true);
    expect(storage.has(DEVICE_ID_STORAGE_KEY)).toBe(false);
  });

  it('een falende removeItem stopt de overige sleutels niet en gooit niet', () => {
    const storage = new FakeStorage();
    storage.setItem(DEVICE_ID_STORAGE_KEY, 'device-1');
    storage.setItem(activeGameStorageKey('org-1', 'team-1'), 'x');
    const original = storage.removeItem.bind(storage);
    storage.removeItem = (key: string) => {
      if (key === DEVICE_ID_STORAGE_KEY) throw new Error('quota');
      original(key);
    };

    expect(() => clearDeletedAccountLocalData(storage, storage.keys())).not.toThrow();
    expect(storage.has(activeGameStorageKey('org-1', 'team-1'))).toBe(false);
  });

  it('doet niets op een leeg apparaat', () => {
    const storage = new FakeStorage();
    expect(() => clearDeletedAccountLocalData(storage, [])).not.toThrow();
  });
});
