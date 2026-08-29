import type { KeyValueStorage } from '../../i18n/persistence';
import { ROSTER_STORAGE_KEY } from '../../domain/roster/types';
import { SETTINGS_STORAGE_KEY } from '../../domain/settings/types';
import { V1_ACTIVE_GAME_STORAGE_KEY } from '../../domain/game/v1Migration';
import { V1_GAMES_STORAGE_KEY } from '../../domain/backup/migrateV1';
import { ACTIVE_GAME_STORAGE_KEY_PREFIX } from '../game/LocalStorageGameRepository';
import { COMPLETED_GAMES_STORAGE_KEY_PREFIX } from '../game/LocalStorageCompletedGameRepository';
import { PENDING_FINALIZE_STORAGE_KEY_PREFIX } from '../game/LocalStoragePendingFinalizeRepository';
import { GAME_SYNC_CHECKPOINT_STORAGE_PREFIX } from '../game/LocalStorageGameSyncCheckpointRepository';
import { MIGRATION_RUN_STORAGE_KEY_PREFIX } from '../migration/LocalStorageMigrationRunRepository';
import { DEVICE_ID_STORAGE_KEY } from './deviceId';

/**
 * Vaste, niet-org/team-gescoopte sleutels uit de witte lijst (docs/pr-8.2-
 * plan.md §B punt 5).
 */
const FIXED_KEYS_TO_CLEAR: readonly string[] = [
  SETTINGS_STORAGE_KEY,
  ROSTER_STORAGE_KEY,
  V1_GAMES_STORAGE_KEY,
  V1_ACTIVE_GAME_STORAGE_KEY,
  DEVICE_ID_STORAGE_KEY,
];

/**
 * Prefixen van org/team- of `gameId`-gescoopte sleutelfamilies uit de witte
 * lijst. **Elke sleutel die met één van deze prefixen begint wordt gewist,
 * voor ELKE org/team/gameId — niet alleen de huidige context.**
 *
 * Herzien na de externe review op PR #84 (P1): een eerdere versie
 * construeerde de te wissen sleutel uitsluitend uit de MEEGEGEVEN org/team,
 * en liet zo stilzwijgend de wedstrijd-/synchronisatiedata van elke ANDERE
 * org/team die dit apparaat ooit gebruikte (bijv. een eerder bezocht ander
 * team) onaangeroerd staan — een lek op precies het gedeeld-apparaat-
 * scenario dat 8.2c moest dichten. `listBrowserStorageKeys()`
 * (`i18n/browserStorage.ts`) enumereert nu de daadwerkelijk aanwezige
 * sleutels; deze prefixlijst blijft bewust EXPLICIET (dezelfde witte-lijst-
 * discipline als voorheen, alleen niet meer org/team-geparametriseerd) — een
 * toekomstige nieuwe sleutelfamilie moet hier bewust aan toegevoegd worden.
 */
const DYNAMIC_KEY_PREFIXES_TO_CLEAR: readonly string[] = [
  ACTIVE_GAME_STORAGE_KEY_PREFIX,
  COMPLETED_GAMES_STORAGE_KEY_PREFIX,
  PENDING_FINALIZE_STORAGE_KEY_PREFIX,
  MIGRATION_RUN_STORAGE_KEY_PREFIX,
  GAME_SYNC_CHECKPOINT_STORAGE_PREFIX,
];

/**
 * Wist, uitsluitend op het onvertrouwd-apparaat-uitlogpad (en het
 * herroepbare-vertrouwd-apparaat-instellingspad, zie `AuthGate.tsx`'s
 * `handleChangeTrustedDevice()`), exact de `localStorage`-sleutels die
 * ADR-000's laagconventie als lokale wedstrijd-/roster-/instellingendata
 * bestempelt (docs/pr-8.2-plan.md §B punt 5, witte-/zwarte-lijst uit
 * externe review PR #80) — voor ELKE org/team-context die dit apparaat ooit
 * gebruikte, niet alleen de huidige.
 *
 * Bewust geen `localStorage.clear()`: `allKeys` (in productie
 * `listBrowserStorageKeys()`) wordt gefilterd tegen een EXPLICIETE lijst
 * vaste sleutels en sleutelprefixen — een sleutel die aan geen van beide
 * matcht (taalvoorkeur, de vertrouwd-apparaatvlag zelf, bootstrap-status,
 * cloud-import-vlaggen, en elke toekomstige onbekende sleutel) blijft
 * onaangeroerd.
 */
export function clearLocalDeviceData(storage: KeyValueStorage, allKeys: readonly string[]): void {
  for (const key of allKeys) {
    const isFixedKey = FIXED_KEYS_TO_CLEAR.includes(key);
    const isDynamicKey = DYNAMIC_KEY_PREFIXES_TO_CLEAR.some((prefix) => key.startsWith(prefix));
    if (isFixedKey || isDynamicKey) {
      storage.removeItem(key);
    }
  }
}
