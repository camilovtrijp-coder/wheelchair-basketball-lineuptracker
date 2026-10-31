import { describe, expect, it } from 'vitest';
import { computeDataQualityWarnings } from '../../src/domain/trends/dataQuality';
import { L1, fixtureGames, game, seg, segmentsA } from './support/trendsT6T7Fixture';

describe('computeDataQualityWarnings — fixture §F.2', () => {
  it('meldt Q3 zonder segmenten (A en B), Q2 alleen in B, en speeltijd < 40:00 voor A en B', () => {
    // A heeft segmenten in Q1, Q2, Q4 -> mist Q3. B heeft Q1 en Q4 -> mist Q2 en Q3
    // (het plan noemt alleen Q3, maar B heeft inderdaad geen Q2-segment).
    // Speeltijd: A = 600+420+180+600 = 1800 s; B = 300+300+480+120 = 1200 s; beide < 2400 s.
    // Alle segmenten hebben tov, geen 0 s, geen PARTIAL.
    expect(computeDataQualityWarnings(fixtureGames(), null)).toEqual([
      { code: 'quarter-without-segments', quarter: 2, gameIds: ['B'], totalGames: 2 },
      { code: 'quarter-without-segments', quarter: 3, gameIds: ['A', 'B'], totalGames: 2 },
      { code: 'playtime-below-total', gameId: 'A', seconds: 1800, expectedSeconds: 2400 },
      { code: 'playtime-below-total', gameId: 'B', seconds: 1200, expectedSeconds: 2400 },
    ]);
  });

  it('respecteert het wedstrijdfilter', () => {
    expect(computeDataQualityWarnings(fixtureGames(), new Set(['A']))).toEqual([
      { code: 'quarter-without-segments', quarter: 3, gameIds: ['A'], totalGames: 1 },
      { code: 'playtime-below-total', gameId: 'A', seconds: 1800, expectedSeconds: 2400 },
    ]);
    expect(computeDataQualityWarnings(fixtureGames(), new Set())).toEqual([]);
  });

  it('geeft geen speeltijd- of kwartwaarschuwing bij een volledige wedstrijd', () => {
    const full = [1, 2, 3, 4].map((q) => seg(`F${q}`, q, 600, 0, L1, 1, 0, 0, 14));
    expect(computeDataQualityWarnings([game('F', '2026-09-19', full)], null)).toEqual([]);
  });

  it('gebruikt quarterCount (indien aanwezig) voor de verwachte speeltijd en kwarten', () => {
    const two = [1, 2].map((q) => seg(`H${q}`, q, 600, 0, L1, 1, 0, 0, 14));
    const g = { ...game('H', '2026-09-19', two), quarterCount: 2 } as ReturnType<typeof game>;
    expect(computeDataQualityWarnings([g], null)).toEqual([]);
    const g3 = { ...g, quarterCount: 3 } as ReturnType<typeof game>;
    expect(computeDataQualityWarnings([g3], null)).toEqual([
      { code: 'quarter-without-segments', quarter: 3, gameIds: ['H'], totalGames: 1 },
      { code: 'playtime-below-total', gameId: 'H', seconds: 1200, expectedSeconds: 1800 },
    ]);
  });

  it('meldt segmenten van 0 s, wedstrijden zonder tov en uitgesloten PARTIAL-segmenten', () => {
    const noTov = [1, 2, 3, 4].map((q) => seg(`N${q}`, q, 600, 0, L1, 1, 0, undefined, 14));
    const zero = seg('Z1', 1, 300, 300, L1, 0, 0, undefined, 14);
    const partial = seg('P1', 1, 600, 540, ['p1', 'p2', 'p3', 'p4', 'p99'], 0, 0, undefined, 14);
    const warnings = computeDataQualityWarnings(
      [game('N', '2026-09-26', [...noTov, zero, partial]), game('A', '2026-09-05', segmentsA())],
      null,
    );
    expect(warnings).toEqual([
      { code: 'quarter-without-segments', quarter: 3, gameIds: ['A'], totalGames: 2 },
      { code: 'playtime-below-total', gameId: 'A', seconds: 1800, expectedSeconds: 2400 },
      { code: 'zero-length-segments', count: 1, gameIds: ['N'] },
      { code: 'missing-turnovers', gameIds: ['N'] },
      { code: 'partial-segments-excluded', count: 1, gameIds: ['N'] },
    ]);
  });

  it('een wedstrijd zonder segmenten mist alle kwarten en speeltijd, maar geeft geen tov-melding', () => {
    const warnings = computeDataQualityWarnings([game('E', '2026-10-03', [])], null);
    expect(warnings.map((w) => w.code)).toEqual([
      'quarter-without-segments',
      'quarter-without-segments',
      'quarter-without-segments',
      'quarter-without-segments',
      'playtime-below-total',
    ]);
  });
});
