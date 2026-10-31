import type { GamePlayer, Segment } from '../../../src/domain/game/types';
import type { RosterPlayer } from '../../../src/domain/roster/types';
import type { AnalysisGame } from '../../../src/domain/stats/types';

/**
 * Vaste, fictieve fixture uit docs/pr-trends-lineups-plan.md §F.2.
 * Spelers rosterId = rugnummer = 1-7 (GamePlayer.id = `p<n>`).
 * L1 = 1-2-3-4-5, L2 = 1-2-3-4-6, L3 = 1-2-3-6-7, L4 = 1-2-3-5-7.
 * allowed = 14.0 in alle segmenten, useClassLimit = true.
 *
 * Klokrichting (door de tests gekozen, het plan geeft geen tijden): aflopend,
 * begin/eind in seconden op de kwartklok (600 = kwartbegin):
 *  A1 Q1 600->0     A2 Q2 600->180   A3 Q2 180->0    A4 Q4 600->0
 *  B1 Q1 600->300   B2 Q1 300->0     B3 Q4 600->120  B4 Q4 120->0
 */
export function gp(n: number): GamePlayer {
  return {
    id: `p${n}`,
    rosterId: n,
    nr: String(n),
    naam: `Speler ${n}`,
    kl: '1.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
  };
}

export const fixtureRoster: RosterPlayer[] = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
  id: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '1.0',
  vrouw: false,
  jeugd: false,
}));

export const L1 = ['p1', 'p2', 'p3', 'p4', 'p5'];
export const L2 = ['p1', 'p2', 'p3', 'p4', 'p6'];
export const L3 = ['p1', 'p2', 'p3', 'p6', 'p7'];
export const L4 = ['p1', 'p2', 'p3', 'p5', 'p7'];

export function seg(
  id: string,
  quarter: number,
  beginSec: number,
  endSec: number,
  lineup: string[],
  pf: number,
  pa: number,
  tov: number | undefined,
  classSum: number,
  over = false,
  allowed = 14.0,
): Segment {
  return {
    id,
    quarter,
    beginSec,
    endSec,
    durSec: Math.abs(beginSec - endSec),
    lineup,
    pf,
    pa,
    classSum,
    allowed,
    over,
    ...(tov === undefined ? {} : { tov }),
  };
}

export function game(
  id: string,
  date: string,
  segments: Segment[],
  useClassLimit = true,
): AnalysisGame {
  return {
    id,
    opponent: `Tegenstander ${id}`,
    competition: 'Fictief',
    date,
    players: [1, 2, 3, 4, 5, 6, 7].map(gp),
    segments,
    scoreFor: segments.reduce((s, x) => s + x.pf, 0),
    scoreAgainst: segments.reduce((s, x) => s + x.pa, 0),
    isCurrent: false,
    useClassLimit,
  };
}

export function segmentsA(): Segment[] {
  return [
    seg('A1', 1, 600, 0, L1, 10, 6, 2, 14.0),
    seg('A2', 2, 600, 180, L2, 6, 8, 3, 13.5),
    seg('A3', 2, 180, 0, L3, 4, 0, 0, 12.5),
    seg('A4', 4, 600, 0, L1, 8, 12, 1, 14.0),
  ];
}

export function segmentsB(): Segment[] {
  return [
    seg('B1', 1, 600, 300, L1, 6, 4, 1, 14.0),
    seg('B2', 1, 300, 0, L2, 4, 4, 2, 13.5),
    seg('B3', 4, 600, 120, L2, 10, 7, 2, 13.5),
    seg('B4', 4, 120, 0, L4, 2, 0, 0, 14.5, true),
  ];
}

export function fixtureGames(): AnalysisGame[] {
  return [game('A', '2026-09-05', segmentsA()), game('B', '2026-09-12', segmentsB())];
}
