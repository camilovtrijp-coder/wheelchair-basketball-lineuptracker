/**
 * PR 6.5 (trends) — types voor de pure trendberekening, conform
 * docs/pr-6.5-plan.md §C. Spiegelt v1's `computePlayerTrend()` /
 * `renderTrendsTab()`, maar op `rosterId` i.p.v. de per-wedstrijd
 * `GamePlayer.id` (zelfde reden als PR 6.4 §C.2: een `GamePlayer.id` is per
 * wedstrijd een nieuwe UUID).
 */

/** Sorteercyclus (plan §C.2): rugnummer → gemiddelde minuten → gemiddelde plus/min. */
export type TrendsSortBy = 'nr' | 'minutes' | 'plusMinus';

export interface TrendsFilter {
  /** Eigen per-tab toggle (plan §B) — NIET gedeeld met Stats. */
  per10: boolean;
  sortBy: TrendsSortBy;
  /**
   * Gedeeld wedstrijdfilter (plan §C.2/§F): dezelfde `Set<AnalysisGame.id> | null`
   * als `StatsFilter.gameIds`, aangeleverd door een gedeelde state boven
   * Stats en Trends (zie `app/App.tsx`).
   */
  gameIds: Set<string> | null;
}

/** Eén wedstrijdpunt voor één speler (plan §C.1: alleen als de speler in
 * minstens één geldig segment op het veld stond). */
export interface TrendPoint {
  gameId: string;
  opponent: string;
  date: string;
  /** Som van `durSec` over de segmenten waarin de speler op het veld stond. */
  sec: number;
  /** Ruwe som van `pf - pa` over diezelfde segmenten (niet per-10). */
  pm: number;
  /** De actuele, nog niet afgeronde wedstrijd (plan §C.2: altijd als laatste punt). */
  provisional: boolean;
}

export interface PlayerTrend {
  rosterId: number;
  nr: string;
  naam: string;
  /** Chronologisch oud → nieuw, actuele wedstrijd (indien aanwezig) als laatste. */
  points: TrendPoint[];
  /** Totale seconden / 60 / aantal gespeelde wedstrijden. */
  avgMinutes: number;
  /**
   * Bij `per10`: gemiddelde van per punt genormaliseerde `pm * 600 / sec`
   * (plan §C.2 — NIET één normalisatie over de opgetelde seconden). Anders
   * het kale gemiddelde van `pm`.
   */
  avgPlusMinus: number;
}

/**
 * Dataherkomst (plan §C.3): in fase 6 is lokale data canoniek, dus alleen
 * `local-complete`, `partial` en `error` worden daadwerkelijk geproduceerd.
 * `cache` is gereserveerd voor een latere fase zodat een toekomstige
 * cloudcache nooit stilzwijgend als volledige serverdata wordt voorgesteld
 * (plan §C.3, laatste bullet).
 */
export type TrendsDataOrigin = 'local-complete' | 'cache' | 'partial' | 'error';

export interface TrendsResult {
  players: PlayerTrend[];
  /** Gedeeld minutenmaximum (plan §C.3) over alle zichtbare spelers/wedstrijden, minimum 1. */
  sharedMaxMinutes: number;
  /** Aantal PARTIAL-segmenten (onbekende spelersreferentie), net als Stats §C.2 van PR 6.4. */
  partialSegments: number;
  dataOrigin: TrendsDataOrigin;
}
