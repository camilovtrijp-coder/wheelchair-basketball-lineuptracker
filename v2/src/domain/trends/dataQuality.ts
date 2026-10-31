import type { AnalysisGame } from '../stats/types';
import {
  playersByIdOf,
  QUARTER_SECONDS,
  quarterCountOf,
  segmentRosterIds,
  selectGames,
} from './trendsScope';

/**
 * T6 — datakwaliteitswaarschuwingen. Pure, getypeerde uitvoer (code +
 * parameters); de UI vertaalt. Geen vertaalde tekst in het domein.
 *
 * Verwachte speeltijd per wedstrijd = `quarterCount * 600` s. `AnalysisGame`
 * heeft nog geen verplicht `quarterCount`; een (toekomstig) optioneel veld
 * wordt gebruikt, anders geldt 4 x 10 min = 2400 s.
 *
 * Volgorde van de uitvoer: kwarten (oplopend), speeltijd (per wedstrijd, in
 * volgorde van `games`), segmenten van 0 s, ontbrekende turnovers, PARTIAL.
 */
export type DataQualityWarning =
  | {
      code: 'quarter-without-segments';
      quarter: number;
      /** Wedstrijden (uit de selectie) zonder segment in dit kwart. */
      gameIds: string[];
      totalGames: number;
    }
  | {
      code: 'playtime-below-total';
      gameId: string;
      seconds: number;
      expectedSeconds: number;
    }
  | { code: 'zero-length-segments'; count: number; gameIds: string[] }
  | {
      /** Wedstrijden met segmenten maar zonder `tov` op enig segment (oude data). */
      code: 'missing-turnovers';
      gameIds: string[];
    }
  | { code: 'partial-segments-excluded'; count: number; gameIds: string[] };

export function computeDataQualityWarnings(
  games: readonly AnalysisGame[],
  gameIds: ReadonlySet<string> | null,
): DataQualityWarning[] {
  const selected = selectGames(games, gameIds);
  const warnings: DataQualityWarning[] = [];

  const missingByQuarter = new Map<number, string[]>();
  for (const game of selected) {
    const present = new Set(game.segments.map((s) => s.quarter));
    for (let q = 1; q <= quarterCountOf(game); q += 1) {
      if (!present.has(q)) {
        const list = missingByQuarter.get(q) ?? [];
        list.push(game.id);
        missingByQuarter.set(q, list);
      }
    }
  }
  for (const quarter of [...missingByQuarter.keys()].sort((a, b) => a - b)) {
    warnings.push({
      code: 'quarter-without-segments',
      quarter,
      gameIds: missingByQuarter.get(quarter)!,
      totalGames: selected.length,
    });
  }

  for (const game of selected) {
    const seconds = game.segments.reduce((sum, s) => sum + s.durSec, 0);
    const expectedSeconds = quarterCountOf(game) * QUARTER_SECONDS;
    if (seconds < expectedSeconds) {
      warnings.push({ code: 'playtime-below-total', gameId: game.id, seconds, expectedSeconds });
    }
  }

  let zeroCount = 0;
  const zeroGames: string[] = [];
  let partialCount = 0;
  const partialGames: string[] = [];
  const noTovGames: string[] = [];
  for (const game of selected) {
    const byId = playersByIdOf(game);
    let zero = 0;
    let partial = 0;
    for (const s of game.segments) {
      if (s.durSec === 0) zero += 1;
      if (segmentRosterIds(s, byId) === null) partial += 1;
    }
    if (zero > 0) {
      zeroCount += zero;
      zeroGames.push(game.id);
    }
    if (partial > 0) {
      partialCount += partial;
      partialGames.push(game.id);
    }
    if (game.segments.length > 0 && !game.segments.some((s) => typeof s.tov === 'number')) {
      noTovGames.push(game.id);
    }
  }
  if (zeroCount > 0) {
    warnings.push({ code: 'zero-length-segments', count: zeroCount, gameIds: zeroGames });
  }
  if (noTovGames.length > 0) warnings.push({ code: 'missing-turnovers', gameIds: noTovGames });
  if (partialCount > 0) {
    warnings.push({
      code: 'partial-segments-excluded',
      count: partialCount,
      gameIds: partialGames,
    });
  }
  return warnings;
}
