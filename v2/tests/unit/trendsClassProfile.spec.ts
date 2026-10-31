import { describe, expect, it } from 'vitest';
import {
  classBucketOf,
  computeClassProfile,
  computeOverLimitTime,
} from '../../src/domain/trends/classProfile';
import { computeLineupStats } from '../../src/domain/stats/computeLineupStats';
import { L1, fixtureGames, game, seg, segmentsA } from './support/trendsT6T7Fixture';

describe('computeClassProfile — fixture §F.2', () => {
  it('geeft de drie groepen met de uitgerekende waarden (minSec 300)', () => {
    const profile = computeClassProfile(fixtureGames(), null, 300);
    expect(profile.classLimitGames).toBe(2);
    expect(profile.skippedSegments).toBe(0);
    expect(profile.partialSegments).toBe(0);
    expect(profile.groups.map((g) => g.bucket)).toEqual(['over', 'vol', 'ruimte']);

    // over: B4 (classSum 14.5 > allowed 14.0): 120 s, 2-0 = +2, onder de drempel van 300 s
    const [over, vol, ruimte] = profile.groups;
    expect(over).toEqual({
      bucket: 'over',
      seconds: 120,
      pf: 2,
      pa: 0,
      pm: 2,
      pmPer10: null,
      segments: 1,
    });
    // vol (slack 0 t/m 0,5): A1 600 + A2 420 + A4 600 + B1 300 + B2 300 + B3 480 = 2700 s
    // pf 10+6+8+6+4+10 = 44, pa 6+8+12+4+4+7 = 41, pm +3, per 10 = 3*600/2700 = 0,6667
    expect(vol!.seconds).toBe(2700);
    expect(vol!.pf).toBe(44);
    expect(vol!.pa).toBe(41);
    expect(vol!.pm).toBe(3);
    expect(vol!.segments).toBe(6);
    expect(vol!.pmPer10).toBeCloseTo(0.6667, 4);
    // ruimte (slack 1,5): alleen A3, 180 s, +4, onder de drempel
    expect(ruimte).toEqual({
      bucket: 'ruimte',
      seconds: 180,
      pf: 4,
      pa: 0,
      pm: 4,
      pmPer10: null,
      segments: 1,
    });
    // de som van de groepen is het hele team: 3000 s
    expect(profile.groups.reduce((s, g) => s + g.seconds, 0)).toBe(3000);
  });

  it('geeft pmPer10 voor alle groepen bij minSec 0 en onderscheidt de grenzen exact', () => {
    const profile = computeClassProfile(fixtureGames(), null, 0);
    expect(profile.groups[0]!.pmPer10).toBeCloseTo(10, 6); // 2*600/120
    expect(profile.groups[2]!.pmPer10).toBeCloseTo(13.3333, 3); // 4*600/180
    // grens: slack 0,5 = vol, 0 = vol, 0,51 = ruimte, -0,01 = over
    expect(classBucketOf({ allowed: 14, classSum: 13.5 })).toBe('vol');
    expect(classBucketOf({ allowed: 14, classSum: 14 })).toBe('vol');
    expect(classBucketOf({ allowed: 14, classSum: 13.49 })).toBe('ruimte');
    expect(classBucketOf({ allowed: 14, classSum: 14.01 })).toBe('over');
  });

  it('respecteert het wedstrijdfilter', () => {
    // Alleen B: over 120 s; vol = B1 300 + B2 300 + B3 480 = 1080 s; ruimte 0 s
    const profile = computeClassProfile(fixtureGames(), new Set(['B']), 0);
    expect(profile.classLimitGames).toBe(1);
    expect(profile.groups.map((g) => g.seconds)).toEqual([120, 1080, 0]);
    expect(profile.groups[2]!.pmPer10).toBeNull();
  });

  it('laat de groepen leeg als geen enkele wedstrijd useClassLimit heeft (of het veld ontbreekt)', () => {
    const off = fixtureGames().map((g) => ({ ...g, useClassLimit: false }));
    expect(computeClassProfile(off, null, 0)).toEqual({
      groups: [],
      skippedSegments: 0,
      partialSegments: 0,
      classLimitGames: 0,
    });
    const missing = fixtureGames().map((g) => {
      const { useClassLimit, ...rest } = g;
      void useClassLimit;
      return rest;
    });
    expect(computeClassProfile(missing, null, 0).groups).toEqual([]);
  });

  it('negeert wedstrijden zonder klassegrens in een gemengde selectie', () => {
    const [a, b] = fixtureGames();
    const profile = computeClassProfile([a!, { ...b!, useClassLimit: false }], null, 0);
    expect(profile.classLimitGames).toBe(1);
    expect(profile.groups.reduce((s, g) => s + g.seconds, 0)).toBe(1800);
  });

  it('slaat segmenten met ongeldige of ontbrekende classSum/allowed over en telt ze', () => {
    const segs = [
      ...segmentsA(),
      seg('X1', 3, 600, 540, L1, 1, 0, 0, Number.NaN),
      seg('X2', 3, 540, 480, L1, 1, 0, 0, 14, false, 0), // allowed 0 = niet vastgelegd
      seg('X3', 3, 480, 420, L1, 1, 0, 0, -1),
    ];
    const missing = { ...seg('X4', 3, 420, 360, L1, 1, 0, 0, 14) } as Record<string, unknown>;
    delete missing.classSum;
    segs.push(missing as unknown as (typeof segs)[number]);
    const profile = computeClassProfile([game('A', '2026-09-05', segs)], null, 0);
    expect(profile.skippedSegments).toBe(4);
    // alleen de vier geldige A-segmenten tellen: 1800 s
    expect(profile.groups.reduce((s, g) => s + g.seconds, 0)).toBe(1800);
  });

  it('telt PARTIAL-segmenten apart en sluit ze uit', () => {
    const partial = seg('P1', 3, 600, 540, ['p1', 'p2', 'p3', 'p4', 'p99'], 5, 0, 0, 14);
    const profile = computeClassProfile(
      [game('A', '2026-09-05', [...segmentsA(), partial])],
      null,
      0,
    );
    expect(profile.partialSegments).toBe(1);
    expect(profile.skippedSegments).toBe(0);
    expect(profile.groups.reduce((s, g) => s + g.seconds, 0)).toBe(1800);
  });
});

