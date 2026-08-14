import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import {
  DocumentValidationError,
  assertBoolean,
  assertInteger,
  assertNonEmptyString,
  assertNullableString,
  assertNullableStringArray,
  assertNumber,
  assertOneOf,
  assertString,
  assertStringArray,
  assertTimestamp,
  isPlainObject,
} from './validation.js';

const TYPE = 'game';

const GAME_PHASES = ['setup', 'tracking'] as const;
export type GameDocumentPhase = (typeof GAME_PHASES)[number];

/** Spiegelt `v2/src/domain/game/types.ts` (`GamePlayer`). */
export interface GamePlayerDocument {
  id: string;
  rosterId: number;
  nr: string;
  naam: string;
  kl: string;
  vrouw: boolean;
  jeugd: boolean;
  participate: boolean;
  start: boolean;
}

function assertGamePlayer(field: string, value: unknown): GamePlayerDocument {
  if (!isPlainObject(value)) {
    throw new DocumentValidationError(TYPE, field, 'moet een object zijn');
  }
  return {
    id: assertNonEmptyString(TYPE, `${field}.id`, value.id),
    rosterId: assertNumber(TYPE, `${field}.rosterId`, value.rosterId),
    nr: assertString(TYPE, `${field}.nr`, value.nr),
    naam: assertString(TYPE, `${field}.naam`, value.naam),
    kl: assertString(TYPE, `${field}.kl`, value.kl),
    vrouw: assertBoolean(TYPE, `${field}.vrouw`, value.vrouw),
    jeugd: assertBoolean(TYPE, `${field}.jeugd`, value.jeugd),
    participate: assertBoolean(TYPE, `${field}.participate`, value.participate),
    start: assertBoolean(TYPE, `${field}.start`, value.start),
  };
}

function assertGamePlayers(field: string, value: unknown): GamePlayerDocument[] {
  if (!Array.isArray(value)) {
    throw new DocumentValidationError(TYPE, field, 'moet een array zijn');
  }
  return value.map((player, index) => assertGamePlayer(`${field}[${index}]`, player));
}

/**
 * organizations/{orgId}/teams/{teamId}/games/{gameId}
 *
 * Spiegelt `v2/src/domain/game/types.ts` (`ActiveGame`), zie
 * docs/pr-7.1-plan.md §B. `gameId` komt uit het pad (== `ActiveGame.id`);
 * dit document draagt zelf ook `organizationId`/`teamId` (net als de
 * action-envelope hieronder) zodat Security Rules (PR 7.1b) en de
 * sync-coordinator (PR 7.1c) de contextvelden onafhankelijk van het pad
 * kunnen controleren.
 *
 * `scoreFor`/`scoreAgainst`/`segmentCount` zijn een afgeleide snapshot
 * (`domain/game/tracking.ts` `deriveGameHistory()`) voor goedkope lijst-/
 * detailreads — de bronwaarheid blijft de `actions`-subcollectie, nooit dit
 * cacheveld. `onCourt`/`curQuarter`/`beginSec`/`endSec`/`pendingSwapLineup`
 * zijn de "draaivelden" uit ADR-002 §"Verduidelijkingen voor fase 7" punt 4:
 * die worden met echte veldpatches geschreven, nooit als actielog-entry.
 * `writerUid`/`deviceId`/`writerEpoch` leggen het epoch/fencing-contract uit
 * hetzelfde ADR-punt 3 vast; de daadwerkelijke claim-/overnamelogica is
 * PR 7.3-scope, dit document draagt hier alleen de velden. `revision` is een
 * monotone teller voor optimistische concurrency-controle op snapshotpatches
 * (PR 7.1c). `createdAt`/`startedAt` zijn client-autoritatieve historische
 * feiten die `ActiveGame.createdAt`/`startedAt` exact spiegelen (platte
 * ISO-strings, geen `serverTimestamp()` — nodig voor deterministische
 * projectie, zie `application/game/projectGameForCloud.ts`); `updatedAt` is
 * server-bijgehouden bookkeeping voor sync-/staleness-weergave (zelfde
 * patroon als settings/roster) en wordt pas door de PR 7.1c-adapter gezet,
 * niet door de pure projectiefunctie.
 */
export interface GameDocument {
  organizationId: string;
  teamId: string;
  phase: GameDocumentPhase;
  players: GamePlayerDocument[];
  opponent: string;
  competition: string;
  clockDown: boolean;
  limitStr: string;
  onCourt: string[];
  curQuarter: number;
  beginSec: number;
  endSec: number;
  pendingSwapLineup: string[] | null;
  scoreFor: number;
  scoreAgainst: number;
  segmentCount: number;
  writerUid: string | null;
  deviceId: string | null;
  writerEpoch: number;
  revision: number;
  createdAt: string;
  startedAt: string | null;
  updatedAt: Timestamp;
}

export const gameConverter: FirestoreDataConverter<GameDocument> = {
  toFirestore(game: GameDocument) {
    return game;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): GameDocument {
    const data = snapshot.data();
    return {
      organizationId: assertNonEmptyString(TYPE, 'organizationId', data.organizationId),
      teamId: assertNonEmptyString(TYPE, 'teamId', data.teamId),
      phase: assertOneOf(TYPE, 'phase', data.phase, GAME_PHASES),
      players: assertGamePlayers('players', data.players),
      opponent: assertString(TYPE, 'opponent', data.opponent),
      competition: assertString(TYPE, 'competition', data.competition),
      clockDown: assertBoolean(TYPE, 'clockDown', data.clockDown),
      limitStr: assertString(TYPE, 'limitStr', data.limitStr),
      onCourt: assertStringArray(TYPE, 'onCourt', data.onCourt),
      curQuarter: assertInteger(TYPE, 'curQuarter', data.curQuarter),
      beginSec: assertInteger(TYPE, 'beginSec', data.beginSec),
      endSec: assertInteger(TYPE, 'endSec', data.endSec),
      pendingSwapLineup: assertNullableStringArray(TYPE, 'pendingSwapLineup', data.pendingSwapLineup),
      scoreFor: assertInteger(TYPE, 'scoreFor', data.scoreFor),
      scoreAgainst: assertInteger(TYPE, 'scoreAgainst', data.scoreAgainst),
      segmentCount: assertInteger(TYPE, 'segmentCount', data.segmentCount),
      writerUid: assertNullableString(TYPE, 'writerUid', data.writerUid),
      deviceId: assertNullableString(TYPE, 'deviceId', data.deviceId),
      writerEpoch: assertInteger(TYPE, 'writerEpoch', data.writerEpoch),
      revision: assertInteger(TYPE, 'revision', data.revision),
      createdAt: assertNonEmptyString(TYPE, 'createdAt', data.createdAt),
      startedAt: assertNullableString(TYPE, 'startedAt', data.startedAt),
      updatedAt: assertTimestamp(TYPE, 'updatedAt', data.updatedAt),
    };
  },
};
