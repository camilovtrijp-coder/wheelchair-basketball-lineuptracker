import { describe, expect, it } from 'vitest';
import { computeLineupStats } from '../../src/domain/stats/computeLineupStats';
import { computeOnOffImpact } from '../../src/domain/trends/onOffImpact';
import type { AnalysisGame } from '../../src/domain/stats/types';
import type { GamePlayer, Segment } from '../../src/domain/game/types';
import type { RosterPlayer } from '../../src/domain/roster/types';

/**
 * Vaste fixture uit docs/pr-trends-lineups-plan.md §F.2 (fictief).
 * L1 = 1-2-3-4-5, L2 = 1-2-3-4-6, L3 = 1-2-3-6-7, L4 = 1-2-3-5-7.
 *
 * | Seg | Wedstrijd | Kwart | Lineup |   s | pf | pa |
 * | A1  | A         | 1     | L1     | 600 | 10 |  6 |
 * | A2  | A         | 2     | L2     | 420 |  6 |  8 |
 * | A3  | A         | 2     | L3     | 180 |  4 |  0 |
 * | A4  | A         | 4     | L1     | 600 |  8 | 12 |
 * | B1  | B         | 1     | L1     | 300 |  6 |  4 |
 * | B2  | B         | 1     | L2     | 300 |  4 |  4 |
 * | B3  | B         | 4     | L2     | 480 | 10 |  7 |
 * | B4  | B         | 4     | L4     | 120 |  2 |  0 |
 *
 * Team: 3000 s, pf 50, pa 41, +9.
 */
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

const LINEUPS: Record<string, string[]> = {
  L1: ['p1', 'p2', 'p3', 'p4', 'p5'],
  L2: ['p1', 'p2', 'p3', 'p4', 'p6'],
  L3: ['p1', 'p2', 'p3', 'p6', 'p7'],
  L4: ['p1', 'p2', 'p3', 'p5', 'p7'],
};

function seg(
  id: string,
  quarter: number,
  lineup: string[],
  durSec: number,
  pf: number,
  pa: number,
): Segment {
  return {
    id,
    quarter,
    beginSec: durSec,
    endSec: 0,
    durSec,
    lineup,
    pf,
    pa,
    classSum: 0,
    allowed: 0,
    over: false,
  };
}

function game(id: string, date: string, segments: Segment[], quarterCount = 4): AnalysisGame {
  return {
    id,
    opponent: `Tegenstander ${id}`,
    competition: '',
    date,
    players: [1, 2, 3, 4, 5, 6, 7].map(gp),
    segments,
    scoreFor: 0,
    scoreAgainst: 0,
    isCurrent: false,
    quarterCount,
  };
}

function fixture(): AnalysisGame[] {
  return [
    game('A', '2026-09-05', [
      seg('A1', 1, LINEUPS.L1!, 600, 10, 6),
      seg('A2', 2, LINEUPS.L2!, 420, 6, 8),
      seg('A3', 2, LINEUPS.L3!, 180, 4, 0),
      seg('A4', 4, LINEUPS.L1!, 600, 8, 12),
    ]),
    game('B', '2026-09-12', [
      seg('B1', 1, LINEUPS.L1!, 300, 6, 4),
      seg('B2', 1, LINEUPS.L2!, 300, 4, 4),
      seg('B3', 4, LINEUPS.L2!, 480, 10, 7),
      seg('B4', 4, LINEUPS.L4!, 120, 2, 0),
    ]),
  ];
}

const roster: RosterPlayer[] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
  id: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '1.0',
  vrouw: false,
  jeugd: false,
}));

const byId = (rows: ReturnType<typeof computeOnOffImpact>, id: number) =>
  rows.find((r) => r.rosterId === id)!;

