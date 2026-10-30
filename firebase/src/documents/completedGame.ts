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
  isPlainObject,
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
 * PR 7.5c (docs/pr-7.5-plan.md §D.2/§D.3): de zes bewerkbare segmentvelden in
 * een correctie-logitem — spiegelt `CorrectableSegmentFields`
 * (`v2/src/domain/game/types.ts`).
 */
export interface CompletedGameCorrectionFieldsDocument {
  quarter: number;
  beginSec: number;
  endSec: number;
  pf: number;
  pa: number;
  tov: number;
}

/**
 * PR 7.5c: één item in het append-only correctielog. Spiegelt
 * `CompletedGameCorrection` plus het CLOUD-ONLY veld `segmentIndex`: de
 * positie van het segment in `segments`. Firestore Rules kunnen geen lus
 * over een lijst schrijven; met de index kunnen ze het gecorrigeerde segment
 * aanwijzen, controleren dat het `segmentId` klopt en dat alle andere
 * segmenten byte-gelijk blijven (firestore.rules punt 21). Segmenten worden
 * nooit toegevoegd, verwijderd of herordend, dus de index is stabiel. Het
 * domein kent dit veld niet: `completedGameFromDocument()` laat het weg.
 */
export interface CompletedGameCorrectionDocument {
  id: string;
  segmentId: string;
  segmentIndex: number;
  at: string;
  by: string | null;
  before: CompletedGameCorrectionFieldsDocument;
  after: CompletedGameCorrectionFieldsDocument;
}

function assertCorrectionFields(
  field: string,
  value: unknown,
): CompletedGameCorrectionFieldsDocument {
  if (!isPlainObject(value)) {
    throw new DocumentValidationError(TYPE, field, 'moet een object zijn');
  }
  const tov = assertInteger(TYPE, `${field}.tov`, value.tov);
  if (tov < 0) throw new DocumentValidationError(TYPE, `${field}.tov`, 'moet ≥ 0 zijn');
  return {
    quarter: assertInteger(TYPE, `${field}.quarter`, value.quarter),
    beginSec: assertInteger(TYPE, `${field}.beginSec`, value.beginSec),
    endSec: assertInteger(TYPE, `${field}.endSec`, value.endSec),
    pf: assertInteger(TYPE, `${field}.pf`, value.pf),
    pa: assertInteger(TYPE, `${field}.pa`, value.pa),
    tov,
  };
}

function assertCorrections(field: string, value: unknown): CompletedGameCorrectionDocument[] {
  if (!Array.isArray(value)) {
    throw new DocumentValidationError(TYPE, field, 'moet een array zijn');
  }
  return value.map((item: unknown, index) => {
    const f = `${field}[${index}]`;
    if (!isPlainObject(item)) {
      throw new DocumentValidationError(TYPE, f, 'moet een object zijn');
    }
    const segmentIndex = assertInteger(TYPE, `${f}.segmentIndex`, item.segmentIndex);
    if (segmentIndex < 0) {
      throw new DocumentValidationError(TYPE, `${f}.segmentIndex`, 'moet ≥ 0 zijn');
    }
    return {
      id: assertNonEmptyString(TYPE, `${f}.id`, item.id),
      segmentId: assertNonEmptyString(TYPE, `${f}.segmentId`, item.segmentId),
      segmentIndex,
      at: assertIsoTimestampString(TYPE, `${f}.at`, item.at),
      by: assertNullableString(TYPE, `${f}.by`, item.by),
      before: assertCorrectionFields(`${f}.before`, item.before),
      after: assertCorrectionFields(`${f}.after`, item.after),
    };
  });
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
 *
 * Backward-compat (externe review op PR #65, P1): elk document dat vóór
 * PR 7.2c is aangemaakt (PR 7.2a/7.2b-schema) mist `revision`/`deletedAt`/
 * `deletedBy` volledig — die velden bestonden toen nog niet. `fromFirestore()`
 * behandelt AFWEZIGHEID (`undefined`) van deze drie velden daarom als hun
 * aanmaak-default (`revision:0`, `deletedAt:null`, `deletedBy:null`) i.p.v.
 * fail-closed te weigeren; een AANWEZIG-maar-fout-getypeerd veld blijft wél
 * fail-closed (`assertInteger`/`assertNullableTimestamp`/`assertNullableString`).
 * `firestore.rules`' tombstone-`allow update` past dezelfde
 * `('revision' in resource.data) ? ... : 0`-defaulting toe (zie daar), zodat
 * ook een legacy-document zonder migratiestap getombstoned kan worden.
 *
 * PR 7.5c: `corrections`/`correctedAt` zijn OPTIONEEL — ze ontbreken op elk
 * document dat nooit gecorrigeerd is (en dus op alle documenten van vóór 7.5c)
 * en staan bewust niet in de create-payload. Een correctie
 * (`allow update`, firestore.rules punt 21) verhoogt `revision` met 1,
 * vervangt `segments`/`scoreFor`/`scoreAgainst` en voegt één logitem toe.
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
  /** PR 7.5c: append-only correctielog (max. 50); afwezig tot de eerste correctie. */
  corrections?: CompletedGameCorrectionDocument[];
  /** PR 7.5c: serverTijd van de laatste correctie; afwezig tot de eerste correctie. */
  correctedAt?: Timestamp;
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
      // Backward-compat met PR 7.2a/7.2b-documenten (zie de klassendocstring
      // hierboven): AFWEZIG → aanmaak-default; AANWEZIG-maar-fout-getypeerd
      // blijft fail-closed via de bestaande assert-helpers.
      revision: data.revision === undefined ? 0 : assertInteger(TYPE, 'revision', data.revision),
      deletedAt:
        data.deletedAt === undefined
          ? null
          : assertNullableTimestamp(TYPE, 'deletedAt', data.deletedAt),
      deletedBy:
        data.deletedBy === undefined
          ? null
          : assertNullableString(TYPE, 'deletedBy', data.deletedBy),
      // PR 7.5c: afwezig (oud/ongecorrigeerd document) → sleutel weglaten.
      // Een AANWEZIG-maar-fout-getypeerd `corrections` blijft fail-closed.
      // `correctedAt === null` is de nog-niet-bevestigde `serverTimestamp()`
      // van een eigen, lokaal toegepaste write (latency compensation) en telt
      // als afwezig tot de serverbevestiging binnenkomt.
      ...(data.corrections === undefined
        ? {}
        : { corrections: assertCorrections('corrections', data.corrections) }),
      ...(data.correctedAt === undefined || data.correctedAt === null
        ? {}
        : { correctedAt: assertTimestamp(TYPE, 'correctedAt', data.correctedAt) }),
    };
  },
};
