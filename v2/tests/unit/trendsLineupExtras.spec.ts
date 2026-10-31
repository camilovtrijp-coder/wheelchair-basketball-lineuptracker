import { describe, expect, it } from 'vitest';
import { buildAnalysisScope } from '../../src/application/stats/buildAnalysisScope';
import type { CompletedGameRepository } from '../../src/application/game/CompletedGameRepository';
import type { ActiveGame, CompletedGame } from '../../src/domain/game/types';
import { computeLineupStats } from '../../src/domain/stats/computeLineupStats';
import {
  computeComboExtremes,
  computeConsistency,
  computeStartCloseLineups,
  computeStints,
  dampedPer10,
  sortByDamped,
} from '../../src/domain/trends/lineupExtras';
import {
  L1,
  L2,
  L4,
  fixtureGames,
  fixtureRoster,
  game,
  gp,
  seg,
  segmentsA,
  segmentsB,
} from './support/trendsT6T7Fixture';

/**
 * Handberekeningen op de fixture uit docs/pr-trends-lineups-plan.md §F.2:
 *  L1 = 1-2-3-4-5: 1500 s, pf 24, pa 22, +2 (A1 +4, A4 -4, B1 +2)
 *  L2 = 1-2-3-4-6: 1200 s, pf 20, pa 19, +1 (A2 -2, B2 0, B3 +3)
 *  L3 = 1-2-3-6-7:  180 s, +4 (A3)     L4 = 1-2-3-5-7: 120 s, +2 (B4)
 */

function lineupRows() {
  const result = computeLineupStats(fixtureGames(), {
    comboSize: 5,
    per10: false,
    sortDirection: 'desc',
    gameIds: null,
    playerFilters: [],
  });
  return result.combinations.map((c) => ({
    rosterIds: c.rosterIds,
    seconds: c.onSec,
    pm: c.onPF - c.onPA,
  }));
}

describe('gedempte waarde (shrinkage, sorteerhulp)', () => {
  it('geeft de waarden uit §F.2 met K = 600', () => {
    expect(dampedPer10(2, 1500)).toBeCloseTo(0.5714, 4); // 1200/2100
    expect(dampedPer10(1, 1200)).toBeCloseTo(0.3333, 4); // 600/1800
    expect(dampedPer10(4, 180)).toBeCloseTo(3.0769, 4); // 2400/780
    expect(dampedPer10(2, 120)).toBeCloseTo(1.6667, 4); // 1200/720
  });

  it('ondersteunt een andere demping en geeft null bij een niet-positieve noemer', () => {
    expect(dampedPer10(2, 1200, 0)).toBeCloseTo(1, 6); // 1200/1200
    expect(dampedPer10(2, 0, 0)).toBeNull();
  });

  it('sorteert aflopend op de gedempte waarde: L3, L4, L1, L2', () => {
    const sorted = sortByDamped(lineupRows());
    expect(sorted.map((r) => r.rosterIds.join(','))).toEqual([
      '1,2,3,6,7',
      '1,2,3,5,7',
      '1,2,3,4,5',
      '1,2,3,4,6',
    ]);
  });

  it('gelijkspel: meer seconden eerst, dan de sleutel; muteert de invoer niet', () => {
    const rows = [
      { rosterIds: [2], seconds: 600, pm: 1 },
      { rosterIds: [1], seconds: 600, pm: 1 },
      { rosterIds: [3], seconds: 1200, pm: 2 }, // 1200/1800 = 0,667 = 600/1200
    ];
    const copy = JSON.stringify(rows);
    expect(sortByDamped(rows).map((r) => r.rosterIds[0])).toEqual([3, 1, 2]);
    expect(JSON.stringify(rows)).toBe(copy);
  });
});

