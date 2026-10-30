import { segmentTurnovers } from '../game/tracking';
import { computeLineupStats, turnoverRatePer10 } from '../stats/computeLineupStats';
import type { AnalysisGame } from '../stats/types';

/**
 * Teamniveau-turnovers voor de Trends-tab: een totaalregel en een ranglijst van
 * opstellingen van vijf. Pure berekeningen, geen DOM. Ze lezen alleen
 * `Segment.tov` (ontbrekend = 0) en hergebruiken `computeLineupStats` voor de
 * lineup-ranglijst: er wordt dus geen bestaande statistiek gewijzigd.
 */

export interface TurnoverSummary {
  /** Totaal eigen turnovers over alle segmenten van de gefilterde wedstrijden. */
  turnovers: number;
  /** Aantal gefilterde wedstrijden met minstens één segment. */
  games: number;
  /** Totale gespeelde tijd (som van `durSec` over alle segmenten), in seconden. */
  seconds: number;
  /** `turnovers * 600 / seconds`, of `null` zonder gespeelde tijd. */
  per10: number | null;
  /**
   * `true` zodra minstens één segment het veld `tov` heeft. Zo kan de UI de
   * turnover-onderdelen verbergen voor wedstrijden uit de tijd vóór de
   * turnoverteller, in plaats van misleidende nullen te tonen.
   */
  tracked: boolean;
}

/**
 * Totaalregel over de gefilterde wedstrijden. Telt ALLE segmenten (ook een
 * segment met een onbekende spelersreferentie): het gaat om een teamtotaal, niet
 * om een opstelling. De lineup-kaart sluit PARTIAL-segmenten wel uit, zoals de
 * overige statistieken; het teamtotaal kan dus iets hoger liggen dan de som
 * van de ranglijst.
 */
export function computeTurnoverSummary(
  games: AnalysisGame[],
  gameIds: Set<string> | null,
): TurnoverSummary {
  const allowed = gameIds === null ? games : games.filter((g) => gameIds.has(g.id));
  let turnovers = 0;
  let seconds = 0;
  let countedGames = 0;
  let tracked = false;
  for (const game of allowed) {
    if (game.segments.length === 0) continue;
    countedGames += 1;
    for (const segment of game.segments) {
      turnovers += segmentTurnovers(segment);
      seconds += segment.durSec;
      if (typeof segment.tov === 'number') tracked = true;
    }
  }
  return {
    turnovers,
    games: countedGames,
    seconds,
    per10: turnoverRatePer10(turnovers, seconds),
    tracked,
  };
}

export interface LineupTurnoverRow {
  /** Gesorteerde `rosterId`'s van de opstelling (vijf spelers). */
  rosterIds: number[];
  /** Speeltijd van deze opstelling, in seconden. */
  seconds: number;
  turnovers: number;
  /** Turnovers per 10 minuten; altijd gedefinieerd (rijen zonder speeltijd bestaan niet). */
  per10: number;
  /** Relatief aan het gewogen gemiddelde van de ranglijst: `good` = op of onder het gemiddelde. */
  tone: 'good' | 'bad';
}

export interface LineupTurnoverRanking {
  rows: LineupTurnoverRow[];
  /** Gewogen gemiddelde (`som tov * 600 / som seconden`) over ALLE opstellingen; `null` zonder rijen. */
  averagePer10: number | null;
}

/** Maximaal aantal getoonde opstellingen in de ranglijst. */
export const LINEUP_RANKING_LIMIT = 10;

/**
 * Ranglijst van opstellingen van vijf, gesorteerd van laag naar hoog (laagste
 * turnover-snelheid eerst). Tie-break: de canonieke combinatiesleutel
 * (oplopend), zodat de volgorde stabiel is.
 *
 * Kleurkeuze (`tone`): groen (`good`) bij een waarde op of onder het
 * tijdgewogen gemiddelde van ALLE opstellingen (`averagePer10`), anders rood
 * (`bad`). Een absolute drempel zou arbitrair zijn: wat veel turnovers is,
 * hangt van het team en het niveau af. Rijen na de limiet vallen weg uit de
 * weergave maar tellen wel mee in het gemiddelde.
 */
export function computeLineupTurnoverRanking(
  games: AnalysisGame[],
  gameIds: Set<string> | null,
  limit: number = LINEUP_RANKING_LIMIT,
): LineupTurnoverRanking {
  const stats = computeLineupStats(games, {
    comboSize: 5,
    per10: false,
    sortDirection: 'desc',
    gameIds,
    playerFilters: [],
  });
  const all = stats.combinations.filter((c) => c.onSec > 0);
  const totalTov = all.reduce((a, c) => a + c.onTov, 0);
  const totalSec = all.reduce((a, c) => a + c.onSec, 0);
  const averagePer10 = turnoverRatePer10(totalTov, totalSec);

  const rows: LineupTurnoverRow[] = all.map((c) => {
    const per10 = (c.onTov * 600) / c.onSec;
    return {
      rosterIds: c.rosterIds,
      seconds: c.onSec,
      turnovers: c.onTov,
      per10,
      tone: averagePer10 !== null && per10 > averagePer10 ? 'bad' : 'good',
    };
  });
  rows.sort((a, b) => {
    if (a.per10 !== b.per10) return a.per10 - b.per10;
    const ak = a.rosterIds.join(',');
    const bk = b.rosterIds.join(',');
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
  return { rows: rows.slice(0, Math.max(0, limit)), averagePer10 };
}
