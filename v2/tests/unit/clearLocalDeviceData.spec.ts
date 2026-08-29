import { describe, it, expect } from 'vitest';
import { clearLocalDeviceData } from '../../src/infrastructure/device/clearLocalDeviceData';
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
}

const CLOUD_IMPORTED_SETTINGS_KEY = 'lineup-tracker-cloud-imported-settings';
const CLOUD_IMPORTED_ROSTER_KEY = 'lineup-tracker-cloud-imported-roster';

describe('infrastructure/device/clearLocalDeviceData (PR 8.2c §B punt 5)', () => {
  it('wist exact de witte-lijstsleutels voor het gegeven org/team, inclusief gameId-gescoopte checkpoints', () => {
    const storage = new FakeStorage();
    const orgId = 'org-1';
    const teamId = 'team-1';

    storage.setItem(SETTINGS_STORAGE_KEY, '{}');
    storage.setItem(ROSTER_STORAGE_KEY, '[]');
    storage.setItem(V1_GAMES_STORAGE_KEY, '[]');
    storage.setItem(V1_ACTIVE_GAME_STORAGE_KEY, '{}');
    storage.setItem(DEVICE_ID_STORAGE_KEY, 'device-1');
    storage.setItem(activeGameStorageKey(orgId, teamId), JSON.stringify({ id: 'active-game-1' }));
    storage.setItem(
      completedGamesStorageKey(orgId, teamId),
      JSON.stringify([{ id: 'completed-game-1' }, { id: 'completed-game-2' }]),
    );
    storage.setItem(pendingFinalizeStorageKey(orgId, teamId), '{}');
    storage.setItem(migrationRunStorageKey(orgId, teamId), '{}');
    storage.setItem(gameSyncCheckpointStorageKey('active-game-1'), '{}');
    storage.setItem(gameSyncCheckpointStorageKey('completed-game-1'), '{}');
    storage.setItem(gameSyncCheckpointStorageKey('completed-game-2'), '{}');

    // Sleutels van een ANDER org/team blijven onaangeroerd.
    storage.setItem(activeGameStorageKey('org-2', 'team-2'), JSON.stringify({ id: 'other-game' }));

    // Nooit wissen.
    storage.setItem(LANG_STORAGE_KEY, 'nl');
    storage.setItem(TRUSTED_DEVICE_STORAGE_KEY, 'false');
    storage.setItem(BOOTSTRAP_ORG_ID_STORAGE_KEY, 'org-3');
    storage.setItem(CLOUD_IMPORTED_SETTINGS_KEY, 'true');
    storage.setItem(CLOUD_IMPORTED_ROSTER_KEY, 'true');

    clearLocalDeviceData(storage, orgId, teamId);

    expect(storage.has(SETTINGS_STORAGE_KEY)).toBe(false);
    expect(storage.has(ROSTER_STORAGE_KEY)).toBe(false);
    expect(storage.has(V1_GAMES_STORAGE_KEY)).toBe(false);
    expect(storage.has(V1_ACTIVE_GAME_STORAGE_KEY)).toBe(false);
    expect(storage.has(DEVICE_ID_STORAGE_KEY)).toBe(false);
    expect(storage.has(activeGameStorageKey(orgId, teamId))).toBe(false);
    expect(storage.has(completedGamesStorageKey(orgId, teamId))).toBe(false);
    expect(storage.has(pendingFinalizeStorageKey(orgId, teamId))).toBe(false);
    expect(storage.has(migrationRunStorageKey(orgId, teamId))).toBe(false);
    expect(storage.has(gameSyncCheckpointStorageKey('active-game-1'))).toBe(false);
    expect(storage.has(gameSyncCheckpointStorageKey('completed-game-1'))).toBe(false);
    expect(storage.has(gameSyncCheckpointStorageKey('completed-game-2'))).toBe(false);

    expect(storage.has(activeGameStorageKey('org-2', 'team-2'))).toBe(true);

    expect(storage.getItem(LANG_STORAGE_KEY)).toBe('nl');
    expect(storage.getItem(TRUSTED_DEVICE_STORAGE_KEY)).toBe('false');
    expect(storage.getItem(BOOTSTRAP_ORG_ID_STORAGE_KEY)).toBe('org-3');
    expect(storage.getItem(CLOUD_IMPORTED_SETTINGS_KEY)).toBe('true');
    expect(storage.getItem(CLOUD_IMPORTED_ROSTER_KEY)).toBe('true');
  });

  it('gooit niet als er nog geen actieve/voltooide wedstrijd bestaat voor dit org/team', () => {
    const storage = new FakeStorage();
    expect(() => clearLocalDeviceData(storage, 'org-empty', 'team-empty')).not.toThrow();
  });

  it('negeert corrupte JSON in de actieve-wedstrijd-/voltooide-wedstrijden-sleutel', () => {
    const storage = new FakeStorage();
    const orgId = 'org-1';
    const teamId = 'team-1';
    storage.setItem(activeGameStorageKey(orgId, teamId), 'niet-geldige-json{');
    storage.setItem(completedGamesStorageKey(orgId, teamId), 'ook-niet-geldig[');
    expect(() => clearLocalDeviceData(storage, orgId, teamId)).not.toThrow();
    expect(storage.has(activeGameStorageKey(orgId, teamId))).toBe(false);
    expect(storage.has(completedGamesStorageKey(orgId, teamId))).toBe(false);
  });
});
