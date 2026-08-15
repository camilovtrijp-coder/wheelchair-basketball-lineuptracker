import {
  GAME_ACTION_SCHEMA_VERSION,
  type GameActionEnvelopeDocument,
  type GameActionPayloadDocument,
} from 'firebase-base/documents';
import type { ActiveGame, GameAction, GamePlayer, Segment } from '../../domain/game/types';
import { deriveGameHistory } from '../../domain/game/tracking';
import type { GameSnapshotProjection } from './GameCloudGateway';

/**
 * Projecteert `ActiveGame` naar de cloudvorm (PR 7.1a, docs/pr-7.1-plan.md
 * §C werk 4). Beide functies zijn puur en deterministisch: dezelfde `game`
 * (plus dezelfde `context` voor de acties) levert altijd dezelfde document-
 * ID's en dezelfde volgorde op — geen `Date.now()`/`crypto.randomUUID()`
 * hierbinnen. De daadwerkelijke Firestore-write (met `serverTimestamp()` op
 * `updatedAt`) is PR 7.1c-scope.
 */

export interface GameCloudWriterContext {
  authorUid: string;
  deviceId: string;
  writerEpoch: number;
}

function projectGamePlayer(player: GamePlayer) {
  return {
    id: player.id,
    rosterId: player.rosterId,
    nr: player.nr,
    naam: player.naam,
    kl: player.kl,
    vrouw: player.vrouw,
    jeugd: player.jeugd,
    participate: player.participate,
    start: player.start,
  };
}

function projectSegment(segment: Segment) {
  return {
    id: segment.id,
    quarter: segment.quarter,
    beginSec: segment.beginSec,
    endSec: segment.endSec,
    durSec: segment.durSec,
    lineup: [...segment.lineup],
    pf: segment.pf,
    pa: segment.pa,
    classSum: segment.classSum,
    allowed: segment.allowed,
    over: segment.over,
  };
}

/**
 * Projecteert identiteit/status, historische spelersnapshot en de actuele
 * draaivelden naar de parent-snapshotvorm. `revision`/`writerUid`/`deviceId`/
 * `writerEpoch` krijgen hier bewust vaste initiële waarden (0/`null`/`null`/0)
 * — de daadwerkelijke schrijver-/epochtoekenning is PR 7.3-scope; deze
 * functie levert alleen de vorm voor een eerste `ensureGame()`-create in
 * PR 7.1c. `scoreFor`/`scoreAgainst`/`segmentCount` komen uit
 * `deriveGameHistory()`, dezelfde afleiding als de lokale UI gebruikt — geen
 * tweede, eigen berekeningspad.
 */
export function projectGameSnapshot(game: ActiveGame): GameSnapshotProjection {
  const history = deriveGameHistory(game);
  return {
    organizationId: game.organizationId,
    teamId: game.teamId,
    phase: game.phase,
    players: game.players.map(projectGamePlayer),
    opponent: game.opponent,
    competition: game.competition,
    clockDown: game.clockDown,
    limitStr: game.limitStr,
    onCourt: [...game.onCourt],
    curQuarter: game.curQuarter,
    beginSec: game.beginSec,
    endSec: game.endSec,
    pendingSwapLineup: game.pendingSwapLineup ? [...game.pendingSwapLineup] : null,
    scoreFor: history.scoreFor,
    scoreAgainst: history.scoreAgainst,
    segmentCount: history.segments.length,
    writerUid: null,
    deviceId: null,
    writerEpoch: 0,
    revision: 0,
    createdAt: game.createdAt,
    startedAt: game.startedAt,
  };
}

/**
 * Exacte "draaivelden"-subset uit ADR-002 §"Verduidelijkingen voor fase 7"
 * punt 4 (plus de afgeleide score-/segmentsnapshot en `phase`/`startedAt`) —
 * spiegelt precies de veldallowlist van firestore.rules' normale
 * game-updatepad (PR 7.1b, punt 10a). Nooit `organizationId`/`teamId`/
 * `players`/`opponent`/`competition`/`clockDown`/`limitStr`/`createdAt` (die
 * zijn na `ensureGame()`'s create onveranderlijk) en nooit `writerUid`/
 * `deviceId`/`writerEpoch`/`revision` (die beheert `GameSyncCoordinator`
 * zelf, zie de initiële-claimstap). Bevat bewust altijd de volledige subset,
 * ook velden die sinds de laatste patch niet gewijzigd zijn: Firestore
 * Rules' `diff(resource.data).affectedKeys()` reageert alleen op een
 * werkelijke waardewijziging in het resulterende document, dus een
 * ongewijzigd veld meesturen is een no-op voor de Rules-validatie en dit
 * spaart de coordinator een eigen "wat is er sinds de vorige patch
 * veranderd"-boekhouding uit — er is hooguit één actieve schrijver per
 * wedstrijd (het epoch/fencingcontract), dus er is geen ander apparaat dat
 * intussen een van deze velden onafhankelijk gewijzigd kan hebben.
 */
export function projectGameSnapshotPatch(
  game: ActiveGame,
): Pick<
  GameSnapshotProjection,
  | 'phase'
  | 'onCourt'
  | 'curQuarter'
  | 'beginSec'
  | 'endSec'
  | 'pendingSwapLineup'
  | 'scoreFor'
  | 'scoreAgainst'
  | 'segmentCount'
  | 'startedAt'
> {
  const snapshot = projectGameSnapshot(game);
  return {
    phase: snapshot.phase,
    onCourt: snapshot.onCourt,
    curQuarter: snapshot.curQuarter,
    beginSec: snapshot.beginSec,
    endSec: snapshot.endSec,
    pendingSwapLineup: snapshot.pendingSwapLineup,
    scoreFor: snapshot.scoreFor,
    scoreAgainst: snapshot.scoreAgainst,
    segmentCount: snapshot.segmentCount,
    startedAt: snapshot.startedAt,
  };
}

function projectActionPayload(action: GameAction): GameActionPayloadDocument {
  switch (action.type) {
    case 'score-delta':
      return { type: 'score-delta', team: action.team, delta: action.delta };
    case 'score-set':
      return { type: 'score-set', team: action.team, value: action.value };
    case 'segment-saved':
      return { type: 'segment-saved', segment: projectSegment(action.segment) };
    case 'segment-edited':
      return {
        type: 'segment-edited',
        segmentId: action.segmentId,
        segment: projectSegment(action.segment),
      };
    case 'segment-deleted':
      return { type: 'segment-deleted', segmentId: action.segmentId };
  }
}

/**
 * Projecteert elke bevestigde `GameAction` naar een action-envelope, in
 * dezelfde volgorde als `game.actions` (de bron van waarheid voor volgorde —
 * `sequence` is simpelweg de arrayindex, dus reconstrueerbaar ongeacht
 * out-of-order netwerklevering). `actionId` hergebruikt `GameAction.id` als
 * Firestore-document-ID (docs/pr-7.1-plan.md §B): dezelfde acties leveren
 * dus altijd dezelfde envelopes en dezelfde volgorde op.
 */
export function projectGameActions(
  game: ActiveGame,
  context: GameCloudWriterContext,
): GameActionEnvelopeDocument[] {
  return game.actions.map((action, index) => ({
    organizationId: game.organizationId,
    teamId: game.teamId,
    gameId: game.id,
    actionId: action.id,
    authorUid: context.authorUid,
    deviceId: context.deviceId,
    writerEpoch: context.writerEpoch,
    sequence: index,
    occurredAt: action.at,
    schemaVersion: GAME_ACTION_SCHEMA_VERSION,
    action: projectActionPayload(action),
  }));
}
