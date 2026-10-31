import type { RosterPlayer } from '../roster/types';
import { computeLineupStats } from '../stats/computeLineupStats';
import type { AnalysisGame } from '../stats/types';

/**
 * T4 — on/off per speler (docs/pr-trends-lineups-plan.md §F.1/§F.2).
 *
 * Additief: wijzigt geen bestaande berekening. De ON-kant komt uit
 * `computeLineupStats` (combinatiegrootte 1, geen spelerfilters); de OFF-kant is
 * het teamtotaal van dezelfde selectie min ON. Daarmee telt een wedstrijd
 * waarin de speler niet in de snapshot zat als OFF-tijd (anders dan de
 * Statistieken-tab, die OFF beperkt tot wedstrijden met de speler in de
 * snapshot). PARTIAL-segmenten zijn overal uitgesloten.
 *
 * Spelers die in de selectie nooit op het veld stonden (`onSec === 0`) krijgen
 * geen rij, zoals `computePlayerTrends` spelers zonder gespeelde wedstrijd
 * overslaat. Rijvolgorde = volgorde van `roster`.
 */
export interface OnOffRow {
  rosterId: number;
  onSec: number;
  /** pf − pa terwijl de speler op het veld stond. */
  onPm: number;
  onPer10: number;
  offSec: number;
  offPm: number;
  /** `null` zonder OFF-minuten (de speler speelde alles). */
  offPer10: number | null;
  /** `onPer10 − offPer10`; `null` zonder OFF-minuten. */
  diffPer10: number | null;
  /** `onSec >= onMinSec` EN `offSec >= offMinSec` (gelijk telt mee) en er is OFF-tijd. */
  qualified: boolean;
}

/**
 * Drempels per kant (besluit I.3: de off-kant vraagt 10:00 bij een gekozen
 * drempel > 0, de on-kant volgt de filterbalk). Een kaal getal geldt voor
 * beide kanten (compatibele aanroepvorm).
 */
export interface OnOffThresholds {
  onMinSec: number;
  offMinSec: number;
}

export function computeOnOffImpact(
  games: AnalysisGame[],
  gameIds: Set<string> | null,
  roster: readonly RosterPlayer[],
  min: number | OnOffThresholds,
): OnOffRow[] {
  const onMinSec = typeof min === 'number' ? min : min.onMinSec;
  const offMinSec = typeof min === 'number' ? min : min.offMinSec;
  const stats = computeLineupStats(games, {
    comboSize: 1,
    per10: false,
    sortDirection: 'desc',
    gameIds,
    playerFilters: [],
  });
  const onById = new Map<number, { sec: number; pm: number }>();
  for (const c of stats.combinations) {
    onById.set(c.rosterIds[0]!, { sec: c.onSec, pm: c.onPF - c.onPA });
  }

  // Teamtotaal over dezelfde (niet-PARTIAL) segmenten als computeLineupStats.
  let teamSec = 0;
  let teamPm = 0;
  const allowed = gameIds === null ? games : games.filter((g) => gameIds.has(g.id));
  for (const game of allowed) {
    const known = new Set(game.players.map((p) => p.id));
    for (const segment of game.segments) {
      if (!segment.lineup.every((id) => known.has(id))) continue;
      teamSec += segment.durSec;
      teamPm += segment.pf - segment.pa;
    }
  }

  const rows: OnOffRow[] = [];
  for (const rp of roster) {
    if (typeof rp.id !== 'number') continue;
    const on = onById.get(rp.id);
    if (!on || on.sec <= 0) continue;
    const offSec = teamSec - on.sec;
    const offPm = teamPm - on.pm;
    const onPer10 = (on.pm * 600) / on.sec;
    const offPer10 = offSec > 0 ? (offPm * 600) / offSec : null;
    rows.push({
      rosterId: rp.id,
      onSec: on.sec,
      onPm: on.pm,
      onPer10,
      offSec,
      offPm,
      offPer10,
      diffPer10: offPer10 === null ? null : onPer10 - offPer10,
      qualified: offPer10 !== null && on.sec >= onMinSec && offSec >= offMinSec,
    });
  }
  return rows;
}
