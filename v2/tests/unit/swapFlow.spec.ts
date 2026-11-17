import { describe, expect, it } from 'vitest';
import { closeQuarter, openSegmentSummary } from '../../src/domain/game/liveCommands';
import type { RotationPlan } from '../../src/domain/game/rotationPlan';
import {
  commitRetroactiveSwap,
  commitSwapWithProvisionalTime,
  confirmSwapTime,
  lastUndoableAction,
  pendingTimeConfirmations,
  proposeSwapTime,
  retroSwapEntries,
  swapTimeBounds,
  undoLastAction,
} from '../../src/domain/game/swapFlow';
import {
  applyAction,
  deriveGameHistory,
  EMPTY_HISTORY,
  scoreDeltaAction,
  scoreSetAction,
  segmentDeletedAction,
  swapOnCourt,
  turnoverDeltaAction,
  type ClassificationConfig,
} from '../../src/domain/game/tracking';
import type { ActiveGame, GameAction, GamePlayer } from '../../src/domain/game/types';

// Fictieve spelers: op de vloer #4 Alex, #7 Sam, #9 Robin, #11 Kim, #13 Dani;
// bank #6 Bo, #12 Noa, #15 Jules. rosterId = rugnummer.
function p(id: string, nr: string, naam: string): GamePlayer {
  return {
    id,
    rosterId: Number(nr),
    nr,
    naam,
    kl: '2.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: false,
  };
}
const PLAYERS = [
  p('p4', '4', 'Alex'),
  p('p7', '7', 'Sam'),
  p('p9', '9', 'Robin'),
  p('p11', '11', 'Kim'),
  p('p13', '13', 'Dani'),
  p('p6', '6', 'Bo'),
  p('p12', '12', 'Noa'),
  p('p15', '15', 'Jules'),
];
const START = ['p4', 'p7', 'p9', 'p11', 'p13'];

const CLASS_OFF: ClassificationConfig = {
  useClassLimit: false,
  classBaseLimit: 14.5,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1,
  bonusBoth: 2,
};

function makeGame(overrides: Partial<ActiveGame> = {}): ActiveGame {
  return {
    id: 'g1',
    organizationId: 'o1',
    teamId: 't1',
    phase: 'tracking',
    players: PLAYERS,
    opponent: 'Tegenstander',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: [...START],
    curQuarter: 1,
    beginSec: 600,
    endSec: 600,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:05:00.000Z',
    ...overrides,
  };
}

function withActions(game: ActiveGame, ...actions: GameAction[]): ActiveGame {
  return { ...game, actions: [...game.actions, ...actions] };
}

/** Eén wissel in het concept: `out` van de vloer, `inn` erin; snapshot van de oude vijf blijft behouden. */
function swap(game: ActiveGame, out: string, inn: string): ActiveGame {
  return {
    ...game,
    onCourt: swapOnCourt(game.onCourt, out, inn),
    pendingSwapLineup: game.pendingSwapLineup ?? game.onCourt,
  };
}

function commit(game: ActiveGame, plan: RotationPlan | null = null, endSec?: number) {
  const result = commitSwapWithProvisionalTime(game, {
    plan,
    endSec,
    classification: CLASS_OFF,
  });
  if (!result.ok) throw new Error(`onverwachte fout: ${result.error}`);
  return result;
}

function ids(game: ActiveGame): string[] {
  return deriveGameHistory(game).segments.map((s) => s.id);
}

/** Schema: kwart 1 wisselt om 8:00 (480 s) naar START met Noa (#12) voor Sam (#7). */
function planQ1(): RotationPlan {
  return {
    quarters: {
      '1': [
        { toSec: 480, lineup: [4, 7, 9, 11, 13] },
        { toSec: 0, lineup: [4, 12, 9, 11, 13] },
      ],
    },
  };
}

