import { computeLineupStats } from '../stats/computeLineupStats';
import type { AnalysisGame, LineupCombinationStats } from '../stats/types';
import type { RosterPlayer } from '../roster/types';
import type { Segment } from '../game/types';
import {
  playersByIdOf,
  QUARTER_SECONDS,
  quarterCountOf,
  rosterKey,
  segmentRosterIds,
  selectGames,
} from './trendsScope';

/**
 * T7 (Could) — extra lineup-inzichten. Alle functies zijn additief, puur en
 * hergebruiken `computeLineupStats` waar dat kan. PARTIAL-segmenten worden
 * uitgesloten (zelfde regel als `computeLineupStats`). Alle waarden zijn
 * beschrijvend en tijdgewogen (`som pm * 600 / som sec`).
 */

export const DAMP_SEC = 600;
const TIME_EPS = 0.001;

function compareKeys(a: readonly number[], b: readonly number[]): number {
  const ak = rosterKey(a);
  const bk = rosterKey(b);
  return ak < bk ? -1 : ak > bk ? 1 : 0;
}

// ---------- (a) gedempte waarde als sorteerhulp ----------

/**
 * Gedempte +/- per 10 min: `pm * 600 / (seconds + damp)`, de waarde "alsof de
 * combinatie nog `damp` seconden gelijk speelde" (plan §E.8, besluit I.8). Alleen
 * een sorteerhulp, geen prior op het teamgemiddelde. `null` bij een noemer <= 0.
 */
export function dampedPer10(pm: number, seconds: number, damp: number = DAMP_SEC): number | null {
  const denominator = seconds + damp;
  return denominator > 0 ? (pm * 600) / denominator : null;
}

/**
 * Sorteert aflopend op de gedempte waarde; gelijkspel: meer seconden eerst,
 * daarna de canonieke sleutel. Retourneert een nieuwe array.
 */
export function sortByDamped<
  T extends { rosterIds: readonly number[]; seconds: number; pm: number },
>(rows: readonly T[], damp: number = DAMP_SEC): T[] {
  return [...rows].sort((a, b) => {
    const av = dampedPer10(a.pm, a.seconds, damp) ?? Number.NEGATIVE_INFINITY;
    const bv = dampedPer10(b.pm, b.seconds, damp) ?? Number.NEGATIVE_INFINITY;
    if (av !== bv) return bv - av;
    if (a.seconds !== b.seconds) return b.seconds - a.seconds;
    return compareKeys(a.rosterIds, b.rosterIds);
  });
}

// ---------- (b) duo's en trio's: beste en slechtste ----------

export interface ComboRow {
  rosterIds: number[];
  seconds: number;
  pf: number;
  pa: number;
  pm: number;
  pmPer10: number;
  dampedPmPer10: number | null;
}

export interface ComboExtremes {
  size: 2 | 3;
  /** Beste n op +/- per 10 (aflopend). */
  best: ComboRow[];
  /** Slechtste n op +/- per 10 (oplopend), zonder rijen die al in `best` staan. */
  worst: ComboRow[];
  /** Aantal combinaties op of boven de drempel (na het weglaten van "altijd samen"). */
  qualified: number;
  /** Combinaties die op of boven de drempel zitten maar de volledige teamspeeltijd delen. */
  excludedAlwaysTogether: number;
  partialSegments: number;
}

function totalPlayableSeconds(games: readonly AnalysisGame[]): number {
  let total = 0;
  for (const game of games) {
    const byId = playersByIdOf(game);
    for (const s of game.segments) {
      if (segmentRosterIds(s, byId) !== null) total += s.durSec;
    }
  }
  return total;
}

function toComboRow(c: LineupCombinationStats): ComboRow {
  const pm = c.onPF - c.onPA;
  return {
    rosterIds: c.rosterIds,
    seconds: c.onSec,
    pf: c.onPF,
    pa: c.onPA,
    pm,
    pmPer10: (pm * 600) / c.onSec,
    dampedPmPer10: dampedPer10(pm, c.onSec),
  };
}

/**
 * Beste en slechtste `n` duo's of trio's op +/- per 10 min, alleen boven de
 * drempel (`onSec >= minSec`, totaal over de gekozen wedstrijden). Combinaties
 * die de volledige teamspeeltijd delen (altijd samen op het veld, `onSec` ==
 * totaal) zeggen niets onderscheidends en worden weggelaten. Sortering:
 * waarde, dan meer seconden, dan de canonieke sleutel. `worst` bevat nooit een
 * rij uit `best`.
 */
