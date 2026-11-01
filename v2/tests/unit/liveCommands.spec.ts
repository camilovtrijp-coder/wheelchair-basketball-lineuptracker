import { describe, expect, it } from 'vitest';
import {
  clockDuration,
  closeQuarter,
  commitSegment,
  confirmSwap,
  discardSwaps,
  editSegment,
  isValidClockSeconds,
  maxSecondsForMinutes,
  segmentScoreBounds,
  setScore,
  type LiveCommandResult,
} from '../../src/domain/game/liveCommands';
import { canFinishGame } from '../../src/domain/game/finish';
import {
  deriveGameHistory,
  scoreDeltaAction,
  swapOnCourt,
  turnoverDeltaAction,
  type ClassificationConfig,
} from '../../src/domain/game/tracking';
import type { ActiveGame, GamePlayer, GameAction } from '../../src/domain/game/types';
import { secondsMaxOf, withMinutes, withSeconds } from '../../src/ui/game/LiveTrackingPanel';

// Fictieve spelers: op de vloer #4 Alex, #7 Sam, #9 Robin, #11 Kim, #13 Dani;
// bank #6 Bo, #12 Noa, #15 Jules.
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

function ok(result: LiveCommandResult): ActiveGame {
  if (!result.ok) throw new Error(`onverwachte fout: ${result.error}`);
  return result.game;
}

function withActions(game: ActiveGame, ...actions: GameAction[]): ActiveGame {
  return { ...game, actions: [...game.actions, ...actions] };
}

function swap(game: ActiveGame, out: string, inn: string): ActiveGame {
  return {
    ...game,
    onCourt: swapOnCourt(game.onCourt, out, inn),
    pendingSwapLineup: game.pendingSwapLineup ?? game.onCourt,
  };
}

describe('liveCommands — bouwplanscenario A–D (handmatig narekenbaar)', () => {
  it('geeft 210 s 8-6 TO2, 210 s 4-4 TO1 en 180 s 4-2 TO0; totaal 600 s, +4, TO 3', () => {
    // A: Q1 aftellend 10:00, lineup 4/7/9/11/13, stand 0-0.
    let g = makeGame();

    // B: 2 turnovers; bij 6:30 stand 8-6; wissel 7 -> 12.
    g = withActions(g, turnoverDeltaAction(1), turnoverDeltaAction(1));
    g = swap(g, 'p7', 'p12');
    g = ok(
      confirmSwap(g, { endSec: 390, scoreFor: 8, scoreAgainst: 6, classification: CLASS_OFF }),
    );
    expect(g.beginSec).toBe(390);
    expect(g.endSec).toBe(390);
    expect(g.pendingSwapLineup).toBeNull();
    expect(g.onCourt).toEqual(['p4', 'p12', 'p9', 'p11', 'p13']);
    let h = deriveGameHistory(g);
    expect(h.segments).toHaveLength(1);
    expect(h.segments[0]).toMatchObject({
      quarter: 1,
      beginSec: 600,
      endSec: 390,
      durSec: 210,
      lineup: START,
      pf: 8,
      pa: 6,
      tov: 2,
    });
    expect(h.turnovers - h.segStartTurnovers).toBe(0);

    // C: bij 3:00 stand 12-10, 1 TO; wissel 4 -> 6 en 11 -> 15 samen = één segment.
    g = withActions(g, turnoverDeltaAction(1));
    g = swap(g, 'p4', 'p6');
    g = swap(g, 'p11', 'p15');
    expect(g.pendingSwapLineup).toEqual(['p4', 'p12', 'p9', 'p11', 'p13']);
    g = ok(
      confirmSwap(g, { endSec: 180, scoreFor: 12, scoreAgainst: 10, classification: CLASS_OFF }),
    );
    h = deriveGameHistory(g);
    expect(h.segments).toHaveLength(2);
    expect(h.segments[1]).toMatchObject({
      beginSec: 390,
      endSec: 180,
      durSec: 210,
      lineup: ['p4', 'p12', 'p9', 'p11', 'p13'],
      pf: 4,
      pa: 4,
      tov: 1,
    });
    expect(g.onCourt).toEqual(['p6', 'p12', 'p9', 'p15', 'p13']);

    // D: sluit Q1 op 0:00, stand 16-12, 0 TO. Rondt NIET af.
    g = ok(
      closeQuarter(g, {
        endSec: 0,
        scoreFor: 16,
        scoreAgainst: 12,
        nextQuarter: 2,
        quarterCount: 4,
        classification: CLASS_OFF,
      }),
    );
    h = deriveGameHistory(g);
    expect(h.segments).toHaveLength(3);
    expect(h.segments[2]).toMatchObject({
      beginSec: 180,
      endSec: 0,
      durSec: 180,
      lineup: ['p6', 'p12', 'p9', 'p15', 'p13'],
      pf: 4,
      pa: 2,
      tov: 0,
    });
    expect(h.segments.reduce((a, s) => a + s.durSec, 0)).toBe(600);
    expect(h.segments.reduce((a, s) => a + (s.pf - s.pa), 0)).toBe(4);
    expect(h.segments.reduce((a, s) => a + (s.tov ?? 0), 0)).toBe(3);
    expect(h.scoreFor).toBe(16);
    expect(h.scoreAgainst).toBe(12);
    // selectQuarter in dezelfde overgang: Q2, klok terug op 10:00.
    expect(g.curQuarter).toBe(2);
    expect(g.beginSec).toBe(600);
    expect(g.endSec).toBe(600);
    expect(g.pendingSwapLineup).toBeNull();
    // Geen automatische afronding: de game blijft een tracking-ActiveGame.
    expect(g.phase).toBe('tracking');
    expect(canFinishGame(g)).toBe(true);
  });

  it('segmentScoreBounds geeft de cumulatieve begin-/eindstand per segment', () => {
    let g = makeGame();
    g = ok(
      commitSegment(g, { endSec: 390, scoreFor: 8, scoreAgainst: 6, classification: CLASS_OFF }),
    );
    g = ok(
      commitSegment(g, { endSec: 180, scoreFor: 12, scoreAgainst: 10, classification: CLASS_OFF }),
    );
    g = ok(
      commitSegment(g, { endSec: 0, scoreFor: 16, scoreAgainst: 12, classification: CLASS_OFF }),
    );
    expect(segmentScoreBounds(deriveGameHistory(g).segments)).toEqual([
      { beginFor: 0, beginAgainst: 0, endFor: 8, endAgainst: 6 },
      { beginFor: 8, beginAgainst: 6, endFor: 12, endAgainst: 10 },
      { beginFor: 12, beginAgainst: 10, endFor: 16, endAgainst: 12 },
    ]);
  });
});

