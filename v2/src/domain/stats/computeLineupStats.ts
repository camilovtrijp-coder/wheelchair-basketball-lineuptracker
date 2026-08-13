import type {
  AnalysisGame,
  LineupCombinationStats,
  LineupStatsResult,
  PlayerFilterEntry,
  StatsFilter,
} from './types';

/**
 * PR 6.4 — pure berekening van de lineup-statistieken, conform docs/pr-6.4-plan.md
 * §C.3 (exact v1-gedrag) en §D.6.4a.
 *
 * Volgorde (v1 `computeCombos` + `renderStatsTab`):
 *  1. pas de wedstrijdselectie toe (`filter.gameIds`);
 *  2. pas de spelerfilters toe (`'on'`: iedere segment-lineup moet de speler
 *     bevatten; `'off'`: geen enkele segment-lineup mag de speler bevatten);
 *  3. genereer alléén combinaties die in minstens één gefilterd segment
 *     samen op het veld stonden (v1: `combosOfSize(seg.lineup, size)` →
 *     `comboKey()`);
 *  4. voor iedere combinatie: tel ON wanneer alle leden op het veld staan
 *     en OFF wanneer dat niet zo is, maar uitsluitend in wedstrijden
 *     waarin álle leden in de wedstrijdspelerssnapshot aanwezig zijn (v1:
 *     `rosterIds.indexOf(id) >= 0`-check op `g.players`).
 *
 * Stabiele speleridentiteit: per segment normaliseren we de line-up via de
 * spelerssnapshot van díe wedstrijd naar `GamePlayer.rosterId`, zoals §C.2
 * voorschrijft — `GamePlayer.id` is per wedstrijd een nieuwe UUID en mag dus
 * niet over meerdere wedstrijden heen dezelfde speler vertegenwoordigen.
 * Combinaties, filters en sleutels gebruiken vervolgens de gesorteerde
 * `rosterId`-waarden.
 *
 * Onbekende segmentreferenties: een `Segment.lineup`-ID dat niet in de
 * bijbehorende `players`-snapshot zit, wordt uit die segment-lineup
 * verwijderd. Daardoor kan zo'n segment resulteren in een lineup met
 * minder dan 5 spelers, wat op zijn beurt betekent dat geen enkele
 * combinatie met de ontbrekende speler in dát segment ON-aggregatie krijgt
 * — exact conform §C.2 ("mag niet stil als een andere speler worden
 * meegeteld"). De `rosterIds`-check in stap 4 zorgt daarnaast dat OFF- en
 * ON-aggregatie per combinatie alleen in wedstrijden meetellen waar álle
 * leden in de snapshot zaten.
 *
 * Filter-passing wordt één keer bepaald en voor zowel generatie als
 * aggregatie hergebruikt (zelfde aanpak als v1 `statsFilteredEntries()` →
 * `computeCombos()`): zo kan een spelerfilter een segment zowel uit de
 * lijst "combinaties die ooit samen op het veld stonden" als uit de
 * aggregatiebron weren. Een segment dat door een spelerfilter wegvalt,
 * levert dus geen ON-bijdrage voor een combinatie waarvan één lid in
 * dát segment ontbrak.
 */
export function computeLineupStats(games: AnalysisGame[], filter: StatsFilter): LineupStatsResult {
  const size = filter.comboSize;
  const allowedGames =
    filter.gameIds === null
      ? games
      : games.filter((g) => filter.gameIds !== null && (filter.gameIds as Set<string>).has(g.id));

  const requiredOn = new Map<number, true>();
  const requiredOff = new Map<number, true>();
  for (const entry of filter.playerFilters) {
    if (entry.mode === 'on') requiredOn.set(entry.rosterId, true);
    else if (entry.mode === 'off') requiredOff.set(entry.rosterId, true);
  }

  /**
   * Eerste pass: per spelerssnapshot en segment de gefilterde lijst van
   * segmenten opbouwen waaruit zowel combinaties worden gegenereerd als
   * geaggereerd. v1 doet hetzelfde via `statsFilteredEntries()` → één keer
   * filteren, twee keer hergebruiken.
   */
  type FilteredEntry = {
    game: AnalysisGame;
    segment: import('../game/types').Segment;
    lineupRosterIds: number[];
  };
  const filteredEntries: FilteredEntry[] = [];
  for (const game of allowedGames) {
    const playersById = new Map(game.players.map((p) => [p.id, p]));
    for (const segment of game.segments) {
      const lineupRosterIds = normalizeSegmentLineup(segment, playersById);
      if (!passesPlayerFilters(lineupRosterIds, requiredOn, requiredOff, size)) continue;
      filteredEntries.push({ game, segment, lineupRosterIds });
    }
  }

  /**
   * Map<key, LineupCombinationStats>, waarbij `key` de gesorteerde komma-
   * gescheiden `rosterId`-string is. Zelfde aanpak als v1's `comboKey`,
   * alleen op `rosterId` ipv `GamePlayer.id` (zie §C.2).
   */
  const map = new Map<string, LineupCombinationStats>();
  for (const entry of filteredEntries) {
    for (const ids of combinationsOfSize(entry.lineupRosterIds, size)) {
      const key = ids.join(',');
      const existing = map.get(key);
      if (existing) continue;
      map.set(key, {
        rosterIds: ids,
        onSec: 0,
        onPF: 0,
        onPA: 0,
        offSec: 0,
        offPF: 0,
        offPA: 0,
      });
    }
  }

  /**
   * Aggregatie over dezelfde gefilterde entries (v1: `entries.forEach` in
   * `computeCombos`). Per combinatie: ON als alle leden op het veld staan,
   * OFF als dat niet zo is — maar alleen in wedstrijden waar alle leden
   * in de `players`-snapshot zaten.
   */
  for (const combo of map.values()) {
    for (const entry of filteredEntries) {
      const gameRosterIds = new Set(entry.game.players.map((p) => p.rosterId));
      if (!comboRosterIdsPresentInGame(combo.rosterIds, gameRosterIds)) continue;

      const onCourt = comboRosterIdsAllOnCourt(combo.rosterIds, entry.lineupRosterIds);
      if (onCourt) {
        combo.onSec += entry.segment.durSec;
        combo.onPF += entry.segment.pf;
        combo.onPA += entry.segment.pa;
      } else {
        combo.offSec += entry.segment.durSec;
        combo.offPF += entry.segment.pf;
        combo.offPA += entry.segment.pa;
      }
    }
  }

  const totalRawCombinations = map.size;
  const combinations = stableSort(map.values(), filter.sortDirection);
  return { combinations, consideredSegments: filteredEntries.length, totalRawCombinations };
}