export function computeComboExtremes(
  games: readonly AnalysisGame[],
  gameIds: ReadonlySet<string> | null,
  size: 2 | 3,
  minSec = 600,
  n = 3,
): ComboExtremes {
  const selected = selectGames(games, gameIds);
  const stats = computeLineupStats(selected, {
    comboSize: size,
    per10: true,
    sortDirection: 'desc',
    gameIds: null,
    playerFilters: [],
  });
  const teamSeconds = totalPlayableSeconds(selected);
  let excluded = 0;
  const rows: ComboRow[] = [];
  for (const c of stats.combinations) {
    if (c.onSec <= 0 || c.onSec < minSec) continue;
    if (c.onSec >= teamSeconds) {
      excluded += 1;
      continue;
    }
    rows.push(toComboRow(c));
  }
  const byValue = (dir: 1 | -1) => (a: ComboRow, b: ComboRow) => {
    if (a.pmPer10 !== b.pmPer10) return dir * (b.pmPer10 - a.pmPer10);
    if (a.seconds !== b.seconds) return b.seconds - a.seconds;
    return compareKeys(a.rosterIds, b.rosterIds);
  };
  const limit = Math.max(0, n);
  const best = [...rows].sort(byValue(1)).slice(0, limit);
  const bestKeys = new Set(best.map((r) => rosterKey(r.rosterIds)));
  const worst = [...rows]
    .sort(byValue(-1))
    .filter((r) => !bestKeys.has(rosterKey(r.rosterIds)))
    .slice(0, limit);
  return {
    size,
    best,
    worst,
    qualified: rows.length,
    excludedAlwaysTogether: excluded,
    partialSegments: stats.partialSegments,
  };
}

// ---------- volgorde binnen een kwart (plan §F.3) ----------

interface OrderedSegment {
  segment: Segment;
  index: number;
  elapsedStart: number;
  elapsedEnd: number;
}

/**
 * Verstreken tijd binnen het kwart (plan §F.3): bij een aflopende klok
 * (`beginSec > endSec`) is dat `600 - sec`, bij een oplopende klok `sec`.
 * `CompletedGame` heeft geen `clockDown`; de richting volgt uit het segment.
 */
function elapsedOf(segment: Segment): { start: number; end: number } {
  if (segment.beginSec > segment.endSec) {
    return { start: QUARTER_SECONDS - segment.beginSec, end: QUARTER_SECONDS - segment.endSec };
  }
  return { start: segment.beginSec, end: segment.endSec };
}

/**
 * Segmenten van één kwart met speeltijd, gesorteerd op (verstreken begintijd,
 * verstreken eindtijd, arrayindex). `reliable` is false als de volgorde niet
 * eenduidig is: gemengde klokrichtingen, overlappende segmenten of een
 * eindtijd voor de begintijd na de omrekening. Segmenten van 0 s tellen niet mee.
 */
function orderedQuarter(
  game: AnalysisGame,
  quarter: number,
): { ordered: OrderedSegment[]; reliable: boolean } {
  const ordered: OrderedSegment[] = [];
  let down = false;
  let up = false;
  game.segments.forEach((segment, index) => {
    if (segment.quarter !== quarter || !(segment.durSec > 0)) return;
    if (segment.beginSec > segment.endSec) down = true;
    else if (segment.beginSec < segment.endSec) up = true;
    const e = elapsedOf(segment);
    ordered.push({ segment, index, elapsedStart: e.start, elapsedEnd: e.end });
  });
  ordered.sort(
    (a, b) => a.elapsedStart - b.elapsedStart || a.elapsedEnd - b.elapsedEnd || a.index - b.index,
  );
  let reliable = !(down && up);
  for (let i = 0; i < ordered.length; i += 1) {
    const cur = ordered[i]!;
    if (cur.elapsedEnd < cur.elapsedStart) reliable = false;
    const prev = ordered[i - 1];
    if (prev && cur.elapsedStart < prev.elapsedEnd - TIME_EPS) reliable = false;
  }
  return { ordered, reliable };
}

// ---------- (c) start- en sluitlineup ----------

export interface StartCloseRow {
  rosterIds: number[];
  seconds: number;
  pf: number;
  pa: number;
  pm: number;
  /** Aantal wedstrijden waarin deze lineup het eerste (start) of laatste (sluit) segment speelde. */
  games: number;
}