describe('liveCommands — commitSegment', () => {
  it('past de score-set en het segment in één overgang toe op de laatste state', () => {
    const g = makeGame();
    const next = ok(
      commitSegment(g, { endSec: 500, scoreFor: 5, scoreAgainst: 3, classification: CLASS_OFF }),
    );
    // Eén score-set per kant plus het segment; de invoer is niet gemuteerd.
    expect(next.actions.map((a) => a.type)).toEqual(['score-set', 'score-set', 'segment-saved']);
    expect(g.actions).toHaveLength(0);
    const seg = deriveGameHistory(next).segments[0];
    expect(seg).toMatchObject({ pf: 5, pa: 3, durSec: 100, tov: 0 });
  });

  it('voegt geen score-actie toe als de waarde niet verandert', () => {
    let g = makeGame();
    g = withActions(g, scoreDeltaAction('for', 2));
    const next = ok(
      commitSegment(g, { endSec: 500, scoreFor: 2, scoreAgainst: 0, classification: CLASS_OFF }),
    );
    expect(next.actions.map((a) => a.type)).toEqual(['score-delta', 'segment-saved']);
    expect(deriveGameHistory(next).segments[0]).toMatchObject({ pf: 2, pa: 0 });
  });

  it('gebruikt pendingSwapLineup als lineup, laat onCourt staan en zet begin = eind', () => {
    const g = swap(makeGame(), 'p7', 'p12');
    const next = ok(commitSegment(g, { endSec: 450, classification: CLASS_OFF }));
    expect(deriveGameHistory(next).segments[0]?.lineup).toEqual(START);
    expect(next.onCourt).toEqual(['p4', 'p12', 'p9', 'p11', 'p13']);
    expect(next.beginSec).toBe(450);
    expect(next.endSec).toBe(450);
    expect(next.pendingSwapLineup).toBeNull();
  });

  it('telt een ontbrekende tov (geen turnover-acties) als 0', () => {
    const next = ok(commitSegment(makeGame(), { endSec: 300, classification: CLASS_OFF }));
    expect(deriveGameHistory(next).segments[0]?.tov).toBe(0);
  });

  it('weigert een klok boven 10:00 en niet-gehele of negatieve tijden', () => {
    const g = makeGame({ clockDown: false, beginSec: 0, endSec: 0 });
    for (const endSec of [601, 659, -1, 30.5, Number.NaN]) {
      expect(commitSegment(g, { endSec, classification: CLASS_OFF })).toEqual({
        ok: false,
        error: 'invalid-clock',
      });
    }
    const oldBad = makeGame({ clockDown: true, beginSec: 659, endSec: 300 });
    expect(commitSegment(oldBad, { endSec: 300, classification: CLASS_OFF })).toEqual({
      ok: false,
      error: 'invalid-clock',
    });
    // 10:00 zelf is toegestaan (optellende klok).
    expect(commitSegment(g, { endSec: 600, classification: CLASS_OFF }).ok).toBe(true);
  });

  it('weigert negatieve punten en punten boven 150, zonder iets te wijzigen', () => {
    const g = makeGame();
    for (const bad of [-1, 151, 2.5]) {
      expect(commitSegment(g, { endSec: 500, scoreFor: bad, classification: CLASS_OFF })).toEqual({
        ok: false,
        error: 'invalid-score',
      });
    }
    expect(g.actions).toHaveLength(0);
  });

  it('weigert een eindstand onder de beginstand van het segment', () => {
    // Stand 8-6 vastgelegd, daarna -1 op eigen team: 7 < beginstand 8.
    let g = ok(
      commitSegment(makeGame(), {
        endSec: 400,
        scoreFor: 8,
        scoreAgainst: 6,
        classification: CLASS_OFF,
      }),
    );
    expect(commitSegment(g, { endSec: 300, scoreFor: 7, classification: CLASS_OFF })).toEqual({
      ok: false,
      error: 'score-below-segment-start',
    });
    g = withActions(g, scoreDeltaAction('against', -1));
    expect(commitSegment(g, { endSec: 300, classification: CLASS_OFF })).toEqual({
      ok: false,
      error: 'score-below-segment-start',
    });
  });

  it('weigert duur <= 0 en een lineup die geen 5 spelers heeft', () => {
    expect(commitSegment(makeGame(), { endSec: 600, classification: CLASS_OFF })).toEqual({
      ok: false,
      error: 'invalid-duration',
    });
    expect(commitSegment(makeGame(), { endSec: 700, classification: CLASS_OFF }).ok).toBe(false);
    expect(
      commitSegment(makeGame({ onCourt: START.slice(0, 4) }), {
        endSec: 300,
        classification: CLASS_OFF,
      }),
    ).toEqual({ ok: false, error: 'invalid-lineup' });
  });

  it('werkt ook met een optellende klok', () => {
    const g = makeGame({ clockDown: false, beginSec: 0, endSec: 0 });
    const next = ok(commitSegment(g, { endSec: 240, scoreFor: 3, classification: CLASS_OFF }));
    expect(deriveGameHistory(next).segments[0]).toMatchObject({ durSec: 240, pf: 3, pa: 0 });
    expect(clockDuration(false, 0, 240)).toBe(240);
  });
});

