import { computeLineupStats, normalizeSegmentLineup } from '../stats/computeLineupStats';
import type { StatsFilter } from '../stats/types';
import { playerBonus, type ClassificationConfig } from './tracking';
import type { CompletedGame, GamePlayer } from './types';

/**
 * R8 — lineup-overzicht van een afgeronde wedstrijd. Uitsluitend weergave:
 * afgeleid uit de bestaande segmenten; er wordt niets opgeslagen en het
 * datacontract/CSV verandert niet. Tijd, punten en turnovers komen uit
 * `computeLineupStats` (comboSize 5, één wedstrijd); alleen stints, kwarten,
 * volgorde en de klassenotatie zijn hier nieuw.
 */
export interface LineupOverviewQuarter {
  quarter: number;
  sec: number;
}

export interface LineupOverviewRow {
  /** Gesorteerde `rosterId`'s: identiteit van de lineup. */
  key: string;
  /** Spelers in volgorde van het eerste segment waarin de lineup speelde. */
  players: GamePlayer[];
  /** Som van de klassen (spelers zonder numerieke klasse tellen als 0). */
  classSum: number;
  /** Totale bonus, begrensd op `maxBonus`. 0 als er geen bonus is. */
  bonus: number;
  hasWomen: boolean;
  hasYouth: boolean;
  sec: number;
  /** Aaneengesloten blokken (zelfde lineup, zelfde kwart) → 1 stint. */
  stints: number;
  pf: number;
  pa: number;
  plusMinus: number;
  turnovers: number;
  /** Per kwart (oplopend) hoeveel seconden deze lineup speelde. */
  quarters: LineupOverviewQuarter[];
}

const ALL_GAMES_FILTER: StatsFilter = {
  comboSize: 5,
  per10: false,
  sortDirection: 'desc',
  gameIds: null,
  playerFilters: [],
};

export function buildLineupOverview(
  game: CompletedGame,
  config: ClassificationConfig,
): LineupOverviewRow[] {
  const stats = computeLineupStats(
    [
      {
        id: game.id,
        opponent: game.opponent,
        competition: game.competition,
        date: game.date,
        players: game.players,
        segments: game.segments,
        scoreFor: game.scoreFor,
        scoreAgainst: game.scoreAgainst,
        isCurrent: false,
      },
    ],
    ALL_GAMES_FILTER,
  );
  const statsByKey = new Map(stats.combinations.map((c) => [c.rosterIds.join(','), c]));
  const playersById = new Map(game.players.map((p) => [p.id, p]));
  // Bonus los van de klassegrens-schakelaar: het overzicht toont de notatie altijd.
  const bonusConfig: ClassificationConfig = { ...config, useClassLimit: true };

  const rows = new Map<string, LineupOverviewRow>();
  let previousKey: string | null = null;
  let previousQuarter: number | null = null;
  for (const segment of game.segments) {
    const normalized = normalizeSegmentLineup(segment, playersById);
    if (normalized.hasUnknown) {
      previousKey = null;
      continue;
    }
    const key = normalized.rosterIds
      .slice()
      .sort((a, b) => a - b)
      .join(',');
    const lineupStats = statsByKey.get(key);
    if (!lineupStats) continue;

    let row = rows.get(key);
    if (!row) {
      const players = segment.lineup.map((id) => playersById.get(id)).filter((p) => p != null);
      const classSum = players.reduce((sum, p) => {
        const v = parseFloat(p.kl);
        return sum + (Number.isNaN(v) ? 0 : v);
      }, 0);
      const bonus = Math.min(
        bonusConfig.maxBonus,
        players.reduce((sum, p) => sum + playerBonus(p, bonusConfig), 0),
      );
      row = {
        key,
        players,
        classSum,
        bonus,
        hasWomen: players.some((p) => p.vrouw),
        hasYouth: players.some((p) => p.jeugd),
        sec: lineupStats.onSec,
        stints: 0,
        pf: lineupStats.onPF,
        pa: lineupStats.onPA,
        plusMinus: lineupStats.onPF - lineupStats.onPA,
        turnovers: lineupStats.onTov,
        quarters: [],
      };
      rows.set(key, row);
    }
    if (!(previousKey === key && previousQuarter === segment.quarter)) row.stints += 1;
    previousKey = key;
    previousQuarter = segment.quarter;

    const q = row.quarters.find((x) => x.quarter === segment.quarter);
    if (q) q.sec += segment.durSec;
    else row.quarters.push({ quarter: segment.quarter, sec: segment.durSec });
  }

  const result = Array.from(rows.values());
  for (const r of result) r.quarters.sort((a, b) => a.quarter - b.quarter);
  return result;
}

/**
 * Game-plan-notatie: klassesom, F/J-tags (eerste letter van de labels, vrouw
 * vóór jeugd) en bonus — bv. `15.0 FJ +2`, `14.5 F +1.5`, `13.0` zonder tags.
 */
export function formatLineupClassNotation(
  row: Pick<LineupOverviewRow, 'classSum' | 'bonus' | 'hasWomen' | 'hasYouth'>,
  tag1Label: string,
  tag2Label: string,
): string {
  const tags =
    (row.hasWomen ? tag1Label.charAt(0).toUpperCase() : '') +
    (row.hasYouth ? tag2Label.charAt(0).toUpperCase() : '');
  const bonus =
    row.bonus > 0 ? `+${Number.isInteger(row.bonus) ? row.bonus : row.bonus.toFixed(1)}` : '';
  return [row.classSum.toFixed(1), tags, bonus].filter((s) => s !== '').join(' ');
}
