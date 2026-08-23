import type { CompletedGame } from '../../domain/game/types';
import type { GameSnapshotProjection } from '../game/GameCloudGateway';
import { projectGamePlayer } from '../game/projectGameForCloud';

/**
 * PR 7.4b (docs/pr-7.4-plan.md §C 7.4b werk 3): bouwt de synthetische
 * `games/{sourceGameId}`-PARENTsnapshot die nodig is om een reeds-BEVROREN
 * `CompletedGame` (migratiebron — de bijbehorende `ActiveGame` bestaat
 * allang niet meer, zie `domain/game/finish.ts`) alsnog via de bestaande
 * 7.2-completed-gameflow te kunnen schrijven (firestore.rules' `completed
 * Games`-createregel eist een `games/{sourceGameId}`-document met de
 * aanroeper als writer, punt 16/17 — zie `MigrationWriteGateway`'s
 * docstring).
 *
 * Bewust GEEN her-afleiding van `deriveGameHistory()` (zoals
 * `projectGameSnapshot()` voor een ECHTE `ActiveGame` doet) — `scoreFor`/
 * `scoreAgainst`/`segmentCount` komen hier 1:1 van de al-bevroren
 * `CompletedGame` zelf, want er is geen actielog meer om opnieuw te
 * berekenen. `phase: 'tracking'` (nooit `'setup'`): een afgeronde wedstrijd
 * heeft per definitie getrackt, `isValidGamePayload()` kent geen `'completed'`-
 * fase (zie firestore.rules' `gameKeys()`/`isValidGamePayload()` — status
 * "afgerond" leeft uitsluitend in `completedGameId != null`, niet in
 * `phase`). Dit parentdocument wordt na de migratie NOOIT meer gepatcht via
 * het normale sync-pad (geen levende `ActiveGame` hoort erbij) — het bestaat
 * uitsluitend om aan de create-regel van de completedGame-write te voldoen.
 */
export function projectMigratedGameParentSnapshot(game: CompletedGame): GameSnapshotProjection {
  return {
    organizationId: game.organizationId,
    teamId: game.teamId,
    phase: 'tracking',
    players: game.players.map(projectGamePlayer),
    opponent: game.opponent,
    competition: game.competition,
    clockDown: false,
    limitStr: '',
    onCourt: [],
    curQuarter: game.quarterCount,
    beginSec: 0,
    endSec: 0,
    pendingSwapLineup: null,
    scoreFor: game.scoreFor,
    scoreAgainst: game.scoreAgainst,
    segmentCount: game.segments.length,
    writerUid: null,
    deviceId: null,
    writerEpoch: 0,
    claimedAt: null,
    lastWriterActivityAt: null,
    revision: 0,
    createdAt: game.date,
    startedAt: game.date,
    completedGameId: null,
  };
}
