import type { ActiveGame, GameAction } from './types';
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

/**
 * PR 7.3c (docs/pr-7.3-plan.md §C 7.3c werk 2/3): de lokale acties van
 * `game` die dit checkpoint nog niet als server-bevestigd kent — precies de
 * "exporteerbare `Actie nodig`-items" uit werk 2 (bijv. omdat een andere
 * schrijver deze wedstrijd overnam terwijl dit apparaat offline queued
 * acties had) en tegelijk de bron voor werk 3's herstel-garantie: de lokale
 * actielog (`ActiveGame.actions`) zelf wordt hier alleen GELEZEN, nooit
 * gefilterd/verwijderd — `GameRepository.write()` blijft de enige plek die
 * `game.actions` mag muteren (zie `application/game/GameRepository.ts`), dus
 * een actie die hier als "nog niet bevestigd" verschijnt blijft dat gewoon
 * totdat een latere sync 'm alsnog bevestigt of de gebruiker de wedstrijd
 * handmatig aanpast. Puur — geen Firestore-/downloadafhankelijkheid, zie
 * `infrastructure/game/exportPendingGameActions.ts` voor het downloadpad.
 */
export function unconfirmedGameActions(
  game: ActiveGame,
  checkpoint: GameSyncCheckpoint,
): GameAction[] {
  return game.actions.filter((action) => !checkpoint.confirmedActionIds.includes(action.id));
}
