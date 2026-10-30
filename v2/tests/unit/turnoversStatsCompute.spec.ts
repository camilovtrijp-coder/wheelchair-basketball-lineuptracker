import { describe, expect, it } from 'vitest';
import {
  compareTurnoverRates,
  computeLineupStats,
  offTurnoverShownValue,
  onTurnoverShownValue,
  turnoverRatePer10,
} from '../../src/domain/stats/computeLineupStats';
import type {
  AnalysisGame,
  LineupCombinationStats,
  StatsFilter,
} from '../../src/domain/stats/types';
import type { GamePlayer, Segment } from '../../src/domain/game/types';

function player(id: string, rosterId: number): GamePlayer {
  return {
    id,
    rosterId,
    nr: String(rosterId),
    naam: `Speler ${rosterId}`,
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

const filter = (overrides: Partial<StatsFilter> = {}): StatsFilter => ({
  comboSize: 5,
  per10: false,
  sortDirection: 'desc',
  gameIds: null,
  playerFilters: [],
  ...overrides,
});

/**
 * Handmatig narekenbare wedstrijd (zes spelers, rosterId 1-6):
 *  A: 1-2-3-4-5 gedurende 600 s, pf 4 / pa 2, 3 turnovers
 *  B: 1-2-3-4-6 gedurende 300 s, pf 2 / pa 3, 2 turnovers
 *  C: 1-2-3-4-5 gedurende 120 s, pf 1 / pa 1, ZONDER tov-veld (oud segment: telt 0)
 */
function game(): AnalysisGame {
  const players = [1, 2, 3, 4, 5, 6].map((n) => player(`p${n}`, n));
  return {
    id: 'g1',
    opponent: 'X',
    competition: '',
    date: '2026-01-01T10:00:00.000Z',
    players,
    segments: [
      seg('A', ['p1', 'p2', 'p3', 'p4', 'p5'], 600, 4, 2, 3),
      seg('B', ['p1', 'p2', 'p3', 'p4', 'p6'], 300, 2, 3, 2),
      seg('C', ['p1', 'p2', 'p3', 'p4', 'p5'], 120, 1, 1),
    ],
    scoreFor: 0,
    scoreAgainst: 0,
    isCurrent: false,
  };
}

function combo(
  result: ReturnType<typeof computeLineupStats>,
  ids: number[],
): LineupCombinationStats {
  const found = result.combinations.find((c) => c.rosterIds.join(',') === ids.join(','));
  if (!found) throw new Error(`combinatie ${ids.join(',')} ontbreekt`);
  return found;
}

describe('stats — turnovers per combinatie (hand narekenbaar)', () => {
  const result = computeLineupStats([game()], filter());

  it('opstelling 1-2-3-4-5: ON = A + C (720 s, 3 + 0 tov), OFF = B (300 s, 2 tov)', () => {
    const c = combo(result, [1, 2, 3, 4, 5]);
    expect(c.onSec).toBe(720);
    expect(c.onTov).toBe(3); // oud segment C zonder tov telt als 0
    expect(c.offSec).toBe(300);
    expect(c.offTov).toBe(2);
  });

  it('opstelling 1-2-3-4-6: ON = B (300 s, 2 tov), OFF = A + C (720 s, 3 tov)', () => {
    const c = combo(result, [1, 2, 3, 4, 6]);
    expect(c.onSec).toBe(300);
    expect(c.onTov).toBe(2);
    expect(c.offSec).toBe(720);
    expect(c.offTov).toBe(3);
  });

  it('per 10 min: 3 * 600 / 720 = 2,5 en 2 * 600 / 300 = 4,0', () => {
    const c = combo(result, [1, 2, 3, 4, 5]);
    expect(turnoverRatePer10(c.onTov, c.onSec)).toBeCloseTo(2.5, 10);
    expect(turnoverRatePer10(c.offTov, c.offSec)).toBeCloseTo(4.0, 10);
    expect(onTurnoverShownValue(c, true)).toBeCloseTo(2.5, 10);
    expect(offTurnoverShownValue(c, true)).toBeCloseTo(4.0, 10);
    // zonder per10: het totaal
    expect(onTurnoverShownValue(c, false)).toBe(3);
    expect(offTurnoverShownValue(c, false)).toBe(2);
  });

  it('vergelijking: minder turnovers per 10 min is beter', () => {
    expect(compareTurnoverRates(combo(result, [1, 2, 3, 4, 5]))).toBe('with-better'); // 2,5 < 4,0
    expect(compareTurnoverRates(combo(result, [1, 2, 3, 4, 6]))).toBe('without-better'); // 4,0 > 2,5
  });

  it('een speler die altijd speelt heeft geen OFF-speeltijd: geen waarde en onbekende vergelijking', () => {
    const one = computeLineupStats([game()], filter({ comboSize: 1 }));
    const p1 = combo(one, [1]);
    expect(p1.onSec).toBe(1020);
    expect(p1.onTov).toBe(5);
    expect(p1.offSec).toBe(0);
    expect(offTurnoverShownValue(p1, true)).toBeNull();
    expect(offTurnoverShownValue(p1, false)).toBeNull();
    expect(compareTurnoverRates(p1)).toBe('unknown');
  });

  it('gelijke snelheid is "equal"', () => {
    const c: LineupCombinationStats = {
      rosterIds: [1],
      onSec: 600,
      onPF: 0,
      onPA: 0,
      offSec: 300,
      offPF: 0,
      offPA: 0,
      onTov: 4,
      offTov: 2,
    };
    expect(compareTurnoverRates(c)).toBe('equal'); // 4 per 10 min aan beide kanten
  });
});

describe('stats — bestaande uitkomsten blijven gelijk (turnovers zijn alleen een uitbreiding)', () => {
  it('punten, tijden en volgorde zijn identiek, met of zonder turnover-gegevens', () => {
    const withTov = computeLineupStats([game()], filter());
    const base = game();
    const withoutTov: AnalysisGame = {
      ...base,
      segments: base.segments.map((s) => {
        const copy = { ...s };
        delete copy.tov;
        return copy;
      }),
    };
    const without = computeLineupStats([withoutTov], filter());

    const strip = (r: ReturnType<typeof computeLineupStats>) =>
      r.combinations.map((c) => {
        const copy: Partial<LineupCombinationStats> = { ...c };
        delete copy.onTov;
        delete copy.offTov;
        return copy;
      });
    expect(strip(withTov)).toEqual(strip(without));
    expect(withTov.consideredSegments).toBe(without.consideredSegments);
    expect(withTov.partialSegments).toBe(without.partialSegments);

    // Zonder enige tov-gegevens zijn alle turnovertellers 0.
    for (const c of without.combinations) {
      expect(c.onTov).toBe(0);
      expect(c.offTov).toBe(0);
    }
  });

  it('handmatig nagerekend: 1-2-3-4-5 heeft ON 5 punt voor / 3 tegen (4+1 / 2+1) over 720 s', () => {
    const c = combo(computeLineupStats([game()], filter()), [1, 2, 3, 4, 5]);
    expect(c.onPF).toBe(5);
    expect(c.onPA).toBe(3);
    expect(c.onSec).toBe(720);
    expect(c.offPF).toBe(2);
    expect(c.offPA).toBe(3);
  });
});
