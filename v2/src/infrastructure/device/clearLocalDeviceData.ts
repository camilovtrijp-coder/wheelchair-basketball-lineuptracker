import type { KeyValueStorage } from '../../i18n/persistence';
import { ROSTER_STORAGE_KEY } from '../../domain/roster/types';
import { SETTINGS_STORAGE_KEY } from '../../domain/settings/types';
import { V1_ACTIVE_GAME_STORAGE_KEY } from '../../domain/game/v1Migration';
import { V1_GAMES_STORAGE_KEY } from '../../domain/backup/migrateV1';
import { activeGameStorageKey } from '../game/LocalStorageGameRepository';
import { completedGamesStorageKey } from '../game/LocalStorageCompletedGameRepository';
import { pendingFinalizeStorageKey } from '../game/LocalStoragePendingFinalizeRepository';
import { gameSyncCheckpointStorageKey } from '../game/LocalStorageGameSyncCheckpointRepository';
import { migrationRunStorageKey } from '../migration/LocalStorageMigrationRunRepository';
import { DEVICE_ID_STORAGE_KEY } from './deviceId';

/**
 * Beste-poging `id` uit een rauwe, ongevalideerde JSON-blob halen — gebruikt
 * om de `gameId`'s te achterhalen waarvoor `lineup-tracker-v2-game-sync-
 * checkpoint:${gameId}`-sleutels gewist moeten worden (§B punt 5,
 * docs/pr-8.2-plan.md). Geen validatie van de rest van de vorm nodig: een
 * onverwachte/corrupte blob levert hier gewoon geen extra sleutel op, i.p.v.
 * te crashen.
 */
function extractGameIds(raw: string | null): string[] {
  if (raw === null || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) =>
          entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined,
        )
        .filter((id): id is string => typeof id === 'string');
    }
    if (parsed && typeof parsed === 'object') {
      const id = (parsed as { id?: unknown }).id;
      return typeof id === 'string' ? [id] : [];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Wist, uitsluitend op het onvertrouwd-apparaat-uitlogpad, exact de
 * `localStorage`-sleutels die ADR-000's laagconventie als lokale
 * wedstrijd-/roster-/instellingendata bestempelt (docs/pr-8.2-plan.md §B
 * punt 5, witte-/zwarte-lijst uit externe review PR #80).
 *
 * Bewust een EXPLICIETE sleutellijst (geen `localStorage.clear()`, geen
 * prefix-wildcard-scan over de volledige storage) — een toekomstige nieuwe
 * sleutel moet bewust aan deze lijst toegevoegd worden, anders blijft hij
 * onaangeroerd. `gameId`-gescoopte `game-sync-checkpoint`-sleutels zijn de
 * enige uitzondering die wél een korte vooraf-lees-stap nodig heeft (de
 * sleutel zelf bevat geen org/team, alleen een `gameId`) — die `gameId`'s
 * worden opgehaald uit de actieve wedstrijd en de voltooide-wedstrijden-
 * lijst van dit org/team vóórdat die sleutels zelf gewist worden.
 *
 * NOOIT gewist: `lineup-tracker-lang` (taalvoorkeur),
 * `lineup-tracker-trusted-device` (de vertrouwd-apparaatvlag zelf blijft
 * een apparaateigenschap), `lineup-tracker-bootstrap-org-id` en de
 * `lineup-tracker-cloud-imported-*`-vlaggen.
 */
export function clearLocalDeviceData(
  storage: KeyValueStorage,
  organizationId: string,
  teamId: string,
): void {
  const activeGameKey = activeGameStorageKey(organizationId, teamId);
  const completedGamesKey = completedGamesStorageKey(organizationId, teamId);

  const gameIds = new Set<string>([
    ...extractGameIds(storage.getItem(activeGameKey)),
    ...extractGameIds(storage.getItem(completedGamesKey)),
  ]);

  for (const gameId of gameIds) {
    storage.removeItem(gameSyncCheckpointStorageKey(gameId));
  }

  const keys = [
    SETTINGS_STORAGE_KEY,
    ROSTER_STORAGE_KEY,
    V1_GAMES_STORAGE_KEY,
    V1_ACTIVE_GAME_STORAGE_KEY,
    activeGameKey,
    completedGamesKey,
    DEVICE_ID_STORAGE_KEY,
    pendingFinalizeStorageKey(organizationId, teamId),
    migrationRunStorageKey(organizationId, teamId),
  ];
  for (const key of keys) {
    storage.removeItem(key);
  }
}