describe('proposeSwapTime — voorstelwaarde', () => {
  it('neemt de schematijd als die er is', () => {
    expect(proposeSwapTime(makeGame(), planQ1())).toEqual({ endSec: 480, source: 'plan' });
  });

  it('zonder schema: vorige wissel + 1:00 (aflopende klok: 600 -> 540)', () => {
    expect(proposeSwapTime(makeGame(), null)).toEqual({ endSec: 540, source: 'estimate' });
    expect(proposeSwapTime(makeGame({ beginSec: 250 }), null).endSec).toBe(190);
  });

  it('wordt begrensd tot het einde van het kwart (aflopend 0, oplopend 600)', () => {
    expect(proposeSwapTime(makeGame({ beginSec: 30 }), null).endSec).toBe(0);
    expect(proposeSwapTime(makeGame({ beginSec: 0 }), null).endSec).toBe(0);
    expect(proposeSwapTime(makeGame({ clockDown: false, beginSec: 0 }), null).endSec).toBe(60);
    expect(proposeSwapTime(makeGame({ clockDown: false, beginSec: 570 }), null).endSec).toBe(600);
  });

  it('S12 verlenging: kwart zonder schemablok valt terug op vorige wissel + 1:00', () => {
    const overtime = makeGame({ curQuarter: 5, beginSec: 600 });
    expect(proposeSwapTime(overtime, planQ1())).toEqual({ endSec: 540, source: 'estimate' });
  });

  it('een schematijd die niet na het begin ligt wordt genegeerd', () => {
    // Open segment begint al op 7:00 (420), schema wisselde om 8:00 (480): niet bruikbaar.
    const late = makeGame({ beginSec: 420, endSec: 420 });
    expect(proposeSwapTime(late, planQ1())).toEqual({ endSec: 360, source: 'estimate' });
  });
});

describe('commitSwapWithProvisionalTime', () => {
  it('S1: wissel op de schematijd — één stap, tijd = schematijd, meteen bevestigd', () => {
    // 600 -> 480 = 120 s, +2 voor, 1 turnover, +1 tegen.
    let g = withActions(
      makeGame(),
      scoreDeltaAction('for', 2),
      turnoverDeltaAction(1),
      scoreDeltaAction('against', 1),
    );
    g = swap(g, 'p7', 'p12');
    const r = commit(g, planQ1());
    expect(r.timeSource).toBe('plan');
    expect(r.needsConfirmation).toBe(false);
    expect(r.endSec).toBe(480);
    expect(r.segmentId).not.toBeNull();
    const h = deriveGameHistory(r.game);
    expect(h.segments).toHaveLength(1);
    const s = h.segments[0]!;
    expect([s.beginSec, s.endSec, s.durSec, s.pf, s.pa, s.tov]).toEqual([600, 480, 120, 2, 1, 1]);
    expect(s.lineup).toEqual(START);
    expect(r.game.onCourt).toEqual(['p4', 'p12', 'p9', 'p11', 'p13']);
    expect(r.game.beginSec).toBe(480);
    expect(r.game.pendingSwapLineup).toBeNull();
    expect(r.lastActionId).toBe(r.game.actions[r.game.actions.length - 1]?.id);
  });

  it('zonder schema: schatting 540 s, moet nog bevestigd worden; punten kloppen meteen', () => {
    const g = swap(withActions(makeGame(), scoreDeltaAction('for', 4)), 'p7', 'p12');
    const r = commit(g);
    expect(r.timeSource).toBe('estimate');
    expect(r.needsConfirmation).toBe(true);
    const s = deriveGameHistory(r.game).segments[0]!;
    expect([s.endSec, s.durSec, s.pf]).toEqual([540, 60, 4]);
  });

  it('een expliciete tijd geldt als gegeven en hoeft niet bevestigd te worden', () => {
    const r = commit(swap(makeGame(), 'p7', 'p12'), null, 500);
    expect(r.timeSource).toBe('given');
    expect(r.needsConfirmation).toBe(false);
    expect(r.endSec).toBe(500);
  });

  it('duur 0 (begin al op kwarteinde): geen segment, geen bevestiging nodig', () => {
    const g = swap(makeGame({ beginSec: 0, endSec: 0 }), 'p7', 'p12');
    const r = commit(g);
    expect(r.segmentId).toBeNull();
    expect(r.needsConfirmation).toBe(false);
    expect(r.game.pendingSwapLineup).toBeNull();
    expect(deriveGameHistory(r.game).segments).toHaveLength(0);
  });

  it('geeft de domeinfout door zonder wisselconcept', () => {
    const r = commitSwapWithProvisionalTime(makeGame(), { plan: null, classification: CLASS_OFF });
    expect(r).toEqual({ ok: false, error: 'no-pending-swap' });
  });
});

