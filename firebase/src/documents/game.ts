import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import {
  DocumentValidationError,
  assertBoolean,
  assertInteger,
  assertIsoTimestampString,
  assertNonEmptyString,
  assertNullableIsoTimestampString,
  assertNullableString,
  assertNullableStringArray,
  assertNumber,
  assertOneOf,
  assertPathContextField,
  assertString,
  assertStringArray,
  assertTimestamp,
  isPlainObject,
  pathSegments,
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

/** Geëxporteerd voor hergebruik door `completedGame.ts` (PR 7.2a) — dezelfde
 * `GamePlayer`-vorm wordt bevroren op een `CompletedGame`-snapshot, geen
 * tweede, divergerende validatiekopie. */
export function assertGamePlayer(field: string, value: unknown): GamePlayerDocument {
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

export function assertGamePlayers(field: string, value: unknown): GamePlayerDocument[] {
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
 * hetzelfde ADR-punt 3 vast; de daadwerkelijke claim-/overnamelogica staat in
 * `application/game/GameCloudGateway.ts` (PR 7.3a, docs/pr-7.3-plan.md §B/
 * §C 7.3a). `claimedAt`/`lastWriterActivityAt` zijn PR 7.3a-toevoegingen: net
 * als `createdAt`/`startedAt` zijn dit client-autoritatieve ISO-strings, geen
 * `serverTimestamp()` — nodig voor een deterministische, testbare
 * claim/overname-projectie. `claimedAt` wordt bij elke (initiële-claim- of
 * overname-)claim opnieuw gezet; `lastWriterActivityAt` wordt bij elke
 * normale draaiveldpatch van de ACTUELE writer bijgewerkt (zie
 * `projectGameSnapshotPatch()`). Samen leveren ze de "zichtbare huidige
 * writer + laatste serveractiviteit" die een overname-bevestigingsflow
 * (7.3c) nodig heeft — expliciet GEEN automatische lease-expiry op basis van
 * de klok (docs/pr-7.3-plan.md §B: "Courtside-netwerkverlies mag
 * eigenaarschap niet ongemerkt laten vervallen"), dus deze velden worden
 * nergens clientside met de systeemklok vergeleken om een claim automatisch
 * ongeldig te verklaren. `revision` is een monotone teller voor
 * optimistische concurrency-controle op snapshotpatches (PR 7.1c, ook
 * gebruikt door de PR 7.3a-claim/overnamepatches). `createdAt`/`startedAt`
 * zijn client-autoritatieve historische feiten die
 * `ActiveGame.createdAt`/`startedAt` exact spiegelen (platte ISO-strings,
 * geen `serverTimestamp()` — nodig voor deterministische projectie, zie
 * `application/game/projectGameForCloud.ts`); `updatedAt` is
 * server-bijgehouden bookkeeping voor sync-/staleness-weergave (zelfde
 * patroon als settings/roster) en wordt pas door de PR 7.1c-adapter gezet,
 * niet door de pure projectiefunctie.
 *
 * `completedGameId` (PR 7.2a, docs/pr-7.2-plan.md §C 7.2a): `null` totdat de
 * wedstrijd is afgerond; daarna `CompletedGame.id` van de bevroren snapshot
 * in `completedGames/{completedGameId}` (zie `completedGame.ts` hieronder).
 * Bewust GEEN `phase: 'completed'` — `phase` spiegelt exact
 * `v2/src/domain/game/types.ts`'s `ActiveGame.phase` (die kent alleen
 * `'setup'|'tracking'`; een afgeronde wedstrijd is domeinbreed altijd al een
 * apart `CompletedGame`, geen derde `ActiveGame`-fase). Zodra gezet is dit
 * parentdocument bevroren: firestore.rules staat geen normale draaiveldpatch
 * (punt 10a) meer toe zolang `completedGameId != null`, en de eenmalige
 * overgang zelf (10c) laat verder niets anders wijzigen dan dit veld zelf.
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
  /** PR 7.3a: ISO-tijdstip van de laatste (initiële of overname-)claim; `null` zolang `writerUid` `null` is. */
  claimedAt: string | null;
  /** PR 7.3a: ISO-tijdstip van de laatste draaiveldpatch door de actuele writer; `null` zolang `writerUid` `null` is. */
  lastWriterActivityAt: string | null;
  revision: number;
  createdAt: string;
  startedAt: string | null;
  completedGameId: string | null;
  updatedAt: Timestamp;
}

export const gameConverter: FirestoreDataConverter<GameDocument> = {
  toFirestore(game: GameDocument) {
    return game;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): GameDocument {
    const data = snapshot.data();
    // Pad: organizations/{orgId}/teams/{teamId}/games/{gameId}.
    const segments = pathSegments(snapshot.ref.path);
    const organizationId = assertNonEmptyString(TYPE, 'organizationId', data.organizationId);
    const teamId = assertNonEmptyString(TYPE, 'teamId', data.teamId);
    assertPathContextField(TYPE, 'organizationId', organizationId, segments[1]);
    assertPathContextField(TYPE, 'teamId', teamId, segments[3]);
    return {
      organizationId,
      teamId,
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
      pendingSwapLineup: assertNullableStringArray(
        TYPE,
        'pendingSwapLineup',
        data.pendingSwapLineup,
      ),
      scoreFor: assertInteger(TYPE, 'scoreFor', data.scoreFor),
      scoreAgainst: assertInteger(TYPE, 'scoreAgainst', data.scoreAgainst),
      segmentCount: assertInteger(TYPE, 'segmentCount', data.segmentCount),
      writerUid: assertNullableString(TYPE, 'writerUid', data.writerUid),
      deviceId: assertNullableString(TYPE, 'deviceId', data.deviceId),
      writerEpoch: assertInteger(TYPE, 'writerEpoch', data.writerEpoch),
      claimedAt: assertNullableIsoTimestampString(TYPE, 'claimedAt', data.claimedAt),
      lastWriterActivityAt: assertNullableIsoTimestampString(
        TYPE,
        'lastWriterActivityAt',
        data.lastWriterActivityAt,
      ),
      revision: assertInteger(TYPE, 'revision', data.revision),
      createdAt: assertIsoTimestampString(TYPE, 'createdAt', data.createdAt),
      startedAt: assertNullableIsoTimestampString(TYPE, 'startedAt', data.startedAt),
      completedGameId: assertNullableString(TYPE, 'completedGameId', data.completedGameId),
      updatedAt: assertTimestamp(TYPE, 'updatedAt', data.updatedAt),
    };
  },
};
