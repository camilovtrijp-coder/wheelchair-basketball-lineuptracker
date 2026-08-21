import type { CompletedGame } from '../../domain/game/types';
import type { CompletedGameSnapshotProjection } from './GameCloudGateway';
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