describe('liveCommands — wissel op 0 seconden (besluit 3)', () => {
  it('maakt zonder scorewijziging geen leeg segment en wist alleen het concept', () => {
    const g = swap(makeGame(), 'p7', 'p12');
    const next = ok(confirmSwap(g, { endSec: 600, classification: CLASS_OFF }));
    expect(next.actions).toHaveLength(0);
    expect(next.pendingSwapLineup).toBeNull();
    expect(next.onCourt).toEqual(['p4', 'p12', 'p9', 'p11', 'p13']);
    expect(next.beginSec).toBe(600);
  });

  it('weigert met score-changed als de stand is gewijzigd (via scoreparameter)', () => {
    const g = swap(makeGame(), 'p7', 'p12');
    expect(confirmSwap(g, { endSec: 600, scoreFor: 2, classification: CLASS_OFF })).toEqual({
      ok: false,
      error: 'score-changed',
    });
  });

  it('weigert met score-changed als de stand al in de log is gewijzigd', () => {
    const g = swap(withActions(makeGame(), scoreDeltaAction('against', 2)), 'p7', 'p12');
    expect(confirmSwap(g, { endSec: 600, classification: CLASS_OFF })).toEqual({
      ok: false,
      error: 'score-changed',
    });
    // Met scoreAtOpen op de huidige stand telt het niet als gewijzigd sinds openen.
    const next = ok(
      confirmSwap(g, {
        endSec: 600,
        scoreAtOpen: { for: 0, against: 2 },
        classification: CLASS_OFF,
      }),
    );
    expect(next.pendingSwapLineup).toBeNull();
    expect(next.actions).toHaveLength(1);
  });

  it('accepteert een score-parameter gelijk aan de huidige stand', () => {
    const g = swap(makeGame(), 'p7', 'p12');
    expect(
      confirmSwap(g, { endSec: 600, scoreFor: 0, scoreAgainst: 0, classification: CLASS_OFF }).ok,
    ).toBe(true);
  });

  it('weigert een negatieve duur, een klok boven 10:00 en een ontbrekend concept', () => {
    const g = swap(makeGame({ beginSec: 400, endSec: 400 }), 'p7', 'p12');
    expect(confirmSwap(g, { endSec: 450, classification: CLASS_OFF })).toEqual({
      ok: false,
      error: 'invalid-duration',
    });
    expect(confirmSwap(g, { endSec: 601, classification: CLASS_OFF })).toEqual({
      ok: false,
      error: 'invalid-clock',
    });
    expect(confirmSwap(makeGame(), { endSec: 300, classification: CLASS_OFF })).toEqual({
      ok: false,
      error: 'no-pending-swap',
    });
  });
});