describe('confirmSwapTime', () => {
  it('S2: schematijd 480 later bijgesteld naar 450; beginSec van het open segment volgt', () => {
    const g0 = withActions(makeGame(), scoreDeltaAction('for', 2), turnoverDeltaAction(1));
    const committed = commit(swap(g0, 'p7', 'p12'), planQ1());
    const seg = committed.segmentId!;
    const result = confirmSwapTime(committed.game, seg, 450);
    if (!result.ok) throw new Error(result.error);
    const s = deriveGameHistory(result.game).segments[0]!;
    expect([s.beginSec, s.endSec, s.durSec]).toEqual([600, 450, 150]);
    expect(result.game.beginSec).toBe(450);
    expect(result.game.endSec).toBe(450);
    // Punten, turnovers, lineup en stand blijven ongemoeid.
    expect([s.pf, s.pa, s.tov]).toEqual([2, 0, 1]);
    expect(s.lineup).toEqual(START);
    const h = deriveGameHistory(result.game);
    expect([h.scoreFor, h.segStartFor, h.turnovers, h.segStartTurnovers]).toEqual([2, 2, 1, 1]);
    expect(openSegmentSummary(result.game).hasOpen).toBe(false);
    // Het log is append-only: precies één `segment-edited` erbij.
    expect(result.game.actions).toHaveLength(committed.game.actions.length + 1);
    expect(result.game.actions.at(-1)?.type).toBe('segment-edited');
  });

  it('S2: ook eerder dan gepland (510) en ongewijzigde tijd = zelfde game', () => {
    const committed = commit(swap(makeGame(), 'p7', 'p12'), planQ1());
    const earlier = confirmSwapTime(committed.game, committed.segmentId!, 510);
    if (!earlier.ok) throw new Error(earlier.error);
    expect(deriveGameHistory(earlier.game).segments[0]?.endSec).toBe(510);
    expect(earlier.game.beginSec).toBe(510);
    const same = confirmSwapTime(committed.game, committed.segmentId!, 480);
    expect(same).toEqual({ ok: true, game: committed.game });
  });

  it('weigert duur 0, negatieve duur, ongeldige klok en onbekend segment', () => {
    const committed = commit(swap(makeGame(), 'p7', 'p12'), planQ1());
    const seg = committed.segmentId!;
    expect(confirmSwapTime(committed.game, seg, 600)).toEqual({
      ok: false,
      error: 'invalid-duration',
    });
    expect(confirmSwapTime(committed.game, seg, 601)).toEqual({
      ok: false,
      error: 'invalid-clock',
    });
    expect(confirmSwapTime(committed.game, seg, -1)).toEqual({ ok: false, error: 'invalid-clock' });
    expect(confirmSwapTime(committed.game, seg, 12.5)).toEqual({
      ok: false,
      error: 'invalid-clock',
    });
    expect(confirmSwapTime(committed.game, 'bestaat-niet', 500)).toEqual({
      ok: false,
      error: 'unknown-segment',
    });
  });

  it('een tijd na de huidige tijd (nowSec) wordt geweigerd; precies de huidige tijd mag', () => {
    const committed = commit(swap(makeGame(), 'p7', 'p12'), null); // schatting 540
    const seg = committed.segmentId!;
    expect(swapTimeBounds(committed.game, seg, 500)).toEqual({ min: 500, max: 599 });
    expect(confirmSwapTime(committed.game, seg, 490, 500)).toEqual({
      ok: false,
      error: 'invalid-duration',
    });
    const exact = confirmSwapTime(committed.game, seg, 500, 500);
    expect(exact.ok).toBe(true);
  });

  it('oplopende klok: grenzen gespiegeld', () => {
    const g = swap(makeGame({ clockDown: false, beginSec: 0, endSec: 0 }), 'p7', 'p12');
    const committed = commit(g); // 0 -> 60
    const seg = committed.segmentId!;
    expect(deriveGameHistory(committed.game).segments[0]?.endSec).toBe(60);
    expect(swapTimeBounds(committed.game, seg, 200)).toEqual({ min: 1, max: 200 });
    const moved = confirmSwapTime(committed.game, seg, 90, 200);
    if (!moved.ok) throw new Error(moved.error);
    expect(moved.game.beginSec).toBe(90);
    expect(confirmSwapTime(committed.game, seg, 0, 200)).toEqual({
      ok: false,
      error: 'invalid-duration',
    });
  });

  it('S6: twee wissels vlak na elkaar — volgorde blijft geldig, grenzen 481..599', () => {
    // Wissel 1: Sam -> Noa, schatting 540. +3 voor. Wissel 2: Robin -> Bo, schatting 480.
    let g = swap(makeGame(), 'p7', 'p12');
    const first = commit(g);
    g = withActions(first.game, scoreDeltaAction('for', 3));
    const second = commit(swap(g, 'p9', 'p6'));
    expect(second.endSec).toBe(480);
    const [seg1, seg2] = [first.segmentId!, second.segmentId!];
    expect(pendingTimeConfirmations(second.game, [seg2, seg1]).map((s) => s.id)).toEqual([
      seg1,
      seg2,
    ]);

    expect(swapTimeBounds(second.game, seg1)).toEqual({ min: 481, max: 599 });
    // Wissel 1 mag niet tot of voorbij het einde van segment 2 schuiven.
    expect(confirmSwapTime(second.game, seg1, 480)).toEqual({
      ok: false,
      error: 'invalid-duration',
    });
    expect(confirmSwapTime(second.game, seg1, 470)).toEqual({
      ok: false,
      error: 'invalid-duration',
    });
    // Tot 481 mag wel; segment 2 begint dan daar (segment-edited op het volgende segment).
    const moved = confirmSwapTime(second.game, seg1, 560);
    if (!moved.ok) throw new Error(moved.error);
    const segs = deriveGameHistory(moved.game).segments;
    expect([segs[0]?.beginSec, segs[0]?.endSec, segs[0]?.durSec]).toEqual([600, 560, 40]);
    expect([segs[1]?.beginSec, segs[1]?.endSec, segs[1]?.durSec]).toEqual([560, 480, 80]);
    expect(segs.map((s) => s.pf)).toEqual([0, 3]);
    // Open segment onaangeroerd; daarna wissel 2 (open successor) bijstellen tot de huidige tijd 450.
    expect(moved.game.beginSec).toBe(480);
    expect(swapTimeBounds(moved.game, seg2, 450)).toEqual({ min: 450, max: 559 });
    const later = confirmSwapTime(moved.game, seg2, 450, 450);
    if (!later.ok) throw new Error(later.error);
    expect(later.game.beginSec).toBe(450);
    // Totale speeltijd van de gespeelde segmenten = 600 - 450.
    const total = deriveGameHistory(later.game).segments.reduce((a, s) => a + s.durSec, 0);
    expect(total).toBe(150);
    expect(deriveGameHistory(later.game).scoreFor).toBe(3);
  });

  it('S10: einde kwart met open tijden — ze blijven bevestigbaar over de kwartgrens', () => {
    const first = commit(swap(makeGame(), 'p7', 'p12')); // 600 -> 540
    const second = commit(swap(first.game, 'p9', 'p6')); // 540 -> 480
    const [seg1, seg2] = [first.segmentId!, second.segmentId!];
    const closed = closeQuarter(second.game, {
      endSec: 0,
      nextQuarter: 2,
      quarterCount: 4,
      classification: CLASS_OFF,
    });
    if (!closed.ok) throw new Error(closed.error);
    const g = closed.game;
    expect(g.curQuarter).toBe(2);
    const segs = deriveGameHistory(g).segments;
    expect(segs).toHaveLength(3);
    expect([segs[2]?.beginSec, segs[2]?.endSec]).toEqual([480, 0]);
    // Onbekende id's (bijv. ongedaan gemaakt) vallen af, volgorde = wedstrijdvolgorde.
    expect(pendingTimeConfirmations(g, [seg2, 'weg', seg1]).map((s) => s.id)).toEqual([seg1, seg2]);
    // Segment 2 heeft nu een vastgelegd volgend segment (het kwarteindsegment): tijd 300.
    const moved = confirmSwapTime(g, seg2, 300);
    if (!moved.ok) throw new Error(moved.error);
    const after = deriveGameHistory(moved.game).segments;
    expect([after[1]?.endSec, after[2]?.beginSec, after[2]?.endSec]).toEqual([300, 300, 0]);
    expect(after.reduce((a, s) => a + s.durSec, 0)).toBe(600);
    // Het open segment van kwart 2 blijft onaangeroerd.
    expect(moved.game.beginSec).toBe(g.beginSec);
    expect(moved.game.curQuarter).toBe(2);
  });
});

