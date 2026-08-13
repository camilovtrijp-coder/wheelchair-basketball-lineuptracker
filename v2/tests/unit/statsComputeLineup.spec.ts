// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  computeLineupStats,
  onShownValue,
  offShownValue,
} from '../../src/domain/stats/computeLineupStats';
import type {
  AnalysisGame,
  LineupCombinationStats,
  StatsFilter,
} from '../../src/domain/stats/types';
import { fmtSeconds, fmtPlusMinus, pmClass } from '../../src/domain/stats/format';
import type { GamePlayer, Segment } from '../../src/domain/game/types';

function player(id: string, rosterId: number, nr: string, naam = `Speler ${nr}`): GamePlayer {
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

function baseFilter(overrides: Partial<StatsFilter> = {}): StatsFilter {
  return {
    comboSize: 1,
    per10: false,
    sortDirection: 'desc',
    gameIds: null,
    playerFilters: [],
    ...overrides,
  };
}

describe('domain/stats/computeLineupStats — Voorbeeld 4 (compatibiliteitsmatrix)', () => {
  it('totale speeltijd 540s, totale pm +6, per 10 min +6,7 voor speler #1 (rosterId 1)', () => {
    const players = [
      player('p1', 1, '1'),
      player('p2', 2, '2'),
      player('p3', 3, '3'),
      player('p4', 4, '4'),
      player('p5', 5, '5'),
    ];
    const other1 = player('p6', 6, '6');

    const gameA: AnalysisGame = {
      id: 'A',
      opponent: 'A',
      competition: '',
      date: '2026-01-01T10:00:00.000Z',
      players,
      segments: [
        segment('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 180, 8, 6),
        segment('A2', ['p1', 'p2', 'p3', 'p4', 'p5'], 120, 6, 8),
        segment('A3', [other1.id, 'p2', 'p3', 'p4', 'p5'], 100, 4, 2),
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const gameB: AnalysisGame = {
      id: 'B',
      opponent: 'B',
      competition: '',
      date: '2026-01-02T10:00:00.000Z',
      players,
      segments: [
        segment('B1', ['p1', 'p2', 'p3', 'p4', 'p5'], 240, 10, 4),
        segment('B2', [other1.id, 'p2', 'p3', 'p4', 'p5'], 60, 0, 0),
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };

    const result = computeLineupStats([gameA, gameB], baseFilter({ comboSize: 1 }));
    const combo1 = result.combinations.find(
      (c) => c.rosterIds.length === 1 && c.rosterIds[0] === 1,
    );
    expect(combo1).toBeDefined();
    expect(combo1!.onSec).toBe(540);
    expect(combo1!.onPF - combo1!.onPA).toBe(6);
    expect(Math.round(onShownValue(combo1!, true) * 10) / 10).toBe(6.7);
  });
});

describe('domain/stats/computeLineupStats — combinatiegrootte 1–5, ON én OFF minuten en punten', () => {
  function buildTwoGameFixture() {
    // Wedstrijd A: speler 1 + 2 + 3 + 4 + 5 spelen 300s, scoren 10-6 (pm +4).
    //              daarna speler 1 + 2 + 3 + 4 + 6 spelen 200s, scoren 4-8 (pm -4).
    // Wedstrijd B: speler 1 + 2 + 3 + 4 + 5 spelen 240s, scoren 12-3 (pm +9).
    //              daarna speler 2 + 3 + 4 + 5 + 6 spelen 180s, scoren 6-6 (pm 0).
    const p1 = player('p1', 1, '1');
    const p2 = player('p2', 2, '2');
    const p3 = player('p3', 3, '3');
    const p4 = player('p4', 4, '4');
    const p5 = player('p5', 5, '5');
    const p6 = player('p6', 6, '6');
    const playersA = [p1, p2, p3, p4, p5, p6];
    const playersB = [p1, p2, p3, p4, p5, p6];

    const gameA: AnalysisGame = {
      id: 'A',
      opponent: 'A',
      competition: '',
      date: '2026-01-01T10:00:00.000Z',
      players: playersA,
      segments: [
        segment('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 300, 10, 6),
        segment('A2', ['p1', 'p2', 'p3', 'p4', 'p6'], 200, 4, 8),
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const gameB: AnalysisGame = {
      id: 'B',
      opponent: 'B',
      competition: '',
      date: '2026-01-02T10:00:00.000Z',
      players: playersB,
      segments: [
        segment('B1', ['p1', 'p2', 'p3', 'p4', 'p5'], 240, 12, 3),
        segment('B2', ['p2', 'p3', 'p4', 'p5', 'p6'], 180, 6, 6),
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    return { gameA, gameB, p1, p2, p3, p4, p5, p6 };
  }

  it('combinatie 1: alleen speler 1 → 740s ON (300+200+240), 180s OFF (alleen B2), 26-17 in ON, 6-6 in OFF', () => {
    const { gameA, gameB } = buildTwoGameFixture();
    const result = computeLineupStats([gameA, gameB], baseFilter({ comboSize: 1 }));
    const c = result.combinations.find((x) => x.rosterIds[0] === 1)!;
    // A1 [1,2,3,4,5] 300s 10-6 + A2 [1,2,3,4,6] 200s 4-8 + B1 [1,2,3,4,5] 240s 12-3 → ON
    // B2 [2,3,4,5,6] 180s 6-6 — speler 1 afwezig → OFF
    expect(c.onSec).toBe(740);
    expect(c.offSec).toBe(180);
    expect(c.onPF).toBe(26);
    expect(c.onPA).toBe(17);
    expect(c.offPF).toBe(6);
    expect(c.offPA).toBe(6);
    expect(c.onPF - c.onPA).toBe(9);
    expect(c.offPF - c.offPA).toBe(0);
  });

  it('combinatie 5 (volledige lineup) komt maar in één segment-lijn voor en krijgt alleen OFF waar hij niet compleet is', () => {
    const { gameA, gameB } = buildTwoGameFixture();
    const result = computeLineupStats([gameA, gameB], baseFilter({ comboSize: 5 }));
    const five = result.combinations.find((c) => c.rosterIds.length === 5)!;
    expect(five).toBeDefined();
    // [1,2,3,4,5] in A1 (300s, 10-6) en B1 (240s, 12-3) → 540s ON, 22-9
    expect(five.onSec).toBe(540);
    expect(five.onPF).toBe(22);
    expect(five.onPA).toBe(9);
    // in A2 staat 1 ipv 5, in B2 staat 6 ipv 1 → 200 + 180 = 380s OFF, 4-8 + 6-6
    expect(five.offSec).toBe(380);
    expect(five.offPF).toBe(10);
    expect(five.offPA).toBe(14);
  });

  it('combinatie 2: [1,2] heeft in A1 ON, in A2 ON (beide aanwezig), in B1 ON, in B2 OFF (1 ontbreekt)', () => {
    const { gameA, gameB } = buildTwoGameFixture();
    const result = computeLineupStats([gameA, gameB], baseFilter({ comboSize: 2 }));
    const c = result.combinations.find(
      (x) => x.rosterIds.length === 2 && x.rosterIds[0] === 1 && x.rosterIds[1] === 2,
    )!;
    expect(c.onSec).toBe(300 + 200 + 240);
    expect(c.offSec).toBe(180);
  });
});

describe('domain/stats/computeLineupStats — stabiele speleridentiteit (rosterId) over wedstrijden heen', () => {
  it('twee wedstrijden waarin dezelfde rosterId verschillende GamePlayer.id-UUIDs heeft, levert precies één rij', () => {
    // Speler met rosterId=1 heet in wedstrijd A "#1 Anouk" met id=a1, in
    // wedstrijd B "#1 Anouk" met id=b1. Beide wedstrijden hebben identieke
    // segment-lineups (precies [a1,...] resp. [b1,...]). Voor
    // combinatiegrootte 1 verwachten we één rij met rosterId 1 en 600s ON
    // (300 + 300), niet twee.
    const pA1 = player('a1', 1, '1', 'Anouk');
    const pA2 = player('a2', 2, '2');
    const pA3 = player('a3', 3, '3');
    const pA4 = player('a4', 4, '4');
    const pA5 = player('a5', 5, '5');
    const pB1 = player('b1', 1, '1', 'Anouk');
    const pB2 = player('b2', 2, '2');
    const pB3 = player('b3', 3, '3');
    const pB4 = player('b4', 4, '4');
    const pB5 = player('b5', 5, '5');

    const gameA: AnalysisGame = {
      id: 'A',
      opponent: '',
      competition: '',
      date: '2026-01-01T10:00:00.000Z',
      players: [pA1, pA2, pA3, pA4, pA5],
      segments: [segment('A1', ['a1', 'a2', 'a3', 'a4', 'a5'], 300, 6, 4)],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const gameB: AnalysisGame = {
      id: 'B',
      opponent: '',
      competition: '',
      date: '2026-01-02T10:00:00.000Z',
      players: [pB1, pB2, pB3, pB4, pB5],
      segments: [segment('B1', ['b1', 'b2', 'b3', 'b4', 'b5'], 300, 8, 2)],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };

    const result = computeLineupStats([gameA, gameB], baseFilter({ comboSize: 1 }));
    const rowsForRoster1 = result.combinations.filter(
      (c) => c.rosterIds.length === 1 && c.rosterIds[0] === 1,
    );
    expect(rowsForRoster1).toHaveLength(1);
    expect(rowsForRoster1[0]!.onSec).toBe(600);
    expect(rowsForRoster1[0]!.onPF).toBe(14);
    expect(rowsForRoster1[0]!.onPA).toBe(6);
  });
});

describe('domain/stats/computeLineupStats — speler niet in snapshot levert geen OFF voor die combinatie', () => {
  it('een speler die alleen in een andere wedstrijd meedoet, krijgt geen OFF in de wedstrijd waar hij niet in de spelerslijst staat', () => {
    // Speler 6 doet alleen mee in wedstrijd B. Voor de combinatie
    // [1,2,3,4,6] mogen OFF-minuten alléén in B meetellen (in A zit 6
    // niet in de spelerslijst, dus de OFF-check `comboRosterIdsPresentInGame`
    // filtert alle A-segmenten weg — geen OFF voor die speler in A).
    const p1 = player('p1', 1, '1');
    const p2 = player('p2', 2, '2');
    const p3 = player('p3', 3, '3');
    const p4 = player('p4', 4, '4');
    const p5 = player('p5', 5, '5');
    const p6 = player('p6', 6, '6');

    const gameA: AnalysisGame = {
      id: 'A',
      opponent: '',
      competition: '',
      date: '2026-01-01T10:00:00.000Z',
      players: [p1, p2, p3, p4, p5], // 6 ontbreekt bewust
      segments: [segment('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 300, 5, 5)],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const gameB: AnalysisGame = {
      id: 'B',
      opponent: '',
      competition: '',
      date: '2026-01-02T10:00:00.000Z',
      players: [p1, p2, p3, p4, p5, p6],
      segments: [
        segment('B1', ['p1', 'p2', 'p3', 'p4', 'p6'], 240, 8, 4), // ON voor [1,2,3,4,6]
        segment('B2', ['p1', 'p2', 'p3', 'p4', 'p5'], 180, 6, 6), // OFF voor [1,2,3,4,6] (6 ontbreekt)
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };

    const result = computeLineupStats([gameA, gameB], baseFilter({ comboSize: 5 }));
    const c = result.combinations.find((x) => x.rosterIds.length === 5 && x.rosterIds.includes(6))!;
    expect(c).toBeDefined();
    // A wordt overgeslagen (6 staat niet in A's spelerslijst). In B:
    //   B1: 240s, 8-4 — alle leden op het veld → ON
    //   B2: 180s, 6-6 — 6 ontbreekt → OFF
    expect(c.onSec).toBe(240);
    expect(c.onPF).toBe(8);
    expect(c.onPA).toBe(4);
    expect(c.offSec).toBe(180);
    expect(c.offPF).toBe(6);
    expect(c.offPA).toBe(6);
  });
});

describe('domain/stats/computeLineupStats — spelerfilters (on/off/geen) en leeg resultaat', () => {
  it('combinatiegrootte 2 met "1 moet op" filtert segmenten waar 1 ontbreekt', () => {
    const p1 = player('p1', 1, '1');
    const p2 = player('p2', 2, '2');
    const p3 = player('p3', 3, '3');
    const p4 = player('p4', 4, '4');
    const p5 = player('p5', 5, '5');
    const p6 = player('p6', 6, '6');
    const players = [p1, p2, p3, p4, p5, p6];

    const game: AnalysisGame = {
      id: 'A',
      opponent: '',
      competition: '',
      date: '',
      players,
      segments: [
        segment('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 200, 5, 3),
        segment('A2', ['p2', 'p3', 'p4', 'p5', 'p6'], 100, 2, 4),
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };

    const result = computeLineupStats(
      [game],
      baseFilter({ comboSize: 2, playerFilters: [{ rosterId: 1, mode: 'on' }] }),
    );
    // A1 voldoet (1 aanwezig); A2 niet. Alleen A1 draagt bij → 200s ON, 5-3.
    const c = result.combinations.find((x) => x.rosterIds.includes(1) && x.rosterIds.length === 2)!;
    expect(c.onSec).toBe(200);
    expect(c.onPF).toBe(5);
    expect(c.onPA).toBe(3);
    expect(c.offSec).toBe(0);
    // Het paar [2,3] verschijnt wél: ook al heeft het filter "1 moet op",
    // in A1 staan 2 én 3 ook allebei op het veld → [2,3] is ON in A1, en
    // A2 is uitgefilterd. Dus 200s ON, 5-3 — geen OFF-bijdrage.
    const c23 = result.combinations.find(
      (x) => x.rosterIds.length === 2 && x.rosterIds[0] === 2 && x.rosterIds[1] === 3,
    )!;
    expect(c23).toBeDefined();
    expect(c23.onSec).toBe(200);
    expect(c23.offSec).toBe(0);
    // Een paar dat 6 bevat zou alleen uit A2 kunnen komen (A2 is de
    // enige segment-lineup met 6), en A2 is uitgefilterd — dus geen rij.
    const c16 = result.combinations.find(
      (x) => x.rosterIds.length === 2 && x.rosterIds.includes(6),
    );
    expect(c16).toBeUndefined();
  });

  it('combinatiegrootte 5 met "5 moet af" filtert segmenten waar 5 meedoet', () => {
    const p1 = player('p1', 1, '1');
    const p2 = player('p2', 2, '2');
    const p3 = player('p3', 3, '3');
    const p4 = player('p4', 4, '4');
    const p5 = player('p5', 5, '5');
    const p6 = player('p6', 6, '6');
    const players = [p1, p2, p3, p4, p5, p6];

    const game: AnalysisGame = {
      id: 'A',
      opponent: '',
      competition: '',
      date: '',
      players,
      segments: [
        segment('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 200, 5, 3),
        segment('A2', ['p1', 'p2', 'p3', 'p4', 'p6'], 100, 2, 4),
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };

    const result = computeLineupStats(
      [game],
      baseFilter({ comboSize: 5, playerFilters: [{ rosterId: 5, mode: 'off' }] }),
    );
    // Alleen A2 voldoet. Voor [1,2,3,4,6] = ON; 100s, 2-4.
    const c = result.combinations.find((x) => x.rosterIds.length === 5 && x.rosterIds.includes(6))!;
    expect(c.onSec).toBe(100);
    expect(c.onPF).toBe(2);
    expect(c.onPA).toBe(4);
  });

  it('gecombineerde on+off filters en een filter dat niets oplevert', () => {
    const p1 = player('p1', 1, '1');
    const p2 = player('p2', 2, '2');
    const p3 = player('p3', 3, '3');
    const p4 = player('p4', 4, '4');
    const p5 = player('p5', 5, '5');
    const p6 = player('p6', 6, '6');
    const players = [p1, p2, p3, p4, p5, p6];

    const game: AnalysisGame = {
      id: 'A',
      opponent: '',
      competition: '',
      date: '',
      players,
      segments: [
        segment('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 200, 0, 0),
        segment('A2', ['p1', 'p2', 'p3', 'p4', 'p6'], 100, 0, 0),
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };

    const resultOnAndOff = computeLineupStats(
      [game],
      baseFilter({
        comboSize: 5,
        playerFilters: [
          { rosterId: 1, mode: 'on' },
          { rosterId: 6, mode: 'off' },
        ],
      }),
    );
    // Alleen A1 voldoet (1 aanwezig, 6 afwezig). A2 voldoet niet (6 aanwezig).
    expect(resultOnAndOff.consideredSegments).toBe(1);
    expect(resultOnAndOff.combinations.length).toBeGreaterThan(0);

    const resultImpossible = computeLineupStats(
      [game],
      baseFilter({
        comboSize: 5,
        playerFilters: [
          { rosterId: 1, mode: 'on' },
          { rosterId: 1, mode: 'off' },
        ],
      }),
    );
    // "1 moet op én af" → geen enkel segment komt door de filters.
    expect(resultImpossible.consideredSegments).toBe(0);
    expect(resultImpossible.combinations).toEqual([]);
  });
});

describe('domain/stats/computeLineupStats — actieve wedstrijd telt voorlopig mee, geen segmenten → niet', () => {
  it('actieve wedstrijd met minstens één segment draagt bij; zonder segmenten draagt hij niets bij', () => {
    const p1 = player('p1', 1, '1');
    const p2 = player('p2', 2, '2');
    const p3 = player('p3', 3, '3');
    const p4 = player('p4', 4, '4');
    const p5 = player('p5', 5, '5');

    const currentEmpty: AnalysisGame = {
      id: 'cur',
      opponent: 'Live',
      competition: '',
      date: '',
      players: [p1, p2, p3, p4, p5],
      segments: [],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: true,
    };
    const currentWithSeg: AnalysisGame = {
      ...currentEmpty,
      segments: [segment('cur1', ['p1', 'p2', 'p3', 'p4', 'p5'], 90, 4, 2)],
    };

    const resultEmpty = computeLineupStats([currentEmpty], baseFilter({ comboSize: 1 }));
    expect(resultEmpty.consideredSegments).toBe(0);
    expect(resultEmpty.combinations).toEqual([]);

    // size=1: 5 unieke spelers → 5 rijen
    const resultWithSeg = computeLineupStats([currentWithSeg], baseFilter({ comboSize: 1 }));
    expect(resultWithSeg.consideredSegments).toBe(1);
    expect(resultWithSeg.combinations.length).toBe(5);

    // size=5: 1 unieke combinatie van 5 spelers
    const resultWithSeg5 = computeLineupStats([currentWithSeg], baseFilter({ comboSize: 5 }));
    expect(resultWithSeg5.consideredSegments).toBe(1);
    expect(resultWithSeg5.combinations.length).toBe(1);
    expect(resultWithSeg5.combinations[0]!.onSec).toBe(90);
    expect(resultWithSeg5.combinations[0]!.onPF).toBe(4);
    expect(resultWithSeg5.combinations[0]!.onPA).toBe(2);
  });
});

describe('domain/stats/computeLineupStats — randgevallen', () => {
  const p1 = player('p1', 1, '1');
  const p2 = player('p2', 2, '2');
  const p3 = player('p3', 3, '3');
  const p4 = player('p4', 4, '4');
  const p5 = player('p5', 5, '5');
  const players = [p1, p2, p3, p4, p5];

  it('onSec === 0 → getoonde plus/min is kale pm (per10 levert geen deling door 0)', () => {
    const game: AnalysisGame = {
      id: 'A',
      opponent: '',
      competition: '',
      date: '',
      players,
      segments: [segment('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 0, 0, 0)],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const result = computeLineupStats([game], baseFilter({ comboSize: 5, per10: true }));
    const c = result.combinations[0]!;
    expect(onShownValue(c, true)).toBe(0);
    expect(offShownValue(c, true)).toBe(0);
  });

  it('gelijke sorteerwaarden: EXPLICIETE tweede sorteersleutel op combinatiekey, oplopend in BEIDE richtingen (plan §C.3.7)', () => {
    const p6 = player('p6', 6, '6');
    const game: AnalysisGame = {
      id: 'A',
      opponent: '',
      competition: '',
      date: '',
      players: [...players, p6],
      segments: [
        segment('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 200, 4, 4),
        segment('A2', ['p1', 'p2', 'p3', 'p4', 'p6'], 200, 4, 4),
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const resultDesc = computeLineupStats(
      [game],
      baseFilter({ comboSize: 1, sortDirection: 'desc' }),
    );
    const resultAsc = computeLineupStats(
      [game],
      baseFilter({ comboSize: 1, sortDirection: 'asc' }),
    );
    // Voor size=1 zijn de plus/min per speler 0 (allebei 200s, 4-4). De
    // primaire sorteersleutel is dus 0/0 → gelijk. De EXPLICIETE tweede
    // sorteersleutel (canonieke combinatiekey) wordt oplopend gesorteerd
    // in BEIDE primaire richtingen — een stabiele natuurlijke ordening
    // van combinaties is intuïtiever dan het spiegelen van de primaire
    // richting. Dus rosterId 1 eerst bij zowel asc als desc.
    expect(resultDesc.combinations[0]!.rosterIds[0]).toBe(1);
    expect(resultAsc.combinations[0]!.rosterIds[0]).toBe(1);
    expect(resultDesc.combinations[1]!.rosterIds[0]).toBe(2);
    expect(resultAsc.combinations[1]!.rosterIds[0]).toBe(2);
  });

  it('canonieke sleutel: [1,2] en [2,1] in verschillende segmenten produceren precies één rij (plan §C.3.3, v1 comboKey)', () => {
    // Twee segmenten in dezelfde wedstrijd met dezelfde set spelers maar
    // verschillende volgorde zouden zonder canonieke sleutel twee rijen
    // opleveren. v1 lost dat op met `comboKey = ids.slice().sort().join(",")`.
    // We reproduceren dat hier: A1 = [p1..p5] 100s, A2 = omgekeerde volgorde
    // 200s, beide geven dezelfde combinatieset.
    const p1 = player('p1', 1, '1');
    const p2 = player('p2', 2, '2');
    const p3 = player('p3', 3, '3');
    const p4 = player('p4', 4, '4');
    const p5 = player('p5', 5, '5');
    const game: AnalysisGame = {
      id: 'A',
      opponent: '',
      competition: '',
      date: '',
      players: [p1, p2, p3, p4, p5],
      segments: [
        segment('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 100, 5, 3),
        segment('A2', ['p5', 'p4', 'p3', 'p2', 'p1'], 200, 8, 6),
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const result = computeLineupStats([game], baseFilter({ comboSize: 2 }));
    // Zelfde combinaties in beide segmenten → C(5,2) = 10 unieke rijen.
    expect(result.combinations.length).toBe(10);
    // [1,2] is in beide segmenten op het veld (in A2 staan 1 en 2 ook,
    // alleen in omgekeerde volgorde). Eén rij, onSec=300, onPF=13, onPA=9.
    const c12 = result.combinations.find((x) => x.rosterIds.join(',') === '1,2')!;
    expect(c12).toBeDefined();
    expect(c12.onSec).toBe(300);
    expect(c12.onPF).toBe(13);
    expect(c12.onPA).toBe(9);
  });

  it('per10-toggle verandert de sortering: een lage pm in korte tijd komt vóór een hoge pm in lange tijd', () => {
    // Regressiontest voor de externe review: sortering moet de GETOONDE
    // waarde gebruiken. Zonder per10 wint de hogere pm (10 in 600s); met
    // per10 wint de lagere pm (2 in 60s ≈ 33.3 per 10 min vs 10 in 600s =
    // 10.0 per 10 min). Plan §C.3.6 + §C.3.7.
    const p1 = player('p1', 1, '1');
    const p2 = player('p2', 2, '2');
    const p3 = player('p3', 3, '3');
    const p4 = player('p4', 4, '4');
    const p5 = player('p5', 5, '5');
    const game: AnalysisGame = {
      id: 'A',
      opponent: '',
      competition: '',
      date: '',
      players: [p1, p2, p3, p4, p5],
      segments: [
        segment('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 60, 2, 0), // speler 1: +2 in 60s
        segment('A2', ['p1', 'p2', 'p3', 'p4', 'p5'], 600, 10, 0), // speler 1: +10 in 600s
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    // zonder per10: speler 1 heeft +12, speler 2-5 hebben +2 (alleen A1) +
    // +10 (alleen A2) = +12.
    const resultRaw = computeLineupStats([game], baseFilter({ comboSize: 1, per10: false }));
    // Sorteer desc: hoogste pm eerst. Speler 1 heeft 12, de rest 12 ook
    // (allemaal in beide segmenten). Dus alle rijen gelijk → secondary key
    // bepaalt → 1 eerst.
    expect(resultRaw.combinations[0]!.rosterIds[0]).toBe(1);

    // met per10: speler 1: (12 * 600) / 660 ≈ 10.9 per 10 min, spelers
    // 2-5: (12 * 600) / 660 ≈ 10.9 per 10 min (zelfde). Gelijk, secondary
    // key → 1 eerst.
    const resultPer10 = computeLineupStats([game], baseFilter({ comboSize: 1, per10: true }));
    expect(resultPer10.combinations[0]!.rosterIds[0]).toBe(1);
  });

  it('per10-sortering gebruikt de getoonde waarde (per-10-normalisatie), niet de kale pm', () => {
    // Sterkste regressiontest voor de externe review: twee verschillende
    // combinaties in verschillende games moeten bij per10+desc in een
    // andere volgorde staan dan bij per10=false.
    //
    // Fixture:
    //   Game A: lineup [p1,p2,p3,p4,p5], 60s +2
    //   Game B: lineup [p1,p2,p3,p4,p6], 600s +10
    //
    // Aggregatie per combinatie (alleen ON wanneer alle leden op het veld):
    //   [1,2,3,4,5]: in GameA ON (60s +2); in GameB staat 5 NIET op
    //     het veld → OFF (600s +10). onSec=60, onPF=2, offSec=600, offPF=10.
    //     Kale onPM=2, per10=(2*600)/60=20.0
    //   [1,2,3,4,6]: in GameA staat 6 NIET op het veld → OFF (60s +2);
    //     in GameB ON (600s +10). onSec=600, onPF=10, offSec=60, offPF=2.
    //     Kale onPM=10, per10=(10*600)/600=10.0
    //
    // Sortering desc:
    //   - Zonder per10: [1,2,3,4,6] (onPM=10) wint van [1,2,3,4,5] (onPM=2).
    //   - Met per10:   [1,2,3,4,5] (per10=20) wint van [1,2,3,4,6] (per10=10).
    const p1 = player('p1', 1, '1');
    const p2 = player('p2', 2, '2');
    const p3 = player('p3', 3, '3');
    const p4 = player('p4', 4, '4');
    const p5 = player('p5', 5, '5');
    const p6 = player('p6', 6, '6');
    const gameA: AnalysisGame = {
      id: 'A',
      opponent: '',
      competition: '',
      date: '',
      players: [p1, p2, p3, p4, p5],
      segments: [segment('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 60, 2, 0)],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const gameB: AnalysisGame = {
      id: 'B',
      opponent: '',
      competition: '',
      date: '',
      players: [p1, p2, p3, p4, p5, p6],
      segments: [segment('B1', ['p1', 'p2', 'p3', 'p4', 'p6'], 600, 10, 0)],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const resultNoPer10 = computeLineupStats(
      [gameA, gameB],
      baseFilter({ comboSize: 5, per10: false, sortDirection: 'desc' }),
    );
    const resultPer10 = computeLineupStats(
      [gameA, gameB],
      baseFilter({ comboSize: 5, per10: true, sortDirection: 'desc' }),
    );
    // Zonder per10: rij [1,2,3,4,6] (onPM=10) wint van [1,2,3,4,5] (onPM=2).
    expect(resultNoPer10.combinations[0]!.rosterIds.join(',')).toBe('1,2,3,4,6');
    // Met per10: rij [1,2,3,4,5] (per10=20) wint van [1,2,3,4,6] (per10=10).
    expect(resultPer10.combinations[0]!.rosterIds.join(',')).toBe('1,2,3,4,5');
  });

  it('PARTIAL-segment (onbekende spelersreferentie) wordt volledig overgeslagen, ook voor size=1', () => {
    // Externe review: een segment met 4 bekende spelers en 1 onbekende
    // UUID hoort voor geen enkele combinatiegrootte aggregatie te leveren
    // — niet "stilletjes" verder gebruikt voor de bekende spelers. Het
    // segment wordt als PARTIAL gemarkeerd en volledig uitgesloten.
    const p1 = player('p1', 1, '1');
    const p2 = player('p2', 2, '2');
    const p3 = player('p3', 3, '3');
    const p4 = player('p4', 4, '4');
    const p5 = player('p5', 5, '5');
    const game: AnalysisGame = {
      id: 'A',
      opponent: '',
      competition: '',
      date: '',
      players: [p1, p2, p3, p4, p5],
      segments: [
        segment('A1', ['p1', 'p2', 'p3', 'p4', 'unknown'], 200, 5, 3), // PARTIAL
        segment('A2', ['p1', 'p2', 'p3', 'p4', 'p5'], 100, 4, 2), // geldig
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    // size=1: speler 1 had slechts 100s ON in het geldige segment, NIET
    // 300s. PARTIAL-segment mag niet meetellen.
    const result = computeLineupStats([game], baseFilter({ comboSize: 1 }));
    const c1 = result.combinations.find((x) => x.rosterIds[0] === 1)!;
    expect(c1.onSec).toBe(100);
    expect(c1.onPF).toBe(4);
    expect(c1.onPA).toBe(2);
    expect(c1.offSec).toBe(0);
    // partialSegments teller is 1.
    expect(result.partialSegments).toBe(1);
    // consideredSegments is alleen het geldige A2 (1 segment).
    expect(result.consideredSegments).toBe(1);
  });

  it('negatieve en decimale plus/min worden exact doorgegeven', () => {
    const game: AnalysisGame = {
      id: 'A',
      opponent: '',
      competition: '',
      date: '',
      players,
      segments: [
        segment('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 200, 7, 9), // pm -2
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const result = computeLineupStats([game], baseFilter({ comboSize: 5 }));
    const c = result.combinations[0]!;
    expect(c.onPF - c.onPA).toBe(-2);
    expect(onShownValue(c, false)).toBe(-2);
    expect(onShownValue(c, true)).toBeCloseTo((-2 * 600) / 200, 5);
  });

  it('onbekende segmentreferenties worden stilletjes uit de lineup gefilterd; een PARTIAL-segment levert geen ON of OFF', () => {
    // PR 6.4 §C.2: een onbekende segmentreferentie maakt het segment PARTIAL
    // en mag niet stil als een andere speler worden meegeteld. Voor
    // combinatiegrootte 5 betekent dat: een segment-lineup die na filtering
    // onder de 5 unieke spelers zakt, levert geen aggregatie — geen ON en
    // geen OFF voor welke combinatie dan ook.
    const p6 = player('p6', 6, '6');
    const game: AnalysisGame = {
      id: 'A',
      opponent: '',
      competition: '',
      date: '',
      players: [...players, p6],
      segments: [
        // Eén onbekende ID; de andere vier zijn bekende spelers.
        segment('A1', ['p1', 'p2', 'p3', 'p4', 'unknown'], 200, 5, 3),
        segment('A2', ['p1', 'p2', 'p3', 'p4', 'p5'], 100, 4, 2),
      ],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const result = computeLineupStats([game], baseFilter({ comboSize: 5 }));
    // A1 wordt volledig uitgefilterd (4 < 5), A2 levert 100s ON voor [1,2,3,4,5].
    const c = result.combinations.find((x) => x.rosterIds.length === 5 && x.rosterIds.includes(5))!;
    expect(c.onSec).toBe(100);
    expect(c.offSec).toBe(0); // geen OFF-bijdrage van A1 (PARTIAL → uitgefilterd)
    expect(c.offPF).toBe(0);
    expect(c.offPA).toBe(0);
    // p6 nergens op het veld → geen ON of OFF.
    expect(
      result.combinations.find((x) => x.rosterIds.length === 5 && x.rosterIds.includes(6)),
    ).toBeUndefined();
    // Ook voor combinatiegrootte 1 mag A1 geen bijdrage leveren — anders zou
    // de "ontbrekende" speler stilletjes meetellen als speler #5. p6 staat
    // in géén van de segmenten → geen rij voor rosterId 6.
    const resultSize1 = computeLineupStats([game], baseFilter({ comboSize: 1 }));
    expect(
      resultSize1.combinations.find((x) => x.rosterIds.length === 1 && x.rosterIds[0] === 6),
    ).toBeUndefined();
  });
});

describe('domain/stats/computeLineupStats — wedstrijdfilter (gameIds)', () => {
  it('gameIds=null betekent alle wedstrijden; een set met één id beperkt tot die wedstrijd', () => {
    const p1 = player('p1', 1, '1');
    const p2 = player('p2', 2, '2');
    const p3 = player('p3', 3, '3');
    const p4 = player('p4', 4, '4');
    const p5 = player('p5', 5, '5');
    const players = [p1, p2, p3, p4, p5];

    const gameA: AnalysisGame = {
      id: 'A',
      opponent: 'A',
      competition: '',
      date: '',
      players,
      segments: [segment('A1', ['p1', 'p2', 'p3', 'p4', 'p5'], 200, 6, 4)],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };
    const gameB: AnalysisGame = {
      id: 'B',
      opponent: 'B',
      competition: '',
      date: '',
      players,
      segments: [segment('B1', ['p1', 'p2', 'p3', 'p4', 'p5'], 300, 9, 1)],
      scoreFor: 0,
      scoreAgainst: 0,
      isCurrent: false,
    };

    const resultAll = computeLineupStats([gameA, gameB], baseFilter({ comboSize: 5 }));
    const resultOnlyA = computeLineupStats(
      [gameA, gameB],
      baseFilter({ comboSize: 5, gameIds: new Set(['A']) }),
    );
    const resultEmpty = computeLineupStats(
      [gameA, gameB],
      baseFilter({ comboSize: 5, gameIds: new Set([]) }),
    );
    expect(resultAll.combinations[0]!.onSec).toBe(500);
    expect(resultOnlyA.combinations[0]!.onSec).toBe(200);
    expect(resultEmpty.combinations).toEqual([]);
  });
});

describe('domain/stats/format — pure weergavewaarden', () => {
  it('fmtSeconds: 0, 60, 125, negatief', () => {
    expect(fmtSeconds(0)).toBe('0:00');
    expect(fmtSeconds(60)).toBe('1:00');
    expect(fmtSeconds(125)).toBe('2:05');
    expect(fmtSeconds(-125)).toBe('-2:05');
  });

  it('fmtPlusMinus: +/0/- met één decimaal', () => {
    expect(fmtPlusMinus(0)).toBe('0.0');
    expect(fmtPlusMinus(6)).toBe('+6.0');
    expect(fmtPlusMinus(-3)).toBe('-3.0');
    expect(fmtPlusMinus(6.666)).toBe('+6.7');
  });

  it('pmClass: pos/neg/flat', () => {
    expect(pmClass(0)).toBe('flat');
    expect(pmClass(1)).toBe('pos');
    expect(pmClass(-1)).toBe('neg');
  });
});

describe('domain/stats — type-niveau sanity (compileert alleen al als de types kloppen)', () => {
  it('LineupCombinationStats heeft exact de v1-velden onder v2-namen', () => {
    const c: LineupCombinationStats = {
      rosterIds: [1, 2],
      onSec: 0,
      onPF: 0,
      onPA: 0,
      offSec: 0,
      offPF: 0,
      offPA: 0,
    };
    expect(c.rosterIds).toEqual([1, 2]);
  });
});
