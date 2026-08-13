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

describe('domain/trends/computePlayerTrends — Voorbeeld 4 (plan §E.1)', () => {
  it('9:00 totaal, gemiddeld 4:30, gemiddeld +1,5 over twee wedstrijden; per-10 apart genormaliseerd', () => {
    const p1 = gamePlayer('p1', 1, '1');
    const others = [
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
      players: [p1, ...others],
      segments: [segment('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 300, 8, 6)],
      scoreFor: 8,
      scoreAgainst: 6,
      isCurrent: false,
    };
    const gameB: AnalysisGame = {
      id: 'B',
      opponent: 'B',
      competition: '',
      date: '2026-01-08T10:00:00.000Z',
      players: [p1, ...others],
      segments: [segment('B1', ['p1', 'p2', 'p3', 'p4', 'p5'], 240, 5, 4)],
      scoreFor: 5,
      scoreAgainst: 4,
      isCurrent: false,
    };
    const roster = [rosterPlayer(1, '1')];

    const result = computePlayerTrends([gameB, gameA], roster, baseFilter(), 'ok');
    expect(result.players).toHaveLength(1);
    const trend = result.players[0]!;
    expect(trend.points.map((p) => p.gameId)).toEqual(['A', 'B']);
    const totalSec = trend.points.reduce((a, p) => a + p.sec, 0);
    expect(totalSec).toBe(540); // 9:00
    expect(trend.avgMinutes).toBeCloseTo(4.5, 6);
    expect(trend.avgPlusMinus).toBeCloseTo(1.5, 6);

    const per10Result = computePlayerTrends(
      [gameB, gameA],
      roster,
      baseFilter({ per10: true }),
      'ok',
    );
    const per10Trend = per10Result.players[0]!;
    // per punt genormaliseerd (v1: pm*600/sec), NIET één normalisatie over de opgetelde seconden.
    const expectedPer10 = ((2 * 600) / 300 + (1 * 600) / 240) / 2;
    expect(per10Trend.avgPlusMinus).toBeCloseTo(expectedPer10, 6);
    expect(expectedPer10).not.toBeCloseTo((3 * 600) / 540, 3);
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
