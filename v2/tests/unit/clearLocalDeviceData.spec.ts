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
  keys(): string[] {
    return Array.from(this.store.keys());
  }
}

const CLOUD_IMPORTED_SETTINGS_KEY = 'lineup-tracker-cloud-imported-settings';
const CLOUD_IMPORTED_ROSTER_KEY = 'lineup-tracker-cloud-imported-roster';

describe('infrastructure/device/clearLocalDeviceData (PR 8.2c §B punt 5)', () => {
  it('wist de witte-lijstsleutels van MEERDERE org/team-contexten tegelijk (P1-fix na externe review PR #84)', () => {
    const storage = new FakeStorage();
    const teamA = { orgId: 'org-1', teamId: 'team-1' };
    const teamB = { orgId: 'org-2', teamId: 'team-2' };

    storage.setItem(SETTINGS_STORAGE_KEY, '{}');
    storage.setItem(ROSTER_STORAGE_KEY, '[]');
    storage.setItem(V1_GAMES_STORAGE_KEY, '[]');
    storage.setItem(V1_ACTIVE_GAME_STORAGE_KEY, '{}');
    storage.setItem(DEVICE_ID_STORAGE_KEY, 'device-1');

    for (const team of [teamA, teamB]) {
      storage.setItem(
        activeGameStorageKey(team.orgId, team.teamId),
        JSON.stringify({ id: `active-${team.teamId}` }),
      );
      storage.setItem(
        completedGamesStorageKey(team.orgId, team.teamId),
        JSON.stringify([{ id: `completed-${team.teamId}` }]),
      );
      storage.setItem(pendingFinalizeStorageKey(team.orgId, team.teamId), '{}');
      storage.setItem(migrationRunStorageKey(team.orgId, team.teamId), '{}');
      storage.setItem(gameSyncCheckpointStorageKey(`active-${team.teamId}`), '{}');
      storage.setItem(gameSyncCheckpointStorageKey(`completed-${team.teamId}`), '{}');
    }

    // Nooit wissen.
    storage.setItem(LANG_STORAGE_KEY, 'nl');
    storage.setItem(TRUSTED_DEVICE_STORAGE_KEY, 'false');
    storage.setItem(BOOTSTRAP_ORG_ID_STORAGE_KEY, 'org-3');
    storage.setItem(CLOUD_IMPORTED_SETTINGS_KEY, 'true');
    storage.setItem(CLOUD_IMPORTED_ROSTER_KEY, 'true');

    // Uitloggen gebeurt vanuit team A's context — maar team B's data staat
    // ook op dit gedeelde apparaat en moet net zo goed weg.
    clearLocalDeviceData(storage, storage.keys());

    expect(storage.has(SETTINGS_STORAGE_KEY)).toBe(false);
    expect(storage.has(ROSTER_STORAGE_KEY)).toBe(false);
    expect(storage.has(V1_GAMES_STORAGE_KEY)).toBe(false);
    expect(storage.has(V1_ACTIVE_GAME_STORAGE_KEY)).toBe(false);
    expect(storage.has(DEVICE_ID_STORAGE_KEY)).toBe(false);

    for (const team of [teamA, teamB]) {
      expect(storage.has(activeGameStorageKey(team.orgId, team.teamId))).toBe(false);
      expect(storage.has(completedGamesStorageKey(team.orgId, team.teamId))).toBe(false);
      expect(storage.has(pendingFinalizeStorageKey(team.orgId, team.teamId))).toBe(false);
      expect(storage.has(migrationRunStorageKey(team.orgId, team.teamId))).toBe(false);
      expect(storage.has(gameSyncCheckpointStorageKey(`active-${team.teamId}`))).toBe(false);
      expect(storage.has(gameSyncCheckpointStorageKey(`completed-${team.teamId}`))).toBe(false);
    }

    expect(storage.getItem(LANG_STORAGE_KEY)).toBe('nl');
    expect(storage.getItem(TRUSTED_DEVICE_STORAGE_KEY)).toBe('false');
    expect(storage.getItem(BOOTSTRAP_ORG_ID_STORAGE_KEY)).toBe('org-3');
    expect(storage.getItem(CLOUD_IMPORTED_SETTINGS_KEY)).toBe('true');
    expect(storage.getItem(CLOUD_IMPORTED_ROSTER_KEY)).toBe('true');
  });

  it('gooit niet als er nog geen wedstrijddata bestaat (lege sleutellijst)', () => {
    const storage = new FakeStorage();
    expect(() => clearLocalDeviceData(storage, [])).not.toThrow();
  });

  it('raakt geen sleutel die aan geen enkele witte-lijstprefix voldoet', () => {
    const storage = new FakeStorage();
    storage.setItem('een-onbekende-toekomstige-sleutel', 'blijft-staan');
    clearLocalDeviceData(storage, storage.keys());
    expect(storage.getItem('een-onbekende-toekomstige-sleutel')).toBe('blijft-staan');
  });
});
