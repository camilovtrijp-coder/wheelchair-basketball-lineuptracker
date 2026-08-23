import { SETTINGS_STORAGE_KEY } from '../../domain/settings/types';
import { ROSTER_STORAGE_KEY } from '../../domain/roster/types';
import { activeGameStorageKey } from '../game/LocalStorageGameRepository';
import { completedGamesStorageKey } from '../game/LocalStorageCompletedGameRepository';
import { buildLocalMigrationInventory } from '../../domain/migration/inventory';
import type { LocalMigrationInventory } from '../../domain/migration/types';
import type { KeyValueStorage } from '../../i18n/persistence';

/**
 * PR 7.4a (docs/pr-7.4-plan.md §C 7.4a werk 1): infrastructure-rand rond de
 * pure `domain/migration/inventory.ts`. Doet UITSLUITEND storage-read +
 * `JSON.parse` — geen enkele validatie hier (die blijft exclusief in de
 * domeinlaag, herbruikt van `domain/backup/validate.ts`). Een storage-fout
 * of parsefout levert `undefined` op (spiegelt
 * `LocalStorageCompletedGameRepository.readAll()`'s eigen try/catch-paren)
 * — de domeinlaag behandelt dat als `status: 'empty'`, NOOIT als `'corrupt'`:
 * een tijdelijke leesfout op de storage-laag zelf is geen uitspraak over de
 * INHOUD (die kon domain/migration/inventory.ts hier nooit beoordelen, er
 * was niets om te valideren).
 *
 * Settings/roster zijn — anders dan activeGame/completedGames — GEEN
 * per-organisatie/team-sleutel (`SETTINGS_STORAGE_KEY`/`ROSTER_STORAGE_KEY`
 * zijn vaste, globale sleutels, zie `domain/settings/types.ts`/
 * `domain/roster/types.ts`): de lokale-modus-app kent maar één actieve
 * team-context tegelijk, dus "de lokale bron" voor settings/roster is altijd
 * de huidige lokale stand, ongeacht welke `organizationId`/`teamId` de
 * aanroeper als brontag meegeeft (die dient uitsluitend om de preview te
 * LABELEN, zie `MigrationContextRef`).
 */
function readRawJson(storage: KeyValueStorage, key: string): unknown {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return undefined;
  }
  if (raw === null || raw === '') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function collectLocalMigrationInventory(
  storage: KeyValueStorage,
  organizationId: string,
  teamId: string,
): LocalMigrationInventory {
  const settings = readRawJson(storage, SETTINGS_STORAGE_KEY);
  const roster = readRawJson(storage, ROSTER_STORAGE_KEY);
  const activeGame = readRawJson(storage, activeGameStorageKey(organizationId, teamId));
  const completedGames = readRawJson(storage, completedGamesStorageKey(organizationId, teamId));
  return buildLocalMigrationInventory(organizationId, teamId, {
    settings,
    roster,
    activeGame,
    completedGames,
  });
}
