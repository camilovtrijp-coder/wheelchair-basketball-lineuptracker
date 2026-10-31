import type { Segment } from '../game/types';
import type { AnalysisGame } from '../stats/types';

/**
 * Gedeelde, pure hulpfuncties voor de additieve Trends-berekeningen
 * (classificatieprofiel, datakwaliteit, lineup-extra's). Geen DOM, geen opslag.
 * De PARTIAL-regel is gelijk aan die van `computeLineupStats`: een segment
 * waarvan een lineup-ID niet in de spelerssnapshot van dezelfde wedstrijd
 * voorkomt, wordt uitgesloten.
 */

/** Standaard aantal kwarten en kwartlengte (4 x 10 min) wanneer `quarterCount` onbekend is. */
export const DEFAULT_QUARTER_COUNT = 4;
export const QUARTER_SECONDS = 600;

/** Wedstrijden binnen de selectie; `null` = alles (zoals `StatsFilter.gameIds`). */
export function selectGames(
  games: readonly AnalysisGame[],
  gameIds: ReadonlySet<string> | null,
): AnalysisGame[] {
  return gameIds === null ? [...games] : games.filter((g) => gameIds.has(g.id));
}

/**
 * Rosterspeler-ID's van een segment, of `null` als het segment PARTIAL is
 * (onbekende spelersreferentie).
 */
export function segmentRosterIds(
  segment: Segment,
  playersById: ReadonlyMap<string, { rosterId: number }>,
): number[] | null {
  const ids: number[] = [];
  for (const id of segment.lineup) {
    const player = playersById.get(id);
    if (!player) return null;
    ids.push(player.rosterId);
  }
  return ids;
}

export function playersByIdOf(game: AnalysisGame): Map<string, { rosterId: number }> {
  return new Map(game.players.map((p) => [p.id, p]));
}

/**
 * Aantal kwarten van een wedstrijd. `AnalysisGame` heeft (nog) geen verplicht
 * `quarterCount`; een toekomstig optioneel veld wordt hier defensief gelezen.
 * Ongeldig of afwezig = 4.
 */
export function quarterCountOf(game: AnalysisGame): number {
  const raw = (game as { quarterCount?: unknown }).quarterCount;
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_QUARTER_COUNT;
}

/** Sleutel zoals `computeLineupStats`: numeriek gesorteerde rosterId-lijst. */
export function rosterKey(ids: readonly number[]): string {
  return ids.join(',');
}

export function per10(value: number, seconds: number): number | null {
  return seconds > 0 ? (value * 600) / seconds : null;
}
