import { describe, it, expect } from 'vitest';
import {
  LOW_MINUTES_SEC,
  isLowMinutes,
  offPlusMinusPer10,
  onPlusMinusPer10,
  plusMinusPer10,
} from '../../src/domain/stats/computeLineupStats';
import { deriveRunningLineup } from '../../src/domain/stats/runningLineup';
import type { LineupCombinationStats } from '../../src/domain/stats/types';
import type { ActiveGame, GameAction, GamePlayer, Segment } from '../../src/domain/game/types';

// R5 — alle verwachte getallen hieronder zijn met de hand uitgerekend (fictieve data).

function combo(overrides: Partial<LineupCombinationStats> = {}): LineupCombinationStats {
  return {
    rosterIds: [1, 2, 3, 4, 5],
    onSec: 0,
    onPF: 0,
    onPA: 0,
    offSec: 0,
    offPF: 0,
    offPA: 0,
    onTov: 0,
    offTov: 0,
    ...overrides,
  };
}

describe('plusMinusPer10 / onPlusMinusPer10 / offPlusMinusPer10', () => {
  it('pm × 600 / sec: +6 in 540s = 6,666…; −3 in 900s = −2', () => {
    // 6 * 600 / 540 = 3600 / 540 = 6,666…
    expect(plusMinusPer10(6, 540)).toBeCloseTo(6.6667, 4);
    // -3 * 600 / 900 = -1800 / 900 = -2
    expect(plusMinusPer10(-3, 900)).toBe(-2);
  });

  it('geen speeltijd → null (niets om te normaliseren)', () => {
    expect(plusMinusPer10(5, 0)).toBeNull();
  });

  it('ON gebruikt onSec, OFF gebruikt offSec: eigen tijdsbasis per kant', () => {
    // ON: 12 - 6 = +6 in 360s → 6 * 600 / 360 = 10
    // OFF: 20 - 14 = +6 in 450s → 6 * 600 / 450 = 8 (niet 10: andere tijdsbasis)
    const c = combo({ onSec: 360, onPF: 12, onPA: 6, offSec: 450, offPF: 20, offPA: 14 });
    expect(onPlusMinusPer10(c)).toBe(10);
    expect(offPlusMinusPer10(c)).toBe(8);
  });

  it('OFF zonder speeltijd → null', () => {
    expect(offPlusMinusPer10(combo({ onSec: 100, onPF: 2 }))).toBeNull();
  });
});

describe('isLowMinutes (drempel 5:00)', () => {
  it('drempel is 300 seconden', () => {
    expect(LOW_MINUTES_SEC).toBe(300);
  });

  it('4:59 (299s) is weinig minuten, 5:00 (300s) niet', () => {
    expect(isLowMinutes(combo({ onSec: 299 }))).toBe(true);
    expect(isLowMinutes(combo({ onSec: 300 }))).toBe(false);
    expect(isLowMinutes(combo({ onSec: 0 }))).toBe(true);
  });

  it('kijkt naar de speeltijd MET hen, niet naar de OFF-tijd', () => {
    expect(isLowMinutes(combo({ onSec: 120, offSec: 3000 }))).toBe(true);
  });
});

