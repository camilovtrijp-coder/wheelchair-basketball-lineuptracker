import { describe, expect, it } from 'vitest';
import {
  applyAction,
  deriveGameHistory,
  EMPTY_HISTORY,
  segmentTurnovers,
  turnoverDeltaAction,
} from '../../src/domain/game/tracking';
import type { ActiveGame, GameAction, Segment } from '../../src/domain/game/types';

const AT = '2026-01-01T10:00:00.000Z';

function seg(id: string, tov?: number): Segment {
  return {
    id,
    quarter: 1,
    beginSec: 600,
    endSec: 300,
    durSec: 300,
    lineup: ['a', 'b', 'c', 'd', 'e'],
    pf: 4,
    pa: 2,
    classSum: 0,
    allowed: 0,
    over: false,
    ...(tov === undefined ? {} : { tov }),
  };
}

const t = (delta: number, id = `t${Math.random()}`): GameAction => ({
  type: 'turnover-delta',
  id,
  delta,
  at: AT,
});
const saved = (segment: Segment): GameAction => ({
  type: 'segment-saved',
  id: `s-${segment.id}`,
  segment,
  at: AT,
});

describe('turnovers — domein (handmatig narekenbaar)', () => {
  it('telt turnovers op en slaat het startpunt per segment op', () => {
    // 3 turnovers, segment A opslaan met tov 3, dan 2 turnovers erbij.
    let h = EMPTY_HISTORY;
    for (const d of [1, 1, 1]) h = applyAction(h, t(d));
    expect(h.turnovers).toBe(3);
    expect(h.segStartTurnovers).toBe(0);
    h = applyAction(h, saved(seg('A', 3)));
    expect(h.segStartTurnovers).toBe(3);
    h = applyAction(h, t(1));
    h = applyAction(h, t(1));
    expect(h.turnovers).toBe(5);
    expect(h.turnovers - h.segStartTurnovers).toBe(2);
  });

  it('−1 corrigeren zakt nooit onder het begin van het open segment', () => {
    let h = applyAction(EMPTY_HISTORY, t(1));
    h = applyAction(h, saved(seg('A', 1)));
    h = applyAction(h, t(-1)); // open segment is 0 → blijft 0
    expect(h.turnovers).toBe(1);
    h = applyAction(h, t(1));
    h = applyAction(h, t(-1));
    expect(h.turnovers).toBe(1);
  });

  it('segment bewerken/verwijderen herberekent de basis zoals bij de score', () => {
    let h = EMPTY_HISTORY;
    h = applyAction(h, t(2));
    h = applyAction(h, saved(seg('A', 2)));
    h = applyAction(h, t(1)); // open segment: 1
    h = applyAction(h, {
      type: 'segment-edited',
      id: 'e1',
      segmentId: 'A',
      segment: seg('A', 5),
      at: AT,
    });
    expect(h.segStartTurnovers).toBe(5);
    expect(h.turnovers).toBe(6); // 5 vastgelegd + 1 open
    h = applyAction(h, { type: 'segment-deleted', id: 'd1', segmentId: 'A', at: AT });
    expect(h.segStartTurnovers).toBe(0);
    expect(h.turnovers).toBe(1);
  });

  it('segmentTurnovers: ontbrekend of ongeldig veld telt als 0', () => {
    expect(segmentTurnovers(seg('x'))).toBe(0);
    expect(segmentTurnovers(seg('x', 4))).toBe(4);
    expect(segmentTurnovers({ tov: -3 })).toBe(0);
    expect(segmentTurnovers({ tov: 2.9 })).toBe(2);
  });

  it('deriveGameHistory vouwt de actielog samen, ook zonder turnover-acties', () => {
    const game = { actions: [saved(seg('A'))] } as unknown as ActiveGame;
    expect(deriveGameHistory(game).turnovers).toBe(0);
    const game2 = { actions: [turnoverDeltaAction(1), turnoverDeltaAction(1)] } as ActiveGame;
    expect(deriveGameHistory(game2).turnovers).toBe(2);
  });
});
