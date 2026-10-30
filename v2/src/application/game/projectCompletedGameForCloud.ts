import type { CompletedGame, CompletedGameCorrection } from '../../domain/game/types';
import type {
  CompletedGameCorrectionPayload,
  CompletedGameSnapshotProjection,
} from './GameCloudGateway';
import { projectGamePlayer, projectSegment } from './projectGameForCloud';

/**
 * Projecteert een `CompletedGame` naar de cloudvorm (PR 7.2a,
 * docs/pr-7.2-plan.md §C 7.2a werk 1). Puur en deterministisch — geen
 * herberekening: elk veld is een 1:1-overname van `finishGame()`'s
 * uitkomst (`domain/game/finish.ts`), zodat een CSV/detailweergave via de
 * cloud-snapshot byte-voor-byte gelijk blijft aan de lokale `CompletedGame`.
 * Hergebruikt dezelfde speler-/segmentprojectie als `projectGameSnapshot()`
 * (`projectGameForCloud.ts`) — geen tweede, divergerende mapping.
 */
export function projectCompletedGameSnapshot(
  completed: CompletedGame,
): CompletedGameSnapshotProjection {
  return {
    organizationId: completed.organizationId,
    teamId: completed.teamId,
    sourceGameId: completed.sourceGameId,
    opponent: completed.opponent,
    competition: completed.competition,
    date: completed.date,
    players: completed.players.map(projectGamePlayer),
    segments: completed.segments.map(projectSegment),
    scoreFor: completed.scoreFor,
    scoreAgainst: completed.scoreAgainst,
    quarterCount: completed.quarterCount,
    periodLabel: completed.periodLabel,
    useClassLimit: completed.useClassLimit,
    // PR 7.2c: create-only payload, dus altijd de aanmaak-default —
    // firestore.rules' `isValidCompletedGamePayload()` eist exact dit voor
    // `allow create` (nooit een al-getombstoned item aanmaken). Een
    // eventuele `completed.deletedAt`/`deletedBy`/`revision` op de lokale
    // snapshot (bijv. na een backup-import van een reeds getombstoned item,
    // zie `BackupCoordinator`) is hier niet van toepassing: dit pad
    // schrijft altijd een NIEUWE cloud-snapshot, geen patch op een
    // bestaande.
    revision: 0,
    deletedAt: null,
    deletedBy: null,
  };
}

/**
 * PR 7.5c (docs/pr-7.5-plan.md §D.3): projecteert de uitkomst van EEN
 * correctie (`game` = de wedstrijd NA `correction`, zoals `correctSegment()`
 * die teruggeeft) naar de cloud-payload van `GameCloudGateway
 * .correctCompletedGame()`. Puur en deterministisch; hergebruikt
 * `projectSegment()` (dus `tov` alleen bij >= 1, zoals bij finalize). Voegt het
 * cloud-only `segmentIndex` toe (positie van het segment in `segments`, zie
 * firestore.rules punt 21). `null` als `correction.segmentId` niet in `game`
 * voorkomt — dan is er niets veilig te versturen.
 */
export function projectCompletedGameCorrection(
  game: CompletedGame,
  correction: CompletedGameCorrection,
): CompletedGameCorrectionPayload | null {
  const segmentIndex = game.segments.findIndex((s) => s.id === correction.segmentId);
  if (segmentIndex < 0) return null;
  return {
    segments: game.segments.map(projectSegment),
    scoreFor: game.scoreFor,
    scoreAgainst: game.scoreAgainst,
    correction: {
      id: correction.id,
      segmentId: correction.segmentId,
      segmentIndex,
      at: correction.at,
      by: correction.by,
      before: { ...correction.before },
      after: { ...correction.after },
    },
  };
}