export interface StartCloseLineups {
  /** Eerste segment van kwart 1 per wedstrijd, samengevoegd per lineup. */
  start: StartCloseRow[];
  /** Laatste segment van het laatste kwart (`quarterCount`, standaard 4) per wedstrijd. */
  close: StartCloseRow[];
  /**
   * `false` zodra de volgorde van de betrokken kwarten in minstens een wedstrijd
   * niet eenduidig is (gemengde klokrichting of overlappende segmenten). De
   * uitkomst is dan een beste gok.
   */
  orderReliable: boolean;
  /** Wedstrijden met een onbetrouwbare volgorde in kwart 1 of het laatste kwart. */
  unreliableGameIds: string[];
  /** Gekozen eerste/laatste segmenten die PARTIAL waren en daarom ontbreken. */
  partialSegments: number;
}

/**
 * Start- en sluitlineup volgens §F.3: sorteren op (kwart, verstreken tijd,
 * arrayindex). Wedstrijden zonder segment in kwart 1 (start) of het laatste
 * kwart (sluit) leveren voor die kant niets op. Rijen: meer seconden eerst,
 * dan de sleutel. Per wedstrijd telt precies een segment per kant.
 */
export function computeStartCloseLineups(
  games: readonly AnalysisGame[],
  gameIds: ReadonlySet<string> | null,
): StartCloseLineups {
  const startMap = new Map<string, StartCloseRow>();
  const closeMap = new Map<string, StartCloseRow>();
  const unreliable: string[] = [];
  let partial = 0;

  const add = (
    map: Map<string, StartCloseRow>,
    picked: OrderedSegment,
    byId: ReadonlyMap<string, { rosterId: number }>,
  ) => {
    const ids = segmentRosterIds(picked.segment, byId);
    if (ids === null) {
      partial += 1;
      return;
    }
    const canonical = ids.slice().sort((a, b) => a - b);
    const key = rosterKey(canonical);
    const row = map.get(key) ?? {
      rosterIds: canonical,
      seconds: 0,
      pf: 0,
      pa: 0,
      pm: 0,
      games: 0,
    };
    row.seconds += picked.segment.durSec;
    row.pf += picked.segment.pf;
    row.pa += picked.segment.pa;
    row.pm = row.pf - row.pa;
    row.games += 1;
    map.set(key, row);
  };

  for (const game of selectGames(games, gameIds)) {
    const byId = playersByIdOf(game);
    const lastQuarter = quarterCountOf(game);
    const first = orderedQuarter(game, 1);
    const last = lastQuarter === 1 ? first : orderedQuarter(game, lastQuarter);
    if (!first.reliable || !last.reliable) unreliable.push(game.id);
    const start = first.ordered[0];
    const close = last.ordered[last.ordered.length - 1];
    if (start) add(startMap, start, byId);
    if (close) add(closeMap, close, byId);
  }

  const finish = (map: Map<string, StartCloseRow>) =>
    [...map.values()].sort(
      (a, b) => b.seconds - a.seconds || compareKeys(a.rosterIds, b.rosterIds),
    );
  return {
    start: finish(startMap),
    close: finish(closeMap),
    orderReliable: unreliable.length === 0,
    unreliableGameIds: unreliable,
    partialSegments: partial,
  };
}

// ---------- (d) stints ----------

export interface PlayerStints {
  rosterId: number;
  stints: number;
  /** Totale tijd op het veld in de gekozen wedstrijden (som van alle stints). */
  totalSec: number;
  /** `totalSec / stints`, `null` zonder stints. */
  avgSec: number | null;
  longestSec: number;
}

export interface StintsResult {
  /** Een rij per rosterspeler, in rosterVolgorde. Spelers buiten het roster ontbreken. */
  players: PlayerStints[];
  orderReliable: boolean;
  partialSegments: number;
}

/**
 * Stint = aaneengesloten tijd op het veld binnen een kwart (besluit I.6). Per
 * kwart worden de segmenten chronologisch geordend (§F.3); een speler houdt zijn
 * stint zolang hij in opeenvolgende, tijd-aansluitende segmenten staat. Een
 * wissel (speler niet in het volgende segment), een kwartgrens, een gat in de
 * tijd of een PARTIAL-segment (onbekende opstelling) beeindigt de stint. Twee
 * segmenten met dezelfde speler (bijv. door een tussentijdse opslag) vormen
 * dus een stint. Segmenten van 0 s worden genegeerd.
 */