describe('liveCommands — closeQuarter, discardSwaps, setScore', () => {
  it('rondt ook in het laatste kwart niet af en weigert een ongeldig kwart', () => {
    const g = makeGame({ curQuarter: 4 });
    const next = ok(
      closeQuarter(g, {
        endSec: 0,
        scoreFor: 10,
        nextQuarter: 4,
        quarterCount: 4,
        classification: CLASS_OFF,
      }),
    );
    expect(next.phase).toBe('tracking');
    expect(next.curQuarter).toBe(4);
    expect(deriveGameHistory(next).segments).toHaveLength(1);
    expect(
      closeQuarter(g, { endSec: 0, nextQuarter: 5, quarterCount: 4, classification: CLASS_OFF }),
    ).toEqual({ ok: false, error: 'invalid-quarter' });
  });

  it('slaat bij niets open (duur 0, geen punten/turnovers) geen leeg segment op', () => {
    const next = ok(
      closeQuarter(makeGame(), { endSec: 600, nextQuarter: 2, classification: CLASS_OFF }),
    );
    expect(next.actions).toHaveLength(0);
    expect(next.curQuarter).toBe(2);
    // Open punten bij duur 0 worden niet stilzwijgend weggegooid.
    expect(
      closeQuarter(makeGame(), {
        endSec: 600,
        scoreFor: 2,
        nextQuarter: 2,
        classification: CLASS_OFF,
      }),
    ).toEqual({ ok: false, error: 'invalid-duration' });
  });

  it('discardSwaps herstelt de lineup van vóór de wissels; zonder concept dezelfde game', () => {
    const base = makeGame();
    expect(discardSwaps(base)).toBe(base);
    const swapped = swap(swap(base, 'p7', 'p12'), 'p4', 'p6');
    const back = discardSwaps(swapped);
    expect(back.onCourt).toEqual(START);
    expect(back.pendingSwapLineup).toBeNull();
  });

  it('setScore voegt geen no-op actie toe en weigert waarden buiten 0-150', () => {
    const g = makeGame();
    const same = setScore(g, 'for', 0);
    expect(same.ok && same.game).toBe(g);
    const changed = ok(setScore(g, 'against', 7));
    expect(changed.actions).toHaveLength(1);
    expect(deriveGameHistory(changed).scoreAgainst).toBe(7);
    expect(setScore(g, 'for', -1)).toEqual({ ok: false, error: 'invalid-score' });
    expect(setScore(g, 'for', 151)).toEqual({ ok: false, error: 'invalid-score' });
  });
});

function draftOfSegment(g: ActiveGame, i: number, patch = {}) {
  const s = deriveGameHistory(g).segments[i]!;
  return {
    quarter: s.quarter,
    beginSec: s.beginSec,
    endSec: s.endSec,
    lineup: s.lineup,
    pf: s.pf,
    pa: s.pa,
    tov: s.tov ?? 0,
    ...patch,
  };
}

