// R8 — lineup-overzicht van een afgeronde wedstrijd. Fictieve spelers, alles
// handmatig nagerekend (zie de opmerkingen per verwachting).
//
// Spelers (klasse; V = vrouw, J = jeugd):
//   p1 3.0 · p2 2.5 V · p3 3.5 J · p4 1.5 V+J · p5 4.0 · p6 1.0 · p7 2.0
// Bonusconfig: max 2.5; alleen V 1.5; alleen J 1.0; beide 2.0.
//
// Lineups:
//   A = p1 p2 p3 p4 p5 → klasse 3+2.5+3.5+1.5+4 = 14.5; bonus 1.5+1+2 = 4.5 → max 2.5 → "14.5 FJ +2.5"
//   C = p1 p3 p5 p6 p7 → klasse 3+3.5+4+1+2 = 13.5; bonus 1.0 → "13.5 J +1"
//   D = p1 p2 p5 p6 p7 → klasse 3+2.5+4+1+2 = 12.5; bonus 1.5 → "12.5 F +1.5"
import { describe, it, expect } from 'vitest';
import {
  buildLineupOverview,
  formatLineupClassNotation,
} from '../../src/domain/game/lineupOverview';
import type { ClassificationConfig } from '../../src/domain/game/tracking';
import type { CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';

const CONFIG: ClassificationConfig = {
  useClassLimit: true,
  classBaseLimit: 14,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1.0,
  bonusBoth: 2.0,
};

function player(n: number, kl: string, vrouw = false, jeugd = false): GamePlayer {
  return {
    id: `p${n}`,
    rosterId: n,
    nr: String(n),
    naam: `Speler ${n}`,
    kl,
    vrouw,
    jeugd,
    participate: true,
    start: true,
  };
}

const PLAYERS: GamePlayer[] = [
  player(1, '3.0'),
  player(2, '2.5', true),
  player(3, '3.5', false, true),
  player(4, '1.5', true, true),
  player(5, '4.0'),
  player(6, '1.0'),
  player(7, '2.0'),
];

function seg(
  id: string,
  quarter: number,
  lineup: string[],
  durSec: number,
  pf: number,
  pa: number,
  tov?: number,
): Segment {
  return {
    id,
    quarter,
    beginSec: 0,
    endSec: durSec,
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

const A = ['p1', 'p2', 'p3', 'p4', 'p5'];
const C = ['p1', 'p3', 'p5', 'p6', 'p7'];
const D = ['p1', 'p2', 'p5', 'p6', 'p7'];

function game(segments: Segment[]): CompletedGame {
  return {
    id: 'g1',
    opponent: 'Tegenstander',
    competition: '',
    date: '2026-01-01T12:00:00.000Z',
    players: PLAYERS,
    segments,
    scoreFor: 0,
    scoreAgainst: 0,
  } as unknown as CompletedGame;
}

const SEGMENTS: Segment[] = [
  seg('s1', 1, A, 300, 4, 2, 1),
  seg('s2', 1, A, 60, 0, 1), // direct erna, zelfde kwart → dezelfde stint; tov ontbreekt = 0
  seg('s3', 1, C, 120, 2, 2, 0),
  seg('s4', 2, [...A].reverse(), 180, 3, 5, 2), // omgekeerde volgorde, nieuw kwart → 2e stint
  seg('s5', 2, D, 240, 6, 0, 0),
  seg('s6', 3, C, 100, 1, 0, 1),
];

describe('buildLineupOverview', () => {
  const rows = buildLineupOverview(game(SEGMENTS), CONFIG);

  it('geeft unieke lineups op volgorde van eerste opkomst (A, C, D)', () => {
    expect(rows.map((r) => r.players.map((p) => p.nr).join(''))).toEqual([
      '12345',
      '13567',
      '12567',
    ]);
  });

  it('lineup A: 300+60+180 = 540 s, 2 stints, 4+0+3 = 7 voor, 2+1+5 = 8 tegen, +/- -1, TO 1+0+2 = 3', () => {
    const a = rows[0]!;
    expect(a.sec).toBe(540);
    expect(a.stints).toBe(2);
    expect([a.pf, a.pa, a.plusMinus]).toEqual([7, 8, -1]);
    expect(a.turnovers).toBe(3);
    expect(a.quarters).toEqual([
      { quarter: 1, sec: 360 },
      { quarter: 2, sec: 180 },
    ]);
  });

  it('lineup C: 120+100 = 220 s, 2 stints (Q1 en Q3), 3-2 → +1, 1 TO', () => {
    const c = rows[1]!;
    expect(c.sec).toBe(220);
    expect(c.stints).toBe(2);
    expect([c.pf, c.pa, c.plusMinus]).toEqual([3, 2, 1]);
    expect(c.turnovers).toBe(1);
    expect(c.quarters).toEqual([
      { quarter: 1, sec: 120 },
      { quarter: 3, sec: 100 },
    ]);
  });

  it('lineup D: 240 s, 1 stint, 6-0 → +6, 0 TO, alleen Q2', () => {
    const d = rows[2]!;
    expect([d.sec, d.stints, d.plusMinus, d.turnovers]).toEqual([240, 1, 6, 0]);
    expect(d.quarters).toEqual([{ quarter: 2, sec: 240 }]);
  });

  it('klassesom, bonus (met maximum) en tags per lineup', () => {
    const [a, c, d] = rows;
    expect([a!.classSum, a!.bonus, a!.hasWomen, a!.hasYouth]).toEqual([14.5, 2.5, true, true]);
    expect([c!.classSum, c!.bonus, c!.hasWomen, c!.hasYouth]).toEqual([13.5, 1, false, true]);
    expect([d!.classSum, d!.bonus, d!.hasWomen, d!.hasYouth]).toEqual([12.5, 1.5, true, false]);
  });

  it('toont de game-plan-notatie', () => {
    expect(rows.map((r) => formatLineupClassNotation(r, 'Vrouw', 'Jeugd'))).toEqual([
      '14.5 VJ +2.5',
      '13.5 J +1',
      '12.5 V +1.5',
    ]);
    expect(formatLineupClassNotation(rows[0]!, 'Female', 'Junior')).toBe('14.5 FJ +2.5');
  });

  it('zonder tags en bonus alleen de klassesom', () => {
    expect(
      formatLineupClassNotation(
        { classSum: 13, bonus: 0, hasWomen: false, hasYouth: false },
        'F',
        'J',
      ),
    ).toBe('13.0');
  });

  it('negeert een segment met een onbekende speler (PARTIAL)', () => {
    const partial = seg('sx', 1, ['p1', 'p2', 'p3', 'p4', 'pX'], 500, 9, 9);
    const out = buildLineupOverview(game([partial, seg('s1', 1, A, 100, 2, 1)]), CONFIG);
    expect(out).toHaveLength(1);
    expect(out[0]!.sec).toBe(100);
  });

  it('geeft een lege lijst zonder segmenten', () => {
    expect(buildLineupOverview(game([]), CONFIG)).toEqual([]);
  });
});
