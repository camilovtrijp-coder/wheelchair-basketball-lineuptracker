import { describe, expect, it } from 'vitest';
import {
  computeLineupInsights,
  type LineupInsightsOptions,
  type LineupRow,
} from '../../src/domain/trends/lineupInsights';
import { computeLineupTurnoverRanking } from '../../src/domain/trends/turnoverSummary';
import { computeLineupStats } from '../../src/domain/stats/computeLineupStats';
import type { AnalysisGame } from '../../src/domain/stats/types';
import type { GamePlayer, Segment } from '../../src/domain/game/types';

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

const L1 = [1, 2, 3, 4, 5];
const L2 = [1, 2, 3, 4, 6];
const L3 = [1, 2, 3, 6, 7];
const L4 = [1, 2, 3, 5, 7];
const ids = (l: number[]) => l.map((n) => `p${n}`);

function seg(
  id: string,
  quarter: number,
  lineup: string[],
  durSec: number,
  pf: number,
  pa: number,
  tov: number,
  classSum: number,
  over: boolean,
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
    classSum,
    allowed: 14.0,
    over,
    tov,
  };
}

function game(id: string, date: string, segments: Segment[], isCurrent = false): AnalysisGame {
  return {
    id,
    opponent: id,
    competition: '',
    date,
    players: [1, 2, 3, 4, 5, 6, 7].map(gp),
    segments,
    scoreFor: 0,
    scoreAgainst: 0,
    isCurrent,
  };
}

/** Vaste fixture uit docs/pr-trends-lineups-plan.md §F.2 (opslagvolgorde: nieuwste eerst). */
function fixture(): AnalysisGame[] {
  const a = game('A', '2026-09-05T10:00:00.000Z', [
    seg('A1', 1, ids(L1), 600, 10, 6, 2, 14.0, false),
    seg('A2', 2, ids(L2), 420, 6, 8, 3, 13.5, false),
    seg('A3', 2, ids(L3), 180, 4, 0, 0, 12.5, false),
    seg('A4', 4, ids(L1), 600, 8, 12, 1, 14.0, false),
  ]);
  const b = game('B', '2026-09-12T10:00:00.000Z', [
    seg('B1', 1, ids(L1), 300, 6, 4, 1, 14.0, false),
    seg('B2', 1, ids(L2), 300, 4, 4, 2, 13.5, false),
    seg('B3', 4, ids(L2), 480, 10, 7, 2, 13.5, false),
    seg('B4', 4, ids(L4), 120, 2, 0, 0, 14.5, true),
  ]);
  return [b, a];
}

const opts = (o: Partial<LineupInsightsOptions> = {}): LineupInsightsOptions => ({
  size: 5,
  minSec: 300,
  metric: 'pm',
  ...o,
});
const keys = (rows: LineupRow[]) => rows.map((x) => x.rosterIds);

