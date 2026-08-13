import { describe, it, expect } from 'vitest';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';
import { MAX_CLOCK_SECONDS, MAX_SCORE } from '../../src/domain/game/types';
import {
  applyAction,
  buildSegment,
  canSaveSegment,
  deriveGameHistory,
  initialClockSeconds,
  isOverLimit,
  limitVal,
  playerBonus,
  scoreDeltaAction,
  scoreSetAction,
  segDur,
  segmentDeletedAction,
  segmentEditedAction,
  segmentSavedAction,
  selectQuarter,
  sumBonus,
  sumClass,
  swapOnCourt,
  type ClassificationConfig,
  type DerivedGameHistory,
} from '../../src/domain/game/tracking';

function player(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    id: 'p1',
    rosterId: 1,
    nr: '1',
    naam: 'Speler',
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: false,
    ...overrides,
  };
}

function game(overrides: Partial<ActiveGame> = {}): ActiveGame {
  return {
    id: 'game-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: [],
    opponent: '',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: [],
    curQuarter: 1,
    beginSec: MAX_CLOCK_SECONDS,
    endSec: MAX_CLOCK_SECONDS,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:05:00.000Z',
    ...overrides,
  };
}

const classOn: ClassificationConfig = {
  useClassLimit: true,
  classBaseLimit: 14.5,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1.0,
  bonusBoth: 2.0,
};

const classOff: ClassificationConfig = { ...classOn, useClassLimit: false };

function history(overrides: Partial<DerivedGameHistory> = {}): DerivedGameHistory {
  return {
    scoreFor: 0,
    scoreAgainst: 0,
    segStartFor: 0,
    segStartAgainst: 0,
    segments: [],
    ...overrides,
  };
}

describe('domain/game/tracking — classificatie', () => {
  it('playerBonus: vrouw+jeugd = bonusBoth, vrouw-only = bonusTag1Only, jeugd-only = bonusTag2Only, geen van beide = 0', () => {
    expect(playerBonus(player({ vrouw: true, jeugd: true }), classOn)).toBe(2.0);
    expect(playerBonus(player({ vrouw: true, jeugd: false }), classOn)).toBe(1.5);
    expect(playerBonus(player({ vrouw: false, jeugd: true }), classOn)).toBe(1.0);
    expect(playerBonus(player({ vrouw: false, jeugd: false }), classOn)).toBe(0);
  });

  it('playerBonus is 0 zonder classificatiesysteem of zonder speler', () => {
    expect(playerBonus(player({ vrouw: true, jeugd: true }), classOff)).toBe(0);
    expect(playerBonus(undefined, classOn)).toBe(0);
  });

  it('limitVal valt terug op classBaseLimit bij niet-numerieke limitStr', () => {
    expect(limitVal(game({ limitStr: 'niet-een-getal' }), classOn)).toBe(14.5);
    expect(limitVal(game({ limitStr: '16.0' }), classOn)).toBe(16.0);
    expect(limitVal(game({ limitStr: '16.0' }), classOff)).toBe(0);
  });

  it('sumClass/sumBonus zijn 0 zonder classificatiesysteem', () => {
    const g = game({ players: [player({ id: 'a', kl: '3.0' })] });
    expect(sumClass(g, ['a'], classOff)).toBe(0);
    expect(sumBonus(g, ['a'], classOff)).toBe(0);
  });

  it('sumClass telt de kl-waarden van de opgegeven lineup op', () => {
    const g = game({
      players: [player({ id: 'a', kl: '3.0' }), player({ id: 'b', kl: '2.5' })],
    });
    expect(sumClass(g, ['a', 'b'], classOn)).toBeCloseTo(5.5);
  });

  it('sumBonus is begrensd door maxBonus', () => {
    const g = game({
      players: [
        player({ id: 'a', vrouw: true, jeugd: true }),
        player({ id: 'b', vrouw: true, jeugd: true }),
      ],
    });
    // 2 × bonusBoth (2.0) = 4.0, maar maxBonus = 2.5
    expect(sumBonus(g, ['a', 'b'], classOn)).toBe(2.5);
  });

  it('isOverLimit markeert over pas boven allowed + 0.001 (afrondingstolerantie)', () => {
    const g = game({ limitStr: '5', players: [player({ id: 'a', kl: '5.0' })] });
    expect(isOverLimit(g, ['a'], classOn).over).toBe(false);
    const g2 = game({ limitStr: '5', players: [player({ id: 'a', kl: '5.01' })] });
    expect(isOverLimit(g2, ['a'], classOn).over).toBe(true);
  });
});

