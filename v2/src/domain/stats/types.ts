import type { CompletedGame, GamePlayer, Segment } from '../game/types';

/**
 * PR 6.4 (stats): application-bron voor de analyse. Een `AnalysisGame` is
 * een volledig, al genormaliseerd, doorzoekbaar beeld van één wedstrijd —
 * opgebouwd door `buildAnalysisScope` (application/stats) uit de
 * `CompletedGameRepository` (afgeronde wedstrijden) en de afgeleide actieve
 * wedstrijd (zie `domain/game/tracking.ts` `deriveGameHistory()`). De UI leest
 * `localStorage` of Firestore nooit rechtstreeks — alles komt via deze types
 * binnen (PR 6.4 §C.1).
 *
 * `isCurrent` markeert de voorlopige lopende wedstrijd; `id` is altijd uniek
 * binnen één analyse-scope (afgeronde wedstrijden krijgen hun eigen UUID; de
 * actieve wedstrijd krijgt de `sourceGameId`-ID alleen als die nog niet
 * voorkomt, anders een aparte voorlopige ID — zie `buildAnalysisScope`).
 */
export interface AnalysisGame {
  id: string;
  opponent: string;
  competition: string;
  date: string;
  players: GamePlayer[];
  segments: Segment[];
  scoreFor: number;
  scoreAgainst: number;
  isCurrent: boolean;
}

/**
 * Status van het inlezen van de afgeronde-wedstrijd-historie door de
 * `CompletedGameRepository`. PR 6.4 §C.1: `[]` is geen bewijs voor "geen
 * wedstrijden" — een leesfout of een nog niet aangemaakte opslagsleutel moet
 * expliciet onderscheiden worden van een wél leesbare, lege lijst. De UI
 * toont hier per status een andere melding en verbergt de "normale"
 * geen-data-banner bij `error` (PR 6.4 §C.1, §E.8).
 *
 * - `ok`     : leesbare array, ook als die leeg is.
 * - `missing`: nog nooit opgeslagen (lege sleutel). Fungeert voor de UI als
 *              "ok" met `games: []` — er is simpelweg nog niets.
 * - `error`  : kon de bestaande opslag niet lezen (corrupte JSON, niet-array
 *              payload, een gefaalde read-call of een niet-beschikbare
 *              storage-getter). De bestaande data is mogelijk wél aanwezig,
 *              maar de UI kan er niet bij — toon een foutmelding en NOOIT de
 *              "geen wedstrijden"-banner.
 */
export type CompletedGamesReadStatus = 'ok' | 'missing' | 'error';

export interface CompletedGamesReadResult {
  status: CompletedGamesReadStatus;
  games: CompletedGame[];
}

/**
 * Filterstatus per speler voor de analyse (PR 6.4 §C.3.2):
 * - `'on'`      : speler moet in ieder meegerekend segment op de vloer staan;
 * - `'off'`     : speler mag in geen enkel meegerekend segment op de vloer
 *                 staan;
 * - `'none'` of afwezig : geen filter.
 *
 * Identiek aan v1's `statsPlayerFilter` (`'on' | 'off' | undefined`),
 * gemodelleerd als `'none'` voor serialiseerbaarheid.
 */
export type PlayerFilterMode = 'on' | 'off' | 'none';

export interface PlayerFilterEntry {
  rosterId: number;
  mode: PlayerFilterMode;
}

export type SortDirection = 'asc' | 'desc';

export interface StatsFilter {
  /** Combinatiegrootte 1–5 (v1: `statsComboSize`). */
  comboSize: 1 | 2 | 3 | 4 | 5;
  /** Toon ON/OFF per-10-minuten i.p.v. raw (v1: `statsPer10`). */
  per10: boolean;
  /** Sorteerrichting (v1: `statsSortDesc`). */
  sortDirection: SortDirection;
  /**
   * Set van geselecteerde `AnalysisGame.id`'s. `null` = "alles wat de bron
   * aanbiedt" (v1: `statsGameIds == null`); een lege set = "niets geselecteerd"
   * (v1: alle vinkjes uit).
   */
  gameIds: Set<string> | null;
  /** Per-rosterId filter (v1: `statsPlayerFilter`). */
  playerFilters: PlayerFilterEntry[];
}

/**
 * Eén rij in het Stats-resultaat. Identiek aan v1's `comboKey`-aggregaat
 * (`onSec/onPF/onPA/offSec/offPF/offPA`); de namen zijn alleen typografisch
 * v2-conform. `rosterIds` is de gesorteerde unieke lijst `rosterId`'s waarop
 * de aggregaat is gebaseerd — labels komen uit `AnalysisGame.players` (de
 * meest recente, wél bestaande spelerssnapshot binnen de scope).
 */
export interface LineupCombinationStats {
  rosterIds: number[];
  onSec: number;
  onPF: number;
  onPA: number;
  offSec: number;
  offPF: number;
  offPA: number;
}

export interface LineupStatsResult {
  combinations: LineupCombinationStats[];
  /** Aantal segmenten dat door de filters is meegenomen vóór aggregatie. */
  consideredSegments: number;
  /** Aantal unieke combinaties vóór de sortering werd toegepast. */
  totalRawCombinations: number;
  /**
   * Aantal PARTIAL-segmenten — segmenten waarvan de `lineup` een
   * `GamePlayer.id` bevatte die niet in de bijbehorende spelerssnapshot
   * voorkwam (plan §C.2). Deze segmenten zijn volledig uitgesloten van
   * generatie én aggregatie; het getal wordt apart teruggegeven zodat
   * de UI ze zichtbaar kan maken.
   */
  partialSegments: number;
}