describe('computeOverLimitTime — fixture §F.2', () => {
  it('wedstrijd B heeft 120 s in 1 segment, wedstrijd A heeft 0', () => {
    expect(computeOverLimitTime(fixtureGames(), null)).toEqual([
      { gameId: 'A', seconds: 0, segments: 0, totalSegments: 4 },
      { gameId: 'B', seconds: 120, segments: 1, totalSegments: 4 },
    ]);
  });

  it('slaat wedstrijden zonder klassegrens over en respecteert het filter', () => {
    const [a, b] = fixtureGames();
    expect(computeOverLimitTime([a!, { ...b!, useClassLimit: false }], null)).toEqual([
      { gameId: 'A', seconds: 0, segments: 0, totalSegments: 4 },
    ]);
    expect(computeOverLimitTime(fixtureGames(), new Set(['B']))).toHaveLength(1);
    expect(computeOverLimitTime(fixtureGames(), new Set())).toEqual([]);
  });
});

describe('regressie: bestaande computeLineupStats blijft ongewijzigd', () => {
  it('geeft de bekende totalen voor lineups van 5 en de nieuwe functies muteren niets', () => {
    const games = fixtureGames();
    const before = JSON.stringify(games);
    const result = computeLineupStats(games, {
      comboSize: 5,
      per10: false,
      sortDirection: 'desc',
      gameIds: null,
      playerFilters: [],
    });
    const byKey = new Map(result.combinations.map((c) => [c.rosterIds.join(','), c]));
    expect(result.partialSegments).toBe(0);
    expect(result.consideredSegments).toBe(8);
    expect(byKey.get('1,2,3,4,5')).toMatchObject({ onSec: 1500, onPF: 24, onPA: 22, onTov: 4 });
    expect(byKey.get('1,2,3,4,6')).toMatchObject({ onSec: 1200, onPF: 20, onPA: 19, onTov: 7 });
    expect(byKey.get('1,2,3,6,7')).toMatchObject({ onSec: 180, onPF: 4, onPA: 0 });
    expect(byKey.get('1,2,3,5,7')).toMatchObject({ onSec: 120, onPF: 2, onPA: 0 });
    computeClassProfile(games, null, 0);
    computeOverLimitTime(games, null);
    expect(JSON.stringify(games)).toBe(before);
  });
});
