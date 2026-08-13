// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  computePlayerTrends,
  pointPlusMinusValue,
} from '../../src/domain/trends/computePlayerTrends';
import type { TrendsFilter } from '../../src/domain/trends/types';
import type { AnalysisGame } from '../../src/domain/stats/types';
import type { GamePlayer, Segment } from '../../src/domain/game/types';
import type { RosterPlayer } from '../../src/domain/roster/types';

function gamePlayer(id: string, rosterId: number, nr: string, naam = `Speler ${nr}`): GamePlayer {
  return {
    id,
    rosterId,
    nr,
    naam,
    kl: '1.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
  };
}

function segment(id: string, lineup: string[], durSec: number, pf = 0, pa = 0): Segment {
  return {
    id,
    quarter: 1,
    beginSec: 0,
    endSec: durSec,
    durSec,
    lineup,
    pf,
    pa,
    classSum: 0,
    allowed: 0,
    over: false,
  };
}

function rosterPlayer(id: number, nr: string, naam = `Speler ${nr}`): RosterPlayer {
  return { id, nr, naam, kl: '1.0', vrouw: false, jeugd: false };
}

function baseFilter(overrides: Partial<TrendsFilter> = {}): TrendsFilter {
  return { per10: false, sortBy: 'nr', gameIds: null, ...overrides };
}

