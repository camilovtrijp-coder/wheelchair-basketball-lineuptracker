import type { FirestoreDataConverter, QueryDocumentSnapshot } from 'firebase/firestore';
import {
  DocumentValidationError,
  assertBoolean,
  assertInteger,
  assertNonEmptyString,
  assertNumber,
  assertOneOf,
  assertStringArray,
  isPlainObject,
} from './validation.js';

const TYPE = 'gameAction';

/**
 * Enige ondersteunde envelope-schemaversie (PR 7.1a). Een onbekende
 * toekomstige versie wordt fail-closed geweigerd (docs/pr-7.1-plan.md §B:
 * "Leg toegestane action-payloads en schema-evolutie fail-closed vast").
 */
export const GAME_ACTION_SCHEMA_VERSION = 1;
const SUPPORTED_ACTION_SCHEMA_VERSIONS = [GAME_ACTION_SCHEMA_VERSION] as const;

const SCORE_TEAMS = ['for', 'against'] as const;
export type ScoreTeamDocument = (typeof SCORE_TEAMS)[number];

const ACTION_TYPES = [
  'score-delta',
  'score-set',
  'segment-saved',
  'segment-edited',
  'segment-deleted',
] as const;
export type GameActionTypeDocument = (typeof ACTION_TYPES)[number];

/** Spiegelt `v2/src/domain/game/types.ts` (`Segment`). */
export interface SegmentDocument {
  id: string;
  quarter: number;
  beginSec: number;
  endSec: number;
  durSec: number;
  lineup: string[];
  pf: number;
  pa: number;
  classSum: number;
  allowed: number;
  over: boolean;
}

function assertSegment(field: string, value: unknown): SegmentDocument {
  if (!isPlainObject(value)) {
    throw new DocumentValidationError(TYPE, field, 'moet een object zijn');
  }
  return {
    id: assertNonEmptyString(TYPE, `${field}.id`, value.id),
    quarter: assertInteger(TYPE, `${field}.quarter`, value.quarter),
    beginSec: assertInteger(TYPE, `${field}.beginSec`, value.beginSec),
    endSec: assertInteger(TYPE, `${field}.endSec`, value.endSec),
    durSec: assertInteger(TYPE, `${field}.durSec`, value.durSec),
    lineup: assertStringArray(TYPE, `${field}.lineup`, value.lineup),
    pf: assertNumber(TYPE, `${field}.pf`, value.pf),
    pa: assertNumber(TYPE, `${field}.pa`, value.pa),
    classSum: assertNumber(TYPE, `${field}.classSum`, value.classSum),
    allowed: assertNumber(TYPE, `${field}.allowed`, value.allowed),
    over: assertBoolean(TYPE, `${field}.over`, value.over),
  };
}

/**
 * Spiegelt `v2/src/domain/game/types.ts` (`GameAction`), maar zonder `id`/`at`
 * — die zijn al onderdeel van de envelope hieronder (`actionId`/`occurredAt`)
 * en worden hier bewust niet gedupliceerd om een divergerende dubbele bron
 * van waarheid te voorkomen.
 */
export type GameActionPayloadDocument =
  | { type: 'score-delta'; team: ScoreTeamDocument; delta: number }
  | { type: 'score-set'; team: ScoreTeamDocument; value: number }
  | { type: 'segment-saved'; segment: SegmentDocument }
  | { type: 'segment-edited'; segmentId: string; segment: SegmentDocument }
  | { type: 'segment-deleted'; segmentId: string };

