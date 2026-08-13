import type { AnalysisGame } from '../stats/types';
import type { CompletedGamesReadStatus } from '../stats/types';
import type { RosterPlayer } from '../roster/types';
import type {
  PlayerTrend,
  TrendPoint,
  TrendsDataOrigin,
  TrendsFilter,
  TrendsResult,
} from './types';

/**
 * PR 6.5 §C — pure berekening van speler-trends, conform docs/pr-6.5-plan.md
 * en v1's `trendsScopeGames()` / `computePlayerTrend()` / `trendsPlayerAverages()`
 * / `sortTrendsPlayers()`. Geen DOM/Preact-afhankelijkheid (plan §D 6.5a).
 *
 * Herbruikt dezelfde `AnalysisGame`-bron en spelersnapshot-normalisatie
 * (rosterId i.p.v. per-wedstrijd `GamePlayer.id`) als PR 6.4's
 * `computeLineupStats` — geen tweede normalisatiepad (plan §F).
 */
export function computePlayerTrends(
  games: AnalysisGame[],
  roster: readonly RosterPlayer[],
  filter: TrendsFilter,
  historyStatus: CompletedGamesReadStatus,
): TrendsResult {
  const allowedGames =
    filter.gameIds === null
      ? games
      : games.filter((g) => filter.gameIds !== null && filter.gameIds.has(g.id));

  let partialSegments = 0;
  const normalizedByGame = new Map<
    string,
    { rosterIds: Set<number>; sec: Map<number, number>; pm: Map<number, number> }
  >();
  for (const game of allowedGames) {
    const playersById = new Map(game.players.map((p) => [p.id, p]));
    const sec = new Map<number, number>();
    const pm = new Map<number, number>();
    const onCourtRosterIds = new Set<number>();
    for (const segment of game.segments) {
      let hasUnknown = false;
      const rosterIds: number[] = [];
      for (const id of segment.lineup) {
        const player = playersById.get(id);
        if (!player) {
          hasUnknown = true;
          continue;
        }
        rosterIds.push(player.rosterId);
      }
      if (hasUnknown) {
        partialSegments += 1;
        continue;
      }
      for (const rosterId of rosterIds) {
        onCourtRosterIds.add(rosterId);
        sec.set(rosterId, (sec.get(rosterId) ?? 0) + segment.durSec);
        pm.set(rosterId, (pm.get(rosterId) ?? 0) + (segment.pf - segment.pa));
      }
    }
    normalizedByGame.set(game.id, { rosterIds: onCourtRosterIds, sec, pm });
  }

  // Chronologisch oud -> nieuw voor afgeronde wedstrijden, actuele wedstrijd
  // (indien aanwezig en geselecteerd) altijd als laatste punt (plan §C.2).
  const archived = chronologicalArchived(allowedGames.filter((g) => !g.isCurrent));
  const current = allowedGames.find((g) => g.isCurrent) ?? null;
  const scope = current ? [...archived, current] : archived;

  const players: PlayerTrend[] = [];
  for (const rosterPlayer of roster) {
    if (typeof rosterPlayer.id !== 'number') continue;
    const rosterId = rosterPlayer.id;
    const points: TrendPoint[] = [];
    for (const game of scope) {
      const normalized = normalizedByGame.get(game.id);
      if (!normalized || !normalized.rosterIds.has(rosterId)) continue;
      points.push({
        gameId: game.id,
        opponent: game.opponent,
        date: game.date,
        sec: normalized.sec.get(rosterId) ?? 0,
        pm: normalized.pm.get(rosterId) ?? 0,
        provisional: game.isCurrent,
      });
    }
    if (points.length === 0) continue;

    const totalSec = points.reduce((a, pt) => a + pt.sec, 0);
    const avgMinutes = totalSec / 60 / points.length;
    const avgPlusMinus =
      points.reduce((a, pt) => a + pointPlusMinusValue(pt, filter.per10), 0) / points.length;

    players.push({
      rosterId,
      nr: rosterPlayer.nr,
      naam: rosterPlayer.naam,
      points,
      avgMinutes,
      avgPlusMinus,
    });
  }

  const sorted = sortPlayerTrends(players, filter.sortBy);

  const allMinutes: number[] = [];
  for (const p of sorted) {
    for (const pt of p.points) allMinutes.push(pt.sec / 60);
  }
  const sharedMaxMinutes = Math.max(1, allMinutes.length ? Math.max(...allMinutes) : 1);

  return {
    players: sorted,
    sharedMaxMinutes,
    partialSegments,
    dataOrigin: dataOriginFor(historyStatus, partialSegments),
  };
}

/**
 * v1: `trendPmValue()` — bij `per10` en `sec > 0` wordt het punt eerst
 * genormaliseerd (`pm * 600 / sec`), pas daarna gemiddeld (plan §C.2, dit is
 * NIET hetzelfde als één normalisatie over de opgetelde seconden).
 */
export function pointPlusMinusValue(pt: TrendPoint, per10: boolean): number {
  if (per10 && pt.sec > 0) return (pt.pm * 600) / pt.sec;
  return pt.pm;
}

/**
 * Chronologische ordening (plan §C.2): datum oplopend, met een stabiele
 * tweede sleutel (opslagvolgorde) bij gelijke of ongeldige datums. De
 * meegegeven `games` staan in opslagvolgorde (nieuwste eerst); de index in
 * die volgorde is de stabiele tweede sleutel.
 */
function chronologicalArchived(archivedGames: AnalysisGame[]): AnalysisGame[] {
  const withIndex = archivedGames.map((g, i) => ({ g, i }));
  withIndex.sort((a, b) => {
    const ta = Date.parse(a.g.date);
    const tb = Date.parse(b.g.date);
    const va = Number.isNaN(ta) ? Number.POSITIVE_INFINITY : ta;
    const vb = Number.isNaN(tb) ? Number.POSITIVE_INFINITY : tb;
    if (va !== vb) return va - vb;
    return a.i - b.i;
  });
  return withIndex.map((x) => x.g);
}

/**
 * Sorteercyclus (plan §C.2): rugnummer → gemiddelde minuten → gemiddelde
 * plus/min, met een stabiele rugnummer/rosterId-sortering bij gelijke
 * waarden.
 */
function sortPlayerTrends(
  players: PlayerTrend[],
  sortBy: 'nr' | 'minutes' | 'plusMinus',
): PlayerTrend[] {
  const arr = players.slice();
  arr.sort((a, b) => {
    if (sortBy === 'minutes') {
      if (a.avgMinutes !== b.avgMinutes) return b.avgMinutes - a.avgMinutes;
    } else if (sortBy === 'plusMinus') {
      if (a.avgPlusMinus !== b.avgPlusMinus) return b.avgPlusMinus - a.avgPlusMinus;
    }
    const an = Number(a.nr);
    const bn = Number(b.nr);
    const av = Number.isNaN(an) ? Number.POSITIVE_INFINITY : an;
    const bv = Number.isNaN(bn) ? Number.POSITIVE_INFINITY : bn;
    if (av !== bv) return av - bv;
    return a.rosterId - b.rosterId;
  });
  return arr;
}

function dataOriginFor(
  status: CompletedGamesReadStatus,
  partialSegments: number,
): TrendsDataOrigin {
  if (status === 'error') return 'error';
  if (partialSegments > 0) return 'partial';
  return 'local-complete';
}
