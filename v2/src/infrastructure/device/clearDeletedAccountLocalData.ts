import type { KeyValueStorage } from '../../i18n/persistence';
import { ACTIVE_GAME_STORAGE_KEY_PREFIX } from '../game/LocalStorageGameRepository';
import { COMPLETED_GAMES_STORAGE_KEY_PREFIX } from '../game/LocalStorageCompletedGameRepository';
import { PENDING_FINALIZE_STORAGE_KEY_PREFIX } from '../game/LocalStoragePendingFinalizeRepository';
import { GAME_SYNC_CHECKPOINT_STORAGE_PREFIX } from '../game/LocalStorageGameSyncCheckpointRepository';
import { MIGRATION_RUN_STORAGE_KEY_PREFIX } from '../migration/LocalStorageMigrationRunRepository';
import { BOOTSTRAP_ORG_ID_STORAGE_KEY } from '../onboarding/bootstrapProgress';
import { ROSTER_FLAG_KEY, SETTINGS_FLAG_KEY } from '../cloudImportFlag';
import { DEVICE_ID_STORAGE_KEY } from './deviceId';

/**
 * Besluit R7 (eigenaar, 10 oktober 2026; docs/security-threat-model.md §7 R7): na een
 * geslaagde accountverwijdering (`deleted`) hoort wat dit account op dit apparaat achterliet
 * niet te blijven staan. Exact deze niet-lokale-modussleutels:
 *  - de org/team-gescoopte families (actieve wedstrijd, afgeronde wedstrijden, afrondingen in
 *    de wachtrij, synccheckpoints, migratieruns): ze bevatten spelersnamen;
 *  - het pseudonieme apparaat-ID (komt terug in `games.deviceId`/`actions.deviceId`);
 *  - de cloud-importvlaggen en de bootstrap-organisatie-ID: boekhouding van het verwijderde account.
 *
 * Bewust NIET gewist: de lokale-modusdata (instellingen, spelerslijst, v1-wedstrijden), de
 * taalvoorkeur en de vertrouwd-apparaatvlag. Dat is het B7-besluit (2d bewijst het); dit is
 * dus nadrukkelijk iets anders dan `clearLocalDeviceData()`.
 *
 * Aanroepen alleen op het `deleted`-pad, nooit bij "organisatie verlaten" (het account
 * bestaat dan nog). Een onbevestigde lokale wedstrijd blokkeert verwijderen al, dus hier
 * gaat geen niet-gesynchroniseerd werk verloren.
 */
const FIXED_KEYS: readonly string[] = [
  DEVICE_ID_STORAGE_KEY,
  BOOTSTRAP_ORG_ID_STORAGE_KEY,
  SETTINGS_FLAG_KEY,
  ROSTER_FLAG_KEY,
];

const KEY_PREFIXES: readonly string[] = [
  ACTIVE_GAME_STORAGE_KEY_PREFIX,
  COMPLETED_GAMES_STORAGE_KEY_PREFIX,
  PENDING_FINALIZE_STORAGE_KEY_PREFIX,
  GAME_SYNC_CHECKPOINT_STORAGE_PREFIX,
  MIGRATION_RUN_STORAGE_KEY_PREFIX,
];

export function clearDeletedAccountLocalData(
  storage: KeyValueStorage,
  allKeys: readonly string[],
): void {
  for (const key of allKeys) {
    if (FIXED_KEYS.includes(key) || KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      try {
        storage.removeItem(key);
      } catch {
        /* opslag kan falen (uitgeschakeld/vergrendeld); de overige sleutels toch proberen */
      }
    }
  }
}
