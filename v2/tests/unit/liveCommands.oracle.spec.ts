import { describe, expect, it } from 'vitest';
import {
  applyAction,
  deriveGameHistory,
  EMPTY_HISTORY,
  scoreDeltaAction,
  segmentDeletedAction,
  turnoverDeltaAction,
  type ClassificationConfig,
} from '../../src/domain/game/tracking';
import {
  clockDuration,
  closeQuarter,
  commitSegment,
  confirmSwap,
  editSegment,
  setScore,
  type LiveCommandResult,
} from '../../src/domain/game/liveCommands';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';

/**
 * Onafhankelijke orakeltests voor de gedeelde live-commando's (bouwplan C1).
 * Alle verwachte getallen zijn met de hand nagerekend uit de tabel
 * "Handmatig narekenbare acceptatie" (stappen A-F) en de Besluiten in
 * docs/wedstrijdscherm-compact-bouwplan.md, NIET afgeleid uit de implementatie.
 * Uitsluitend fictieve spelers.
 */

const CLASS: ClassificationConfig = {
  useClassLimit: false,
  classBaseLimit: 14,
  maxBonus: 0,
  bonusTag1Only: 0,
  bonusTag2Only: 0,
  bonusBoth: 0,
};

function player(rosterId: number, nr: string, naam: string, start: boolean): GamePlayer {
  return {
    id: `p${nr}`,
    rosterId,
    nr,
    naam,
    kl: '2.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start,
  };
}

const PLAYERS: GamePlayer[] = [
  player(1, '4', 'Alex', true),
  player(2, '7', 'Sam', true),
  player(3, '9', 'Robin', true),
  player(4, '11', 'Kim', true),
  player(5, '13', 'Dani', true),
  player(6, '6', 'Bo', false),
  player(7, '12', 'Noa', false),
  player(8, '15', 'Jules', false),
];

const START = ['p4', 'p7', 'p9', 'p11', 'p13'];
const AFTER_B = ['p4', 'p9', 'p11', 'p13', 'p12']; // 7 -> 12 (positie 2 vervangen, volgorde: 4/9/11/13/12 per plan)
const AFTER_C = ['p6', 'p9', 'p15', 'p13', 'p12']; // 4 -> 6 en 11 -> 15

