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

const OWN = ['org-own'];

function seedOwn(storage: FakeStorage): string[] {
  const keys = [
    activeGameStorageKey('org-own', 'team-1'),
    completedGamesStorageKey('org-own', 'team-1'),
    pendingFinalizeStorageKey('org-own', 'team-2'),
    migrationRunStorageKey('org-own', 'team-1'),
    gameSyncCheckpointStorageKey('game-own'),
  ];
  for (const key of keys) storage.setItem(key, 'x');
  storage.setItem(
    gameSyncCheckpointStorageKey('game-own'),
    JSON.stringify({ gameId: 'game-own', organizationId: 'org-own' }),
  );
  return keys;
}

describe('infrastructure/device/clearDeletedAccountLocalData (besluit R7)', () => {
  it('wist alle families van de eigen organisatie (alle teams), het apparaat-ID en de vlaggen als er niets van anderen staat', () => {
    const storage = new FakeStorage();
    const own = seedOwn(storage);
    const wide = [DEVICE_ID_STORAGE_KEY, SETTINGS_FLAG_KEY, ROSTER_FLAG_KEY];
    for (const key of wide) storage.setItem(key, 'x');
    storage.setItem(BOOTSTRAP_ORG_ID_STORAGE_KEY, 'org-own');

    clearDeletedAccountLocalData(storage, storage.keys(), OWN);

    for (const key of [...own, ...wide, BOOTSTRAP_ORG_ID_STORAGE_KEY]) {
      expect(storage.has(key)).toBe(false);
    }
  });

  it('laat ALLES van een andere organisatie staan (ook onbevestigd werk) en dan ook het apparaat-ID en de vlaggen', () => {
    const storage = new FakeStorage();
    const own = seedOwn(storage);
    const foreign = [
      pendingFinalizeStorageKey('org-andere', 'team-9'),
      activeGameStorageKey('org-andere', 'team-9'),
      completedGamesStorageKey('org-andere', 'team-9'),
      migrationRunStorageKey('org-andere', 'team-9'),
      gameSyncCheckpointStorageKey('game-andere'),
    ];
    for (const key of foreign) storage.setItem(key, '{"onbevestigd":true}');
    storage.setItem(
      gameSyncCheckpointStorageKey('game-andere'),
      JSON.stringify({ gameId: 'game-andere', organizationId: 'org-andere' }),
    );
    const wide = [DEVICE_ID_STORAGE_KEY, SETTINGS_FLAG_KEY, ROSTER_FLAG_KEY];
    for (const key of wide) storage.setItem(key, 'x');
    storage.setItem(BOOTSTRAP_ORG_ID_STORAGE_KEY, 'org-andere');

    clearDeletedAccountLocalData(storage, storage.keys(), OWN);

    for (const key of own) expect(storage.has(key)).toBe(false);
    for (const key of [...foreign, ...wide, BOOTSTRAP_ORG_ID_STORAGE_KEY]) {
      expect(storage.has(key)).toBe(true);
    }
  });

  it('een org-ID dat alleen als voorvoegsel lijkt (org-own2) telt niet als de eigen organisatie', () => {
    const storage = new FakeStorage();
    storage.setItem(pendingFinalizeStorageKey('org-own2', 'team-1'), 'x');
    storage.setItem(pendingFinalizeStorageKey('org-own', 'team-1'), 'x');

    clearDeletedAccountLocalData(storage, storage.keys(), OWN);

    expect(storage.has(pendingFinalizeStorageKey('org-own2', 'team-1'))).toBe(true);
    expect(storage.has(pendingFinalizeStorageKey('org-own', 'team-1'))).toBe(false);
  });

  it('exacte prefixmatch op `{org}:`: org-ownX blijft staan, org-own wordt gewist', () => {
    const storage = new FakeStorage();
    const lookalike = `lineup-tracker-v2-pending-finalize:org-own:extra:team-1`;
    // Hoort bij org "org-own" (voorvoegsel "org-own:") en wordt dus gewist; een sleutel van org
    // "org-own:extra" zou botsen, maar org-ID's bevatten geen dubbele punt (Firestore-auto-ID's).
    storage.setItem(lookalike, 'x');
    storage.setItem(pendingFinalizeStorageKey('org-ownX', 'team-1'), 'x');

    clearDeletedAccountLocalData(storage, storage.keys(), OWN);

    expect(storage.has(lookalike)).toBe(false);
    expect(storage.has(pendingFinalizeStorageKey('org-ownX', 'team-1'))).toBe(true);
  });

  it('een checkpoint zonder leesbare inhoud wordt niet gewist en telt als van een ander', () => {
    const storage = new FakeStorage();
    storage.setItem(gameSyncCheckpointStorageKey('game-x'), 'geen json');
    storage.setItem(DEVICE_ID_STORAGE_KEY, 'device-1');

    clearDeletedAccountLocalData(storage, storage.keys(), OWN);

    expect(storage.has(gameSyncCheckpointStorageKey('game-x'))).toBe(true);
    expect(storage.has(DEVICE_ID_STORAGE_KEY)).toBe(true);
  });

  it('zonder bekende organisaties (verwijdering hervat zonder plan) wordt niets org-gescoopts gewist', () => {
    const storage = new FakeStorage();
    const own = seedOwn(storage);
    storage.setItem(DEVICE_ID_STORAGE_KEY, 'device-1');

    clearDeletedAccountLocalData(storage, storage.keys(), []);

    for (const key of own) expect(storage.has(key)).toBe(true);
    expect(storage.has(DEVICE_ID_STORAGE_KEY)).toBe(true);
  });

  it('laat lokale-modusdata, taal, vertrouwd-apparaat en onbekende sleutels altijd staan', () => {
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

    clearDeletedAccountLocalData(storage, storage.keys(), OWN);

    for (const key of kept) expect(storage.has(key)).toBe(true);
    expect(storage.has(DEVICE_ID_STORAGE_KEY)).toBe(false);
  });

  it('een falende removeItem stopt de overige sleutels niet en gooit niet', () => {
    const storage = new FakeStorage();
    storage.setItem(DEVICE_ID_STORAGE_KEY, 'device-1');
    storage.setItem(activeGameStorageKey('org-own', 'team-1'), 'x');
    const original = storage.removeItem.bind(storage);
    storage.removeItem = (key: string) => {
      if (key === activeGameStorageKey('org-own', 'team-1')) throw new Error('quota');
      original(key);
    };

    expect(() => clearDeletedAccountLocalData(storage, storage.keys(), OWN)).not.toThrow();
    expect(storage.has(DEVICE_ID_STORAGE_KEY)).toBe(false);
  });

  it('doet niets op een leeg apparaat', () => {
    const storage = new FakeStorage();
    expect(() => clearDeletedAccountLocalData(storage, [], OWN)).not.toThrow();
  });
});