describe('deriveRunningLineup', () => {
  const players: GamePlayer[] = [11, 12, 13, 14, 15, 16].map((rid, i) => ({
    id: `p${i + 1}`,
    rosterId: rid,
    nr: String(rid),
    naam: `Speler ${rid}`,
    kl: '1.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
  }));

  const savedSegment: Segment = {
    id: 's1',
    quarter: 1,
    beginSec: 0,
    endSec: 100,
    durSec: 100,
    lineup: ['p1', 'p2', 'p3', 'p4', 'p6'],
    pf: 2,
    pa: 1,
    classSum: 0,
    allowed: 0,
    over: false,
  };

  function at(i: number): string {
    return `2026-01-01T10:00:0${i}.000Z`;
  }

  // Vóór het opgeslagen segment: voor +2, tegen +1 (→ segment pf 2, pa 1).
  // Daarna (open segment): voor +2, voor +3, tegen +2, TO +1, TO +1.
  const actions: GameAction[] = [
    { type: 'score-delta', id: 'a1', team: 'for', delta: 2, at: at(1) },
    { type: 'score-delta', id: 'a2', team: 'against', delta: 1, at: at(2) },
    { type: 'segment-saved', id: 'a3', segment: savedSegment, at: at(3) },
    { type: 'score-delta', id: 'a4', team: 'for', delta: 2, at: at(4) },
    { type: 'score-delta', id: 'a5', team: 'for', delta: 3, at: at(5) },
    { type: 'score-delta', id: 'a6', team: 'against', delta: 2, at: at(6) },
    { type: 'turnover-delta', id: 'a7', delta: 1, at: at(7) },
    { type: 'turnover-delta', id: 'a8', delta: 1, at: at(8) },
  ];

  function game(overrides: Partial<ActiveGame> = {}): ActiveGame {
    return {
      id: 'g1',
      organizationId: 'o',
      teamId: 't',
      phase: 'tracking',
      players,
      opponent: 'Fictief',
      competition: '',
      clockDown: false,
      limitStr: '',
      // Bewust door elkaar: de uitkomst moet gesorteerd op rosterId zijn.
      onCourt: ['p5', 'p3', 'p1', 'p2', 'p4'],
      curQuarter: 1,
      beginSec: 100,
      endSec: 250,
      pendingSwapLineup: null,
      actions,
      createdAt: at(0),
      startedAt: at(0),
      ...overrides,
    };
  }

  it('open segment: pf 5, pa 2, tov 2, duur 150s (alleen na het opgeslagen segment)', () => {
    const r = deriveRunningLineup(game());
    expect(r).not.toBeNull();
    expect(r!.rosterIds).toEqual([11, 12, 13, 14, 15]);
    expect(r!.durSec).toBe(150); // 250 - 100
    expect(r!.pf).toBe(5); // 2 + 3 (de eerste 2 zit in het opgeslagen segment)
    expect(r!.pa).toBe(2); // 2 (de eerste 1 zit in het opgeslagen segment)
    expect(r!.tov).toBe(2);
    // Per 10 min: +3 → 3 * 600 / 150 = 12; TO 2 * 600 / 150 = 8
    expect(r!.pmPer10).toBe(12);
    expect(r!.tovPer10).toBe(8);
  });

  it('klok die aftelt: duur = begin − eind (600 → 450 = 150s)', () => {
    const r = deriveRunningLineup(game({ clockDown: true, beginSec: 600, endSec: 450 }));
    expect(r!.durSec).toBe(150);
  });

  it('nog geen speeltijd (begin = eind): duur 0 en per-10-waarden null', () => {
    const r = deriveRunningLineup(game({ beginSec: 100, endSec: 100 }));
    expect(r!.durSec).toBe(0);
    expect(r!.pmPer10).toBeNull();
    expect(r!.tovPer10).toBeNull();
  });

  it('lopende lineup is "weinig minuten" onder 5:00 (150s) en niet vanaf 300s', () => {
    expect(deriveRunningLineup(game())!.lowMinutes).toBe(true);
    expect(deriveRunningLineup(game({ beginSec: 0, endSec: 300 }))!.lowMinutes).toBe(false);
  });

  it('bij een nog niet bevestigde wissel hoort het open segment bij de lineup van vóór de wissel', () => {
    // pendingSwapLineup = p1,p2,p3,p4,p6 (rosterIds 11,12,13,14,16); onCourt is al gewisseld.
    const r = deriveRunningLineup(game({ pendingSwapLineup: ['p1', 'p2', 'p3', 'p4', 'p6'] }));
    expect(r!.rosterIds).toEqual([11, 12, 13, 14, 16]);
  });

  it('geen lopende lineup buiten tracking, zonder 5 spelers of met onbekend ID', () => {
    expect(deriveRunningLineup(game({ phase: 'setup' }))).toBeNull();
    expect(deriveRunningLineup(game({ onCourt: ['p1', 'p2', 'p3', 'p4'] }))).toBeNull();
    expect(deriveRunningLineup(game({ onCourt: ['p1', 'p2', 'p3', 'p4', 'onbekend'] }))).toBeNull();
  });
});
