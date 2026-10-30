import { describe, expect, it } from 'vitest';
import {
  computePlayerTrends,
  pointTurnoversValue,
} from '../../src/domain/trends/computePlayerTrends';
import {
  computeLineupTurnoverRanking,
  computeTurnoverSummary,
} from '../../src/domain/trends/turnoverSummary';
import type { TrendsFilter } from '../../src/domain/trends/types';
import type { AnalysisGame } from '../../src/domain/stats/types';
import type { GamePlayer, Segment } from '../../src/domain/game/types';
import type { RosterPlayer } from '../../src/domain/roster/types';

function gp(n: number): GamePlayer {
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

function seg(
  id: string,
  lineup: string[],
  durSec: number,
  pf: number,
  pa: number,
  tov?: number,
): Segment {
  return {
    id,
    quarter: 1,
    beginSec: durSec,
    endSec: 0,
    durSec,
    lineup,
    pf,
    pa,
    classSum: 0,
    allowed: 0,
    over: false,
    ...(tov === undefined ? {} : { tov }),
  };
}

const roster: RosterPlayer[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '1.0',
  vrouw: false,
  jeugd: false,
}));

const filter = (o: Partial<TrendsFilter> = {}): TrendsFilter => ({
  per10: false,
  sortBy: 'nr',
  gameIds: null,
  ...o,
});

/**
 * Handmatig narekenbaar:
 *  Wedstrijd A (1 jan): A1 = 1-2-3-4-5, 300 s, +4/-2, 2 tov; A2 = 1-2-3-4-6, 300 s, +2/-3, 1 tov
 *  Wedstrijd B (2 jan): B1 = 1-2-3-4-5, 300 s, +6/-2, 3 tov
 */
