import type { AnalysisScope } from '../stats/buildAnalysisScope';
import { computePlayerTrends, pointPlusMinusValue } from '../../domain/trends/computePlayerTrends';
import { buildMinutesBarChart, buildPlusMinusLineChart } from '../../domain/trends/chartModels';
import type { BarChartModel, LineChartModel } from '../../domain/trends/chartModels';
import type { RosterPlayer } from '../../domain/roster/types';
import type { PlayerTrend, TrendsDataOrigin, TrendsFilter } from '../../domain/trends/types';
import type { AnalysisGame } from '../../domain/stats/types';
import {
  computeLineupTurnoverRanking,
  computeTurnoverSummary,
  LINEUP_RANKING_LIMIT,
  type LineupTurnoverRanking,
  type LineupTurnoverRow,
  type TurnoverSummary,
} from '../../domain/trends/turnoverSummary';

/**
 * PR 6.5 §D 6.5b — kleine usecase die de trendviewmodels bouwt uit de
 * gedeelde `AnalysisScope` (dezelfde bron als Stats, PR 6.4). Propageert
 * bronstatus en `partialSegments` zonder ze naar `[]` te reduceren (plan §D).
 */
export interface TrendPlayerViewModel extends PlayerTrend {
  lineChart: LineChartModel;
  barChart: BarChartModel;
}

export interface TrendsViewModel {
  players: TrendPlayerViewModel[];
  dataOrigin: TrendsDataOrigin;
  partialSegments: number;
  /** Teamtotaal aan turnovers over de gefilterde wedstrijden (zelfde filter als de spelers). */
  turnoverSummary: TurnoverSummary;
  /** Opstellingen van vijf, laagste turnover-snelheid eerst. */
  lineupRanking: LineupTurnoverRanking;
}

export function buildTrendViewModels(
  scope: AnalysisScope,
  roster: readonly RosterPlayer[],
  filter: TrendsFilter,
): TrendsViewModel {
  const result = computePlayerTrends(scope.games, roster, filter, scope.historyRead.status);
  const players: TrendPlayerViewModel[] = result.players.map((p) => ({
    ...p,
    lineChart: buildPlusMinusLineChart(
      p.points.map((pt) => ({
        value: pointPlusMinusValue(pt, filter.per10),
        provisional: pt.provisional,
      })),
    ),
    barChart: buildMinutesBarChart(
      p.points.map((pt) => ({ minutes: pt.sec / 60, provisional: pt.provisional })),
      result.sharedMaxMinutes,
    ),
  }));
  return {
    players,
    dataOrigin: result.dataOrigin,
    partialSegments: result.partialSegments,
    turnoverSummary: computeTurnoverSummary(scope.games, filter.gameIds),
    lineupRanking: computeLineupTurnoverRanking(scope.games, filter.gameIds),
  };
}

/**
 * Turnoverranglijst van lineups met drempel (plan T2, besluit 9): alleen
 * PRESENTATIE. `computeLineupTurnoverRanking` blijft ongewijzigd; hier wordt
 * het resultaat gesplitst in gekwalificeerde rijen (`seconds >= minSec`, daarna
 * pas de bestaande limiet) en een groep "te weinig data" (seconden aflopend,
 * dan sleutel). `averagePer10` en de toon blijven die van de domeinfunctie:
 * gemiddelde over ALLE lineups, ook die onder de drempel.
 */
export interface LineupTurnoverView {
  rows: LineupTurnoverRow[];
  belowThreshold: LineupTurnoverRow[];
  averagePer10: number | null;
}

export function buildLineupTurnoverView(
  games: AnalysisGame[],
  gameIds: Set<string> | null,
  minSec: number,
): LineupTurnoverView {
  const full = computeLineupTurnoverRanking(games, gameIds, Number.POSITIVE_INFINITY);
  // §E.4 (alleen presentatie): bij gelijke waarde eerst de rij met de meeste minuten, daarna de
  // sleutel. `computeLineupTurnoverRanking` valt bij gelijke waarde direct op de sleutel en blijft
  // ongewijzigd.
  const rows = full.rows
    .filter((r) => r.seconds >= minSec)
    .sort((a, b) => {
      if (a.per10 !== b.per10) return a.per10 - b.per10;
      if (a.seconds !== b.seconds) return b.seconds - a.seconds;
      const ak = a.rosterIds.join(',');
      const bk = b.rosterIds.join(',');
      return ak < bk ? -1 : ak > bk ? 1 : 0;
    });
  const belowThreshold = full.rows
    .filter((r) => r.seconds < minSec)
    .sort((a, b) => {
      if (a.seconds !== b.seconds) return b.seconds - a.seconds;
      const ak = a.rosterIds.join(',');
      const bk = b.rosterIds.join(',');
      return ak < bk ? -1 : ak > bk ? 1 : 0;
    });
  return {
    rows: rows.slice(0, LINEUP_RANKING_LIMIT),
    belowThreshold,
    averagePer10: full.averagePer10,
  };
}