function assertActionPayload(field: string, value: unknown): GameActionPayloadDocument {
  if (!isPlainObject(value)) {
    throw new DocumentValidationError(TYPE, field, 'moet een object zijn');
  }
  const actionType = assertOneOf(TYPE, `${field}.type`, value.type, ACTION_TYPES);
  switch (actionType) {
    case 'score-delta':
      return {
        type: actionType,
        team: assertOneOf(TYPE, `${field}.team`, value.team, SCORE_TEAMS),
        delta: assertNumber(TYPE, `${field}.delta`, value.delta),
      };
    case 'score-set':
      return {
        type: actionType,
        team: assertOneOf(TYPE, `${field}.team`, value.team, SCORE_TEAMS),
        value: assertNumber(TYPE, `${field}.value`, value.value),
      };
    case 'segment-saved':
      return { type: actionType, segment: assertSegment(`${field}.segment`, value.segment) };
    case 'segment-edited':
      return {
        type: actionType,
        segmentId: assertNonEmptyString(TYPE, `${field}.segmentId`, value.segmentId),
        segment: assertSegment(`${field}.segment`, value.segment),
      };
    case 'segment-deleted':
      return {
        type: actionType,
        segmentId: assertNonEmptyString(TYPE, `${field}.segmentId`, value.segmentId),
      };
  }
}

function assertSchemaVersion(field: string, value: unknown): number {
  const version = assertInteger(TYPE, field, value);
  if (!(SUPPORTED_ACTION_SCHEMA_VERSIONS as readonly number[]).includes(version)) {
    throw new DocumentValidationError(
      TYPE,
      field,
      `onbekende schemaversie ${version}; ondersteund: [${SUPPORTED_ACTION_SCHEMA_VERSIONS.join(', ')}]`,
    );
  }
  return version;
}

/**
 * organizations/{orgId}/teams/{teamId}/games/{gameId}/actions/{actionId}
 *
 * Create-only en daarna onveranderlijk (ADR-002 §"Verduidelijkingen voor
 * fase 7" punt 1, afgedwongen door Security Rules in PR 7.1b — een retry met
 * dezelfde `actionId` mag nooit een afwijkende payload accepteren). `actionId`
 * komt uit het pad en is exact `GameAction.id`; `sequence` is de positie in
 * `ActiveGame.actions` op het moment van projecteren, zodat volgorde ook na
 * out-of-order netwerklevering reconstrueerbaar blijft. `occurredAt` spiegelt
 * `GameAction.at` (client-autoritatieve ISO-tijd, geen `serverTimestamp()` —
 * nodig voor deterministische projectie). `authorUid`/`deviceId`/`writerEpoch`
 * dragen het epoch/fencing-contract (ADR-002 punt 3); de daadwerkelijke
 * claim-/overnamelogica is PR 7.3-scope.
 */
export interface GameActionEnvelopeDocument {
  organizationId: string;
  teamId: string;
  gameId: string;
  actionId: string;
  authorUid: string;
  deviceId: string;
  writerEpoch: number;
  sequence: number;
  occurredAt: string;
  schemaVersion: number;
  action: GameActionPayloadDocument;
}

export const gameActionConverter: FirestoreDataConverter<GameActionEnvelopeDocument> = {
  toFirestore(action: GameActionEnvelopeDocument) {
    return action;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): GameActionEnvelopeDocument {
    const data = snapshot.data();
    return {
      organizationId: assertNonEmptyString(TYPE, 'organizationId', data.organizationId),
      teamId: assertNonEmptyString(TYPE, 'teamId', data.teamId),
      gameId: assertNonEmptyString(TYPE, 'gameId', data.gameId),
      actionId: assertNonEmptyString(TYPE, 'actionId', data.actionId),
      authorUid: assertNonEmptyString(TYPE, 'authorUid', data.authorUid),
      deviceId: assertNonEmptyString(TYPE, 'deviceId', data.deviceId),
      writerEpoch: assertInteger(TYPE, 'writerEpoch', data.writerEpoch),
      sequence: assertInteger(TYPE, 'sequence', data.sequence),
      occurredAt: assertNonEmptyString(TYPE, 'occurredAt', data.occurredAt),
      schemaVersion: assertSchemaVersion('schemaVersion', data.schemaVersion),
      action: assertActionPayload('action', data.action),
    };
  },
};
