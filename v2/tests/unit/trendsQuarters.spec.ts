import { describe, expect, it } from 'vitest';
import { buildAnalysisScope } from '../../src/application/stats/buildAnalysisScope';
import type { CompletedGameRepository } from '../../src/application/game/CompletedGameRepository';
import {
  computePlayerQuarterMinutes,
  computeQuarterSplits,
} from '../../src/domain/trends/quarterInsights';
import type { AnalysisGame } from '../../src/domain/stats/types';
import type { CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';
import type { RosterPlayer } from '../../src/domain/roster/types';

/**
 * Vaste fixture uit docs/pr-trends-lineups-plan.md §F.2 (zie trendsOnOff.spec.ts
 * voor de tabel). Kwarten: A en B hebben nooit segmenten in kwart 3.
 *
 *  Q1: A1 600 (10-6) + B1 300 (6-4) + B2 300 (4-4) = 1200 s, pf 20, pa 14, +6 => +3,0/10 (2 wd)
 *  Q2: A2 420 (6-8) + A3 180 (4-0)               =  600 s, pf 10, pa 8,  +2 => +2,0/10 (1 wd)
 *  Q3: -                                          =    0 s                  => null    (0 wd)
 *  Q4: A4 600 (8-12) + B3 480 (10-7) + B4 120 (2-0) = 1200 s, pf 20, pa 19, +1 => +0,5/10 (2 wd)
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

const L1 = ['p1', 'p2', 'p3', 'p4', 'p5'];
const L2 = ['p1', 'p2', 'p3', 'p4', 'p6'];
const L3 = ['p1', 'p2', 'p3', 'p6', 'p7'];
const L4 = ['p1', 'p2', 'p3', 'p5', 'p7'];

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

function game(id: string, date: string, segments: Segment[], quarterCount?: number): AnalysisGame {
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
    ...(quarterCount === undefined ? {} : { quarterCount }),
  };
}

function fixture(quarterCount?: number): AnalysisGame[] {
  return [
    game(
      'A',
      '2026-09-05',
      [
        seg('A1', 1, L1, 600, 10, 6),
        seg('A2', 2, L2, 420, 6, 8),
        seg('A3', 2, L3, 180, 4, 0),
        seg('A4', 4, L1, 600, 8, 12),
      ],
      quarterCount,
    ),
    game(
      'B',
      '2026-09-12',
      [
        seg('B1', 1, L1, 300, 6, 4),
        seg('B2', 1, L2, 300, 4, 4),
        seg('B3', 4, L2, 480, 10, 7),
        seg('B4', 4, L4, 120, 2, 0),
      ],
      quarterCount,
    ),
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

describe('computeQuarterSplits — fixture §F.2', () => {
  const rows = computeQuarterSplits(fixture(4), null);

  it('geeft 4 kwarten met de uitgerekende totalen', () => {
    expect(rows.map((r) => r.quarter)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.seconds)).toEqual([1200, 600, 0, 1200]);
    expect(rows.map((r) => r.pf)).toEqual([20, 10, 0, 20]);
    expect(rows.map((r) => r.pa)).toEqual([14, 8, 0, 19]);
    expect(rows.map((r) => r.pm)).toEqual([6, 2, 0, 1]);
    expect(rows.map((r) => r.games)).toEqual([2, 1, 0, 2]);
  });

  it('per 10: Q1 +3,0 (10,0/7,0), Q2 +2,0 (10,0/8,0), Q4 +0,5 (10,0/9,5)', () => {
    // Q1: 6*600/1200 = 3,0; 20*600/1200 = 10,0; 14*600/1200 = 7,0
    expect(rows[0]!.pmPer10).toBeCloseTo(3.0, 10);
    expect(rows[0]!.pfPer10).toBeCloseTo(10.0, 10);
    expect(rows[0]!.paPer10).toBeCloseTo(7.0, 10);
    // Q2: 2*600/600 = 2,0; 10*600/600 = 10,0; 8*600/600 = 8,0
    expect(rows[1]!.pmPer10).toBeCloseTo(2.0, 10);
    expect(rows[1]!.pfPer10).toBeCloseTo(10.0, 10);
    expect(rows[1]!.paPer10).toBeCloseTo(8.0, 10);
    // Q4: 1*600/1200 = 0,5; 20*600/1200 = 10,0; 19*600/1200 = 9,5
    expect(rows[3]!.pmPer10).toBeCloseTo(0.5, 10);
    expect(rows[3]!.pfPer10).toBeCloseTo(10.0, 10);
    expect(rows[3]!.paPer10).toBeCloseTo(9.5, 10);
  });

  it('kwart zonder segmenten: nullen en null per 10', () => {
    expect(rows[2]).toEqual({
      quarter: 3,
      seconds: 0,
      pf: 0,
      pa: 0,
      pm: 0,
      pmPer10: null,
      pfPer10: null,
      paPer10: null,
      games: 0,
    });
  });

  it('wedstrijdfilter {A}: Q1 600 s +4, Q2 600 s +2, Q4 600 s -4', () => {
    const r = computeQuarterSplits(fixture(4), new Set(['A']));
    expect(r.map((x) => x.seconds)).toEqual([600, 600, 0, 600]);
    expect(r.map((x) => x.pm)).toEqual([4, 2, 0, -4]);
    expect(r.map((x) => x.games)).toEqual([1, 1, 0, 1]);
  });

  it('PARTIAL-segmenten (onbekend lineup-ID) tellen niet mee, ook niet voor games', () => {
    const games = fixture(4);
    games[0]!.segments.push(seg('A5', 3, ['p1', 'p2', 'p3', 'p4', 'onbekend'], 500, 20, 0));
    const r = computeQuarterSplits(games, null);
    expect(r[2]!.seconds).toBe(0);
    expect(r[2]!.games).toBe(0);
    expect(r[2]!.pmPer10).toBeNull();
  });

  it('lege selectie en lege scope geven []', () => {
    expect(computeQuarterSplits(fixture(4), new Set())).toEqual([]);
    expect(computeQuarterSplits([], null)).toEqual([]);
  });
});

describe('computeQuarterSplits — aantal kwarten', () => {
  it('volgt quarterCount van de wedstrijd (2 kwarten => 2 rijen, 6 => 6 rijen)', () => {
    const two = fixture(2).map((g) => ({
      ...g,
      segments: g.segments.filter((s) => s.quarter <= 2),
    }));
    expect(computeQuarterSplits(two, null)).toHaveLength(2);
    expect(computeQuarterSplits(fixture(6), null)).toHaveLength(6);
  });

  it('zonder quarterCount: terugval op 4', () => {
    expect(computeQuarterSplits(fixture(), null)).toHaveLength(4);
  });

  it('zonder quarterCount maar met een segment in kwart 5: hoogste voorkomende kwart', () => {
    const games = fixture();
    games[1]!.segments.push(seg('B5', 5, L1, 60, 2, 0));
    const r = computeQuarterSplits(games, null);
    expect(r).toHaveLength(5);
    expect(r[4]).toMatchObject({ quarter: 5, seconds: 60, pm: 2, games: 1 });
  });

  it('gemengde selectie neemt het grootste aantal (4 en 6 => 6)', () => {
    const games = [fixture(4)[0]!, fixture(6)[1]!];
    expect(computeQuarterSplits(games, null)).toHaveLength(6);
  });
});

describe('computePlayerQuarterMinutes — fixture §F.2', () => {
  const m = computePlayerQuarterMinutes(fixture(4), null, roster);

  it('speler 4: Q1 600, Q2 210, Q3 0, Q4 540 (deler = wedstrijden waarin hij speelde)', () => {
    // Q1: A1 600 + B1 300 + B2 300 = 1200 / 2 = 600
    // Q2: A2 420 / 2 = 210 (deler 2: speler 4 speelde in A en B)
    // Q4: A4 600 + B3 480 = 1080 / 2 = 540
    expect(m.get(4)).toEqual([
      { quarter: 1, avgSec: 600 },
      { quarter: 2, avgSec: 210 },
      { quarter: 3, avgSec: 0 },
      { quarter: 4, avgSec: 540 },
    ]);
  });

  it('speler 6: Q1 150, Q2 300, Q3 0, Q4 240', () => {
    // Q1: B2 300 / 2; Q2: A2 420 + A3 180 = 600 / 2; Q4: B3 480 / 2
    expect(m.get(6)!.map((x) => x.avgSec)).toEqual([150, 300, 0, 240]);
  });

  it('speler 7: Q1 0, Q2 90, Q4 60 (A3 180 / 2, B4 120 / 2)', () => {
    expect(m.get(7)!.map((x) => x.avgSec)).toEqual([0, 90, 0, 60]);
  });

  it('speler die nooit speelde (8) staat er niet in; rijen hebben N kwarten', () => {
    expect(m.has(8)).toBe(false);
    expect(m.get(1)).toHaveLength(4);
  });

  it('wedstrijdfilter {A}: speler 4 Q1 600, Q2 420, Q4 600 (deler 1)', () => {
    const r = computePlayerQuarterMinutes(fixture(4), new Set(['A']), roster);
    expect(r.get(4)!.map((x) => x.avgSec)).toEqual([600, 420, 0, 600]);
    // Speler 7 speelde in A (A3), niet in B => deler 1
    expect(r.get(7)!.map((x) => x.avgSec)).toEqual([0, 180, 0, 0]);
  });

  it('PARTIAL uitgesloten en lege selectie geeft een lege map', () => {
    const games = fixture(4);
    games[0]!.segments.push(seg('A5', 3, ['p1', 'p2', 'p3', 'p4', 'onbekend'], 500, 20, 0));
    expect(computePlayerQuarterMinutes(games, null, roster).get(4)![2]!.avgSec).toBe(0);
    expect(computePlayerQuarterMinutes(fixture(4), new Set(), roster).size).toBe(0);
  });
});

describe('buildAnalysisScope vult AnalysisGame.quarterCount uit CompletedGame', () => {
  it('neemt quarterCount over voor afgeronde wedstrijden; actieve wedstrijd laat het leeg', () => {
    const completed: CompletedGame = {
      id: 'g1',
      organizationId: 'org-1',
      teamId: 'team-1',
      sourceGameId: 'src-1',
      opponent: 'A',
      competition: '',
      date: '2026-01-01T00:00:00.000Z',
      players: [1, 2, 3, 4, 5].map(gp),
      segments: [],
      scoreFor: 0,
      scoreAgainst: 0,
      quarterCount: 2,
      periodLabel: '',
      useClassLimit: false,
      revision: 0,
      deletedAt: null,
      deletedBy: null,
    };
    const repo: CompletedGameRepository = {
      list: () => [completed],
      safeList: () => ({ status: 'ok', games: [completed] }),
      add: () => true,
      remove: () => true,
      update: () => false,
      replaceAll: () => true,
    };
    const scope = buildAnalysisScope(repo, null);
    expect(scope.games[0]!.quarterCount).toBe(2);
  });
});
