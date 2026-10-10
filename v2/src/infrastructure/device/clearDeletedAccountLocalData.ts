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
 * niet te blijven staan.
 *
 * **Alleen wat aan het verwijderde account te koppelen is.** De sleutels zijn per organisatie,
 * niet per account, en een vertrouwd apparaat wist bij uitloggen niets: er kan onbevestigd
 * werk van een ANDERE gebruiker op staan (reviewbevinding op de eerste versie van deze PR).
 * Daarom wist deze functie uitsluitend:
 *  - de org/team-gescoopte families (actieve wedstrijd, afgeronde wedstrijden, afrondingen in
 *    de wachtrij, migratieruns) van de organisaties in `organizationIds`, de organisaties uit het
 *    verwijderplan van dit account;
 *  - de synccheckpoints waarvan de inhoud (`organizationId`) in die set valt;
 *  - de bootstrap-organisatie-ID als die naar zo'n organisatie wijst;
 *  - het pseudonieme apparaat-ID en de twee cloud-importvlaggen (apparaatbreed, niet aan één
 *    account toe te schrijven) ALLEEN als er daarna geen enkele org-gescoopte sleutel of
 *    checkpoint van een andere organisatie meer op het apparaat staat. Anders blijven ze: een
 *    nieuw apparaat-ID zou de writerclaim van een ander account breken en een gewiste vlag zou de
 *    importbanner voor een ander account terugbrengen.
 *
 * Bewust NIET gewist: de lokale-modusdata (instellingen, spelerslijst, v1-wedstrijden), de
 * taalvoorkeur en de vertrouwd-apparaatvlag (B7; 2d bewijst het). Dat is dus nadrukkelijk
 * iets anders dan `clearLocalDeviceData()`.
 *
 * Aanroepen alleen op het `deleted`-pad, nooit bij "organisatie verlaten" (het account
 * bestaat dan nog). Een actieve wedstrijd of afronding in de wachtrij van een organisatie van
 * dit account blokkeert verwijderen al, dus daar gaat geen niet-gesynchroniseerd werk verloren.
 * Zonder bekende organisaties (de verwijdering hervat zonder plan) wordt alleen niets
 * org-gescoopts gewist.
 */
const ORG_FAMILY_PREFIXES: readonly string[] = [
  ACTIVE_GAME_STORAGE_KEY_PREFIX,
  COMPLETED_GAMES_STORAGE_KEY_PREFIX,
  PENDING_FINALIZE_STORAGE_KEY_PREFIX,
  MIGRATION_RUN_STORAGE_KEY_PREFIX,
];

const DEVICE_WIDE_KEYS: readonly string[] = [
  DEVICE_ID_STORAGE_KEY,
  SETTINGS_FLAG_KEY,
  ROSTER_FLAG_KEY,
];

/** Exact `{prefix}{orgId}:` voor een eigen organisatie, geen splitsing op `:` (reviewnit #115). */
function isOwnFamilyKey(key: string, prefix: string, own: ReadonlySet<string>): boolean {
  for (const orgId of own) {
    if (key.startsWith(`${prefix}${orgId}:`)) return true;
  }
  return false;
}

function checkpointOrganizationId(storage: KeyValueStorage, key: string): string | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null || raw === '') return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const id = (parsed as Record<string, unknown>).organizationId;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

function safeRemove(storage: KeyValueStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* opslag kan falen (uitgeschakeld/vergrendeld); de overige sleutels toch proberen */
  }
}

export function clearDeletedAccountLocalData(
  storage: KeyValueStorage,
  allKeys: readonly string[],
  organizationIds: readonly string[],
): void {
  const own = new Set(organizationIds);
  let foreignRemains = false;

  for (const key of allKeys) {
    const family = ORG_FAMILY_PREFIXES.find((prefix) => key.startsWith(prefix));
    if (family !== undefined) {
      if (isOwnFamilyKey(key, family, own)) safeRemove(storage, key);
      else foreignRemains = true;
    } else if (key.startsWith(GAME_SYNC_CHECKPOINT_STORAGE_PREFIX)) {
      const org = checkpointOrganizationId(storage, key);
      if (org !== null && own.has(org)) safeRemove(storage, key);
      else foreignRemains = true;
    }
  }

  let bootstrapOrgId: string | null = null;
  try {
    bootstrapOrgId = storage.getItem(BOOTSTRAP_ORG_ID_STORAGE_KEY);
  } catch {
    bootstrapOrgId = null;
  }
  if (bootstrapOrgId !== null && own.has(bootstrapOrgId)) {
    safeRemove(storage, BOOTSTRAP_ORG_ID_STORAGE_KEY);
  }

  if (!foreignRemains) {
    for (const key of DEVICE_WIDE_KEYS) safeRemove(storage, key);
  }
}
