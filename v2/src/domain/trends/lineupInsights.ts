import { segmentTurnovers } from '../game/tracking';
import { computeLineupStats, normalizeSegmentLineup } from '../stats/computeLineupStats';
import type { AnalysisGame } from '../stats/types';

/**
 * Lineup-inzichten voor de Trends-tab (plan docs/pr-trends-lineups-plan.md §E/§F.1):
 * +/-, punten voor/tegen en turnovers per 10 minuten per lineup, met een
 * minimumdrempel in seconden. Puur additief: de totalen komen uit
 * `computeLineupStats` en de segmentnormalisatie uit `normalizeSegmentLineup`
 * (geen tweede normalisatiepad, geen gekopieerde rekenregels).
 *
 * Aggregatie is TIJDGEWOGEN (`som pm * 600 / som seconden`), dus anders dan de
 * v1-per-punt-regel van de spelertrends (`computePlayerTrends`); dat contract
 * blijft ongewijzigd. De waarden zijn beschrijvend, geen possession-rating.
 *
 * De actieve wedstrijd (`isCurrent`) is gewoon een `AnalysisGame` en telt als
 * voorlopige wedstrijd mee. PARTIAL-segmenten (onbekende spelersreferentie)
 * worden uitgesloten en geteld in `partialSegments`.
 */

/** Demping (shrinkage): waarde "alsof de lineup nog 10 minuten gelijk speelde". */
export const DAMP_SEC = 600;

export type LineupMetric = 'pm' | 'pf' | 'pa' | 'tov';

export interface LineupRow {
  /** Numeriek gesorteerde `rosterId`-sleutel (zoals `computeLineupStats`). */
  rosterIds: number[];
  seconds: number;
  pf: number;
  pa: number;
  pm: number;
  tov: number;
  /** Aantal wedstrijden met minstens één (niet-PARTIAL) segment van deze lineup. */
  games: number;
  pmPer10: number;
  pfPer10: number;
  paPer10: number;
  tovPer10: number;
  /** `pm * 600 / (seconds + DAMP_SEC)`. */
  dampedPmPer10: number;
  /** `pmPer10 - team.pmPer10` (0 als het team geen speeltijd heeft). */
  deltaVsTeamPer10: number;
  /** `seconds >= minSec` (gelijk telt mee). */
  qualified: boolean;
}

export interface LineupTeamTotals {
  seconds: number;
  pf: number;
  pa: number;
  pm: number;
  tov: number;
  pmPer10: number | null;
  pfPer10: number | null;
  paPer10: number | null;
  tovPer10: number | null;
}

export interface LineupInsights {
  /** Gekwalificeerde rijen, gesorteerd op de gekozen metric (zie `computeLineupInsights`). */
  rows: LineupRow[];
  /** Rijen onder de drempel: seconden aflopend, dan sleutel. */
  belowThreshold: LineupRow[];
  team: LineupTeamTotals;
  /** Aantal uitgesloten PARTIAL-segmenten in de gekozen wedstrijden. */
  partialSegments: number;
}

export interface LineupInsightsOptions {
  size: 2 | 3 | 5;
  /** Minimum totaal aantal seconden over alle gekozen wedstrijden. */
  minSec: number;
  metric: LineupMetric;
  /** Maximaal aantal gekwalificeerde rijen; `belowThreshold` blijft volledig. */
  limit?: number;
}

function per10(value: number, seconds: number): number | null {
  return seconds > 0 ? (value * 600) / seconds : null;
}

function keyOf(rosterIds: readonly number[]): string {
  return rosterIds.join(',');
}

function metricValue(row: LineupRow, metric: LineupMetric): number {
  switch (metric) {
    case 'pm':
      return row.pmPer10;
    case 'pf':
      return row.pfPer10;
    case 'pa':
      return row.paPer10;
    case 'tov':
      return row.tovPer10;
  }
}