describe("computeComboExtremes — duo's en trio's", () => {
  /*
   * Duo's (minSec 600). Spelers 1, 2, 3 staan altijd samen op het veld (3000 s =
   * teamtijd) en vallen af ("altijd samen"): {1,2},{1,3},{2,3} en trio {1,2,3}.
   *  speler 4 met 1/2/3: L1+L2 = 2700 s, +3  -> 0,667/10
   *  speler 5 met 1/2/3: L1+L4 = 1620 s, +4  -> 1,481/10
   *  speler 6 met 1/2/3: L2+L3 = 1380 s, +5  -> 2,174/10
   *  speler 7 met 1/2/3: L3+L4 =  300 s      -> onder de drempel
   *  {4,5}: L1 1500 s +2 -> 0,8   {4,6}: L2 1200 s +1 -> 0,5
   */
  it('duo\'s: top 3 en bottom 3 boven de drempel, zonder "altijd samen"', () => {
    const r = computeComboExtremes(fixtureGames(), null, 2, 600, 3);
    expect(r.excludedAlwaysTogether).toBe(3);
    expect(r.qualified).toBe(11);
    // beste: 2,174 voor {1,6},{2,6},{3,6} (gelijk: sleutel oplopend)
    expect(r.best.map((x) => x.rosterIds.join(','))).toEqual(['1,6', '2,6', '3,6']);
    expect(r.best[0]).toMatchObject({ seconds: 1380, pf: 24, pa: 19, pm: 5 });
    expect(r.best[0]!.pmPer10).toBeCloseTo(2.1739, 4);
    // slechtste: {4,6} 0,5, dan 0,667 voor {1,4},{2,4}
    expect(r.worst.map((x) => x.rosterIds.join(','))).toEqual(['4,6', '1,4', '2,4']);
    expect(r.worst[0]!.pmPer10).toBeCloseTo(0.5, 6);
    expect(r.worst[1]!.pmPer10).toBeCloseTo(0.6667, 4);
    expect(r.best[0]!.dampedPmPer10).toBeCloseTo(3000 / 1980, 4); // 5*600/(1380+600)
  });

  /*
   * Trio's (minSec 600): {a,b,6}: 1380 s, +5 -> 2,174 ({1,2,6},{1,3,6},{2,3,6});
   * {a,4,6}: L2 1200 s +1 -> 0,5 ({1,4,6},{2,4,6},{3,4,6}) = slechtste.
   */
  it("trio's: top 3 en bottom 3; {1,2,3} valt af omdat het altijd samen speelt", () => {
    const r = computeComboExtremes(fixtureGames(), null, 3, 600, 3);
    expect(r.excludedAlwaysTogether).toBe(1);
    expect(r.best.map((x) => x.rosterIds.join(','))).toEqual(['1,2,6', '1,3,6', '2,3,6']);
    expect(r.worst.map((x) => x.rosterIds.join(','))).toEqual(['1,4,6', '2,4,6', '3,4,6']);
    expect(r.worst[0]!.pmPer10).toBeCloseTo(0.5, 6);
  });

  it('een hogere drempel laat rijen vallen; n beperkt de lengte; best en worst overlappen niet', () => {
    // minSec 1500: alleen duo's met >= 1500 s: {x,4} 2700 (0,667), {x,5} 1620 (1,481), {4,5} 1500 (0,8)
    const r = computeComboExtremes(fixtureGames(), null, 2, 1500, 3);
    expect(r.qualified).toBe(7);
    const bestKeys = new Set(r.best.map((x) => x.rosterIds.join(',')));
    expect(r.worst.some((x) => bestKeys.has(x.rosterIds.join(',')))).toBe(false);
    // n = 1 -> een rij per kant: beste {1,5} (1,481, sleutel eerst), slechtste {1,4} (0,667)
    const one = computeComboExtremes(fixtureGames(), null, 2, 1500, 1);
    expect(one.best.map((x) => x.rosterIds.join(','))).toEqual(['1,5']);
    expect(one.worst.map((x) => x.rosterIds.join(','))).toEqual(['1,4']);
  });

  it('respecteert het wedstrijdfilter en een lege scope', () => {
    // Alleen A (1800 s): teamtijd 1800; {1,2} 1800 s = altijd samen; {x,4} = A1+A2+A4 = 1620 s
    const a = computeComboExtremes(fixtureGames(), new Set(['A']), 2, 600, 3);
    expect(a.excludedAlwaysTogether).toBe(3);
    const empty = computeComboExtremes(fixtureGames(), new Set(), 2, 600, 3);
    expect(empty).toMatchObject({ best: [], worst: [], qualified: 0, excludedAlwaysTogether: 0 });
  });
});