describe('domain/trends/computePlayerTrends — Voorbeeld 4 (docs/product-compatibility-matrix.md, plan §E.1)', () => {
  it('9:00 totaal, gemiddeld 4:30, gemiddeld +3,0 over twee wedstrijden; per-10 apart genormaliseerd naar +7,5 (NIET de 6,7-Stats-aggregatie)', () => {
    const p1 = gamePlayer('p1', 1, '1');
    const others = [
      gamePlayer('p2', 2, '2'),
      gamePlayer('p3', 3, '3'),
      gamePlayer('p4', 4, '4'),
      gamePlayer('p5', 5, '5'),
    ];
    const other1 = gamePlayer('p6', 6, '6');
    // Voorbeeld 4, letterlijk uit docs/product-compatibility-matrix.md:
    // Wedstrijd A: seg1 #1 speelt 3:00 pf=8 pa=6 (pm=+2); seg2 #1 speelt
    // 2:00 pf=6 pa=8 (pm=-2); seg3 #1 speelt NIET.
    const gameA: AnalysisGame = {
      id: 'A',
      opponent: 'A',
      competition: '',
      date: '2026-01-01T10:00:00.000Z',
      players: [p1, ...others, other1],
      segments: [
        segment('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 180, 8, 6),
        segment('A2', ['p1', 'p2', 'p3', 'p4', 'p5'], 120, 6, 8),
        segment('A3', ['p6', 'p2', 'p3', 'p4', 'p5'], 100, 4, 2), // #1 speelt niet
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    // Wedstrijd B: seg1 #1 speelt 4:00 pf=10 pa=4 (pm=+6); seg2 #1 speelt NIET.
    const gameB: AnalysisGame = {
      id: 'B',
      opponent: 'B',
      competition: '',
      date: '2026-01-08T10:00:00.000Z',
      players: [p1, ...others, other1],
      segments: [
        segment('B1', ['p1', 'p2', 'p3', 'p4', 'p5'], 240, 10, 4),
        segment('B2', ['p6', 'p2', 'p3', 'p4', 'p5'], 90, 3, 1), // #1 speelt niet
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const roster = [rosterPlayer(1, '1')];

    const result = computePlayerTrends([gameB, gameA], roster, baseFilter(), 'ok');
    expect(result.players).toHaveLength(1);
    const trend = result.players[0]!;
    expect(trend.points.map((p) => p.gameId)).toEqual(['A', 'B']);
    // Wedstrijd A: sec = 180+120 = 300, pm = 2 + (-2) = 0.
    expect(trend.points[0]).toMatchObject({ gameId: 'A', sec: 300, pm: 0 });
    // Wedstrijd B: sec = 240, pm = 6.
    expect(trend.points[1]).toMatchObject({ gameId: 'B', sec: 240, pm: 6 });
    const totalSec = trend.points.reduce((a, p) => a + p.sec, 0);
    expect(totalSec).toBe(540); // 9:00
    expect(trend.avgMinutes).toBeCloseTo(4.5, 6);
    // Raw gemiddelde pm: (0 + 6) / 2 = +3,0 (matrix §Voorbeeld 4).
    expect(trend.avgPlusMinus).toBeCloseTo(3.0, 6);

    const per10Result = computePlayerTrends(
      [gameB, gameA],
      roster,
      baseFilter({ per10: true }),
      'ok',
    );
    const per10Trend = per10Result.players[0]!;
    // v1-per-punt-per-10-contract (plan §C.2): elk wedstrijdpunt eerst apart
    // genormaliseerd (pm*600/sec), pas daarna gemiddeld — (0*600/300 +
    // 6*600/240) / 2 = 7,5. Bewust NIET de 6,7 uit de Stats-matrix, die één
    // keer over de opgetelde seconden normaliseert (6*600/540); dat getal
    // hoort bij Stats' lineup-aggregatie, niet bij het Trends-per-punt-contract.
    const expectedPer10 = ((0 * 600) / 300 + (6 * 600) / 240) / 2;
    expect(expectedPer10).toBeCloseTo(7.5, 6);
    expect(per10Trend.avgPlusMinus).toBeCloseTo(expectedPer10, 6);
    expect(per10Trend.avgPlusMinus).not.toBeCloseTo((6 * 600) / 540, 3);
  });
});

describe('domain/trends/computePlayerTrends — identiteit en deelname (plan §E.2-3)', () => {
  it('dezelfde rosterId met verschillende game-player-UUIDs vormt één trend', () => {
    const gameA: AnalysisGame = {
      id: 'A',
      opponent: 'A',
      competition: '',
      date: '2026-01-01T10:00:00.000Z',
      players: [
        gamePlayer('uuid-a', 1, '1'),
        gamePlayer('a2', 2, '2'),
        gamePlayer('a3', 3, '3'),
        gamePlayer('a4', 4, '4'),
        gamePlayer('a5', 5, '5'),
      ],
      segments: [segment('A1', ['uuid-a', 'a2', 'a3', 'a4', 'a5'], 100, 2, 1)],
      scoreFor: 2,
      scoreAgainst: 1,
      isCurrent: false,
    };
    const gameB: AnalysisGame = {
      id: 'B',
      opponent: 'B',
      competition: '',
      date: '2026-01-08T10:00:00.000Z',
      players: [
        gamePlayer('uuid-b', 1, '1'),
        gamePlayer('b2', 2, '2'),
        gamePlayer('b3', 3, '3'),
        gamePlayer('b4', 4, '4'),
        gamePlayer('b5', 5, '5'),
      ],
      segments: [segment('B1', ['uuid-b', 'b2', 'b3', 'b4', 'b5'], 80, 1, 0)],
      scoreFor: 1,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const result = computePlayerTrends([gameB, gameA], [rosterPlayer(1, '1')], baseFilter(), 'ok');
    expect(result.players).toHaveLength(1);
    expect(result.players[0]!.points).toHaveLength(2);
  });

  it('niet meegedaan levert geen punt op en telt niet mee in de deler; nul plus/min blijft wel een punt', () => {
    const others = [
      gamePlayer('p2', 2, '2'),
      gamePlayer('p3', 3, '3'),
      gamePlayer('p4', 4, '4'),
      gamePlayer('p5', 5, '5'),
      gamePlayer('p6', 6, '6'),
    ];
    const gameA: AnalysisGame = {
      id: 'A',
      opponent: 'A',
      competition: '',
      date: '2026-01-01T10:00:00.000Z',
      players: [gamePlayer('p1', 1, '1'), ...others],
      segments: [segment('A1', ['p2', 'p3', 'p4', 'p5', 'p6'], 100, 2, 2)], // speler 1 niet op het veld
      scoreFor: 2,
      scoreAgainst: 2,
      isCurrent: false,
    };
    const gameB: AnalysisGame = {
      id: 'B',
      opponent: 'B',
      competition: '',
      date: '2026-01-08T10:00:00.000Z',
      players: [gamePlayer('p1', 1, '1'), ...others],
      segments: [segment('B1', ['p1', 'p3', 'p4', 'p5', 'p6'], 60, 3, 3)], // gelijkspel: pm = 0
      scoreFor: 3,
      scoreAgainst: 3,
      isCurrent: false,
    };
    const result = computePlayerTrends([gameB, gameA], [rosterPlayer(1, '1')], baseFilter(), 'ok');
    const trend = result.players[0]!;
    expect(trend.points).toHaveLength(1); // alleen wedstrijd B
    expect(trend.points[0]!.pm).toBe(0);
    expect(trend.avgMinutes).toBeCloseTo(1, 6); // 60s / 60 / 1 wedstrijd
  });
});

describe('domain/trends/computePlayerTrends — chronologie en actuele wedstrijd (plan §E.4)', () => {
  it('afgerond oud -> nieuw en actieve wedstrijd altijd voorlopig als laatste', () => {
    const p = [
      gamePlayer('p1', 1, '1'),
      gamePlayer('p2', 2, '2'),
      gamePlayer('p3', 3, '3'),
      gamePlayer('p4', 4, '4'),
      gamePlayer('p5', 5, '5'),
    ];
    const gameNew: AnalysisGame = {
      id: 'new',
      opponent: 'Nieuw',
      competition: '',
      date: '2026-02-01T10:00:00.000Z',
      players: p,
      segments: [segment('n1', ['p1', 'p2', 'p3', 'p4', 'p5'], 60)],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const gameOld: AnalysisGame = {
      id: 'old',
      opponent: 'Oud',
      competition: '',
      date: '2026-01-01T10:00:00.000Z',
      players: p,
      segments: [segment('o1', ['p1', 'p2', 'p3', 'p4', 'p5'], 60)],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const gameCurrent: AnalysisGame = {
      id: 'current',
      opponent: 'Actueel',
      competition: '',
      date: new Date().toISOString(),
      players: p,
      segments: [segment('c1', ['p1', 'p2', 'p3', 'p4', 'p5'], 60)],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: true,
    };
    // opslagvolgorde: nieuwste-eerst, actuele wedstrijd vooraan (zoals buildAnalysisScope)
    const games = [gameCurrent, gameNew, gameOld];
    const result = computePlayerTrends(games, [rosterPlayer(1, '1')], baseFilter(), 'ok');
    const points = result.players[0]!.points;
    expect(points.map((pt) => pt.gameId)).toEqual(['old', 'new', 'current']);
    expect(points[2]!.provisional).toBe(true);
    expect(points[0]!.provisional).toBe(false);
    expect(points[1]!.provisional).toBe(false);
  });
});

describe('domain/trends/computePlayerTrends — wedstrijdfilter en sortering (plan §E.5-6)', () => {
  const p = [
    gamePlayer('p1', 1, '1'),
    gamePlayer('p2', 2, '2'),
    gamePlayer('p3', 3, '3'),
    gamePlayer('p4', 4, '4'),
    gamePlayer('p5', 5, '5'),
  ];
  const gameA: AnalysisGame = {
    id: 'A',
    opponent: 'A',
    competition: '',
    date: '2026-01-01T10:00:00.000Z',
    players: p,
    segments: [segment('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 100, 5, 0)],
    scoreFor: 5,
    scoreAgainst: 0,
    isCurrent: false,
  };
  const gameB: AnalysisGame = {
    id: 'B',
    opponent: 'B',
    competition: '',
    date: '2026-01-08T10:00:00.000Z',
    players: p,
    segments: [segment('B1', ['p1', 'p2', 'p3', 'p4', 'p5'], 200, 1, 1)],
    scoreFor: 1,
    scoreAgainst: 1,
    isCurrent: false,
  };

  it('wedstrijdfilter beperkt de scope net als Stats', () => {
    const roster = [rosterPlayer(1, '1')];
    const filtered = computePlayerTrends(
      [gameB, gameA],
      roster,
      baseFilter({ gameIds: new Set(['A']) }),
      'ok',
    );
    expect(filtered.players[0]!.points.map((pt) => pt.gameId)).toEqual(['A']);
  });

  it('sorteercyclus: rugnummer -> gemiddelde minuten -> gemiddelde plus/min, stabiele tiebreak', () => {
    const roster = [rosterPlayer(2, '2'), rosterPlayer(1, '1')];
    const byNr = computePlayerTrends([gameB, gameA], roster, baseFilter({ sortBy: 'nr' }), 'ok');
    expect(byNr.players.map((pl) => pl.rosterId)).toEqual([1, 2]);

    const byMinutes = computePlayerTrends(
      [gameB, gameA],
      roster,
      baseFilter({ sortBy: 'minutes' }),
      'ok',
    );
    // beide spelers hebben identieke gemiddelden -> stabiele rosterId-tiebreak
    expect(byMinutes.players.map((pl) => pl.rosterId)).toEqual([1, 2]);
  });
});

describe('domain/trends/computePlayerTrends — schalen en verwijderde spelers (plan §E.7-9)', () => {
  it('gedeeld minutenmaximum over alle zichtbare spelers en wedstrijden', () => {
    const p1 = gamePlayer('p1', 1, '1');
    const p2 = gamePlayer('p2', 2, '2');
    const others = [gamePlayer('p3', 3, '3'), gamePlayer('p4', 4, '4'), gamePlayer('p5', 5, '5')];
    const game: AnalysisGame = {
      id: 'A',
      opponent: 'A',
      competition: '',
      date: '2026-01-01T10:00:00.000Z',
      players: [p1, p2, ...others],
      segments: [
        segment('s1', ['p1', 'p3', 'p4', 'p5', 'p2'], 600), // beiden 10 min
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const roster = [rosterPlayer(1, '1'), rosterPlayer(2, '2')];
    const result = computePlayerTrends([game], roster, baseFilter(), 'ok');
    expect(result.sharedMaxMinutes).toBeCloseTo(10, 6);
  });

  it('verwijderde historische speler krijgt geen kaart; onbekende referentie levert PARTIAL', () => {
    const p1 = gamePlayer('p1', 1, '1');
    const others = [
      gamePlayer('p2', 2, '2'),
      gamePlayer('p3', 3, '3'),
      gamePlayer('p4', 4, '4'),
      gamePlayer('p5', 5, '5'),
    ];
    const game: AnalysisGame = {
      id: 'A',
      opponent: 'A',
      competition: '',
      date: '2026-01-01T10:00:00.000Z',
      players: [p1, ...others],
      segments: [
        segment('good', ['p1', 'p2', 'p3', 'p4', 'p5'], 100, 1, 0),
        segment('bad', ['unknown-id', 'p2', 'p3', 'p4', 'p5'], 50, 0, 1),
      ],
      scoreFor: 1,
      scoreAgainst: 1,
      isCurrent: false,
    };
    // speler 1 bestaat wel in de historische snapshot, maar niet meer in de actuele roster
    const roster = [
      rosterPlayer(2, '2'),
      rosterPlayer(3, '3'),
      rosterPlayer(4, '4'),
      rosterPlayer(5, '5'),
    ];
    const result = computePlayerTrends([game], roster, baseFilter(), 'ok');
    expect(result.players.find((pl) => pl.rosterId === 1)).toBeUndefined();
    expect(result.partialSegments).toBe(1);
    expect(result.dataOrigin).toBe('partial');
  });

  it('dataOrigin blijft error/local-complete/partial onderscheidbaar', () => {
    const roster = [rosterPlayer(1, '1')];
    expect(computePlayerTrends([], roster, baseFilter(), 'error').dataOrigin).toBe('error');
    expect(computePlayerTrends([], roster, baseFilter(), 'missing').dataOrigin).toBe(
      'local-complete',
    );
    expect(computePlayerTrends([], roster, baseFilter(), 'ok').dataOrigin).toBe('local-complete');
  });
});

describe('domain/trends/computePlayerTrends — pointPlusMinusValue', () => {
  it('valt terug op raw pm wanneer sec <= 0, ook bij per10', () => {
    expect(
      pointPlusMinusValue(
        { gameId: 'x', opponent: '', date: '', sec: 0, pm: 5, provisional: false },
        true,
      ),
    ).toBe(5);
  });
});