export function computeStints(
  games: readonly AnalysisGame[],
  gameIds: ReadonlySet<string> | null,
  roster: readonly RosterPlayer[],
): StintsResult {
  const stintsByPlayer = new Map<number, number[]>();
  for (const p of roster) stintsByPlayer.set(p.id, []);
  let reliable = true;
  let partial = 0;

  for (const game of selectGames(games, gameIds)) {
    const byId = playersByIdOf(game);
    const quarters = [...new Set(game.segments.map((s) => s.quarter))];
    for (const quarter of quarters) {
      const { ordered, reliable: ok } = orderedQuarter(game, quarter);
      if (!ok) reliable = false;
      let current = new Map<number, number>();
      let prevEnd = 0;
      const close = () => {
        for (const [rosterId, sec] of current) stintsByPlayer.get(rosterId)?.push(sec);
        current = new Map();
      };
      for (const o of ordered) {
        const ids = segmentRosterIds(o.segment, byId);
        if (ids === null) {
          partial += 1;
          close();
          prevEnd = o.elapsedEnd;
          continue;
        }
        const contiguous = current.size > 0 && Math.abs(o.elapsedStart - prevEnd) <= TIME_EPS;
        if (!contiguous) close();
        const present = new Set(ids);
        for (const [rosterId, sec] of current) {
          if (!present.has(rosterId)) {
            stintsByPlayer.get(rosterId)?.push(sec);
            current.delete(rosterId);
          }
        }
        for (const rosterId of present) {
          current.set(rosterId, (current.get(rosterId) ?? 0) + o.segment.durSec);
        }
        prevEnd = o.elapsedEnd;
      }
      close();
    }
  }

  const players = roster.map((p): PlayerStints => {
    const list = stintsByPlayer.get(p.id) ?? [];
    const totalSec = list.reduce((a, b) => a + b, 0);
    return {
      rosterId: p.id,
      stints: list.length,
      totalSec,
      avgSec: list.length > 0 ? totalSec / list.length : null,
      longestSec: list.length > 0 ? Math.max(...list) : 0,
    };
  });
  return { players, orderReliable: reliable, partialSegments: partial };
}

// ---------- (e) consistentie ----------

export interface ConsistencyRow {
  rosterIds: number[];
  /** Totale speeltijd over de gekozen wedstrijden (drempel hierop). */
  seconds: number;
  pm: number;
  /** Wedstrijden waarin de combinatie speelde. */
  gamesPlayed: number;
  /** Daarvan wedstrijden met een +/- van de combinatie > 0 (0 telt niet positief). */
  gamesPositive: number;
}

/**
 * Per combinatie "x van n wedstrijden positief" (besluit: geen SD). Alleen
 * wedstrijden waarin de combinatie op het veld stond tellen mee in `gamesPlayed`;
 * de drempel `minSec` geldt op het totaal over alle gekozen wedstrijden. Sortering:
 * meer wedstrijden, meer seconden, canonieke sleutel.
 */
export function computeConsistency(
  games: readonly AnalysisGame[],
  gameIds: ReadonlySet<string> | null,
  size: 1 | 2 | 3 | 4 | 5,
  minSec: number,
): ConsistencyRow[] {
  const map = new Map<string, ConsistencyRow>();
  for (const game of selectGames(games, gameIds)) {
    const stats = computeLineupStats([game], {
      comboSize: size,
      per10: false,
      sortDirection: 'desc',
      gameIds: null,
      playerFilters: [],
    });
    for (const c of stats.combinations) {
      if (c.onSec <= 0) continue;
      const key = rosterKey(c.rosterIds);
      const row = map.get(key) ?? {
        rosterIds: c.rosterIds,
        seconds: 0,
        pm: 0,
        gamesPlayed: 0,
        gamesPositive: 0,
      };
      const pm = c.onPF - c.onPA;
      row.seconds += c.onSec;
      row.pm += pm;
      row.gamesPlayed += 1;
      if (pm > 0) row.gamesPositive += 1;
      map.set(key, row);
    }
  }
  return [...map.values()]
    .filter((r) => r.seconds >= minSec)
    .sort(
      (a, b) =>
        b.gamesPlayed - a.gamesPlayed ||
        b.seconds - a.seconds ||
        compareKeys(a.rosterIds, b.rosterIds),
    );
}