describe('undoLastAction', () => {
  it('verifieert de reducer: segment-deleted zet segmentstart terug maar neemt de punten van het segment mee', () => {
    // Dit is de reden dat undo van een wissel de punten als deltas terugzet.
    const swapped = commit(swap(withActions(makeGame(), scoreDeltaAction('for', 5)), 'p7', 'p12'));
    const before = deriveGameHistory(swapped.game);
    expect([before.scoreFor, before.segStartFor]).toEqual([5, 5]);
    const afterDelete = applyAction(before, segmentDeletedAction(swapped.segmentId!));
    expect(afterDelete.segments).toHaveLength(0);
    expect([afterDelete.segStartFor, afterDelete.segStartTurnovers]).toEqual([0, 0]);
    expect(afterDelete.scoreFor).toBe(0);
  });

  it('S7: verkeerde speler ingetikt — vorige vijf, segmentstart en punten komen terug', () => {
    // +2 voor, 1 turnover, wissel Sam -> Noa (schatting 540).
    const g0 = withActions(makeGame(), scoreDeltaAction('for', 2), turnoverDeltaAction(1));
    const swapped = commit(swap(g0, 'p7', 'p12'));
    const result = undoLastAction(swapped.game);
    if (!result.ok) throw new Error(result.error);
    const g = result.game;
    expect(g.onCourt).toEqual(START);
    expect(g.beginSec).toBe(600);
    expect(g.endSec).toBe(600);
    expect(g.curQuarter).toBe(1);
    expect(g.pendingSwapLineup).toBeNull();
    expect(result.undone).toEqual({
      kind: 'swap',
      segmentId: swapped.segmentId,
      ins: ['p7'],
      outs: ['p12'],
    });
    const h = deriveGameHistory(g);
    expect(h.segments).toHaveLength(0);
    expect([h.scoreFor, h.scoreAgainst, h.turnovers]).toEqual([2, 0, 1]);
    // Alles zit weer in het open segment.
    expect(openSegmentSummary(g)).toEqual({
      pointsFor: 2,
      pointsAgainst: 0,
      turnovers: 1,
      hasOpen: true,
    });
    expect(g.actions.length).toBeGreaterThan(swapped.game.actions.length);
    expect(g.actions.slice(0, swapped.game.actions.length)).toEqual(swapped.game.actions);
    // Opnieuw wisselen geeft hetzelfde segment (pf 2, tov 1) met de goede speler.
    const redo = commit(swap(g, 'p9', 'p6'));
    const s = deriveGameHistory(redo.game).segments[0]!;
    expect([s.pf, s.tov, s.endSec]).toEqual([2, 1, 540]);
    expect(s.lineup).toEqual(START);
  });

  it('S7: één niveau — na undo staat de knop uit tot er een nieuwe actie is', () => {
    const swapped = commit(swap(makeGame(), 'p7', 'p12'));
    const undone = undoLastAction(swapped.game);
    if (!undone.ok) throw new Error(undone.error);
    expect(undoLastAction(undone.game, undone.lastActionId)).toEqual({
      ok: false,
      error: 'nothing-to-undo',
    });
    expect(lastUndoableAction(undone.game, undone.lastActionId)).toBeNull();
    // Nieuwe actie: weer ongedaan te maken.
    const next = withActions(undone.game, scoreDeltaAction('against', 2));
    expect(lastUndoableAction(next, undone.lastActionId)).not.toBeNull();
  });

  it('score-delta en turnover-delta: tegengestelde delta, stand terug', () => {
    let g = withActions(makeGame(), scoreDeltaAction('for', 3), scoreDeltaAction('against', 2));
    const a = undoLastAction(g);
    if (!a.ok) throw new Error(a.error);
    expect(a.undone).toEqual({ kind: 'score', team: 'against', delta: 2 });
    expect(a.game.actions.at(-1)).toMatchObject({
      type: 'score-delta',
      team: 'against',
      delta: -2,
    });
    let h = deriveGameHistory(a.game);
    expect([h.scoreFor, h.scoreAgainst]).toEqual([3, 0]);

    g = withActions(makeGame(), turnoverDeltaAction(1), turnoverDeltaAction(1));
    const t = undoLastAction(g);
    if (!t.ok) throw new Error(t.error);
    expect(t.undone).toEqual({ kind: 'turnover', delta: 1 });
    h = deriveGameHistory(t.game);
    expect(h.turnovers).toBe(1);
    // Een −1 correctie wordt teruggedraaid naar +1.
    const minus = undoLastAction(
      withActions(makeGame(), scoreDeltaAction('for', 2), scoreDeltaAction('for', -1)),
    );
    if (!minus.ok) throw new Error(minus.error);
    expect(deriveGameHistory(minus.game).scoreFor).toBe(2);
  });

  it('niets te doen: leeg log, laatste actie is geen delta/wissel, of al teruggedraaid', () => {
    expect(undoLastAction(makeGame())).toEqual({ ok: false, error: 'nothing-to-undo' });
    const set = withActions(makeGame(), scoreSetAction('for', 4));
    expect(undoLastAction(set)).toEqual({ ok: false, error: 'nothing-to-undo' });
    const swapped = commit(swap(makeGame(), 'p7', 'p12'));
    const confirmed = confirmSwapTime(swapped.game, swapped.segmentId!, 500);
    if (!confirmed.ok) throw new Error(confirmed.error);
    // Laatste actie is een segment-edited: alleen de laatste actie telt.
    expect(undoLastAction(confirmed.game)).toEqual({ ok: false, error: 'nothing-to-undo' });
  });

  it('een wissel die een kwart afsloot is niet met één stap terug te draaien', () => {
    const swapped = commit(swap(makeGame(), 'p7', 'p12'));
    const closed = closeQuarter(swapped.game, {
      endSec: 0,
      nextQuarter: 2,
      quarterCount: 4,
      classification: CLASS_OFF,
    });
    if (!closed.ok) throw new Error(closed.error);
    expect(undoLastAction(closed.game)).toEqual({ ok: false, error: 'nothing-to-undo' });
  });
});

