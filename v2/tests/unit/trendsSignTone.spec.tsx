// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { TrendsPanel } from '../../src/ui/trends/TrendsPanel';
import {
  FLAT_EPS_PER10,
  toneKeyOfSign,
  toneOfDelta,
  toneOfSign,
  type TrendsViewId,
} from '../../src/ui/trends/trendsShared';
import type { CompletedGameRepository } from '../../src/application/game/CompletedGameRepository';
import type { CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';
import type { RosterPlayer } from '../../src/domain/roster/types';
import type { Lang } from '../../src/i18n/strings';

afterEach(() => cleanup());

// Besluit eigenaar 2026-10-31: de toon van +/- (per 10 min) volgt het TEKEN van de waarde
// (> +0,5 groen ▲ positief, < -0,5 rood ▼ negatief, ertussen grijs ● rond 0) en niet meer
// het verschil met het team. Het verschil blijft alleen als kleine tekst staan.

describe('toneOfSign', () => {
  it('geeft groen boven +0,5, rood onder -0,5 en grijs ertussen (grenzen zijn grijs)', () => {
    expect(toneOfSign(5)).toBe('good');
    expect(toneOfSign(0.6)).toBe('good');
    expect(toneOfSign(0.5)).toBe('flat');
    expect(toneOfSign(0.4)).toBe('flat');
    expect(toneOfSign(0)).toBe('flat');
    expect(toneOfSign(-0.4)).toBe('flat');
    expect(toneOfSign(-0.5)).toBe('flat');
    expect(toneOfSign(-0.6)).toBe('bad');
    expect(toneOfSign(-12)).toBe('bad');
    expect(toneOfSign(1.2, 1.0)).toBe('good');
    expect(toneOfSign(0.9, 1.0)).toBe('flat');
    expect(FLAT_EPS_PER10).toBe(0.5);
  });

  it('laat toneOfDelta (relatief aan het team) ongewijzigd', () => {
    expect(toneOfDelta(-0.8, true)).toBe('bad');
    expect(toneOfDelta(0.8, false)).toBe('bad');
    expect(toneOfDelta(0.4, true)).toBe('flat');
  });

  it('heeft eigen vertaalsleutels voor positief / rond 0 / negatief', () => {
    expect(toneKeyOfSign('good')).toBe('trendsToneSignPositive');
    expect(toneKeyOfSign('flat')).toBe('trendsToneSignAround');
    expect(toneKeyOfSign('bad')).toBe('trendsToneSignNegative');
  });
});

// ---- fixtures ----

function gp(n: number): GamePlayer {
  return {
    id: `p${n}`,
    rosterId: n,
    nr: String(n),
    naam: `Speler ${n}`,
    kl: '1.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
  };
}
const ids = (l: number[]) => l.map((n) => `p${n}`);
const L1 = [1, 2, 3, 4, 5];
const L2 = [1, 2, 3, 4, 6];

function seg(
  id: string,
  quarter: number,
  lineup: number[],
  durSec: number,
  pf: number,
  pa: number,
): Segment {
  return {
    id,
    quarter,
    beginSec: durSec,
    endSec: 0,
    durSec,
    lineup: ids(lineup),
    pf,
    pa,
    classSum: 14,
    allowed: 14,
    over: false,
  };
}

function game(segments: Segment[]): CompletedGame {
  return {
    id: 'G',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'src-G',
    opponent: 'Tegenstander',
    competition: '',
    date: '2026-09-12T10:00:00.000Z',
    players: [1, 2, 3, 4, 5, 6, 7].map(gp),
    segments,
    scoreFor: 0,
    scoreAgainst: 0,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
  };
}

function repoOf(games: CompletedGame[]): CompletedGameRepository {
  return {
    list: () => games,
    safeList: () => ({ status: 'ok', games }),
    add: () => true,
    remove: () => true,
    update: () => false,
    replaceAll: () => true,
  };
}

const roster: RosterPlayer[] = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
  id: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '1.0',
  vrouw: false,
  jeugd: false,
}));