describe('computeStartCloseLineups', () => {
  /*
   * Start = eerste segment van Q1: A1 (L1, 600 s, +4) en B1 (L1, 300 s, +2)
   *   -> L1: 900 s, pm +6, 2 wedstrijden.
   * Sluit = laatste segment van Q4: A4 (L1, 600 s, 8-12 = -4) en B4 (L4, 120 s, +2)
   *   -> L1: 600 s, pm -4, 1 wedstrijd; L4: 120 s, pm +2, 1 wedstrijd.
   */
  it('geeft de start- en sluitlineups uit de fixture', () => {
    const r = computeStartCloseLineups(fixtureGames(), null);
    expect(r.orderReliable).toBe(true);
    expect(r.unreliableGameIds).toEqual([]);
    expect(r.start).toEqual([
      { rosterIds: [1, 2, 3, 4, 5], seconds: 900, pf: 16, pa: 10, pm: 6, games: 2 },
    ]);
    expect(r.close).toEqual([
      { rosterIds: [1, 2, 3, 4, 5], seconds: 600, pf: 8, pa: 12, pm: -4, games: 1 },
      { rosterIds: [1, 2, 3, 5, 7], seconds: 120, pf: 2, pa: 0, pm: 2, games: 1 },
    ]);
  });

  it('is onafhankelijk van de arrayvolgorde (volgorde via verstreken tijd, §F.3)', () => {
    const shuffledB = [...segmentsB()].reverse();
    const games = [fixtureGames()[0]!, game('B', '2026-09-12', shuffledB)];
    const r = computeStartCloseLineups(games, null);
    expect(r.start[0]).toMatchObject({ seconds: 900, pm: 6, games: 2 });
    expect(r.close.map((x) => x.rosterIds.join(','))).toEqual(['1,2,3,4,5', '1,2,3,5,7']);
    expect(r.orderReliable).toBe(true);
  });

  it('ondersteunt een oplopende klok (beginSec < endSec)', () => {
    // verstreken tijd = beginSec zelf: Q1: X2 begint op 300 (later), X1 op 0 (eerst)
    const g = game('U', '2026-10-10', [
      seg('X2', 1, 300, 600, L2, 1, 0, 0, 13.5),
      seg('X1', 1, 0, 300, L1, 2, 0, 0, 14),
      seg('X4', 4, 300, 600, L4, 3, 0, 0, 14),
      seg('X3', 4, 0, 300, L1, 5, 0, 0, 14),
    ]);
    const r = computeStartCloseLineups([g], null);
    expect(r.orderReliable).toBe(true);
    expect(r.start[0]).toMatchObject({ rosterIds: [1, 2, 3, 4, 5], pm: 2 });
    expect(r.close[0]).toMatchObject({ rosterIds: [1, 2, 3, 5, 7], pm: 3 });
  });

  it('markeert een onbetrouwbare volgorde (overlappende segmenten) met orderReliable=false', () => {
    const g = game('O', '2026-10-10', [
      seg('O1', 1, 600, 300, L1, 2, 0, 0, 14),
      seg('O2', 1, 600, 300, L2, 1, 0, 0, 13.5), // zelfde interval: volgorde niet eenduidig
      seg('O3', 4, 600, 0, L1, 1, 0, 0, 14),
    ]);
    const r = computeStartCloseLineups([g], null);
    expect(r.orderReliable).toBe(false);
    expect(r.unreliableGameIds).toEqual(['O']);
    // tiebreaker op arrayindex: O1 is dan de start
    expect(r.start[0]!.rosterIds).toEqual([1, 2, 3, 4, 5]);
  });

  it('slaat een wedstrijd zonder Q1-segment (start) of Q4-segment (sluit) over en telt PARTIAL', () => {
    const noQ1 = game('Q', '2026-10-11', [
      seg('Q4', 4, 600, 0, ['p1', 'p2', 'p3', 'p4', 'p99'], 1, 0, 0, 14),
      seg('Q2', 2, 600, 0, L1, 1, 0, 0, 14),
    ]);
    const r = computeStartCloseLineups([noQ1], null);
    expect(r.start).toEqual([]);
    expect(r.close).toEqual([]);
    expect(r.partialSegments).toBe(1);
    expect(computeStartCloseLineups(fixtureGames(), new Set()).start).toEqual([]);
  });
});

