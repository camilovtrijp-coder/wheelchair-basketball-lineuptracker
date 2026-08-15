import type { ActiveGame } from './types';
import type { GameSyncCheckpoint } from './syncCheckpoint';

/**
 * Exporteerbare diagnosedescriptor voor de cloud-sync van één wedstrijd
 * (PR 7.1c, docs/pr-7.1-plan.md §C 7.1c werk 4). Draagt uitsluitend tellingen
 * en ID's — nooit spelersnamen, score of segmentinhoud — zodat dit veilig in
 * logs/een debugpaneel getoond kan worden zonder wedstrijddata te lekken.
 * Puur domeintype, geen Firestore-afhankelijkheid (zelfde patroon als
 * `domain/syncState.ts`/`domain/game/syncCheckpoint.ts`).
 */
export interface GameSyncDiagnostics {
  gameId: string;
  status: GameSyncCheckpoint['status'];
  totalActionCount: number;
  confirmedActionCount: number;
  pendingActionCount: number;
  serverRevision: number;
  lastError?: string;
  updatedAt: string;
}

export function buildGameSyncDiagnostics(
  game: ActiveGame,
  checkpoint: GameSyncCheckpoint,
): GameSyncDiagnostics {
  const totalActionCount = game.actions.length;
  const confirmedActionCount = game.actions.filter((action) =>
    checkpoint.confirmedActionIds.includes(action.id),
  ).length;
  return {
    gameId: game.id,
    status: checkpoint.status,
    totalActionCount,
    confirmedActionCount,
    pendingActionCount: totalActionCount - confirmedActionCount,
    serverRevision: checkpoint.serverRevision,
    lastError: checkpoint.lastError,
    updatedAt: checkpoint.updatedAt,
  };
}