describe('wissel met terugwerkende kracht', () => {
  // Invoer sinds de vorige wissel (in volgorde): +2 voor, +3 voor, 1 turnover, +2 tegen.
  function forgotten() {
    const a1 = scoreDeltaAction('for', 2);
    const a2 = scoreDeltaAction('for', 3);
    const a3 = turnoverDeltaAction(1);
    const a4 = scoreDeltaAction('against', 2);
    const base = swap(withActions(makeGame(), a1, a2, a3, a4), 'p7', 'p12');
    return { base, a1, a2, a3, a4 };
  }

  it('S9: lijst in volgorde van invoer', () => {
    const { base, a1, a2, a3, a4 } = forgotten();
    const entries = retroSwapEntries(base);
    expect(entries?.map((e) => e.actionId)).toEqual([a1.id, a2.id, a3.id, a4.id]);
    expect(entries?.map((e) => [e.kind, e.team, e.delta])).toEqual([
      ['score', 'for', 2],
      ['score', 'for', 3],
      ['turnover', undefined, 1],
      ['score', 'against', 2],
    ]);
  });

  it('S9: grens na +3 voor — oude lineup krijgt 5-0 TO0, nieuwe krijgt TO1 en 0-2; totalen gelijk', () => {
    const { base, a2 } = forgotten();
    const result = commitRetroactiveSwap(base, {
      endSec: 400,
      lastOldActionId: a2.id,
      classification: CLASS_OFF,
    });
    if (!result.ok) throw new Error(result.error);
    const g = result.game;
    const h = deriveGameHistory(g);
    expect(h.segments).toHaveLength(1);
    const s = h.segments[0]!;
    expect([s.beginSec, s.endSec, s.durSec, s.pf, s.pa, s.tov]).toEqual([600, 400, 200, 5, 0, 0]);
    expect(s.lineup).toEqual(START);
    expect(s.id).toBe(result.segmentId);
    // Open segment van de nieuwe lineup: 0-2 en 1 turnover.
    expect(openSegmentSummary(g)).toMatchObject({ pointsFor: 0, pointsAgainst: 2, turnovers: 1 });
    // Totalen ongewijzigd: 5-2, TO 1.
    expect([h.scoreFor, h.scoreAgainst, h.turnovers]).toEqual([5, 2, 1]);
    expect(g.beginSec).toBe(400);
    expect(g.endSec).toBe(400);
    expect(g.pendingSwapLineup).toBeNull();
    expect(g.onCourt).toEqual(['p4', 'p12', 'p9', 'p11', 'p13']);
    // Append-only: het oude log is een prefix.
    expect(g.actions.slice(0, base.actions.length)).toEqual(base.actions);
    // Daarna sluit het volgende segment met de nieuwe lineup en de rest van de punten.
    const next = commit(swap(g, 'p9', 'p6'), null, 300);
    const s2 = deriveGameHistory(next.game).segments[1]!;
    expect([s2.pf, s2.pa, s2.tov, s2.durSec]).toEqual([0, 2, 1, 100]);
    expect(s2.lineup).toEqual(['p4', 'p12', 'p9', 'p11', 'p13']);
  });

  it('S9: grens ervoor (null) = alles voor de nieuwe lineup; grens na de laatste = alles oud', () => {
    const { base, a4 } = forgotten();
    const none = commitRetroactiveSwap(base, {
      endSec: 400,
      lastOldActionId: null,
      classification: CLASS_OFF,
    });
    if (!none.ok) throw new Error(none.error);
    const s0 = deriveGameHistory(none.game).segments[0]!;
    expect([s0.pf, s0.pa, s0.tov]).toEqual([0, 0, 0]);
    expect(openSegmentSummary(none.game)).toMatchObject({
      pointsFor: 5,
      pointsAgainst: 2,
      turnovers: 1,
    });

    const all = commitRetroactiveSwap(base, {
      endSec: 400,
      lastOldActionId: a4.id,
      classification: CLASS_OFF,
    });
    if (!all.ok) throw new Error(all.error);
    const s1 = deriveGameHistory(all.game).segments[0]!;
    expect([s1.pf, s1.pa, s1.tov]).toEqual([5, 2, 1]);
    expect(openSegmentSummary(all.game).hasOpen).toBe(false);
    expect(deriveGameHistory(all.game).scoreFor).toBe(5);
  });

  it('S9: bouwt voort op een eerder segment; alleen acties sinds de vorige wissel tellen', () => {
    // Eerst een gewone wissel (+4 voor, 540), dan nog +1 voor en +2 tegen, vergeten wissel.
    const first = commit(swap(withActions(makeGame(), scoreDeltaAction('for', 4)), 'p7', 'p12'));
    const x = scoreDeltaAction('for', 1);
    const y = scoreDeltaAction('against', 2);
    const g0 = swap(withActions(first.game, x, y), 'p9', 'p6');
    expect(retroSwapEntries(g0)?.map((e) => e.actionId)).toEqual([x.id, y.id]);
    const r = commitRetroactiveSwap(g0, {
      endSec: 450,
      lastOldActionId: x.id,
      classification: CLASS_OFF,
    });
    if (!r.ok) throw new Error(r.error);
    const segs = deriveGameHistory(r.game).segments;
    expect([segs[1]?.beginSec, segs[1]?.endSec, segs[1]?.pf, segs[1]?.pa]).toEqual([
      540, 450, 1, 0,
    ]);
    expect(openSegmentSummary(r.game)).toMatchObject({ pointsFor: 0, pointsAgainst: 2 });
    expect(deriveGameHistory(r.game).scoreFor).toBe(5);
  });

  it('weigert: geen concept, tijd niet na het begin, onbekende grens, score-set in het venster', () => {
    const { base, a2 } = forgotten();
    const ok = { lastOldActionId: a2.id, classification: CLASS_OFF };
    expect(commitRetroactiveSwap(makeGame(), { endSec: 400, ...ok })).toEqual({
      ok: false,
      error: 'no-pending-swap',
    });
    expect(commitRetroactiveSwap(base, { endSec: 600, ...ok })).toEqual({
      ok: false,
      error: 'invalid-duration',
    });
    expect(commitRetroactiveSwap(base, { endSec: 700, ...ok })).toEqual({
      ok: false,
      error: 'invalid-clock',
    });
    expect(
      commitRetroactiveSwap(base, {
        endSec: 400,
        lastOldActionId: 'bestaat-niet',
        classification: CLASS_OFF,
      }),
    ).toEqual({ ok: false, error: 'invalid-split' });
    const withSet = withActions(base, scoreSetAction('for', 9));
    expect(retroSwapEntries(withSet)).toBeNull();
    expect(commitRetroactiveSwap(withSet, { endSec: 400, ...ok })).toEqual({
      ok: false,
      error: 'invalid-split',
    });
  });

  it('na de gesplitste wissel blijft undo uit via lastActionId, en bevestigen van de tijd werkt', () => {
    const { base, a2 } = forgotten();
    const r = commitRetroactiveSwap(base, {
      endSec: 400,
      lastOldActionId: a2.id,
      classification: CLASS_OFF,
    });
    if (!r.ok) throw new Error(r.error);
    expect(lastUndoableAction(r.game, r.lastActionId)).toBeNull();
    const moved = confirmSwapTime(r.game, r.segmentId, 380, 380);
    if (!moved.ok) throw new Error(moved.error);
    expect(moved.game.beginSec).toBe(380);
    expect(deriveGameHistory(moved.game).segments[0]?.durSec).toBe(220);
  });
});