function newGame(overrides: Partial<ActiveGame> = {}): ActiveGame {
  return {
    id: 'g1',
    organizationId: 'org',
    teamId: 'team',
    phase: 'tracking',
    players: PLAYERS,
    opponent: 'Fictief',
    competition: 'Test',
    clockDown: true,
    limitStr: '14',
    onCourt: START,
    curQuarter: 1,
    beginSec: 600,
    endSec: 600,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function good(result: LiveCommandResult): ActiveGame {
  if (!result.ok) throw new Error(`verwacht ok, kreeg fout ${result.error}`);
  return result.game;
}

function withTurnovers(game: ActiveGame, n: number): ActiveGame {
  const actions = Array.from({ length: n }, () => turnoverDeltaAction(1));
  return { ...game, actions: [...game.actions, ...actions] };
}

/** Stappen A-D; geeft de game na D (Q2 geselecteerd door closeQuarter). */
function playStepsAtoD(): ActiveGame {
  // A: Q1 aftellend 10:00, lineup 4/7/9/11/13, stand 0-0.
  let g = newGame();
  // B: 2 turnovers; bij 6:30 (390 s) stand 8-6; wissel 7 -> 12.
  g = withTurnovers(g, 2);
  g = { ...g, onCourt: AFTER_B, pendingSwapLineup: START };
  g = good(confirmSwap(g, { endSec: 390, scoreFor: 8, scoreAgainst: 6, classification: CLASS }));
  // C: bij 3:00 (180 s) stand 12-10, 1 TO; wissel 4->6 en 11->15 samen.
  g = withTurnovers(g, 1);
  g = { ...g, onCourt: AFTER_C, pendingSwapLineup: AFTER_B };
  g = good(confirmSwap(g, { endSec: 180, scoreFor: 12, scoreAgainst: 10, classification: CLASS }));
  // D: sluit Q1 op 0:00 stand 16-12, 0 extra TO.
  g = good(
    closeQuarter(g, {
      endSec: 0,
      scoreFor: 16,
      scoreAgainst: 12,
      nextQuarter: 2,
      classification: CLASS,
    }),
  );
  return g;
}

describe('stappen A-D (handberekening)', () => {
  it('A: uitgangstoestand', () => {
    const h = deriveGameHistory(newGame());
    expect(h).toEqual(EMPTY_HISTORY);
  });

  it('B: oud segment 210 s, 8-6, +2, TO 2; nieuwe lineup 4/9/11/13/12', () => {
    let g = withTurnovers(newGame(), 2);
    g = { ...g, onCourt: AFTER_B, pendingSwapLineup: START };
    g = good(confirmSwap(g, { endSec: 390, scoreFor: 8, scoreAgainst: 6, classification: CLASS }));
    const h = deriveGameHistory(g);
    expect(h.segments).toHaveLength(1);
    const s = h.segments[0]!;
    // 600 - 390 = 210 s
    expect(s.durSec).toBe(210);
    expect(s.pf).toBe(8);
    expect(s.pa).toBe(6);
    expect(s.pf - s.pa).toBe(2);
    expect(s.tov).toBe(2);
    expect(s.lineup).toEqual(START);
    expect(g.onCourt).toEqual(AFTER_B);
    expect(g.pendingSwapLineup).toBeNull();
    expect(g.beginSec).toBe(390);
    // Nieuwe open segment: TO 0.
    expect(h.turnovers - h.segStartTurnovers).toBe(0);
  });

  it('C: segment 210 s, 4-4, 0, TO 1; twee wissels = een segment', () => {
    let g = withTurnovers(newGame(), 2);
    g = { ...g, onCourt: AFTER_B, pendingSwapLineup: START };
    g = good(confirmSwap(g, { endSec: 390, scoreFor: 8, scoreAgainst: 6, classification: CLASS }));
    g = withTurnovers(g, 1);
    g = { ...g, onCourt: AFTER_C, pendingSwapLineup: AFTER_B };
    g = good(
      confirmSwap(g, { endSec: 180, scoreFor: 12, scoreAgainst: 10, classification: CLASS }),
    );
    const h = deriveGameHistory(g);
    // Slechts 2 segmenten na C: de dubbele wissel maakte er maar een.
    expect(h.segments).toHaveLength(2);
    const s = h.segments[1]!;
    expect(s.durSec).toBe(210); // 390 - 180
    expect(s.pf).toBe(4); // 12 - 8
    expect(s.pa).toBe(4); // 10 - 6
    expect(s.pf - s.pa).toBe(0);
    expect(s.tov).toBe(1);
    expect(s.lineup).toEqual(AFTER_B);
  });

  it('D: laatste segment 180 s, 4-2, +2, TO 0; totalen 600 s / 3000 spelerss / +4 / TO 3', () => {
    const g = playStepsAtoD();
    const h = deriveGameHistory(g);
    expect(h.segments).toHaveLength(3);
    const s = h.segments[2]!;
    expect(s.durSec).toBe(180); // 180 - 0
    expect(s.pf).toBe(4); // 16 - 12
    expect(s.pa).toBe(2); // 12 - 10
    expect(s.pf - s.pa).toBe(2);
    expect(s.tov).toBe(0);
    expect(s.lineup).toEqual(AFTER_C);
    // 210 + 210 + 180 = 600 lineupseconden
    expect(h.segments.reduce((a, x) => a + x.durSec, 0)).toBe(600);
    // 600 x 5 spelers = 3000 spelerseconden
    expect(h.segments.reduce((a, x) => a + x.durSec * x.lineup.length, 0)).toBe(3000);
    // 16 - 12 = +4 en som van segmentdelta's 2 + 0 + 2 = +4
    expect(h.scoreFor).toBe(16);
    expect(h.scoreAgainst).toBe(12);
    expect(h.scoreFor - h.scoreAgainst).toBe(4);
    expect(h.segments.reduce((a, x) => a + x.pf - x.pa, 0)).toBe(4);
    // TO: 2 + 1 + 0 = 3
    expect(h.turnovers).toBe(3);
    expect(h.segments.reduce((a, x) => a + (x.tov ?? 0), 0)).toBe(3);
    // closeQuarter rondt nooit af en kiest Q2 met een verse klok.
    expect(g.curQuarter).toBe(2);
    expect(g.beginSec).toBe(600);
    expect(g.pendingSwapLineup).toBeNull();
    // Open delta's na D zijn 0.
    expect(h.scoreFor - h.segStartFor).toBe(0);
    expect(h.scoreAgainst - h.segStartAgainst).toBe(0);
    expect(h.turnovers - h.segStartTurnovers).toBe(0);
  });
});

describe('stap E: open Q2 + bewerk eerste segment', () => {
  it('totaal 19-12, TO 5; open delta +2 en open TO 1 blijven', () => {
    let g = playStepsAtoD();
    // Q2: 2 eigen punten en 1 TO open.
    g = {
      ...g,
      actions: [...g.actions, scoreDeltaAction('for', 2), turnoverDeltaAction(1)],
    };
    const before = deriveGameHistory(g);
    expect(before.scoreFor).toBe(18); // 16 + 2
    expect(before.turnovers).toBe(4); // 3 + 1

    const first = before.segments[0]!;
    g = good(
      editSegment(
        g,
        first.id,
        {
          quarter: first.quarter,
          beginSec: first.beginSec,
          endSec: first.endSec,
          lineup: first.lineup,
          pf: 9,
          pa: 6,
          tov: 3,
        },
        CLASS,
      ),
    );
    const h = deriveGameHistory(g);
    // Segmenten: pf 9+4+4 = 17, pa 6+4+2 = 12, tov 3+1+0 = 4.
    expect(h.segStartFor).toBe(17);
    expect(h.segStartAgainst).toBe(12);
    expect(h.segStartTurnovers).toBe(4);
    // Open delta's: +2 punten en 1 TO blijven behouden.
    expect(h.scoreFor - h.segStartFor).toBe(2);
    expect(h.scoreAgainst - h.segStartAgainst).toBe(0);
    expect(h.turnovers - h.segStartTurnovers).toBe(1);
    // Totaal: 17 + 2 = 19 voor, 12 tegen, TO 4 + 1 = 5.
    expect(h.scoreFor).toBe(19);
    expect(h.scoreAgainst).toBe(12);
    expect(h.turnovers).toBe(5);
    // Overige segmenten ongewijzigd, bewerkt segment behoudt tijd/lineup.
    expect(h.segments[0]!.durSec).toBe(210);
    expect(h.segments[0]!.lineup).toEqual(START);
    expect(h.segments[1]!.pf).toBe(4);
    expect(h.segments[2]!.pa).toBe(2);
  });
});

describe('stap F: eerste segment verwijderen na D', () => {
  it('totaal 8-6, +2, TO 1; resterende tijden/lineups ongewijzigd', () => {
    const g = playStepsAtoD();
    const first = deriveGameHistory(g).segments[0]!;
    const g2 = { ...g, actions: [...g.actions, segmentDeletedAction(first.id)] };
    const h = deriveGameHistory(g2);
    expect(h.segments).toHaveLength(2);
    // Resterend: 4-4 (TO 1) + 4-2 (TO 0) = 8-6, +2, TO 1.
    expect(h.scoreFor).toBe(8);
    expect(h.scoreAgainst).toBe(6);
    expect(h.scoreFor - h.scoreAgainst).toBe(2);
    expect(h.turnovers).toBe(1);
    expect(h.segments.map((s) => s.durSec)).toEqual([210, 180]);
    expect(h.segments[0]!.lineup).toEqual(AFTER_B);
    expect(h.segments[1]!.lineup).toEqual(AFTER_C);
    expect(h.segments[0]!.beginSec).toBe(390);
    expect(h.segments[1]!.endSec).toBe(0);
  });

  it('applyAction-reducer geeft dezelfde uitkomst als deriveGameHistory', () => {
    const g = playStepsAtoD();
    expect(g.actions.reduce(applyAction, EMPTY_HISTORY)).toEqual(deriveGameHistory(g));
  });
});

describe('grensgevallen volgens de besluiten', () => {
  it('besluit 1: klok boven 10:00 wordt geweigerd', () => {
    const g = newGame({ clockDown: false, beginSec: 0 });
    const r = commitSegment(g, { endSec: 601, classification: CLASS });
    expect(r).toEqual({ ok: false, error: 'invalid-clock' });
    // Begintijd boven 600 is ook ongeldig.
    const bad = newGame({ beginSec: 601 });
    expect(commitSegment(bad, { endSec: 0, classification: CLASS })).toEqual({
      ok: false,
      error: 'invalid-clock',
    });
    // Negatief en niet-geheel worden ook geweigerd.
    expect(commitSegment(newGame(), { endSec: -1, classification: CLASS })).toEqual({
      ok: false,
      error: 'invalid-clock',
    });
    expect(commitSegment(newGame(), { endSec: 12.5, classification: CLASS })).toEqual({
      ok: false,
      error: 'invalid-clock',
    });
    // Precies 600 is toegestaan (opgeteld: 0 -> 600 = 600 s).
    const ok = good(commitSegment(g, { endSec: 600, classification: CLASS }));
    expect(deriveGameHistory(ok).segments[0]!.durSec).toBe(600);
  });

  it('besluit 2: punten buiten 0-150 worden geweigerd', () => {
    const g = newGame();
    expect(commitSegment(g, { endSec: 300, scoreFor: 151, classification: CLASS })).toEqual({
      ok: false,
      error: 'invalid-score',
    });
    expect(commitSegment(g, { endSec: 300, scoreAgainst: -1, classification: CLASS })).toEqual({
      ok: false,
      error: 'invalid-score',
    });
    expect(setScore(g, 'for', 151)).toEqual({ ok: false, error: 'invalid-score' });
    expect(setScore(g, 'against', -1)).toEqual({ ok: false, error: 'invalid-score' });
    // 150 is de bovengrens en is toegestaan.
    const ok = good(commitSegment(g, { endSec: 300, scoreFor: 150, classification: CLASS }));
    expect(deriveGameHistory(ok).segments[0]!.pf).toBe(150);
  });

  it('besluit 2: bewerken weigert punten buiten 0-150', () => {
    const g = playStepsAtoD();
    const first = deriveGameHistory(g).segments[0]!;
    const draft = {
      quarter: 1,
      beginSec: first.beginSec,
      endSec: first.endSec,
      lineup: first.lineup,
      pf: 8,
      pa: 6,
      tov: 2,
    };
    expect(editSegment(g, first.id, { ...draft, pf: 151 }, CLASS)).toEqual({
      ok: false,
      error: 'invalid-score',
    });
    expect(editSegment(g, first.id, { ...draft, pa: -1 }, CLASS)).toEqual({
      ok: false,
      error: 'invalid-score',
    });
  });

  it('besluit 2: eindstand onder de beginstand van het segment wordt geweigerd', () => {
    // Na stap B staat de stand op 8-6; een volgend segment met eindstand 7 voor is -1 punt.
    let g = newGame();
    g = { ...g, onCourt: AFTER_B, pendingSwapLineup: START };
    g = good(confirmSwap(g, { endSec: 390, scoreFor: 8, scoreAgainst: 6, classification: CLASS }));
    expect(commitSegment(g, { endSec: 300, scoreFor: 7, classification: CLASS })).toEqual({
      ok: false,
      error: 'invalid-score',
    });
    expect(commitSegment(g, { endSec: 300, scoreAgainst: 5, classification: CLASS })).toEqual({
      ok: false,
      error: 'invalid-score',
    });
    // Gelijk aan de beginstand (0 punten in het segment) mag wel.
    const ok = good(commitSegment(g, { endSec: 300, scoreFor: 8, classification: CLASS }));
    expect(deriveGameHistory(ok).segments[1]!.pf).toBe(0);
  });

  it('besluit 3: wissel op 0 s zonder scorewijziging maakt geen leeg segment', () => {
    const g = newGame({ onCourt: AFTER_B, pendingSwapLineup: START });
    const out = good(confirmSwap(g, { endSec: 600, classification: CLASS }));
    expect(out.pendingSwapLineup).toBeNull();
    expect(out.onCourt).toEqual(AFTER_B);
    expect(out.actions).toHaveLength(0);
    expect(deriveGameHistory(out).segments).toHaveLength(0);
  });

  it('besluit 3: wissel op 0 s met gewijzigde stand wordt geweigerd', () => {
    const g = newGame({ onCourt: AFTER_B, pendingSwapLineup: START });
    expect(confirmSwap(g, { endSec: 600, scoreFor: 2, classification: CLASS })).toEqual({
      ok: false,
      error: 'score-changed',
    });
    // Ook open punten die al in de log staan tellen mee ten opzichte van de beginstand.
    const gp = { ...g, actions: [scoreDeltaAction('against', 3)] };
    expect(confirmSwap(gp, { endSec: 600, classification: CLASS })).toEqual({
      ok: false,
      error: 'score-changed',
    });
    // Een stand gelijk aan die bij het openen van het concept is wel goed.
    const open = good(
      confirmSwap(gp, {
        endSec: 600,
        scoreAtOpen: { for: 0, against: 3 },
        classification: CLASS,
      }),
    );
    expect(open.pendingSwapLineup).toBeNull();
  });

  it('wissel met negatieve duur wordt geweigerd', () => {
    // Aftellend van 300 naar 400 loopt de klok achteruit.
    const g = newGame({ beginSec: 300, endSec: 300, pendingSwapLineup: START, onCourt: AFTER_B });
    expect(confirmSwap(g, { endSec: 400, classification: CLASS })).toEqual({
      ok: false,
      error: 'invalid-duration',
    });
  });

  it('geen no-op score-actie: ongewijzigde waarde voegt niets toe', () => {
    const g = newGame({ actions: [scoreDeltaAction('for', 5)] });
    const r = setScore(g, 'for', 5);
    expect(r.ok).toBe(true);
    expect(good(r)).toBe(g);
    expect(good(r).actions).toHaveLength(1);
    // Een echte wijziging voegt precies een actie toe.
    const r2 = good(setScore(g, 'for', 7));
    expect(r2.actions).toHaveLength(2);
    expect(deriveGameHistory(r2).scoreFor).toBe(7);
    // commitSegment met dezelfde stand voegt alleen het segment toe (geen score-set).
    const c = good(commitSegment(g, { endSec: 300, scoreFor: 5, classification: CLASS }));
    expect(c.actions).toHaveLength(2);
    expect(c.actions[1]!.type).toBe('segment-saved');
    expect(deriveGameHistory(c).segments[0]!.pf).toBe(5);
  });

  it('opgetelde klok: duur is eind min begin, en terugtellen is ongeldig', () => {
    expect(clockDuration(false, 0, 300)).toBe(300);
    expect(clockDuration(true, 600, 390)).toBe(210);
    const g = newGame({ clockDown: false, beginSec: 0, endSec: 0 });
    const s = good(commitSegment(g, { endSec: 300, scoreFor: 2, classification: CLASS }));
    const seg = deriveGameHistory(s).segments[0]!;
    expect(seg.durSec).toBe(300);
    expect(seg.beginSec).toBe(0);
    expect(seg.endSec).toBe(300);
    expect(s.beginSec).toBe(300);
    // Opgeteld mag de eindtijd niet onder de begintijd liggen.
    const later = newGame({ clockDown: false, beginSec: 300, endSec: 300 });
    expect(commitSegment(later, { endSec: 120, classification: CLASS })).toEqual({
      ok: false,
      error: 'invalid-duration',
    });
    // Aftellend mag de eindtijd niet boven de begintijd liggen.
    expect(
      commitSegment(newGame({ beginSec: 300 }), { endSec: 400, classification: CLASS }),
    ).toEqual({ ok: false, error: 'invalid-duration' });
  });
});