describe('computeOnOffImpact — fixture §F.2 (minSec 300)', () => {
  const rows = computeOnOffImpact(fixture(), null, roster, 300);

  it('spelers 1-3 speelden alles: off 0 s, offPer10 en diffPer10 null, niet gekwalificeerd', () => {
    // on = teamtotaal 3000 s, +9 => 9*600/3000 = 1,8
    for (const id of [1, 2, 3]) {
      const r = byId(rows, id);
      expect(r.onSec).toBe(3000);
      expect(r.onPm).toBe(9);
      expect(r.onPer10).toBeCloseTo(1.8, 10);
      expect(r.offSec).toBe(0);
      expect(r.offPm).toBe(0);
      expect(r.offPer10).toBeNull();
      expect(r.diffPer10).toBeNull();
      expect(r.qualified).toBe(false);
    }
  });

  it('speler 4: on 2700 s +3 (0,667), off 300 s +6 (12,0), verschil -11,333; off exact op de drempel telt mee', () => {
    // on = L1 (+2) + L2 (+1) = +3 in 1500+1200 = 2700 s; 3*600/2700 = 0,6667
    // off = L3 (+4, 180 s) + L4 (+2, 120 s) = +6 in 300 s; 6*600/300 = 12,0
    const r = byId(rows, 4);
    expect(r.onSec).toBe(2700);
    expect(r.onPm).toBe(3);
    expect(r.onPer10).toBeCloseTo(0.667, 3);
    expect(r.offSec).toBe(300);
    expect(r.offPm).toBe(6);
    expect(r.offPer10).toBeCloseTo(12.0, 10);
    expect(r.diffPer10).toBeCloseTo(-11.333, 3);
    expect(r.qualified).toBe(true);
  });

  it('speler 5: on 1620 s +4 (1,481), off 1380 s +5 (2,174), verschil -0,692', () => {
    // on = A1 600 (+4) + A4 600 (-4) + B1 300 (+2) + B4 120 (+2) = 1620 s, +4
    // off = 3000-1620 = 1380 s, +9-4 = +5; 5*600/1380 = 2,1739
    const r = byId(rows, 5);
    expect(r.onSec).toBe(1620);
    expect(r.onPm).toBe(4);
    expect(r.onPer10).toBeCloseTo(1.481, 3);
    expect(r.offSec).toBe(1380);
    expect(r.offPm).toBe(5);
    expect(r.offPer10).toBeCloseTo(2.174, 3);
    expect(r.diffPer10).toBeCloseTo(-0.692, 3);
    expect(r.qualified).toBe(true);
  });

  it('speler 6: on 1380 s +5 (2,174), off 1620 s +4 (1,481), verschil +0,692', () => {
    // on = A2 420 (-2) + A3 180 (+4) + B2 300 (0) + B3 480 (+3) = 1380 s, +5
    const r = byId(rows, 6);
    expect(r.onSec).toBe(1380);
    expect(r.onPm).toBe(5);
    expect(r.onPer10).toBeCloseTo(2.174, 3);
    expect(r.offSec).toBe(1620);
    expect(r.offPm).toBe(4);
    expect(r.offPer10).toBeCloseTo(1.481, 3);
    expect(r.diffPer10).toBeCloseTo(0.692, 3);
    expect(r.qualified).toBe(true);
  });

  it('speler 7: on 300 s +6 (12,0), off 2700 s +3 (0,667), verschil +11,333', () => {
    // on = A3 180 (+4) + B4 120 (+2) = 300 s, +6
    const r = byId(rows, 7);
    expect(r.onSec).toBe(300);
    expect(r.onPm).toBe(6);
    expect(r.onPer10).toBeCloseTo(12.0, 10);
    expect(r.offSec).toBe(2700);
    expect(r.offPm).toBe(3);
    expect(r.offPer10).toBeCloseTo(0.667, 3);
    expect(r.diffPer10).toBeCloseTo(11.333, 3);
    expect(r.qualified).toBe(true);
  });

  it('speler die nooit speelde (8) krijgt geen rij; volgorde volgt het roster', () => {
    expect(rows.map((r) => r.rosterId)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('computeOnOffImpact — drempel, filter, randgevallen', () => {
  it('minSec 600: speler 4 (off 300 s) en speler 7 (on 300 s) zijn niet gekwalificeerd, 5 en 6 wel', () => {
    const rows = computeOnOffImpact(fixture(), null, roster, 600);
    expect(byId(rows, 4).qualified).toBe(false);
    expect(byId(rows, 7).qualified).toBe(false);
    expect(byId(rows, 5).qualified).toBe(true);
    expect(byId(rows, 6).qualified).toBe(true);
  });

  it('minSec 301: ook de gelijke 300 s valt af (grens is >=)', () => {
    const rows = computeOnOffImpact(fixture(), null, roster, 301);
    expect(byId(rows, 4).qualified).toBe(false);
    expect(byId(rows, 7).qualified).toBe(false);
  });

  it('minSec 0: spelers zonder off-minuten blijven niet gekwalificeerd', () => {
    const rows = computeOnOffImpact(fixture(), null, roster, 0);
    expect(byId(rows, 1).qualified).toBe(false);
    expect(byId(rows, 4).qualified).toBe(true);
  });

  it('wedstrijdfilter {B}: alleen wedstrijd B telt', () => {
    // B: 1200 s totaal, pf 22, pa 15 => +7. Speler 5: on B1 300 (+2) + B4 120 (+2) = 420 s, +4;
    // off = 1200-420 = 780 s, +7-4 = +3.
    const rows = computeOnOffImpact(fixture(), new Set(['B']), roster, 300);
    const r = byId(rows, 5);
    expect(r.onSec).toBe(420);
    expect(r.onPm).toBe(4);
    expect(r.offSec).toBe(780);
    expect(r.offPm).toBe(3);
    // Speler 6 speelde in B: B2 300 (0) + B3 480 (+3) = 780 s.
    expect(byId(rows, 6).onSec).toBe(780);
    // Speler 7: B4 120 s => onder drempel.
    expect(byId(rows, 7).onSec).toBe(120);
    expect(byId(rows, 7).qualified).toBe(false);
  });

  it('lege selectie en lege scope geven geen rijen', () => {
    expect(computeOnOffImpact(fixture(), new Set(), roster, 300)).toEqual([]);
    expect(computeOnOffImpact([], null, roster, 300)).toEqual([]);
  });

  it('PARTIAL-segmenten (onbekend lineup-ID) worden uitgesloten van on en off', () => {
    const games = fixture();
    games[0]!.segments.push(seg('A5', 3, ['p1', 'p2', 'p3', 'p4', 'onbekend'], 500, 20, 0));
    const rows = computeOnOffImpact(games, null, roster, 300);
    expect(byId(rows, 1).onSec).toBe(3000);
    expect(byId(rows, 4).offSec).toBe(300);
    expect(byId(rows, 4).offPm).toBe(6);
  });
});

describe('regressie: computeLineupStats blijft ongewijzigd door de AnalysisGame.quarterCount-uitbreiding', () => {
  it('size 5 geeft nog steeds de bekende L1..L4-totalen, met of zonder quarterCount', () => {
    const withQc = fixture();
    const without = fixture().map((g) => {
      const { quarterCount: _omit, ...rest } = g;
      void _omit;
      return rest as AnalysisGame;
    });
    const f = {
      comboSize: 5 as const,
      per10: false,
      sortDirection: 'desc' as const,
      gameIds: null,
      playerFilters: [],
    };
    const a = computeLineupStats(withQc, f);
    const b = computeLineupStats(without, f);
    expect(a).toEqual(b);
    const l1 = a.combinations.find((c) => c.rosterIds.join(',') === '1,2,3,4,5')!;
    expect([l1.onSec, l1.onPF, l1.onPA]).toEqual([1500, 24, 22]);
    const l2 = a.combinations.find((c) => c.rosterIds.join(',') === '1,2,3,4,6')!;
    expect([l2.onSec, l2.onPF, l2.onPA]).toEqual([1200, 20, 19]);
    expect(a.consideredSegments).toBe(8);
    expect(a.partialSegments).toBe(0);
  });
});