describe('lineupInsights — vaste fixture §F.2', () => {
  const r = computeLineupInsights(fixture(), null, opts());

  it('teamtotalen', () => {
    expect(r.team.seconds).toBe(3000);
    expect(r.team.pf).toBe(50);
    expect(r.team.pa).toBe(41);
    expect(r.team.pm).toBe(9);
    expect(r.team.pmPer10).toBeCloseTo(1.8, 10);
    expect(r.team.pfPer10).toBeCloseTo(10.0, 10);
    expect(r.team.paPer10).toBeCloseTo(8.2, 10);
    expect(r.team.tov).toBe(11);
    expect(r.team.tovPer10).toBeCloseTo(2.2, 10);
    expect(r.partialSegments).toBe(0);
  });

  it('gekwalificeerde rijen: L1 dan L2 met alle waarden', () => {
    expect(keys(r.rows)).toEqual([L1, L2]);
    const l1 = r.rows[0]!;
    const l2 = r.rows[1]!;

    expect(l1.seconds).toBe(1500);
    expect([l1.pf, l1.pa, l1.pm, l1.tov, l1.games]).toEqual([24, 22, 2, 4, 2]);
    expect(l1.pmPer10).toBeCloseTo(0.8, 10);
    expect(l1.pfPer10).toBeCloseTo(9.6, 10);
    expect(l1.paPer10).toBeCloseTo(8.8, 10);
    expect(l1.tovPer10).toBeCloseTo(1.6, 10);
    expect(l1.deltaVsTeamPer10).toBeCloseTo(-1.0, 10);
    expect(l1.dampedPmPer10).toBeCloseTo(1200 / 2100, 10);
    expect(l1.dampedPmPer10).toBeCloseTo(0.571, 3);
    expect(l1.qualified).toBe(true);

    expect(l2.seconds).toBe(1200);
    expect([l2.pf, l2.pa, l2.pm, l2.tov, l2.games]).toEqual([20, 19, 1, 7, 2]);
    expect(l2.pmPer10).toBeCloseTo(0.5, 10);
    expect(l2.pfPer10).toBeCloseTo(10.0, 10);
    expect(l2.paPer10).toBeCloseTo(9.5, 10);
    expect(l2.tovPer10).toBeCloseTo(3.5, 10);
    expect(l2.deltaVsTeamPer10).toBeCloseTo(-1.3, 10);
    expect(l2.dampedPmPer10).toBeCloseTo(0.333, 3);
    expect(l2.qualified).toBe(true);
  });

  it('belowThreshold: L3 (180 s) dan L4 (120 s) met ruwe totalen', () => {
    expect(keys(r.belowThreshold)).toEqual([L3, L4]);
    const l3 = r.belowThreshold[0]!;
    const l4 = r.belowThreshold[1]!;
    expect([l3.seconds, l3.pf, l3.pa, l3.pm, l3.tov, l3.games]).toEqual([180, 4, 0, 4, 0, 1]);
    expect([l4.seconds, l4.pf, l4.pa, l4.pm, l4.tov, l4.games]).toEqual([120, 2, 0, 2, 0, 1]);
    expect(l3.pmPer10).toBeCloseTo(13.3333, 4);
    expect(l4.pmPer10).toBeCloseTo(10.0, 10);
    expect(l3.dampedPmPer10).toBeCloseTo(3.077, 3);
    expect(l4.dampedPmPer10).toBeCloseTo(1.667, 3);
    expect(l3.qualified).toBe(false);
    expect(l4.qualified).toBe(false);
  });

  it('controle: som seconden is 3000 en som +/- is +9 (gelijk aan team)', () => {
    const all = [...r.rows, ...r.belowThreshold];
    expect(all.reduce((s, x) => s + x.seconds, 0)).toBe(3000);
    expect(all.reduce((s, x) => s + x.pm, 0)).toBe(9);
  });

  it('minSec = 0: volgorde L3, L4, L1, L2 (bewijs waarom de drempel nodig is)', () => {
    const z = computeLineupInsights(fixture(), null, opts({ minSec: 0 }));
    expect(keys(z.rows)).toEqual([L3, L4, L1, L2]);
    expect(z.belowThreshold).toEqual([]);
  });

  it('drempelgrens: seconds === minSec telt mee, een seconde meer niet', () => {
    const at = computeLineupInsights(fixture(), null, opts({ minSec: 1200 }));
    expect(keys(at.rows)).toEqual([L1, L2]);
    const above = computeLineupInsights(fixture(), null, opts({ minSec: 1201 }));
    expect(keys(above.rows)).toEqual([L1]);
    expect(keys(above.belowThreshold)).toEqual([L2, L3, L4]);
  });

  it('metrics pf/pa/tov sorteren in de juiste richting', () => {
    // pf/10: L2 10,0 > L1 9,6 (aflopend)
    expect(keys(computeLineupInsights(fixture(), null, opts({ metric: 'pf' })).rows)).toEqual([
      L2,
      L1,
    ]);
    // pa/10: L1 8,8 < L2 9,5 (oplopend)
    expect(keys(computeLineupInsights(fixture(), null, opts({ metric: 'pa' })).rows)).toEqual([
      L1,
      L2,
    ]);
    // tov/10: L1 1,6 < L2 3,5 (oplopend)
    expect(keys(computeLineupInsights(fixture(), null, opts({ metric: 'tov' })).rows)).toEqual([
      L1,
      L2,
    ]);
  });

  it('limit beperkt alleen de gekwalificeerde rijen', () => {
    const l = computeLineupInsights(fixture(), null, opts({ limit: 1 }));
    expect(keys(l.rows)).toEqual([L1]);
    expect(l.belowThreshold).toHaveLength(2);
  });

  it('duo 1-2 stond in alle segmenten: 3000 s, +9, 2 wedstrijden', () => {
    const d = computeLineupInsights(fixture(), null, opts({ size: 2, minSec: 600 }));
    const pair = d.rows.find((x) => x.rosterIds.join(',') === '1,2')!;
    expect([pair.seconds, pair.pm, pair.games]).toEqual([3000, 9, 2]);
    expect(pair.pmPer10).toBeCloseTo(1.8, 10);
    expect(pair.deltaVsTeamPer10).toBeCloseTo(0, 10);
  });
});

