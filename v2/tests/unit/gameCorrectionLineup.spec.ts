import { describe, it, expect } from 'vitest';
import type { CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';
import {
  correctSegment,
  replayCorrectionLog,
  sameCorrectionEntry,
} from '../../src/domain/game/correction';
import type { ClassificationConfig } from '../../src/domain/game/tracking';

// PR 7.7a (docs/pr-7.7-plan.md). Fictieve, handmatig nagerekende fixture:
//   p1..p5: klasse 3.0, p6: klasse 2.0 + vrouw, p7: klasse 1.0 maar doet niet mee.
//   Config: basisgrens 14.5, bonus alleen-vrouw 1.0, maxBonus 1.5.
//   S1 lineup p1..p5: som 15, toegestaan 14.5 (bonus 0), over = true.
//   Wissel p5 -> p6: som 12 + 2 = 14; bonus 1.0 => toegestaan 15.5; over = false.

const CONFIG: ClassificationConfig = {
  useClassLimit: true,
  classBaseLimit: 14.5,
  maxBonus: 1.5,
  bonusTag1Only: 1,
  bonusTag2Only: 0.5,
  bonusBoth: 1.5,
};

function player(n: number, extra: Partial<GamePlayer> = {}): GamePlayer {
  return {
    id: `p${n}`,
    rosterId: n,
    nr: String(n),
    naam: `Speler ${n}`,
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: n <= 5,
    ...extra,
  };
}

function game(overrides: Partial<CompletedGame> = {}): CompletedGame {
  const seg: Segment = {
    id: 's1',
    quarter: 1,
    beginSec: 600,
    endSec: 420,
    durSec: 180,
    lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
    pf: 6,
    pa: 4,
    classSum: 15,
    allowed: 14.5,
    over: true,
    tov: 2,
  };
  return {
    id: 'cg-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'src-1',
    opponent: 'Fictief Team',
    competition: '',
    date: '2026-01-01T10:00:00.000Z',
    players: [
      player(1),
      player(2),
      player(3),
      player(4),
      player(5),
      player(6, { kl: '2.0', vrouw: true, start: false }),
      player(7, { kl: '1.0', participate: false, start: false }),
    ],
    segments: [seg, { ...seg, id: 's2', beginSec: 420, endSec: 240, durSec: 180 }],
    scoreFor: 12,
    scoreAgainst: 8,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: true,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

const NEW_LINEUP = ['p1', 'p2', 'p3', 'p4', 'p6'];
const OPTS = { now: new Date('2026-02-01T10:00:00.000Z'), id: 'c-1', classification: CONFIG };

describe('correctSegment: lineup (PR 7.7a)', () => {
  it('wisselt een speler en herberekent som, toegestaan en over (variant A)', () => {
    const r = correctSegment(game(), 's1', { lineup: NEW_LINEUP }, 'u1', OPTS);
    if (!r.ok) throw new Error(r.error);
    const s = r.game.segments[0];
    expect(s?.lineup).toEqual(NEW_LINEUP);
    expect(s?.classSum).toBe(14);
    expect(s?.allowed).toBe(15.5);
    expect(s?.over).toBe(false);
    // tijd, score en turnovers ongewijzigd; alleen revisie en log groeien
    expect([s?.durSec, s?.pf, s?.pa, s?.tov]).toEqual([180, 6, 4, 2]);
    expect([r.game.scoreFor, r.game.scoreAgainst, r.game.revision]).toEqual([12, 8, 1]);
    // het tweede segment blijft ongemoeid
    expect(r.game.segments[1]).toEqual(game().segments[1]);
  });

  it("logt lineup en allowed (alleen speler-ID's) in before en after", () => {
    const r = correctSegment(game(), 's1', { lineup: NEW_LINEUP }, 'u1', OPTS);
    if (!r.ok) throw new Error(r.error);
    expect(r.correction.before).toMatchObject({
      lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
      allowed: 14.5,
    });
    expect(r.correction.after).toMatchObject({ lineup: NEW_LINEUP, allowed: 15.5 });
  });

  it('logt geen lineup bij een correctie van alleen de score (zelfde logvorm als 7.5)', () => {
    const r = correctSegment(game(), 's1', { pf: 7 }, 'u1', OPTS);
    if (!r.ok) throw new Error(r.error);
    expect(Object.keys(r.correction.after).sort()).toEqual(
      ['beginSec', 'endSec', 'pa', 'pf', 'quarter', 'tov'].sort(),
    );
  });

  it('combineert een lineupwissel met een tijd- en scorecorrectie', () => {
    const r = correctSegment(game(), 's1', { lineup: NEW_LINEUP, pf: 9 }, 'u1', OPTS);
    if (!r.ok) throw new Error(r.error);
    expect(r.game.scoreFor).toBe(15);
    expect(r.game.segments[0]?.lineup).toEqual(NEW_LINEUP);
  });

  it('zelfde spelers in andere volgorde is geen wijziging', () => {
    const r = correctSegment(game(), 's1', { lineup: ['p5', 'p4', 'p3', 'p2', 'p1'] }, 'u1', OPTS);
    expect(r).toEqual({ ok: false, error: 'no-change' });
  });

  it.each([
    ['te weinig spelers', ['p1', 'p2', 'p3', 'p4']],
    ['dubbele speler', ['p1', 'p2', 'p3', 'p4', 'p4']],
    ['onbekende speler', ['p1', 'p2', 'p3', 'p4', 'px']],
    ['speler die niet meedeed', ['p1', 'p2', 'p3', 'p4', 'p7']],
    ['te veel spelers', ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']],
  ])('keurt af: %s', (_naam, lineup) => {
    expect(correctSegment(game(), 's1', { lineup }, 'u1', OPTS)).toEqual({
      ok: false,
      error: 'invalid-lineup',
    });
  });

  it('weigert een losse allowed zonder lineup', () => {
    expect(correctSegment(game(), 's1', { allowed: 20 }, 'u1', OPTS)).toEqual({
      ok: false,
      error: 'invalid-lineup',
    });
  });

  it('vraagt om instellingen bij een wedstrijd met klassegrens', () => {
    const r = correctSegment(game(), 's1', { lineup: NEW_LINEUP }, 'u1', { id: 'c-1' });
    expect(r).toEqual({ ok: false, error: 'classification-unavailable' });
  });

  it('laat som, toegestaan en over op 0/ongewijzigd zonder klassegrenssysteem', () => {
    const g = game({
      useClassLimit: false,
      segments: game().segments.map((s) => ({ ...s, classSum: 0, allowed: 0, over: false })),
    });
    const r = correctSegment(g, 's1', { lineup: NEW_LINEUP }, null, { id: 'c-1' });
    if (!r.ok) throw new Error(r.error);
    expect(r.game.segments[0]).toMatchObject({ classSum: 0, allowed: 0, over: false });
  });

  it('muteert de invoer niet', () => {
    const g = game();
    const snapshot = JSON.stringify(g);
    correctSegment(g, 's1', { lineup: NEW_LINEUP }, 'u1', OPTS);
    expect(JSON.stringify(g)).toBe(snapshot);
  });
});

describe('replayCorrectionLog: lineup (PR 7.7a)', () => {
  it('speelt een lineupcorrectie exact terug, zonder instellingen', () => {
    const r = correctSegment(game(), 's1', { lineup: NEW_LINEUP }, 'u1', OPTS);
    if (!r.ok) throw new Error(r.error);
    const replayed = replayCorrectionLog(game(), r.game.corrections ?? [], 0);
    expect(replayed).toEqual(r.game);
  });

  it('gebruikt de gelogde allowed, niet de huidige instellingen', () => {
    const r = correctSegment(game(), 's1', { lineup: NEW_LINEUP }, 'u1', OPTS);
    if (!r.ok) throw new Error(r.error);
    expect(replayCorrectionLog(game(), r.game.corrections ?? [], 0)?.segments[0]?.allowed).toBe(
      15.5,
    );
  });

  it('keurt een item af waarvan before.lineup niet bij het segment past', () => {
    const r = correctSegment(game(), 's1', { lineup: NEW_LINEUP }, 'u1', OPTS);
    if (!r.ok) throw new Error(r.error);
    const bad = {
      ...r.correction,
      before: { ...r.correction.before, lineup: ['p1', 'p2', 'p3', 'p4', 'p6'] },
    };
    expect(replayCorrectionLog(game(), [bad], 0)).toBeNull();
  });

  it('keurt een item af met lineup alleen in after', () => {
    const r = correctSegment(game(), 's1', { lineup: NEW_LINEUP }, 'u1', OPTS);
    if (!r.ok) throw new Error(r.error);
    const { quarter, beginSec, endSec, pf, pa, tov } = r.correction.before;
    const baseBefore = { quarter, beginSec, endSec, pf, pa, tov };
    expect(replayCorrectionLog(game(), [{ ...r.correction, before: baseBefore }], 0)).toBeNull();
  });

  it('keurt een item af met een speler die niet meedeed', () => {
    const r = correctSegment(game(), 's1', { lineup: NEW_LINEUP }, 'u1', OPTS);
    if (!r.ok) throw new Error(r.error);
    const bad = {
      ...r.correction,
      after: { ...r.correction.after, lineup: ['p1', 'p2', 'p3', 'p4', 'p7'] },
    };
    expect(replayCorrectionLog(game(), [bad], 0)).toBeNull();
  });

  it('speelt een oud logitem zonder lineup nog steeds terug', () => {
    const r = correctSegment(game(), 's1', { pf: 9 }, 'u1', OPTS);
    if (!r.ok) throw new Error(r.error);
    expect(replayCorrectionLog(game(), r.game.corrections ?? [], 0)).toEqual(r.game);
  });

  it('sameCorrectionEntry vergelijkt ook lineup en allowed', () => {
    const r = correctSegment(game(), 's1', { lineup: NEW_LINEUP }, 'u1', OPTS);
    if (!r.ok) throw new Error(r.error);
    const other = { ...r.correction, after: { ...r.correction.after, allowed: 99 } };
    expect(sameCorrectionEntry(r.correction, r.correction)).toBe(true);
    expect(sameCorrectionEntry(r.correction, other)).toBe(false);
  });
});
