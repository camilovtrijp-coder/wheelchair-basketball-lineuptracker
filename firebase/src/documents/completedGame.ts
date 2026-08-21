import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import { assertGamePlayers, type GamePlayerDocument } from './game.js';
import { assertSegment, type SegmentDocument } from './gameAction.js';
import {
  DocumentValidationError,
  assertBoolean,
  assertInteger,
  assertIsoTimestampString,
  assertNonEmptyString,
  assertNullableString,
  assertNullableTimestamp,
  assertPathContextField,
  assertString,
  assertTimestamp,
  pathSegments,
} from './validation.js';

const TYPE = 'completedGame';

function assertSegments(field: string, value: unknown): SegmentDocument[] {
  if (!Array.isArray(value)) {
    throw new DocumentValidationError(TYPE, field, 'moet een array zijn');
  }
  return value.map((segment, index) => assertSegment(`${field}[${index}]`, segment));
}

/**
 * organizations/{orgId}/teams/{teamId}/completedGames/{completedGameId}
 *
 * PR 7.2a, docs/pr-7.2-plan.md §C 7.2a: bevroren, leesgeoptimaliseerde
 * cloud-snapshot van een afgeronde wedstrijd. Spiegelt
 * `v2/src/domain/game/types.ts`'s `CompletedGame` exact (zelfde velden op
 * een letter na — `id` komt hier uit het pad, net als bij `GameDocument`).
 * `sourceGameId` koppelt terug naar `games/{sourceGameId}` (het
 * parentdocument krijgt op zijn beurt `completedGameId` gezet zodra deze
 * snapshot bevestigd is, zie `game.ts`). Create-only en daarna volledig
 * onveranderlijk (firestore.rules staat geen `update` toe) — een
 * geschiedenis-item is na afronding inhoudelijk onveranderlijk
 * (docs/pr-7.2-plan.md §B). PR 7.2c: verwijderen is een toegestane
 * tombstone-fieldpatch (`deletedAt`/`deletedBy`/`revision`) — de bevroren
 * inhoud hierboven blijft daarbij letterlijk ongewijzigd; firestore.rules
 * dwingt dat af via een `diff(...).affectedKeys().hasOnly([...])`-allowlist
 * op precies die drie velden (zie firestore.rules, `completedGames`-update).
 *
 * `date`/`players`/`segments`/`scoreFor`/`scoreAgainst`/`quarterCount`/
 * `periodLabel`/`useClassLimit` zijn de exacte, ongewijzigde velden uit
 * `domain/game/finish.ts`'s `finishGame()`-uitkomst (`v2/src/application/
 * game/projectCompletedGameForCloud.ts` projecteert 1:1, herberekent niets)
 * — een CSV/detailweergave via de cloud-snapshot blijft zo byte-voor-byte
 * gelijk aan de lokale `CompletedGame`. `syncedAt` is server-bijgehouden
 * bookkeeping (net als `GameDocument.updatedAt`) voor cache-/
 * serveractualiteit op een tweede apparaat (PR 7.2b) — geen domeinveld, dus
 * niet aanwezig op `CompletedGame` zelf.
 */
export interface CompletedGameDocument {
  organizationId: string;
  teamId: string;
  sourceGameId: string;
  opponent: string;
  competition: string;
  date: string;
  players: GamePlayerDocument[];
  segments: SegmentDocument[];
  scoreFor: number;
  scoreAgainst: number;
  quarterCount: number;
  periodLabel: string;
  useClassLimit: boolean;
  syncedAt: Timestamp;
  /** PR 7.2c: optimistische-concurrencyteller voor de tombstone-patch. `0` bij create. */
  revision: number;
  /** PR 7.2c: `null` tot een tombstone-patch dit zet; nooit teruggezet naar `null`. */
  deletedAt: Timestamp | null;
  /** PR 7.2c: uid van de gebruiker die de tombstone-patch zette; `null` tot dan. */
  deletedBy: string | null;
}

export const completedGameConverter: FirestoreDataConverter<CompletedGameDocument> = {
  toFirestore(completedGame: CompletedGameDocument) {
    return completedGame;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): CompletedGameDocument {
    const data = snapshot.data();
    // Pad: organizations/{orgId}/teams/{teamId}/completedGames/{completedGameId}.
    const segments = pathSegments(snapshot.ref.path);
    const organizationId = assertNonEmptyString(TYPE, 'organizationId', data.organizationId);
    const teamId = assertNonEmptyString(TYPE, 'teamId', data.teamId);
    assertPathContextField(TYPE, 'organizationId', organizationId, segments[1]);
    assertPathContextField(TYPE, 'teamId', teamId, segments[3]);
    return {
      organizationId,
      teamId,
      sourceGameId: assertNonEmptyString(TYPE, 'sourceGameId', data.sourceGameId),
      opponent: assertString(TYPE, 'opponent', data.opponent),
      competition: assertString(TYPE, 'competition', data.competition),
      date: assertIsoTimestampString(TYPE, 'date', data.date),
      players: assertGamePlayers('players', data.players),
      segments: assertSegments('segments', data.segments),
      scoreFor: assertInteger(TYPE, 'scoreFor', data.scoreFor),
      scoreAgainst: assertInteger(TYPE, 'scoreAgainst', data.scoreAgainst),
      quarterCount: assertInteger(TYPE, 'quarterCount', data.quarterCount),
      periodLabel: assertString(TYPE, 'periodLabel', data.periodLabel),
      useClassLimit: assertBoolean(TYPE, 'useClassLimit', data.useClassLimit),
      syncedAt: assertTimestamp(TYPE, 'syncedAt', data.syncedAt),
      revision: assertInteger(TYPE, 'revision', data.revision),
      deletedAt: assertNullableTimestamp(TYPE, 'deletedAt', data.deletedAt),
      deletedBy: assertNullableString(TYPE, 'deletedBy', data.deletedBy),
    };
  },
};
