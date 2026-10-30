// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';
import { MAX_CORRECTIONS, MAX_SCORE } from '../../src/domain/game/types';
import { correctSegment, correctableFieldsOf } from '../../src/domain/game/correction';
import { segmentsCsvFor, combinedCsvForGame } from '../../src/domain/game/csv';
import {
  fmtTurnoversPer10,
  sumTurnovers,
  totalSegmentSeconds,
  turnoversPer10,
} from '../../src/domain/game/turnoverStats';
import { validateBackupData } from '../../src/domain/backup/validate';
import { buildBackupPayload } from '../../src/domain/backup/export';
import { parseBackupPayload } from '../../src/domain/backup/parse';
import { DEFAULT_SETTINGS } from '../../src/domain/settings/types';

// Vaste fixture uit docs/pr-7.5-plan.md §G (fictieve data, handmatig nagerekend).
//   S1: Q1 10:00 -> 7:00 (aftellend), 180 s, pf 6, pa 4, tov 2
//   S2: Q1  7:00 -> 3:00,             240 s, pf 8, pa 6, tov 1
//   Totaal: 14 - 10, 3 turnovers, 420 s => 3 / 7 min * 10 = 4,2857 => "4.3"
// Correctie S1: eind 7:00 -> 5:00 (300 s), pf 6 -> 9, tov 2 -> 3
//   Verwacht: 17 - 10, 4 turnovers, 540 s => 4 / 9 min * 10 = 4,444 => "4.4"

function players(): GamePlayer[] {
  return [1, 2, 3, 4, 5].map((n) => ({
    id: `p${n}`,
    rosterId: n,
    nr: String(n),
    naam: `Speler ${n}`,
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
  }));
}

function seg(overrides: Partial<Segment>): Segment {
  return {
    id: 's1',
    quarter: 1,
    beginSec: 600,
    endSec: 420,
    durSec: 180,
    lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
    pf: 0,
    pa: 0,
    classSum: 15,
    allowed: 14.5,
    over: true,
    ...overrides,
  };
}