/**
 * Berekent de lineup-inzichten. Sortering van `rows`: primair de gekozen
 * metric per 10 (`pm`/`pf` aflopend, `pa`/`tov` oplopend), daarna seconden
 * aflopend, daarna de canonieke sleutel. `gameIds === null` = alle wedstrijden.
 */
export function computeLineupInsights(
  games: AnalysisGame[],
  gameIds: Set<string> | null,
  opts: LineupInsightsOptions,
): LineupInsights {
  const { size, minSec, metric } = opts;
  const allowedGames = gameIds === null ? games : games.filter((g) => gameIds.has(g.id));

  // Teamtotalen en per wedstrijd de lineups van de niet-PARTIAL-segmenten.
  const team = { seconds: 0, pf: 0, pa: 0, tov: 0 };
  let partialSegments = 0;
  const lineupsPerGame: number[][][] = [];
  for (const game of allowedGames) {
    const playersById = new Map(game.players.map((p) => [p.id, p]));
    const lineups: number[][] = [];
    for (const segment of game.segments) {
      const normalized = normalizeSegmentLineup(segment, playersById);
      if (normalized.hasUnknown) {
        partialSegments += 1;
        continue;
      }
      team.seconds += segment.durSec;
      team.pf += segment.pf;
      team.pa += segment.pa;
      team.tov += segmentTurnovers(segment);
      lineups.push(normalized.rosterIds);
    }
    lineupsPerGame.push(lineups);
  }
  const teamPm = team.pf - team.pa;
  const teamPmPer10 = per10(teamPm, team.seconds);

  const stats = computeLineupStats(games, {
    comboSize: size,
    per10: false,
    sortDirection: 'desc',
    gameIds,
    playerFilters: [],
  });

  const all: LineupRow[] = [];
  for (const c of stats.combinations) {
    if (c.onSec <= 0) continue;
    const gamesCount = lineupsPerGame.filter((lineups) =>
      lineups.some((lineup) => {
        const set = new Set(lineup);
        return c.rosterIds.every((id) => set.has(id));
      }),
    ).length;
    const pm = c.onPF - c.onPA;
    const pmPer10 = (pm * 600) / c.onSec;
    all.push({
      rosterIds: c.rosterIds,
      seconds: c.onSec,
      pf: c.onPF,
      pa: c.onPA,
      pm,
      tov: c.onTov,
      games: gamesCount,
      pmPer10,
      pfPer10: (c.onPF * 600) / c.onSec,
      paPer10: (c.onPA * 600) / c.onSec,
      tovPer10: (c.onTov * 600) / c.onSec,
      dampedPmPer10: (pm * 600) / (c.onSec + DAMP_SEC),
      deltaVsTeamPer10: pmPer10 - (teamPmPer10 ?? 0),
      qualified: c.onSec >= minSec,
    });
  }

  const ascending = metric === 'pa' || metric === 'tov';
  const bySecondsThenKey = (a: LineupRow, b: LineupRow): number => {
    if (a.seconds !== b.seconds) return b.seconds - a.seconds;
    const ak = keyOf(a.rosterIds);
    const bk = keyOf(b.rosterIds);
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  };

  const rows = all
    .filter((r) => r.qualified)
    .sort((a, b) => {
      const av = metricValue(a, metric);
      const bv = metricValue(b, metric);
      if (av !== bv) return ascending ? av - bv : bv - av;
      return bySecondsThenKey(a, b);
    });
  const belowThreshold = all.filter((r) => !r.qualified).sort(bySecondsThenKey);

  return {
    rows: opts.limit === undefined ? rows : rows.slice(0, Math.max(0, opts.limit)),
    belowThreshold,
    team: {
      seconds: team.seconds,
      pf: team.pf,
      pa: team.pa,
      pm: teamPm,
      tov: team.tov,
      pmPer10: teamPmPer10,
      pfPer10: per10(team.pf, team.seconds),
      paPer10: per10(team.pa, team.seconds),
      tovPer10: per10(team.tov, team.seconds),
    },
    partialSegments,
  };
}
