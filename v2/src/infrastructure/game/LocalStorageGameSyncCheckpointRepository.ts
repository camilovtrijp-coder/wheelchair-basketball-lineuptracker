import type { KeyValueStorage } from '../../i18n/persistence';
import type { GameSyncCheckpointRepository } from '../../application/game/GameSyncCheckpointRepository';
import type { GameSyncCheckpoint } from '../../domain/game/syncCheckpoint';

/**
 * localStorage-implementatie van `GameSyncCheckpointRepository` (PR 7.1c,
 * docs/pr-7.1-plan.md §C 7.1c werk 3-4). Spiegelt exact het synchrone,
 * boolean-faalcontract van `LocalStorageGameRepository` — geen Firestore-
 * afhankelijkheid, puur lokale boekhouding van welke acties al
 * server-bevestigd zijn. Sleutel per `gameId` (niet per org/team zoals
 * `activeGameStorageKey`): een `gameId` is al globaal uniek
 * (`crypto.randomUUID()`, zie `domain/game/setup.ts`), dus geen extra
 * contextsleutel nodig.
 */
export const GAME_SYNC_CHECKPOINT_STORAGE_PREFIX = 'lineup-tracker-v2-game-sync-checkpoint:';

export function gameSyncCheckpointStorageKey(gameId: string): string {
  return `${GAME_SYNC_CHECKPOINT_STORAGE_PREFIX}${gameId}`;
}

function isGameSyncCheckpointShape(value: unknown): value is GameSyncCheckpoint {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.gameId === 'string' &&
    typeof v.organizationId === 'string' &&
    typeof v.teamId === 'string' &&
    Array.isArray(v.confirmedActionIds) &&
    v.confirmedActionIds.every((id) => typeof id === 'string') &&
    typeof v.serverRevision === 'number' &&
    (v.status === 'idle' || v.status === 'actie-nodig') &&
    typeof v.updatedAt === 'string'
  );
}

export class LocalStorageGameSyncCheckpointRepository implements GameSyncCheckpointRepository {
  constructor(private readonly storage: KeyValueStorage) {}

  read(gameId: string): GameSyncCheckpoint | null {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(gameSyncCheckpointStorageKey(gameId));
    } catch {
      return null;
    }
    if (raw === null || raw === '') return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isGameSyncCheckpointShape(parsed) || parsed.gameId !== gameId) return null;
    return parsed;
  }

  write(checkpoint: GameSyncCheckpoint): boolean {
    try {
      this.storage.setItem(
        gameSyncCheckpointStorageKey(checkpoint.gameId),
        JSON.stringify(checkpoint),
      );
      return true;
    } catch {
      return false;
    }
  }

  clear(gameId: string): boolean {
    try {
      this.storage.removeItem(gameSyncCheckpointStorageKey(gameId));
      return true;
    } catch {
      return false;
    }
  }
}