describe('lineupInsights — selectie en randgevallen', () => {
  it('lege selectie en lege scope', () => {
    for (const r of [
      computeLineupInsights(fixture(), new Set(), opts()),
      computeLineupInsights([], null, opts()),
    ]) {
      expect(r.rows).toEqual([]);
      expect(r.belowThreshold).toEqual([]);
      expect(r.partialSegments).toBe(0);
      expect(r.team.seconds).toBe(0);
      expect(r.team.pm).toBe(0);
      expect(r.team.pmPer10).toBeNull();
      expect(r.team.pfPer10).toBeNull();
      expect(r.team.paPer10).toBeNull();
      expect(r.team.tovPer10).toBeNull();
    }
  });

  it('wedstrijdfilter: alleen B (1200 s, +7, 5 tov)', () => {
    const b = computeLineupInsights(fixture(), new Set(['B']), opts());
    expect(b.team.seconds).toBe(1200);
    expect([b.team.pf, b.team.pa, b.team.pm, b.team.tov]).toEqual([22, 15, 7, 5]);
    // L1 = 300 s (grens, telt mee), +2 -> 4,0 per 10; L2 = 780 s, +3 -> 2,3077 per 10; L4 = 120 s
    expect(keys(b.rows)).toEqual([L1, L2]);
    expect(b.rows[0]!.pmPer10).toBeCloseTo(4.0, 10);
    expect(b.rows[0]!.games).toBe(1);
    expect(b.rows[1]!.pmPer10).toBeCloseTo(1800 / 780, 10);
    expect(keys(b.belowThreshold)).toEqual([L4]);
  });

  it('tiebreaker: gelijke metric -> seconden aflopend -> sleutel', () => {
    const X = [1, 2, 3, 4, 5]; // 600 s, +2 -> 2,0 per 10
    const Y = [1, 2, 3, 4, 6]; // 300 s, +1 -> 2,0 per 10
    const Z = [1, 2, 3, 4, 7]; // 600 s, +2 -> 2,0 per 10
    const g = game('T', '2026-10-01T10:00:00.000Z', [
      seg('T1', 1, ids(Y), 300, 3, 2, 0, 0, false),
      seg('T2', 1, ids(Z), 600, 5, 3, 0, 0, false),
      seg('T3', 2, ids(X), 600, 5, 3, 0, 0, false),
    ]);
    const r = computeLineupInsights([g], null, opts());
    expect(keys(r.rows)).toEqual([X, Z, Y]);
  });

  it('PARTIAL-segment wordt uitgesloten en geteld', () => {
    const g = fixture();
    g[1]!.segments.push(seg('A5', 3, ['p1', 'p2', 'p3', 'p4', 'p99'], 500, 9, 0, 4, 0, false));
    const r = computeLineupInsights(g, null, opts());
    expect(r.partialSegments).toBe(1);
    expect(r.team.seconds).toBe(3000);
    expect(r.team.pm).toBe(9);
    expect(r.team.tov).toBe(11);
    expect(keys(r.rows)).toEqual([L1, L2]);
  });

  it('actieve wedstrijd telt mee als voorlopig', () => {
    const active = game(
      'C',
      '2026-10-20T10:00:00.000Z',
      [seg('C1', 1, ids(L1), 300, 3, 0, 1, 14.0, false)],
      true,
    );
    const r = computeLineupInsights([active, ...fixture()], null, opts());
    expect(r.team.seconds).toBe(3300);
    expect(r.team.pm).toBe(12);
    const l1 = r.rows.find((x) => x.rosterIds.join(',') === '1,2,3,4,5')!;
    expect([l1.seconds, l1.pm, l1.games]).toEqual([1800, 5, 3]);
    // filter op alleen de actieve wedstrijd
    const only = computeLineupInsights([active, ...fixture()], new Set(['C']), opts());
    expect(only.team.seconds).toBe(300);
    expect(keys(only.rows)).toEqual([L1]);
  });
});

