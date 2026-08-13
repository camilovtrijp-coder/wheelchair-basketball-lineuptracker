import type { AnalysisScope } from '../stats/buildAnalysisScope';
import { computePlayerTrends, pointPlusMinusValue } from '../../domain/trends/computePlayerTrends';
import { buildMinutesBarChart, buildPlusMinusLineChart } from '../../domain/trends/chartModels';
import type { BarChartModel, LineChartModel } from '../../domain/trends/chartModels';
import type { RosterPlayer } from '../../domain/roster/types';
import type { PlayerTrend, TrendsDataOrigin, TrendsFilter } from '../../domain/trends/types';

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
  return { players, dataOrigin: result.dataOrigin, partialSegments: result.partialSegments };
}