describe('domain/game/tracking — segDur/canSaveSegment', () => {
  it('clockDown=true: duur = begin - eind (klok telt af)', () => {
    expect(segDur(game({ clockDown: true, beginSec: 600, endSec: 540 }))).toBe(60);
  });

  it('clockDown=false: duur = eind - begin (klok telt op)', () => {
    expect(segDur(game({ clockDown: false, beginSec: 0, endSec: 60 }))).toBe(60);
  });

  it('canSaveSegment vereist positieve duur én exact 5 spelers', () => {
    expect(canSaveSegment(60, ['a', 'b', 'c', 'd', 'e'])).toBe(true);
    expect(canSaveSegment(0, ['a', 'b', 'c', 'd', 'e'])).toBe(false);
    expect(canSaveSegment(-10, ['a', 'b', 'c', 'd', 'e'])).toBe(false);
    expect(canSaveSegment(60, ['a', 'b', 'c', 'd'])).toBe(false);
  });
});

describe('domain/game/tracking — selectQuarter', () => {
  it('reset begin/eind alleen bij een daadwerkelijke wisseling van kwart', () => {
    const g = game({ clockDown: true, curQuarter: 1, beginSec: 300, endSec: 200 });
    expect(selectQuarter(g, 1)).toEqual({ curQuarter: 1, beginSec: 300, endSec: 200 });
    expect(selectQuarter(g, 2)).toEqual({
      curQuarter: 2,
      beginSec: MAX_CLOCK_SECONDS,
      endSec: MAX_CLOCK_SECONDS,
    });
  });

  it('gebruikt 0 als startpunt wanneer de klok optelt', () => {
    const g = game({ clockDown: false, curQuarter: 1, beginSec: 0, endSec: 30 });
    expect(selectQuarter(g, 2)).toEqual({ curQuarter: 2, beginSec: 0, endSec: 0 });
  });

  it('initialClockSeconds spiegelt de klokrichting', () => {
    expect(initialClockSeconds(true)).toBe(MAX_CLOCK_SECONDS);
    expect(initialClockSeconds(false)).toBe(0);
  });
});

describe('domain/game/tracking — applyAction', () => {
  it('score-delta telt op en klemt tussen 0 en MAX_SCORE', () => {
    const s = applyAction(history({ scoreFor: 0 }), scoreDeltaAction('for', 3));
    expect(s.scoreFor).toBe(3);
    const clampedLow = applyAction(history({ scoreFor: 0 }), scoreDeltaAction('for', -5));
    expect(clampedLow.scoreFor).toBe(0);
    const clampedHigh = applyAction(
      history({ scoreAgainst: MAX_SCORE }),
      scoreDeltaAction('against', 10),
    );
    expect(clampedHigh.scoreAgainst).toBe(MAX_SCORE);
  });

  it('score-set overschrijft absoluut en klemt', () => {
    const s = applyAction(history({ scoreFor: 10 }), scoreSetAction('for', 25));
    expect(s.scoreFor).toBe(25);
    const clamped = applyAction(history(), scoreSetAction('against', -3));
    expect(clamped.scoreAgainst).toBe(0);
  });

  it('segment-saved voegt het segment toe en verschuift segStart naar de huidige score', () => {
    const g = game();
    const segment = buildSegment(g, 1, 600, 540, ['a', 'b', 'c', 'd', 'e'], 4, 2, classOff);
    const start = history({ scoreFor: 4, scoreAgainst: 2 });
    const next = applyAction(start, segmentSavedAction(segment));
    expect(next.segments).toHaveLength(1);
    expect(next.segStartFor).toBe(4);
    expect(next.segStartAgainst).toBe(2);
  });

  it('segment-edited herberekent scoreFor/Against met behoud van de nog-niet-opgeslagen live-delta (v1: recalcRunningScore)', () => {
    const g = game();
    const original = buildSegment(g, 1, 600, 540, ['a', 'b', 'c', 'd', 'e'], 4, 2, classOff);
    // Eerst de score naar 4 brengen (zoals v1 vóór het opslaan van het segment zou doen —
    // segment.pf claimt immers dat er 4 punten vielen), dan pas het segment sluiten.
    let state = applyAction(history(), scoreDeltaAction('for', 4));
    state = applyAction(state, segmentSavedAction(original));
    // Extra, nog niet in een segment vastgelegde score sinds het segment (de "live" delta).
    state = applyAction(state, scoreDeltaAction('for', 3));
    expect(state.scoreFor).toBe(7); // 4 (segment) + 3 (live)

    const edited = { ...original, pf: 10 }; // was 4, wordt 10
    state = applyAction(state, segmentEditedAction(original.id, edited));
    expect(state.segments[0]?.pf).toBe(10);
    expect(state.segStartFor).toBe(10);
    expect(state.scoreFor).toBe(13); // 10 (nieuwe segmentsom) + 3 (behouden live-delta)
  });

  it('segment-deleted verwijdert het segment en herberekent de score op dezelfde manier', () => {
    const g = game();
    const segment = buildSegment(g, 1, 600, 540, ['a', 'b', 'c', 'd', 'e'], 4, 2, classOff);
    let state = applyAction(history(), scoreDeltaAction('for', 4));
    state = applyAction(state, segmentSavedAction(segment));
    state = applyAction(state, scoreDeltaAction('for', 1)); // live delta na het segment
    state = applyAction(state, segmentDeletedAction(segment.id));
    expect(state.segments).toHaveLength(0);
    expect(state.segStartFor).toBe(0);
    expect(state.scoreFor).toBe(1); // 0 (geen segmenten meer) + 1 (live-delta blijft behouden)
    expect(state.scoreAgainst).toBe(0);
  });
});