describe('regressie: bestaande functies leveren op de fixture ongewijzigde uitvoer', () => {
  it('computeLineupTurnoverRanking: gemiddelde 2,2; volgorde L4, L3, L1, L2', () => {
    const rk = computeLineupTurnoverRanking(fixture(), null);
    expect(rk.averagePer10).toBeCloseTo(2.2, 10);
    expect(rk.rows.map((x) => x.rosterIds)).toEqual([L4, L3, L1, L2]);
    expect(rk.rows.map((x) => x.seconds)).toEqual([120, 180, 1500, 1200]);
    expect(rk.rows.map((x) => x.turnovers)).toEqual([0, 0, 4, 7]);
    expect(rk.rows[0]!.per10).toBe(0);
    expect(rk.rows[1]!.per10).toBe(0);
    expect(rk.rows[2]!.per10).toBeCloseTo(1.6, 10);
    expect(rk.rows[3]!.per10).toBeCloseTo(3.5, 10);
    expect(rk.rows.map((x) => x.tone)).toEqual(['good', 'good', 'good', 'bad']);
  });

  it('computeLineupStats (size 5): ON-totalen per lineup en sortering op pm per 10', () => {
    const res = computeLineupStats(fixture(), {
      comboSize: 5,
      per10: true,
      sortDirection: 'desc',
      gameIds: null,
      playerFilters: [],
    });
    expect(res.partialSegments).toBe(0);
    expect(res.consideredSegments).toBe(8);
    expect(res.totalRawCombinations).toBe(4);
    expect(res.combinations.map((c) => c.rosterIds)).toEqual([L3, L4, L1, L2]);
    const by = (l: number[]) => res.combinations.find((c) => c.rosterIds.join() === l.join())!;
    expect(by(L1)).toMatchObject({ onSec: 1500, onPF: 24, onPA: 22, onTov: 4 });
    expect(by(L2)).toMatchObject({ onSec: 1200, onPF: 20, onPA: 19, onTov: 7 });
    expect(by(L3)).toMatchObject({ onSec: 180, onPF: 4, onPA: 0, onTov: 0 });
    expect(by(L4)).toMatchObject({ onSec: 120, onPF: 2, onPA: 0, onTov: 0 });
    // OFF-kant: in 5-tallen is OFF = de rest van de 3000 s
    expect(by(L1)).toMatchObject({ offSec: 1500, offPF: 26, offPA: 19, offTov: 7 });
  });
});