describe('liveCommands — segment bewerken (besluit 1 en 2)', () => {
  function twoSegments() {
    let g = ok(
      commitSegment(makeGame(), {
        endSec: 390,
        scoreFor: 8,
        scoreAgainst: 6,
        classification: CLASS_OFF,
      }),
    );
    g = ok(
      commitSegment(g, { endSec: 180, scoreFor: 12, scoreAgainst: 10, classification: CLASS_OFF }),
    );
    return g;
  }
  const draftOf = (g: ActiveGame, i: number, patch = {}) => {
    const s = deriveGameHistory(g).segments[i]!;
    return {
      quarter: s.quarter,
      beginSec: s.beginSec,
      endSec: s.endSec,
      lineup: s.lineup,
      pf: s.pf,
      pa: s.pa,
      tov: s.tov ?? 0,
      ...patch,
    };
  };

  it('legt een geldige bewerking vast en herberekent de stand (bouwplan E)', () => {
    const g = twoSegments();
    const id = deriveGameHistory(g).segments[0]!.id;
    const next = ok(editSegment(g, id, draftOf(g, 0, { pf: 9, tov: 3 }), CLASS_OFF, 4));
    const h = deriveGameHistory(next);
    expect(h.segments[0]).toMatchObject({ pf: 9, pa: 6, tov: 3, durSec: 210 });
    expect(h.scoreFor).toBe(13);
  });

  it('weigert negatieve punten, punten boven 150 en een totaalstand boven 150', () => {
    const g = twoSegments();
    const id = deriveGameHistory(g).segments[0]!.id;
    for (const patch of [{ pf: -1 }, { pa: -3 }, { pf: 151 }, { pf: 1.5 }, { pa: Number.NaN }]) {
      expect(editSegment(g, id, draftOf(g, 0, patch), CLASS_OFF)).toEqual({
        ok: false,
        error: 'invalid-score',
      });
    }
    // 150 in segment 1 + 4 in segment 2 = 154 > 150.
    expect(editSegment(g, id, draftOf(g, 0, { pf: 150 }), CLASS_OFF)).toEqual({
      ok: false,
      error: 'invalid-score',
    });
  });

  it('staat het bestaande kwart van een segment toe, ook boven een verlaagd periodeaantal', () => {
    let g = makeGame({ curQuarter: 4 });
    g = ok(
      commitSegment(g, { endSec: 390, scoreFor: 8, scoreAgainst: 6, classification: CLASS_OFF }),
    );
    const id = deriveGameHistory(g).segments[0]!.id;
    const draft = draftOfSegment(g, 0, { pf: 9 });
    // periodeaantal inmiddels 2: kwart 4 van dit segment blijft bewerkbaar...
    expect(editSegment(g, id, draft, CLASS_OFF, 2).ok).toBe(true);
    // ...maar een ander kwart boven het aantal blijft geweigerd.
    expect(editSegment(g, id, { ...draft, quarter: 3 }, CLASS_OFF, 2)).toEqual({
      ok: false,
      error: 'invalid-quarter',
    });
  });

  it('weigert een klok boven 10:00, duur <= 0, een onbekend segment en een lineup van <> 5', () => {
    const g = twoSegments();
    const id = deriveGameHistory(g).segments[0]!.id;
    expect(editSegment(g, id, draftOf(g, 0, { beginSec: 601 }), CLASS_OFF)).toEqual({
      ok: false,
      error: 'invalid-clock',
    });
    expect(editSegment(g, id, draftOf(g, 0, { endSec: 600 }), CLASS_OFF)).toEqual({
      ok: false,
      error: 'invalid-duration',
    });
    expect(editSegment(g, id, draftOf(g, 0, { lineup: START.slice(0, 4) }), CLASS_OFF)).toEqual({
      ok: false,
      error: 'invalid-lineup',
    });
    expect(editSegment(g, 'bestaat-niet', draftOf(g, 0), CLASS_OFF)).toEqual({
      ok: false,
      error: 'unknown-segment',
    });
    expect(editSegment(g, id, draftOf(g, 0, { quarter: 5 }), CLASS_OFF, 4)).toEqual({
      ok: false,
      error: 'invalid-quarter',
    });
  });
});

describe('liveCommands — klokhulpen (Klassiek TimeSelect)', () => {
  it('isValidClockSeconds begrenst op 0..600 en hele getallen', () => {
    expect(isValidClockSeconds(0)).toBe(true);
    expect(isValidClockSeconds(600)).toBe(true);
    expect(isValidClockSeconds(601)).toBe(false);
    expect(isValidClockSeconds(-1)).toBe(false);
    expect(isValidClockSeconds(1.5)).toBe(false);
  });

  it('bij 10 minuten is alleen seconde 0 te kiezen; 10:59 is niet meer samen te stellen', () => {
    expect(maxSecondsForMinutes(9)).toBe(59);
    expect(maxSecondsForMinutes(10)).toBe(0);
    expect(secondsMaxOf(600)).toBe(0);
    expect(secondsMaxOf(599)).toBe(59);
    expect(withMinutes(545, 10)).toBe(600); // 9:05 -> 10 min wordt 10:00, niet 10:05
    expect(withSeconds(600, 30)).toBe(600);
    expect(withSeconds(540, 30)).toBe(570);
    expect(withMinutes(545, 9)).toBe(545);
  });
});
