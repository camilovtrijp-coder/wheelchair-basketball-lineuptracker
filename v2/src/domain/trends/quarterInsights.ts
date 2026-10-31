import type { RosterPlayer } from '../roster/types';
import type { AnalysisGame } from '../stats/types';

/**
 * T5 — kwartsplitsing en minuten per kwart (docs/pr-trends-lineups-plan.md
 * §F.1/§F.2). Additief; PARTIAL-segmenten (lineup-ID niet in de snapshot)
 * zijn uitgesloten, net als in `computeLineupStats`.
 */
export interface QuarterRow {
  quarter: number;
  seconds: number;
  pf: number;
  pa: number;
  pm: number;
  /** `null` zonder speeltijd ("geen data"). */
  pmPer10: number | null;
  pfPer10: number | null;
  paPer10: number | null;
  /** Aantal wedstrijden met minstens één (niet-PARTIAL) segment in dit kwart. */
  games: number;
}

export interface PlayerQuarterAvg {
  quarter: number;
  /** Gemiddelde seconden in dit kwart per wedstrijd waarin de speler speelde. */
  avgSec: number;
}

/**
 * Aantal kwarten van één wedstrijd: `quarterCount` indien aanwezig, anders 4;
 * nooit lager dan het hoogste voorkomende segmentkwart (zodat geen data
 * wegvalt). De actieve wedstrijd heeft in `buildAnalysisScope` geen
 * `quarterCount` en valt dus terug op 4 / het hoogste voorkomende kwart.
 */
function gameQuarterCount(game: AnalysisGame): number {
  let max = game.quarterCount !== undefined && game.quarterCount >= 1 ? game.quarterCount : 4;
  for (const s of game.segments) if (s.quarter > max) max = s.quarter;
  return max;
}

function selectGames(games: AnalysisGame[], gameIds: Set<string> | null): AnalysisGame[] {
  return gameIds === null ? games : games.filter((g) => gameIds.has(g.id));
}

const per10 = (x: number, sec: number): number | null => (sec > 0 ? (x * 600) / sec : null);

/**
 * Eén rij per kwart 1..N, N = grootste kwartaantal in de selectie (zie
 * `gameQuarterCount`). Lege selectie: `[]`. Kwarten zonder segmenten: nullen en
 * `null` per-10-waarden.
 */
export function computeQuarterSplits(
  games: AnalysisGame[],
  gameIds: Set<string> | null,
): QuarterRow[] {
  const selected = selectGames(games, gameIds);
  const n = selected.reduce((m, g) => Math.max(m, gameQuarterCount(g)), 0);
  const rows = Array.from({ length: n }, (_, i) => ({
    quarter: i + 1,
    seconds: 0,
    pf: 0,
    pa: 0,
    games: 0,
  }));
  for (const game of selected) {
    const known = new Set(game.players.map((p) => p.id));
    const seen = new Set<number>();
    for (const s of game.segments) {
      if (!s.lineup.every((id) => known.has(id))) continue;
      const row = rows[s.quarter - 1];
      if (!row) continue;
      row.seconds += s.durSec;
      row.pf += s.pf;
      row.pa += s.pa;
      seen.add(s.quarter);
    }
    for (const q of seen) rows[q - 1]!.games += 1;
  }
  return rows.map((r) => {
    const pm = r.pf - r.pa;
    return {
      ...r,
      pm,
      pmPer10: per10(pm, r.seconds),
      pfPer10: per10(r.pf, r.seconds),
      paPer10: per10(r.pa, r.seconds),
    };
  });
}

/**
 * Per rosterspeler (met minstens één gespeeld segment) en per kwart 1..N de
 * gemiddelde seconden. Deler = aantal wedstrijden waarin die speler speelde
 * (niet het aantal wedstrijden met dat kwart). Spelers zonder speeltijd krijgen
 * geen entry. N volgt `computeQuarterSplits`.
 */
export function computePlayerQuarterMinutes(
  games: AnalysisGame[],
  gameIds: Set<string> | null,
  roster: readonly RosterPlayer[],
): Map<number, PlayerQuarterAvg[]> {
  const selected = selectGames(games, gameIds);
  const n = selected.reduce((m, g) => Math.max(m, gameQuarterCount(g)), 0);
  const total = new Map<number, number[]>();
  const played = new Map<number, number>();
  for (const game of selected) {
    const byId = new Map(game.players.map((p) => [p.id, p.rosterId]));
    const inGame = new Set<number>();
    for (const s of game.segments) {
      if (!s.lineup.every((id) => byId.has(id))) continue;
      if (s.quarter < 1 || s.quarter > n) continue;
      for (const id of s.lineup) {
        const rid = byId.get(id)!;
        let arr = total.get(rid);
        if (!arr) {
          arr = new Array<number>(n).fill(0);
          total.set(rid, arr);
        }
        arr[s.quarter - 1]! += s.durSec;
        inGame.add(rid);
      }
    }
    for (const rid of inGame) played.set(rid, (played.get(rid) ?? 0) + 1);
  }
  const out = new Map<number, PlayerQuarterAvg[]>();
  for (const rp of roster) {
    if (typeof rp.id !== 'number') continue;
    const arr = total.get(rp.id);
    const g = played.get(rp.id) ?? 0;
    if (!arr || g === 0) continue;
    out.set(
      rp.id,
      arr.map((sec, i) => ({ quarter: i + 1, avgSec: sec / g })),
    );
  }
  return out;
}