function normalizeSegmentLineup(
  segment: { lineup: string[] },
  playersById: ReadonlyMap<string, { rosterId: number }>,
): number[] {
  const ids: number[] = [];
  for (const id of segment.lineup) {
    const player = playersById.get(id);
    if (!player) continue;
    ids.push(player.rosterId);
  }
  return ids;
}

function passesPlayerFilters(
  lineupRosterIds: number[],
  requiredOn: ReadonlyMap<number, true>,
  requiredOff: ReadonlyMap<number, true>,
  size: number,
): boolean {
  const set = new Set(lineupRosterIds);
  for (const id of requiredOn.keys()) {
    if (!set.has(id)) return false;
  }
  for (const id of requiredOff.keys()) {
    if (set.has(id)) return false;
  }
  /**
   * Een segment-lineup die door onbekende referenties onder `size` spelers
   * zakt, kan geen enkele combinatie van grootte `size` opleveren die er
   * "samen op het veld" staat — die aggregaties zouden geen zinvolle ON/OF
   * bijdrage leveren. Buiten beschouwing laten, conform v1: een segment
   * met een onvolledige lineup kan geen combinatie van 5 (of N) spelers
   * "samen op het veld" hebben.
   */
  if (lineupRosterIds.length < size) return false;
  return true;
}

function combinationsOfSize(arr: readonly number[], size: number): number[][] {
  const result: number[][] = [];
  const combo: number[] = [];
  helper(arr, 0, combo, result, size);
  return result;
}

function helper(
  arr: readonly number[],
  start: number,
  combo: number[],
  out: number[][],
  size: number,
): void {
  if (combo.length === size) {
    out.push(combo.slice());
    return;
  }
  for (let i = start; i < arr.length; i += 1) {
    combo.push(arr[i]!);
    helper(arr, i + 1, combo, out, size);
    combo.pop();
  }
}

function comboRosterIdsPresentInGame(
  comboRosterIds: readonly number[],
  gameRosterIds: Set<number>,
): boolean {
  for (const id of comboRosterIds) {
    if (!gameRosterIds.has(id)) return false;
  }
  return true;
}

function comboRosterIdsAllOnCourt(
  comboRosterIds: readonly number[],
  lineupRosterIds: number[],
): boolean {
  const set = new Set(lineupRosterIds);
  for (const id of comboRosterIds) {
    if (!set.has(id)) return false;
  }
  return true;
}

/**
 * Stabiele sortering (PR 6.4 §C.3.7): primaire sleutel is de getoonde
 * ON-plus/min. Geen expliciete tweede sleutel — `Array.prototype.sort` is
 * sinds ES2019 stabiel en de combinaties worden gegenereerd in oplopende
 * `rosterId`-volgorde (zie `combinationsOfSize`), dus bij gelijke plus/min
 * blijft die volgorde behouden in beide richtingen. Dat is exact v1's
 * gedrag (`combos.sort((a, b) => statsSortDesc ? bv - av : av - bv)`).
 */
function stableSort(
  combos: Iterable<LineupCombinationStats>,
  direction: 'asc' | 'desc',
): LineupCombinationStats[] {
  const arr = Array.from(combos);
  arr.sort((a, b) => {
    const av = onShownValue(a, false);
    const bv = onShownValue(b, false);
    return direction === 'desc' ? bv - av : av - bv;
  });
  return arr;
}

/**
 * Toonwaarde van de ON-plus/min, exact v1 (PR 6.4 §C.3.6): bij `per10` en
 * `seconds > 0` is het `pm * 600 / seconds`, anders de kale `pm`. Onbekende
 * spelerslabels beïnvloeden de aggregatie NIET — de berekening werkt op
 * `rosterId` en niet op naam (zie §C.2).
 */
export function onShownValue(combo: LineupCombinationStats, per10: boolean): number {
  const pm = combo.onPF - combo.onPA;
  if (per10 && combo.onSec > 0) return (pm * 600) / combo.onSec;
  return pm;
}

/** Idem voor OFF (v1: `offShow = statsPer10 && offSec > 0 ? offPM * 600 / offSec : offPM`). */
export function offShownValue(combo: LineupCombinationStats, per10: boolean): number {
  const pm = combo.offPF - combo.offPA;
  if (per10 && combo.offSec > 0) return (pm * 600) / combo.offSec;
  return pm;
}

/** Hulpfunctie: lege spelerfilters (geen on, geen off). */
export function emptyPlayerFilters(): PlayerFilterEntry[] {
  return [];
}