function fixtureGame(overrides: Partial<CompletedGame> = {}): CompletedGame {
  return {
    id: 'cg-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'src-1',
    opponent: 'Fictief Team',
    competition: 'Testcompetitie',
    date: '2026-01-01T10:00:00.000Z',
    players: players(),
    segments: [
      seg({ id: 's1', beginSec: 600, endSec: 420, durSec: 180, pf: 6, pa: 4, tov: 2 }),
      seg({ id: 's2', beginSec: 420, endSec: 180, durSec: 240, pf: 8, pa: 6, tov: 1 }),
    ],
    scoreFor: 14,
    scoreAgainst: 10,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: true,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

const NOW = new Date('2026-02-02T09:00:00.000Z');
const opts = { now: NOW, id: 'corr-1' };

const CSV_HEAD =
  'Opstelling,Kwart,Begin,Eind,Speeltijd,Seconden,Punten voor,Punten tegen,Plusminus,Som classificatie,Toegestane grens,Binnen klassegrens,Lineup code,Turnovers';
const LINEUP = '"Speler 1 #1 | Speler 2 #2 | Speler 3 #3 | Speler 4 #4 | Speler 5 #5"';

describe('correctSegment — vaste fixture uit plan §G', () => {
  const game = fixtureGame();

  it('uitgangssituatie klopt handmatig (3 turnovers, 420 s, 4,3 per 10 min)', () => {
    expect(sumTurnovers(game.segments)).toBe(3);
    expect(totalSegmentSeconds(game.segments)).toBe(420);
    expect(fmtTurnoversPer10(turnoversPer10(3, 420))).toBe('4.3');
  });

  it('corrigeert S1 en leidt duur, score, turnovers en speeltijd correct af', () => {
    const result = correctSegment(game, 's1', { endSec: 300, pf: 9, tov: 3 }, 'uid-coach', opts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const g = result.game;
    expect(g.segments[0]).toMatchObject({
      id: 's1',
      quarter: 1,
      beginSec: 600,
      endSec: 300,
      durSec: 300,
      pf: 9,
      pa: 4,
      tov: 3,
    });
    expect(g.scoreFor).toBe(17);
    expect(g.scoreAgainst).toBe(10);
    expect(sumTurnovers(g.segments)).toBe(4);
    expect(totalSegmentSeconds(g.segments)).toBe(540);
    expect(fmtTurnoversPer10(turnoversPer10(4, 540))).toBe('4.4');
    expect(g.revision).toBe(1);
    expect(g.correctedAt).toBe('2026-02-02T09:00:00.000Z');
    expect(g.corrections).toEqual([
      {
        id: 'corr-1',
        segmentId: 's1',
        at: '2026-02-02T09:00:00.000Z',
        by: 'uid-coach',
        before: { quarter: 1, beginSec: 600, endSec: 420, pf: 6, pa: 4, tov: 2 },
        after: { quarter: 1, beginSec: 600, endSec: 300, pf: 9, pa: 4, tov: 3 },
      },
    ]);
    expect(result.correction).toBe(g.corrections?.[0]);
  });

  it('laat lineup, classSum, allowed, over, S2 en de overige velden ongewijzigd en muteert de invoer niet', () => {
    const snapshot: unknown = JSON.parse(JSON.stringify(game));
    const result = correctSegment(game, 's1', { endSec: 300, pf: 9, tov: 3 }, null, opts);
    expect(game).toEqual(snapshot);
    if (!result.ok) throw new Error('verwacht ok');
    const g = result.game;
    expect(g.segments[0]).toMatchObject({
      lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
      classSum: 15,
      allowed: 14.5,
      over: true,
    });
    expect(g.segments[1]).toEqual(game.segments[1]);
    expect(g.players).toEqual(game.players);
    expect(g.id).toBe(game.id);
    expect(g.sourceGameId).toBe(game.sourceGameId);
    expect(g.corrections?.[0]?.by).toBeNull();
  });

  it('CSV: ongewijzigde wedstrijd is byte-identiek, gecorrigeerde bevat de nieuwe segmentwaarden', () => {
    const roundtripped = JSON.parse(JSON.stringify(game)) as CompletedGame;
    expect(combinedCsvForGame(roundtripped)).toBe(combinedCsvForGame(game));
    expect(segmentsCsvFor(game.segments, game.players, true)).toBe(
      [
        CSV_HEAD,
        `${LINEUP},1,10:00,7:00,3:00,180,6,4,2,15.0,14.5,Te hoog,1-2-3-4-5,2`,
        `${LINEUP},1,7:00,3:00,4:00,240,8,6,2,15.0,14.5,Te hoog,1-2-3-4-5,1`,
      ].join('\n'),
    );
    const result = correctSegment(game, 's1', { endSec: 300, pf: 9, tov: 3 }, null, opts);
    if (!result.ok) throw new Error('verwacht ok');
    expect(segmentsCsvFor(result.game.segments, result.game.players, true)).toBe(
      [
        CSV_HEAD,
        `${LINEUP},1,10:00,5:00,5:00,300,9,4,5,15.0,14.5,Te hoog,1-2-3-4-5,3`,
        `${LINEUP},1,7:00,3:00,4:00,240,8,6,2,15.0,14.5,Te hoog,1-2-3-4-5,1`,
      ].join('\n'),
    );
  });
});

describe('correctSegment — afleiding en varianten', () => {
  it('leidt een oplopende klok af uit het bestaande segment', () => {
    const game = fixtureGame({
      segments: [seg({ id: 'u1', beginSec: 0, endSec: 100, durSec: 100, pf: 2, pa: 1 })],
      scoreFor: 2,
      scoreAgainst: 1,
    });
    const ok = correctSegment(game, 'u1', { endSec: 160 }, null, opts);
    expect(ok.ok && ok.game.segments[0]?.durSec).toBe(160);
    // Oplopend: begin 200 > eind 100 zou een aftellende klok betekenen en is ongeldig.
    expect(correctSegment(game, 'u1', { beginSec: 200 }, null, opts)).toEqual({
      ok: false,
      error: 'invalid-duration',
    });
  });

  it('behandelt een segment zonder tov als 0 en wijzigt alleen de gevraagde velden', () => {
    const game = fixtureGame({
      segments: [seg({ id: 'a', pf: 3, pa: 2 })],
      scoreFor: 3,
      scoreAgainst: 2,
    });
    expect(correctableFieldsOf(game.segments[0] as Segment).tov).toBe(0);
    const r = correctSegment(game, 'a', { pa: 5 }, null, opts);
    if (!r.ok) throw new Error('verwacht ok');
    expect(r.game.scoreAgainst).toBe(5);
    expect(r.game.scoreFor).toBe(3);
    expect(r.game.segments[0]).toMatchObject({ pf: 3, pa: 5, tov: 0, durSec: 180 });
  });

  it('behoudt punten die buiten een segment vielen (score += verschil, niet herberekend)', () => {
    const game = fixtureGame({ scoreFor: 20, scoreAgainst: 10 }); // 6 punten buiten segmenten
    const r = correctSegment(game, 's2', { pf: 10 }, null, opts);
    expect(r.ok && r.game.scoreFor).toBe(22);
  });

  it('een tweede correctie voegt een logitem toe en verhoogt revision opnieuw met 1', () => {
    const first = correctSegment(fixtureGame(), 's1', { pf: 7 }, null, opts);
    if (!first.ok) throw new Error('verwacht ok');
    const second = correctSegment(first.game, 's2', { tov: 0 }, 'u2', { ...opts, id: 'corr-2' });
    if (!second.ok) throw new Error('verwacht ok');
    expect(second.game.revision).toBe(2);
    expect(second.game.corrections?.map((c) => c.id)).toEqual(['corr-1', 'corr-2']);
    expect(second.game.corrections?.[1]?.before.tov).toBe(1);
  });

  it('een oude revision-loze wedstrijd telt als revision 0', () => {
    const legacy: Partial<CompletedGame> = { ...fixtureGame() };
    delete legacy.revision;
    const r = correctSegment(legacy as CompletedGame, 's1', { pf: 7 }, null, opts);
    expect(r.ok && r.game.revision).toBe(1);
  });

  it('een score-correctie faalt niet op een ongewijzigd, ouder tijdsveld buiten bereik', () => {
    const oldGame = fixtureGame({
      segments: [seg({ id: 'o', beginSec: 0, endSec: 900, durSec: 900, pf: 1 })],
      scoreFor: 1,
      scoreAgainst: 0,
    });
    const r = correctSegment(oldGame, 'o', { pf: 2 }, null, opts);
    expect(r.ok && r.game.segments[0]?.durSec).toBe(900);
  });
});

describe('correctSegment — ongeldige invoer geeft een foutresultaat en muteert niets', () => {
  const game = fixtureGame();
  const snapshot = JSON.stringify(game);
  const cases: [string, string, Parameters<typeof correctSegment>[2], string][] = [
    ['onbekend segment', 'nope', { pf: 1 }, 'unknown-segment'],
    ['duur 0', 's1', { endSec: 600 }, 'invalid-duration'],
    ['eindtijd boven begintijd bij aftellende klok', 's1', { endSec: 601 }, 'invalid-time'],
    ['negatieve duur binnen bereik', 's1', { beginSec: 400 }, 'invalid-duration'],
    ['tijd boven maximum', 's1', { beginSec: 601 }, 'invalid-time'],
    ['negatieve tijd', 's1', { endSec: -1 }, 'invalid-time'],
    ['niet-gehele tijd', 's1', { endSec: 300.5 }, 'invalid-time'],
    ['tov < 0', 's1', { tov: -1 }, 'invalid-turnovers'],
    ['tov niet-geheel', 's1', { tov: 1.5 }, 'invalid-turnovers'],
    ['tov NaN', 's1', { tov: Number.NaN }, 'invalid-turnovers'],
    ['pf < 0', 's1', { pf: -1 }, 'invalid-score'],
    ['pa > MAX_SCORE', 's1', { pa: MAX_SCORE + 1 }, 'invalid-score'],
    ['pf niet-geheel', 's1', { pf: 2.5 }, 'invalid-score'],
    ['eindscore boven MAX_SCORE', 's1', { pf: MAX_SCORE }, 'invalid-score'],
    ['kwart 0', 's1', { quarter: 0 }, 'invalid-quarter'],
    ['kwart boven quarterCount', 's1', { quarter: 5 }, 'invalid-quarter'],
    ['geen wijziging', 's1', { pf: 6, tov: 2 }, 'no-change'],
    ['lege patch', 's1', {}, 'no-change'],
  ];
  it.each(cases)('%s', (_name, id, patch, error) => {
    expect(correctSegment(game, id, patch, null, opts)).toEqual({ ok: false, error });
    expect(JSON.stringify(game)).toBe(snapshot);
  });

  it('weigert een getombstoned wedstrijd', () => {
    const deleted = fixtureGame({ deletedAt: '2026-01-02T00:00:00.000Z', deletedBy: 'u' });
    expect(correctSegment(deleted, 's1', { pf: 7 }, null, opts)).toEqual({
      ok: false,
      error: 'game-deleted',
    });
  });

  it('weigert een correctie wanneer het log vol is (max. 50)', () => {
    const entry = correctSegment(fixtureGame(), 's1', { pf: 7 }, null, opts);
    if (!entry.ok) throw new Error('verwacht ok');
    const full = fixtureGame({
      corrections: Array.from({ length: MAX_CORRECTIONS }, () => entry.correction),
    });
    expect(correctSegment(full, 's1', { pf: 7 }, null, opts)).toEqual({
      ok: false,
      error: 'log-full',
    });
  });
});

describe('back-upvalidatie van correctievelden', () => {
  const corrected = ((): CompletedGame => {
    const r = correctSegment(fixtureGame(), 's1', { endSec: 300, pf: 9, tov: 3 }, 'uid-1', opts);
    if (!r.ok) throw new Error('verwacht ok');
    return r.game;
  })();

  it('een oude back-up zonder correctievelden blijft laden', () => {
    expect(validateBackupData({ completedGames: [fixtureGame()] })).toEqual([]);
  });

  it('een gecorrigeerde wedstrijd doorstaat een export -> JSON -> import round-trip', () => {
    const payload = buildBackupPayload({
      settings: { ...DEFAULT_SETTINGS },
      completedGames: [corrected],
    });
    const parsed = parseBackupPayload(JSON.parse(JSON.stringify(payload)));
    expect(parsed.errors).toEqual([]);
    expect(parsed.data.completedGames).toEqual([corrected]);
  });

  it('weigert fout getypeerde correctievelden', () => {
    const invalid = (patch: Record<string, unknown>): boolean =>
      validateBackupData({
        completedGames: [{ ...corrected, ...patch } as unknown as CompletedGame],
      }).length > 0;
    const entry = corrected.corrections?.[0] as unknown as Record<string, unknown>;
    expect(invalid({})).toBe(false);
    expect(invalid({ corrections: 'x' })).toBe(true);
    expect(invalid({ corrections: null })).toBe(true);
    expect(invalid({ correctedAt: 123 })).toBe(true);
    expect(invalid({ correctedAt: 'niet-iso' })).toBe(true);
    expect(invalid({ corrections: [null] })).toBe(true);
    expect(invalid({ corrections: [{ ...entry, id: 5 }] })).toBe(true);
    expect(invalid({ corrections: [{ ...entry, by: 7 }] })).toBe(true);
    expect(invalid({ corrections: [{ ...entry, at: 'x' }] })).toBe(true);
    expect(invalid({ corrections: [{ ...entry, before: { pf: 1 } }] })).toBe(true);
    expect(
      invalid({ corrections: [{ ...entry, after: { ...(entry.after as object), tov: -1 } }] }),
    ).toBe(true);
    expect(invalid({ corrections: Array.from({ length: MAX_CORRECTIONS + 1 }, () => entry) })).toBe(
      true,
    );
  });
});