function games(withTov = true): AnalysisGame[] {
  const t = (n: number) => (withTov ? n : undefined);
  const players = [1, 2, 3, 4, 5, 6].map(gp);
  const a: AnalysisGame = {
    id: 'A',
    opponent: 'A',
    competition: '',
    date: '2026-01-01T10:00:00.000Z',
    players,
    segments: [
      seg('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 300, 4, 2, t(2)),
      seg('A2', ['p1', 'p2', 'p3', 'p4', 'p6'], 300, 2, 3, t(1)),
    ],
    scoreFor: 0,
    scoreAgainst: 0,
    isCurrent: false,
  };
  const b: AnalysisGame = {
    id: 'B',
    opponent: 'B',
    competition: '',
    date: '2026-01-02T10:00:00.000Z',
    players,
    segments: [seg('B1', ['p1', 'p2', 'p3', 'p4', 'p5'], 300, 6, 2, t(3))],
    scoreFor: 0,
    scoreAgainst: 0,
    isCurrent: false,
  };
  return [b, a]; // opslagvolgorde: nieuwste eerst
}

describe('trends — turnovers per speler', () => {
  const result = computePlayerTrends(games(), roster, filter(), 'ok');
  const byId = (id: number) => result.players.find((p) => p.rosterId === id)!;

  it('speler 1 stond overal op het veld: 3 + 3 turnovers, +/- totaal 1 + 4 = 5', () => {
    const p = byId(1);
    expect(p.points.map((pt) => pt.tov)).toEqual([3, 3]); // A: 2+1, B: 3
    expect(p.totalTurnovers).toBe(6);
    expect(p.avgTurnovers).toBe(3);
    expect(p.totalPlusMinus).toBe(5); // A: (4-2)+(2-3)=1, B: 4
  });

  it('speler 6 speelde alleen A2: 1 turnover, +/- totaal -1', () => {
    const p = byId(6);
    expect(p.points).toHaveLength(1);
    expect(p.totalTurnovers).toBe(1);
    expect(p.avgTurnovers).toBe(1);
    expect(p.totalPlusMinus).toBe(-1);
  });

  it('speler 5 speelde A1 en B1: 2 + 3 = 5 turnovers (turnovers van segmenten waarin hij speelde)', () => {
    const p = byId(5);
    expect(p.points.map((pt) => pt.tov)).toEqual([2, 3]);
    expect(p.totalTurnovers).toBe(5);
    expect(p.avgTurnovers).toBe(2.5);
  });

  it('per10: gemiddelde van per wedstrijd genormaliseerde waarden (3*600/600 = 3 en 3*600/300 = 6 -> 4,5)', () => {
    const r = computePlayerTrends(games(), roster, filter({ per10: true }), 'ok');
    const p = r.players.find((x) => x.rosterId === 1)!;
    expect(p.avgTurnovers).toBeCloseTo(4.5, 10);
    // totalen blijven altijd ruw
    expect(p.totalTurnovers).toBe(6);
    expect(pointTurnoversValue(p.points[0]!, true)).toBeCloseTo(3, 10);
    expect(pointTurnoversValue(p.points[1]!, true)).toBeCloseTo(6, 10);
    expect(pointTurnoversValue({ ...p.points[0]!, sec: 0 }, true)).toBe(3); // zonder tijd: ruw
  });

  it('bestaande uitkomsten zijn zonder turnover-gegevens exact gelijk, en de turnovertellers zijn 0', () => {
    const withTov = computePlayerTrends(games(true), roster, filter(), 'ok');
    const without = computePlayerTrends(games(false), roster, filter(), 'ok');
    const strip = (r: typeof withTov) =>
      r.players.map((p) => ({
        rosterId: p.rosterId,
        avgMinutes: p.avgMinutes,
        avgPlusMinus: p.avgPlusMinus,
        points: p.points.map((pt) => ({
          gameId: pt.gameId,
          sec: pt.sec,
          pm: pt.pm,
          provisional: pt.provisional,
        })),
      }));
    expect(strip(withTov)).toEqual(strip(without));
    expect(withTov.sharedMaxMinutes).toBe(without.sharedMaxMinutes);
    for (const p of without.players) {
      expect(p.totalTurnovers).toBe(0);
      expect(p.avgTurnovers).toBe(0);
    }
  });
});

describe('trends — totaalregel', () => {
  it('alle wedstrijden: 2 + 1 + 3 = 6 turnovers in 2 wedstrijden over 900 s -> 4,0 per 10 min', () => {
    const s = computeTurnoverSummary(games(), null);
    expect(s).toEqual({ turnovers: 6, games: 2, seconds: 900, per10: 4, tracked: true });
  });

  it('wedstrijdfilter: alleen A -> 3 turnovers, 1 wedstrijd, 600 s, 3,0 per 10 min', () => {
    const s = computeTurnoverSummary(games(), new Set(['A']));
    expect(s).toEqual({ turnovers: 3, games: 1, seconds: 600, per10: 3, tracked: true });
  });

  it('zonder tov-gegevens: niet bijgehouden (de UI verbergt de turnover-onderdelen)', () => {
    const s = computeTurnoverSummary(games(false), null);
    expect(s.tracked).toBe(false);
    expect(s.turnovers).toBe(0);
    expect(s.games).toBe(2);
  });

  it('geen wedstrijden of lege selectie: 0 en geen snelheid', () => {
    expect(computeTurnoverSummary([], null)).toEqual({
      turnovers: 0,
      games: 0,
      seconds: 0,
      per10: null,
      tracked: false,
    });
    expect(computeTurnoverSummary(games(), new Set()).games).toBe(0);
  });
});

describe('trends — lineup-ranglijst (turnovers per 10 min)', () => {
  it('laagste eerst; kleur relatief aan het tijdgewogen gemiddelde (6 tov in 900 s = 4,0)', () => {
    const r = computeLineupTurnoverRanking(games(), null);
    expect(r.averagePer10).toBeCloseTo(4, 10);
    expect(r.rows.map((x) => x.rosterIds.join(','))).toEqual(['1,2,3,4,6', '1,2,3,4,5']);
    // 1-2-3-4-6: A2 300 s, 1 tov -> 2,0 (onder gemiddelde: good)
    expect(r.rows[0]).toMatchObject({ seconds: 300, turnovers: 1, tone: 'good' });
    expect(r.rows[0]!.per10).toBeCloseTo(2, 10);
    // 1-2-3-4-5: A1 + B1 = 600 s, 5 tov -> 5,0 (boven gemiddelde: bad)
    expect(r.rows[1]).toMatchObject({ seconds: 600, turnovers: 5, tone: 'bad' });
    expect(r.rows[1]!.per10).toBeCloseTo(5, 10);
  });

  it('volgt het wedstrijdfilter: alleen A -> 4,0 (bad, gemiddelde 3,0) en 2,0 (good)', () => {
    const r = computeLineupTurnoverRanking(games(), new Set(['A']));
    expect(r.averagePer10).toBeCloseTo(3, 10);
    expect(r.rows.map((x) => [x.rosterIds.join(','), x.tone])).toEqual([
      ['1,2,3,4,6', 'good'],
      ['1,2,3,4,5', 'bad'],
    ]);
  });

  it('limiet beperkt de rijen maar niet het gemiddelde', () => {
    const r = computeLineupTurnoverRanking(games(), null, 1);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.rosterIds).toEqual([1, 2, 3, 4, 6]);
    expect(r.averagePer10).toBeCloseTo(4, 10);
  });

  it('zonder wedstrijden: geen rijen en geen gemiddelde', () => {
    expect(computeLineupTurnoverRanking([], null)).toEqual({ rows: [], averagePer10: null });
  });
});