describe('domain/game/tracking — deriveGameHistory (handmatig narekenbaar scenario)', () => {
  it('reproduceert score en segmenten exact uit een reeks acties', () => {
    // Scenario: kwart 1, twee segmenten van elk 5 minuten (klok telt af vanaf 10:00),
    // score 4-2 in segment 1, 3-1 in segment 2, plus een losse correctie erna.
    const g = game({
      clockDown: true,
      players: [1, 2, 3, 4, 5, 6].map((n) =>
        player({ id: `p${n}`, rosterId: n, nr: String(n), naam: `Speler ${n}` }),
      ),
    });
    const lineup1 = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const lineup2 = ['p1', 'p2', 'p3', 'p4', 'p6']; // p5 → p6 gewisseld

    const seg1 = buildSegment(g, 1, 600, 300, lineup1, 4, 2, classOff);
    const seg2 = buildSegment(g, 1, 300, 0, lineup2, 3, 1, classOff);

    const actions = [
      scoreDeltaAction('for', 2),
      scoreDeltaAction('for', 2), // 0 → 4 voor
      scoreDeltaAction('against', 2), // 0 → 2 tegen
      segmentSavedAction(seg1), // segment 1 sluit af: 5 min, 4-2
      scoreDeltaAction('for', 3), // 4 → 7 voor (live sinds seg1)
      scoreDeltaAction('against', 1), // 2 → 3 tegen
      segmentSavedAction(seg2), // segment 2 sluit af: 5 min, 3-1
      scoreDeltaAction('for', 1), // losse correctie ná segment 2
    ];

    const final = deriveGameHistory({ ...g, actions });

    expect(final.segments).toHaveLength(2);
    expect(final.segments[0]?.durSec).toBe(300);
    expect(final.segments[1]?.durSec).toBe(300);

    // Score = som van segmentpunten + de laatste, nog niet opgeslagen correctie.
    expect(final.scoreFor).toBe(4 + 3 + 1);
    expect(final.scoreAgainst).toBe(2 + 1);

    // Totale gespeelde tijd (som van segmentduur) = 10 minuten.
    const totalPlayedSec = final.segments.reduce((a, s) => a + s.durSec, 0);
    expect(totalPlayedSec).toBe(600);

    // Plus/min per segment = pf - pa.
    expect(final.segments[0]!.pf - final.segments[0]!.pa).toBe(2);
    expect(final.segments[1]!.pf - final.segments[1]!.pa).toBe(2);
  });
});

describe('domain/game/tracking — swapOnCourt', () => {
  it('verwisselt precies het opgegeven court/bank-paar', () => {
    const onCourt = ['a', 'b', 'c', 'd', 'e'];
    const next = swapOnCourt(onCourt, 'b', 'f');
    expect(next).toEqual(['a', 'f', 'c', 'd', 'e']);
    expect(onCourt).toEqual(['a', 'b', 'c', 'd', 'e']); // origineel blijft ongemoeid
  });
});

describe('domain/game/tracking — actiebouwers geven unieke ID’s', () => {
  it('elke actie krijgt een eigen id', () => {
    const seg = buildSegment(game(), 1, 600, 540, ['a', 'b', 'c', 'd', 'e'], 0, 0, classOff);
    const ids = new Set([
      scoreDeltaAction('for', 1).id,
      scoreSetAction('for', 1).id,
      segmentSavedAction(seg).id,
      segmentEditedAction('seg-1', seg).id,
      segmentDeletedAction('seg-1').id,
    ]);
    expect(ids.size).toBe(5);
  });
});