function renderView(segments: Segment[], view: TrendsViewId, lang: Lang = 'nl') {
  return render(
    <TrendsPanel
      lang={lang}
      repository={repoOf([game(segments)])}
      activeGame={null}
      roster={roster}
      gameIds={null}
      onGameIdsChange={() => {}}
      initialView={view}
    />,
  );
}
type Q = ReturnType<typeof renderView>;
const text = (q: Q, id: string) => q.getByTestId(id).textContent;
const aria = (q: Q, id: string) => q.getByTestId(id).getAttribute('aria-label');
const tone = (q: Q, id: string) => q.getByTestId(id).getAttribute('data-tone');
const togglePer10 = (q: Q) => {
  const toggle = q.queryByTestId('trends-filters-toggle');
  if (toggle && toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  fireEvent.click(q.getByTestId('trends-per10-toggle'));
};

// Kwarten: Q1 1200 s +14, Q2 600 s +5, Q4 1200 s +10 => team 3000 s, +29 = +5,8 per 10.
// Kwart 2 (+5,0 per 10) is 0,8 ONDER het team, maar positief: dat moet groen ▲ zijn.
const QUARTERS = [
  seg('s1', 1, L1, 1200, 24, 10),
  seg('s2', 2, L2, 600, 15, 10),
  seg('s4', 4, L1, 1200, 20, 10),
];

describe('Kwarten: toon op het teken', () => {
  it('kwart 2 (+5, team +5,8 per 10) is groen ▲ "positief" in Totaal-modus', () => {
    const q = renderView(QUARTERS, 'quarters');
    expect(tone(q, 'trends-quarter-2')).toBe('good');
    expect(aria(q, 'trends-quarter-2')).toBe('Kwart 2, 10:00, +5 totaal, positief');
    expect(text(q, 'trends-quarter-tone-2')).toBe('▲ positief · -0.8 per 10 min t.o.v. team');
    expect(text(q, 'trends-quarter-2')).toContain('▲');
  });

  it('kwart 2 is ook per 10 min groen; het verschil met het team blijft kleine tekst', () => {
    const q = renderView(QUARTERS, 'quarters');
    togglePer10(q);
    expect(text(q, 'trends-quarters-teamavg')).toContain('+5.8');
    expect(aria(q, 'trends-quarter-2')).toBe('Kwart 2, 10:00, +5.0 per 10 minuten, positief');
    expect(tone(q, 'trends-quarter-2')).toBe('good');
    expect(
      q.getByTestId('trends-quarter-2').querySelector('.trends-tov-bar__fill--good'),
    ).not.toBeNull();
  });

  it('+0,4 per 10 is grijs ● "rond 0" (ook als het team veel hoger zit)', () => {
    // Q3 1500 s, +1 => +0,4 per 10.
    const q = renderView([...QUARTERS, seg('s3', 3, L1, 1500, 11, 10)], 'quarters');
    expect(tone(q, 'trends-quarter-3')).toBe('flat');
    expect(aria(q, 'trends-quarter-3')).toBe('Kwart 3, 25:00, +1 totaal, rond 0');
    expect(text(q, 'trends-quarter-tone-3')).toMatch(/^● rond 0 · /);
  });

  it('-0,6 per 10 is rood ▼ "negatief"; balk gestreept (--bad)', () => {
    // Q3 1000 s, -1 => -0,6 per 10.
    const q = renderView([...QUARTERS, seg('s3', 3, L1, 1000, 9, 10)], 'quarters');
    expect(tone(q, 'trends-quarter-3')).toBe('bad');
    expect(aria(q, 'trends-quarter-3')).toBe('Kwart 3, 16:40, -1 totaal, negatief');
    expect(text(q, 'trends-quarter-tone-3')).toMatch(/^▼ negatief · /);
    expect(
      q.getByTestId('trends-quarter-3').querySelector('.trends-tov-bar__fill--bad'),
    ).not.toBeNull();
  });

  it('toont de legenda zonder "beter/slechter dan team"', () => {
    const q = renderView(QUARTERS, 'quarters');
    const legend = text(q, 'trends-quarters-legend')!;
    expect(legend).toContain('▲ positief');
    expect(legend).toContain('● rond 0');
    expect(legend).toContain('▼ negatief');
    expect(legend).not.toMatch(/beter dan team|slechter dan team/);
  });

  it('werkt in het Engels', () => {
    const q = renderView(QUARTERS, 'quarters', 'en');
    expect(aria(q, 'trends-quarter-2')).toBe('Quarter 2, 10:00, +5 total, positive');
    expect(text(q, 'trends-quarter-tone-2')).toBe('▲ positive · -0.8 per 10 min vs team');
    const legend = text(q, 'trends-quarters-legend')!;
    expect(legend).toContain('▲ positive');
    expect(legend).toContain('● around zero');
    expect(legend).toContain('▼ negative');
  });
});

// Lineups: L1 600 s +5 (+5,0 per 10), L2 1200 s +14 (+7,0 per 10); team 6,3 per 10.
const LINEUPS = [seg('a', 1, L1, 600, 15, 10), seg('b', 2, L2, 1200, 24, 10)];

describe('Lineupkaart: toon op het teken van +/-', () => {
  it('lineup met +5,0 per 10 onder het team (+6,3) is groen ▲ "positief"', () => {
    const q = renderView(LINEUPS, 'lineups');
    expect(tone(q, 'trends-lineup-1-2-3-4-5')).toBe('good');
    expect(aria(q, 'trends-lineup-1-2-3-4-5')).toBe(
      '1-2-3-4-5, 10:00, +5.0 per 10 minuten, positief',
    );
    expect(text(q, 'trends-lineup-delta-1-2-3-4-5')).toBe(
      '▲ positief · -1.3 t.o.v. team (+6.3) · +5.0 per 10 min',
    );
    expect(
      q.getByTestId('trends-lineup-1-2-3-4-5').querySelector('.trends-tov-bar__fill--good'),
    ).not.toBeNull();
  });

  it('legenda bij +/- noemt positief / negatief en niet "dan team"', () => {
    const q = renderView(LINEUPS, 'lineups');
    const legend = text(q, 'trends-lineup-legend')!;
    expect(legend).toContain('▲ positief');
    expect(legend).toContain('▼ negatief');
    expect(legend).not.toMatch(/dan team/);
  });

  it('Engels: positive', () => {
    const q = renderView(LINEUPS, 'lineups', 'en');
    expect(aria(q, 'trends-lineup-1-2-3-4-5')).toBe(
      '1-2-3-4-5, 10:00, +5.0 per 10 minutes, positive',
    );
    expect(text(q, 'trends-lineup-legend')).toContain('▲ positive');
  });

  it('Voor/Tegen blijft relatief aan het team (niet op teken)', () => {
    const q = renderView(LINEUPS, 'lineups');
    fireEvent.click(q.getByTestId('trends-metric-pfpa'));
    // L2: voor 12,0 (team 13,0) = slechter dan team; tegen 5,0 (team 6,7) = beter dan team.
    expect(aria(q, 'trends-lineup-1-2-3-4-6')).toBe(
      '1-2-3-4-6, 20:00, voor 12.0 per 10 minuten, slechter dan team, tegen 5.0 per 10 minuten, beter dan team',
    );
  });
});