describe('computeStints', () => {
  /*
   * Stint = aaneengesloten tijd op het veld binnen een kwart (besluit I.6).
   *  Speler 1 (ook 2, 3): A Q1 600 | A Q2 A2+A3 = 420+180 = 600 (een stint) | A Q4 600 |
   *    B Q1 B1+B2 = 600 | B Q4 B3+B4 = 600 -> 5 stints, totaal 3000, gem. 600, langste 600.
   *  Speler 4: A Q1 600 | A Q2 420 (alleen A2) | A Q4 600 | B Q1 600 | B Q4 480 (B3)
   *    -> 5 stints, totaal 2700, gem. 540, langste 600.
   *  Speler 5: A Q1 600 | A Q4 600 | B Q1 300 (B1) | B Q4 120 (B4) -> 4, totaal 1620, gem. 405.
   *  Speler 6: A Q2 600 (A2+A3) | B Q1 300 (B2) | B Q4 480 (B3) -> 3, totaal 1380, gem. 460.
   *  Speler 7: A Q2 180 (A3) | B Q4 120 (B4) -> 2, totaal 300, gem. 150, langste 180.
   */
  it('berekent stints per speler uit de fixture', () => {
    const r = computeStints(fixtureGames(), null, fixtureRoster);
    expect(r.orderReliable).toBe(true);
    expect(r.partialSegments).toBe(0);
    const byId = new Map(r.players.map((p) => [p.rosterId, p]));
    for (const id of [1, 2, 3]) {
      expect(byId.get(id)).toEqual({
        rosterId: id,
        stints: 5,
        totalSec: 3000,
        avgSec: 600,
        longestSec: 600,
      });
    }
    expect(byId.get(4)).toEqual({
      rosterId: 4,
      stints: 5,
      totalSec: 2700,
      avgSec: 540,
      longestSec: 600,
    });
    expect(byId.get(5)).toEqual({
      rosterId: 5,
      stints: 4,
      totalSec: 1620,
      avgSec: 405,
      longestSec: 600,
    });
    expect(byId.get(6)).toEqual({
      rosterId: 6,
      stints: 3,
      totalSec: 1380,
      avgSec: 460,
      longestSec: 600,
    });
    expect(byId.get(7)).toEqual({
      rosterId: 7,
      stints: 2,
      totalSec: 300,
      avgSec: 150,
      longestSec: 180,
    });
    // de totale stinttijd is gelijk aan de speeltijd (zie on-seconden in §F.2)
    expect(r.players.map((p) => p.rosterId)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('is onafhankelijk van de arrayvolgorde en respecteert het wedstrijdfilter', () => {
    const reversed = [game('A', '2026-09-05', [...segmentsA()].reverse())];
    const r = computeStints(reversed, null, fixtureRoster);
    expect(r.players.find((p) => p.rosterId === 6)).toMatchObject({ stints: 1, totalSec: 600 });
    const onlyB = computeStints(fixtureGames(), new Set(['B']), fixtureRoster);
    expect(onlyB.players.find((p) => p.rosterId === 7)).toMatchObject({
      stints: 1,
      totalSec: 120,
      avgSec: 120,
    });
  });

  it('een kwartgrens beeindigt de stint en een speler zonder speeltijd heeft 0 stints', () => {
    // speler 1 staat in Q1 en Q2 op het veld: twee stints, niet een van 1200 s
    const g = game('K', '2026-10-12', [
      seg('K1', 1, 600, 0, L1, 0, 0, 0, 14),
      seg('K2', 2, 600, 0, L1, 0, 0, 0, 14),
    ]);
    const r = computeStints([g], null, fixtureRoster);
    expect(r.players.find((p) => p.rosterId === 1)).toMatchObject({ stints: 2, longestSec: 600 });
    expect(r.players.find((p) => p.rosterId === 7)).toEqual({
      rosterId: 7,
      stints: 0,
      totalSec: 0,
      avgSec: null,
      longestSec: 0,
    });
  });

  it('een gat in de tijd of een PARTIAL-segment beeindigt de stint; 0 s-segmenten tellen niet', () => {
    const g = game('G', '2026-10-13', [
      seg('G1', 1, 600, 500, L1, 0, 0, 0, 14), // 100 s
      seg('G2', 1, 400, 300, L1, 0, 0, 0, 14), // gat van 100 s (500 -> 400): nieuwe stint
      seg('G3', 1, 300, 300, L1, 0, 0, 0, 14), // 0 s: genegeerd
      seg('G4', 1, 300, 200, ['p1', 'p2', 'p3', 'p4', 'p99'], 0, 0, 0, 14), // PARTIAL
      seg('G5', 1, 200, 100, L1, 0, 0, 0, 14), // na PARTIAL: nieuwe stint
    ]);
    const r = computeStints([g], null, fixtureRoster);
    expect(r.partialSegments).toBe(1);
    expect(r.players.find((p) => p.rosterId === 1)).toMatchObject({
      stints: 3,
      totalSec: 300,
      avgSec: 100,
    });
  });

  it('wissel binnen een kwart: speler die eruit gaat sluit zijn stint, terugkeer start een nieuwe', () => {
    const g = game('W', '2026-10-14', [
      seg('W1', 1, 600, 480, L1, 0, 0, 0, 14), // 5 in
      seg('W2', 1, 480, 360, L2, 0, 0, 0, 13.5), // 5 uit, 6 in
      seg('W3', 1, 360, 240, L1, 0, 0, 0, 14), // 5 terug, 6 uit
    ]);
    const r = computeStints([g], null, fixtureRoster);
    expect(r.players.find((p) => p.rosterId === 5)).toMatchObject({ stints: 2, totalSec: 240 });
    expect(r.players.find((p) => p.rosterId === 6)).toMatchObject({ stints: 1, totalSec: 120 });
    expect(r.players.find((p) => p.rosterId === 4)).toMatchObject({
      stints: 1,
      totalSec: 360,
      longestSec: 360,
    });
  });
});

describe('computeConsistency', () => {
  /*
   * Lineups van 5, per wedstrijd het pm van de lineup:
   *  L1: A = +4 (A1) -4 (A4) = 0 (telt niet positief), B = +2 (B1)  -> 1 van 2, 1500 s
   *  L2: A = -2 (A2), B = 0 (B2) + 3 (B3) = +3                      -> 1 van 2, 1200 s
   *  L3: A +4 (180 s), L4: B +2 (120 s)                             -> onder 300 s
   */
  it('geeft x van n wedstrijden positief (minSec 300)', () => {
    const rows = computeConsistency(fixtureGames(), null, 5, 300);
    expect(rows).toEqual([
      { rosterIds: [1, 2, 3, 4, 5], seconds: 1500, pm: 2, gamesPlayed: 2, gamesPositive: 1 },
      { rosterIds: [1, 2, 3, 4, 6], seconds: 1200, pm: 1, gamesPlayed: 2, gamesPositive: 1 },
    ]);
  });

  it('neemt lineups onder de drempel mee bij minSec 0 en telt alleen wedstrijden waarin ze speelden', () => {
    const rows = computeConsistency(fixtureGames(), null, 5, 0);
    expect(rows.map((r) => r.rosterIds.join(','))).toEqual([
      '1,2,3,4,5',
      '1,2,3,4,6',
      '1,2,3,6,7',
      '1,2,3,5,7',
    ]);
    expect(rows[2]).toMatchObject({ gamesPlayed: 1, gamesPositive: 1, pm: 4, seconds: 180 });
    expect(rows[3]).toMatchObject({ gamesPlayed: 1, gamesPositive: 1, pm: 2, seconds: 120 });
  });

  it("respecteert het wedstrijdfilter en werkt ook voor duo's", () => {
    const onlyB = computeConsistency(fixtureGames(), new Set(['B']), 5, 0);
    expect(onlyB.every((r) => r.gamesPlayed === 1)).toBe(true);
    // duo {4,6}: alleen L2 (A2 -2, B2 0, B3 +3): A -2 negatief, B +3 positief -> 1 van 2
    const duo = computeConsistency(fixtureGames(), null, 2, 600).find(
      (r) => r.rosterIds.join(',') === '4,6',
    );
    expect(duo).toMatchObject({ gamesPlayed: 2, gamesPositive: 1, pm: 1, seconds: 1200 });
    expect(computeConsistency(fixtureGames(), new Set(), 5, 0)).toEqual([]);
  });
});

describe('buildAnalysisScope vult useClassLimit', () => {
  const repo = (games: CompletedGame[]): CompletedGameRepository => ({
    list: () => games,
    safeList: () => ({ status: 'ok', games }),
    add: () => true,
    remove: () => true,
    update: () => false,
    replaceAll: () => true,
  });
  const completed = (id: string, useClassLimit: boolean): CompletedGame =>
    ({
      id,
      organizationId: 'o',
      teamId: 't',
      sourceGameId: `src-${id}`,
      opponent: 'X',
      competition: '',
      date: '2026-01-01T00:00:00.000Z',
      players: [1, 2, 3, 4, 5].map(gp),
      segments: [],
      scoreFor: 0,
      scoreAgainst: 0,
      quarterCount: 4,
      periodLabel: '',
      useClassLimit,
      revision: 0,
      deletedAt: null,
      deletedBy: null,
    }) as CompletedGame;
  const active = (): ActiveGame =>
    ({
      id: 'live',
      organizationId: 'o',
      teamId: 't',
      phase: 'tracking',
      players: [1, 2, 3, 4, 5].map(gp),
      opponent: 'Live',
      competition: '',
      clockDown: true,
      limitStr: '',
      onCourt: L1,
      curQuarter: 1,
      beginSec: 600,
      endSec: 540,
      pendingSwapLineup: null,
      actions: [
        {
          type: 'segment-saved',
          id: 'a1',
          segment: seg('live1', 1, 600, 540, L1, 2, 0, 0, 14),
          at: '2026-01-01T00:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:00:00.000Z',
    }) as ActiveGame;

  it('neemt CompletedGame.useClassLimit over; de lopende wedstrijd krijgt de instelling (standaard false)', () => {
    const history = [completed('on', true), completed('off', false)];
    const scope = buildAnalysisScope(repo(history), active(), true);
    expect(scope.games.map((g) => [g.id, g.useClassLimit])).toEqual([
      ['live', true],
      ['on', true],
      ['off', false],
    ]);
    expect(buildAnalysisScope(repo(history), active()).games[0]!.useClassLimit).toBe(false);
  });
});

describe('regressie: nieuwe berekeningen laten de invoer en computeLineupStats ongemoeid', () => {
  it('muteert geen wedstrijden', () => {
    const games = fixtureGames();
    const before = JSON.stringify(games);
    computeComboExtremes(games, null, 2);
    computeComboExtremes(games, null, 3);
    computeStartCloseLineups(games, null);
    computeStints(games, null, fixtureRoster);
    computeConsistency(games, null, 5, 0);
    expect(JSON.stringify(games)).toBe(before);
  });
});
