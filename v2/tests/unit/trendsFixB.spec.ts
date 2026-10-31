import { describe, expect, it } from 'vitest';
import { buildLineupTurnoverView } from '../../src/application/trends/buildTrendViewModels';
import { computeLineupTurnoverRanking } from '../../src/domain/trends/turnoverSummary';
import type { LineupRow } from '../../src/domain/trends/lineupInsights';
import { STRINGS } from '../../src/i18n/strings';
import { trendsFixBEn, trendsFixBNl } from '../../src/i18n/trendsFixBStrings';
import { orderByTotalPm } from '../../src/ui/trends/lineupOrder';
import { L1, L3, L4, game, seg } from './support/trendsT6T7Fixture';

function row(rosterIds: number[], seconds: number, pm: number): LineupRow {
  return {
    rosterIds,
    seconds,
    pf: Math.max(pm, 0),
    pa: Math.max(-pm, 0),
    pm,
    tov: 0,
    games: 1,
    pmPer10: (pm * 600) / seconds,
    pfPer10: 0,
    paPer10: 0,
    tovPer10: 0,
    dampedPmPer10: 0,
    deltaVsTeamPer10: 0,
    qualified: true,
  };
}

describe('orderByTotalPm (Totaal-modus, review-fix M1)', () => {
  it('sorteert op totaal aflopend, dan minuten aflopend, dan sleutel; muteert de invoer niet', () => {
    const a = row([1, 2, 3, 4, 5], 1500, 6); // 1,44 per 10
    const b = row([1, 2, 3, 4, 6], 360, 3); // 5,0 per 10
    const c = row([1, 2, 3, 6, 7], 900, 3); // gelijk totaal als b, meer minuten
    const d = row([1, 2, 3, 5, 7], 900, 3); // gelijk aan c: sleutel beslist
    const input = [b, a, d, c];
    const ordered = orderByTotalPm(input);
    expect(ordered.map((r) => r.rosterIds.join('-'))).toEqual([
      '1-2-3-4-5', // +6
      '1-2-3-5-7', // +3, 900 s, sleutel 1,2,3,5,7 < 1,2,3,6,7
      '1-2-3-6-7',
      '1-2-3-4-6', // +3, 360 s
    ]);
    expect(input.map((r) => r.rosterIds.join('-'))).toEqual([
      '1-2-3-4-6',
      '1-2-3-4-5',
      '1-2-3-5-7',
      '1-2-3-6-7',
    ]);
  });
});

describe('buildLineupTurnoverView: §E.4 bij gelijke waarde eerst meer minuten (review-fix M5)', () => {
  // L3: 180 s, 0 tov; L4: 120 s, 0 tov (beide 0,0 per 10); L1: 600 s, 2 tov (2,0 per 10).
  const games = [
    game('X', '2026-09-01', [
      seg('x1', 1, 180, 0, L3, 4, 0, 0, 14),
      seg('x2', 2, 120, 0, L4, 2, 0, 0, 14),
      seg('x3', 3, 600, 0, L1, 5, 5, 2, 14),
    ]),
  ];

  it('zet 180 s voor 120 s bij gelijke waarde, terwijl het domein op sleutel sorteert', () => {
    const view = buildLineupTurnoverView(games, null, 0);
    const keys = view.rows.map((r) => r.rosterIds.join('-'));
    expect(keys.slice(0, 2)).toEqual(['1-2-3-6-7', '1-2-3-5-7']);
    const domain = computeLineupTurnoverRanking(games, null).rows.map((r) => r.rosterIds.join('-'));
    // Ongewijzigde domeinfunctie: gelijke waarde valt op de sleutel (1,2,3,5,7 voor 1,2,3,6,7).
    expect(domain.slice(0, 2)).toEqual(['1-2-3-5-7', '1-2-3-6-7']);
    expect(view.averagePer10).toBe(computeLineupTurnoverRanking(games, null).averagePer10);
  });
});

describe('getalnotatie en inhoud van vaste teksten (review-fix, tekst)', () => {
  const trendsKeys = (lang: 'nl' | 'en') =>
    Object.entries(STRINGS[lang]).filter(([k]) => k.startsWith('trends')) as [string, string][];

  it('NL gebruikt een decimale komma, EN een decimale punt in vaste trendteksten', () => {
    // Placeholder-waarden komen uit fmtPlusMinus en blijven app-breed met punt; dit gaat om vaste tekst.
    for (const [k, v] of trendsKeys('nl')) {
      expect(v, k).not.toMatch(/\d\.\d/);
    }
    for (const [k, v] of trendsKeys('en')) {
      expect(v, k).not.toMatch(/\d,\d/);
    }
    expect(STRINGS.nl.trendsPlayersOnOffExplain).toContain('1,0 per 10 min');
    expect(STRINGS.en.trendsPlayersOnOffExplain).toContain('1.0 per 10 min');
    expect(STRINGS.nl.trendsQuartersLegend).toContain('0,5 per 10 min');
    expect(STRINGS.en.trendsQuartersLegend).toContain('0.5 per 10 min');
    expect(STRINGS.nl.trendsOverviewClassFullHelp).toContain('0,5 punt');
    expect(STRINGS.en.trendsOverviewClassSlackHelp).toContain('0.5 points');
  });

  it('uitleg on/off noemt de twee drempels; lineupuitleg heeft een parameter en geen vaste 5', () => {
    expect(STRINGS.nl.trendsPlayersOnOffExplain).toContain('minstens 10:00 af het veld');
    expect(STRINGS.en.trendsPlayersOnOffExplain).toContain('at least 10:00 off court');
    expect(STRINGS.nl.trendsLineupExplain).toContain('{min}');
    expect(STRINGS.en.trendsLineupExplain).toContain('{min}');
    expect(STRINGS.nl.trendsLineupExplain).not.toMatch(/5 minuten/);
    expect(STRINGS.en.trendsLineupExplain).not.toMatch(/5 minutes/);
  });

  it('stintuitleg noemt tijdgat, PARTIAL en segmenten van 0 s', () => {
    expect(STRINGS.nl.trendsPlayersStintsExplain).toMatch(/tijdgat/);
    expect(STRINGS.nl.trendsPlayersStintsExplain).toContain('PARTIAL');
    expect(STRINGS.nl.trendsPlayersStintsExplain).toContain('0 s');
    expect(STRINGS.en.trendsPlayersStintsExplain).toMatch(/time gap/);
    expect(STRINGS.en.trendsPlayersStintsExplain).toContain('PARTIAL');
    expect(STRINGS.en.trendsPlayersStintsExplain).toContain('0 s');
  });

  it('trendsFixB*: NL en EN hebben dezelfde sleutels en plaatshouders, geïnjecteerd in STRINGS', () => {
    expect(Object.keys(trendsFixBEn).sort()).toEqual(Object.keys(trendsFixBNl).sort());
    const holders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(trendsFixBNl) as (keyof typeof trendsFixBNl)[]) {
      expect(k.startsWith('trendsFixB')).toBe(true);
      expect(holders(trendsFixBEn[k])).toEqual(holders(trendsFixBNl[k]));
      expect(STRINGS.nl[k]).toBe(trendsFixBNl[k]);
      expect(STRINGS.en[k]).toBe(trendsFixBEn[k]);
    }
  });
});