describe('S13: herladen midden in een kwart', () => {
  it('het game-object overleeft JSON-roundtrip; open tijden blijven te bevestigen', () => {
    const first = commit(swap(withActions(makeGame(), scoreDeltaAction('for', 2)), 'p7', 'p12'));
    const second = commit(swap(first.game, 'p9', 'p6'));
    const stored = [first.segmentId!, second.segmentId!];
    const reloaded = JSON.parse(JSON.stringify(second.game)) as ActiveGame;
    expect(pendingTimeConfirmations(reloaded, stored).map((s) => s.id)).toEqual(stored);
    const result = confirmSwapTime(reloaded, first.segmentId!, 570);
    if (!result.ok) throw new Error(result.error);
    expect(deriveGameHistory(result.game).segments[1]?.beginSec).toBe(570);
    expect(deriveGameHistory(result.game).scoreFor).toBe(2);
  });
});

describe('afleiding blijft consistent met de reducer', () => {
  it('EMPTY_HISTORY wordt niet gemuteerd door de commando’s', () => {
    const before = JSON.stringify(EMPTY_HISTORY);
    commit(swap(makeGame(), 'p7', 'p12'));
    expect(JSON.stringify(EMPTY_HISTORY)).toBe(before);
    expect(ids(commit(swap(makeGame(), 'p7', 'p12')).game)).toHaveLength(1);
  });
});
