// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { TrendsPanel } from '../../src/ui/trends/TrendsPanel';
import {
  latestCompletedGameIds,
  nextThreshold,
  selectionEquals,
  toneOfDelta,
} from '../../src/ui/trends/trendsShared';
import { buildAnalysisScope } from '../../src/application/stats/buildAnalysisScope';
import { computeLineupTurnoverRanking } from '../../src/domain/trends/turnoverSummary';
import type { CompletedGameRepository } from '../../src/application/game/CompletedGameRepository';
import type { ActiveGame, CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';
import type { RosterPlayer } from '../../src/domain/roster/types';
import type { Lang } from '../../src/i18n/strings';

afterEach(() => cleanup());

// ---- Vaste fixture: docs/pr-trends-lineups-plan.md §F.2 (fictief, narekenbaar) ----

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

const L1 = [1, 2, 3, 4, 5];
const L2 = [1, 2, 3, 4, 6];
const L3 = [1, 2, 3, 6, 7];
const L4 = [1, 2, 3, 5, 7];
const ids = (l: number[]) => l.map((n) => `p${n}`);

function seg(
  id: string,
  quarter: number,
  lineup: number[],
  durSec: number,
  pf: number,
  pa: number,
  tov: number,
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
    tov,
  };
}

function completed(id: string, date: string, segments: Segment[]): CompletedGame {
  return {
    id,
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: `src-${id}`,
    opponent: `Tegenstander ${id}`,
    competition: '',
    date,
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

function fixture(): CompletedGame[] {
  return [
    completed('B', '2026-09-12T10:00:00.000Z', [
      seg('B1', 1, L1, 300, 6, 4, 1),
      seg('B2', 1, L2, 300, 4, 4, 2),
      seg('B3', 4, L2, 480, 10, 7, 2),
      seg('B4', 4, L4, 120, 2, 0, 0),
    ]),
    completed('A', '2026-09-05T10:00:00.000Z', [
      seg('A1', 1, L1, 600, 10, 6, 2),
      seg('A2', 2, L2, 420, 6, 8, 3),
      seg('A3', 2, L3, 180, 4, 0, 0),
      seg('A4', 4, L1, 600, 8, 12, 1),
    ]),
  ];
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

type ViewId = 'overview' | 'lineups' | 'players' | 'quarters';

function renderTrends(
  games: CompletedGame[] = fixture(),
  opts: {
    lang?: Lang;
    gameIds?: Set<string> | null;
    onGameIdsChange?: (next: Set<string> | null) => void;
    activeGame?: ActiveGame | null;
    initialView?: ViewId;
  } = {},
) {
  return render(
    <TrendsPanel
      lang={opts.lang ?? 'nl'}
      repository={repoOf(games)}
      activeGame={opts.activeGame ?? null}
      roster={roster}
      gameIds={opts.gameIds ?? null}
      onGameIdsChange={opts.onGameIdsChange ?? (() => {})}
      initialView={opts.initialView}
    />,
  );
}

type Q = ReturnType<typeof renderTrends>;

const open = (q: Q, view: ViewId) => fireEvent.click(q.getByTestId(`trends-tab-${view}`));
const lineupsPer10 = (q: Q) => {
  open(q, 'lineups');
  fireEvent.click(q.getByTestId('trends-per10-toggle'));
};

function activeGameWithSegment(): ActiveGame {
  return {
    id: 'live-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: [1, 2, 3, 4, 5].map((n) => ({ ...gp(n), id: `a${n}` })),
    opponent: 'Live',
    competition: '',
    clockDown: true,
    limitStr: '',
    onCourt: ['a1', 'a2', 'a3', 'a4', 'a5'],
    curQuarter: 1,
    beginSec: 600,
    endSec: 540,
    pendingSwapLineup: null,
    actions: [
      {
        type: 'segment-saved',
        id: 'live-act-1',
        segment: {
          id: 'live-seg-1',
          quarter: 1,
          beginSec: 0,
          endSec: 60,
          durSec: 60,
          lineup: ['a1', 'a2', 'a3', 'a4', 'a5'],
          pf: 2,
          pa: 0,
          classSum: 0,
          allowed: 0,
          over: false,
        },
        at: '2026-10-01T00:00:00.000Z',
      },
    ],
    createdAt: '2026-10-01T00:00:00.000Z',
    startedAt: '2026-10-01T00:00:00.000Z',
  } as unknown as ActiveGame;
}

// ---------------------------------------------------------------------------

describe('Trends: segmentbediening (tablist)', () => {
  it('heeft tablist/tab/tabpanel met aria-controls/labelledby en een roving tabindex', () => {
    const q = renderTrends();
    const tablist = q.getByRole('tablist');
    expect(tablist.getAttribute('aria-label')).toBe('Weergave');
    const tabs = q.getAllByRole('tab');
    expect(tabs.map((tb) => tb.textContent)).toEqual([
      'Overzicht',
      'Lineups',
      'Spelers',
      'Kwarten',
    ]);
    // Standaard Overzicht; alleen de gekozen tab is tabbaar.
    expect(tabs.map((tb) => tb.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(tabs.map((tb) => tb.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
    for (const tab of tabs) {
      const panel = document.getElementById(tab.getAttribute('aria-controls')!);
      expect(panel).not.toBeNull();
      expect(panel!.getAttribute('role')).toBe('tabpanel');
      expect(panel!.getAttribute('aria-labelledby')).toBe(tab.id);
    }
    // Alleen het gekozen paneel is zichtbaar.
    const visible = q.getAllByRole('tabpanel');
    expect(visible).toHaveLength(1);
    expect(visible[0]!.id).toBe('trends-tabpanel-overview');
  });

  it('pijltjestoetsen, Home en End wisselen en verplaatsen de focus (omwikkelend)', () => {
    const q = renderTrends();
    const tab = (v: ViewId) => q.getByTestId(`trends-tab-${v}`);
    q.getByTestId('trends-tab-overview').focus();

    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
    expect(tab('lineups').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('lineups'));
    expect(tab('lineups').getAttribute('tabindex')).toBe('0');
    expect(tab('overview').getAttribute('tabindex')).toBe('-1');
    expect(q.getByTestId('trends-lineups')).toBeTruthy();

    fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
    expect(tab('quarters').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('quarters'));

    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' }); // omwikkelen naar het begin
    expect(tab('overview').getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' }); // omwikkelen naar het einde
    expect(tab('quarters').getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
    expect(tab('overview').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('overview'));

    // Andere toetsen doen niets.
    fireEvent.keyDown(document.activeElement as Element, { key: 'a' });
    expect(tab('overview').getAttribute('aria-selected')).toBe('true');
  });

  it('onthoudt de gekozen weergave NIET: geen opslag en een nieuwe mount start op Overzicht', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const q = renderTrends();
    open(q, 'players');
    expect(q.getByTestId('trends-tab-players').getAttribute('aria-selected')).toBe('true');
    cleanup();
    const again = renderTrends();
    expect(again.getByTestId('trends-tab-overview').getAttribute('aria-selected')).toBe('true');
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});

describe('Trends: vaste filterbalk', () => {
  it('staat in elke weergave in beeld en bevat de chips', () => {
    const q = renderTrends();
    for (const view of ['overview', 'lineups', 'players', 'quarters'] as const) {
      open(q, view);
      const bar = q.getByTestId('trends-filterbar');
      expect(bar).toBeTruthy();
      for (const id of [
        'trends-per10-toggle',
        'trends-games-btn',
        'trends-threshold-btn',
        'trends-quick-last5',
        'trends-quick-current',
      ]) {
        expect(bar.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
      }
    }
    expect(q.getByTestId('trends-games-btn').textContent).toBe('Wedstrijden (2)');
  });

  it('is sticky en houdt rekening met de safe-area (CSS)', () => {
    const css = readFileSync(resolve(__dirname, '../../src/styles/trends-views.css'), 'utf8');
    const rule = css.slice(
      css.indexOf('.trends-filterbar {'),
      css.indexOf('}', css.indexOf('.trends-filterbar {')),
    );
    expect(rule).toContain('position: sticky');
    expect(rule).toContain('top: 0');
    expect(rule).toContain('env(safe-area-inset-top)');
  });

  it('drempelchip: standaard 5:00 en cyclus 5:00 -> 10:00 -> uit -> 3:00 -> 5:00', () => {
    const q = renderTrends();
    const btn = q.getByTestId('trends-threshold-btn');
    expect(btn.textContent).toBe('Drempel: 5:00');
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(btn);
      seen.push(btn.textContent ?? '');
    }
    expect(seen).toEqual(['Drempel: 10:00', 'Drempel: uit', 'Drempel: 3:00', 'Drempel: 5:00']);
    expect([0, 180, 300, 600].map(nextThreshold)).toEqual([180, 300, 600, 0]);
  });

  it('"Laatste 5" zet het gedeelde filter op de 5 nieuwste afgeronde wedstrijden', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      completed(`G${i + 1}`, `2026-09-0${i + 1}T10:00:00.000Z`, [
        seg(`S${i}`, 1, L1, 300, 2, 1, 0),
      ]),
    );
    const onChange = vi.fn();
    const q = renderTrends(many, { onGameIdsChange: onChange });
    fireEvent.click(q.getByTestId('trends-quick-last5'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const set = onChange.mock.calls[0]![0] as Set<string>;
    expect([...set].sort()).toEqual(['G3', 'G4', 'G5', 'G6', 'G7']);
  });

  it('"Laatste 5" is gedrukt en terugzetten naar alles (null) werkt; de gedeelde notitie staat erbij', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      completed(`G${i + 1}`, `2026-09-0${i + 1}T10:00:00.000Z`, [
        seg(`S${i}`, 1, L1, 300, 2, 1, 0),
      ]),
    );
    const onChange = vi.fn();
    const selected = new Set(['G3', 'G4', 'G5', 'G6', 'G7']);
    const q = renderTrends(many, { gameIds: selected, onGameIdsChange: onChange });
    const btn = q.getByTestId('trends-quick-last5');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(q.getByTestId('trends-filter-shared-note').textContent).toContain('Statistieken');
    expect(q.getByTestId('trends-games-btn').textContent).toBe('Wedstrijden (5)');
    fireEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('zonder wedstrijdselectie (alles) staat de notitie er niet', () => {
    const q = renderTrends();
    expect(q.queryByTestId('trends-filter-shared-note')).toBeNull();
  });

  it('"Deze wedstrijd" is uitgeschakeld mét uitleg zonder lopende wedstrijd', () => {
    const q = renderTrends();
    const btn = q.getByTestId('trends-quick-current') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('Er is geen lopende wedstrijd met gespeelde segmenten.');
    const hint = document.getElementById(btn.getAttribute('aria-describedby')!);
    expect(hint?.textContent).toBe('Er is geen lopende wedstrijd met gespeelde segmenten.');
  });

  it('"Deze wedstrijd" kiest alleen de lopende wedstrijd (gedeeld filter)', () => {
    const onChange = vi.fn();
    const q = renderTrends(fixture(), {
      activeGame: activeGameWithSegment(),
      onGameIdsChange: onChange,
    });
    const btn = q.getByTestId('trends-quick-current') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect([...(onChange.mock.calls[0]![0] as Set<string>)]).toEqual(['live-1']);
  });

  it('hulpfuncties: nieuwste afgeronde wedstrijden en selectievergelijking', () => {
    const scope = buildAnalysisScope(repoOf(fixture()), activeGameWithSegment());
    expect([...latestCompletedGameIds(scope.games, 1)]).toEqual(['B']);
    expect([...latestCompletedGameIds(scope.games, 5)].sort()).toEqual(['A', 'B']);
    expect(selectionEquals(null, new Set(['live-1', 'A', 'B']), scope.games)).toBe(true);
    expect(selectionEquals(new Set(['A']), new Set(['A']), scope.games)).toBe(true);
    expect(selectionEquals(new Set(['A']), new Set(['B']), scope.games)).toBe(false);
    expect(selectionEquals(null, new Set(), scope.games)).toBe(false);
  });
});

describe('Trends: Overzicht', () => {
  it('toont de teamkaart met speeltijd, wedstrijden en per-10-waarden (fixture §F.2)', () => {
    const q = renderTrends();
    expect(q.getByTestId('trends-tov-total').textContent).toBe('11');
    expect(q.getByTestId('trends-team-meta').textContent).toContain('2 wedstrijden');
    expect(q.getByTestId('trends-team-meta').textContent).toContain('50:00 speeltijd');
    // Totaal (standaard): +/- +9, voor 50, tegen 41, turnovers 11.
    expect(q.getByTestId('trends-team-pm').textContent).toBe('+9');
    expect(q.getByTestId('trends-team-for').textContent).toBe('50');
    expect(q.getByTestId('trends-team-against').textContent).toBe('41');
    expect(q.getByTestId('trends-team-tov').textContent).toBe('11');
    fireEvent.click(q.getByTestId('trends-per10-toggle'));
    expect(q.getByTestId('trends-team-pm').textContent).toBe('+1.8');
    expect(q.getByTestId('trends-team-for').textContent).toBe('10.0');
    expect(q.getByTestId('trends-team-against').textContent).toBe('8.2');
    expect(q.getByTestId('trends-team-tov').textContent).toBe('2.2');
  });
});

describe('Trends: Lineups', () => {
  it('rijen boven de drempel (L1, L2), met minuten, wedstrijden, waarde en toon', () => {
    const q = renderTrends();
    lineupsPer10(q);
    const list = q.getByTestId('trends-lineup-list');
    const items = Array.from(list.querySelectorAll('li'));
    expect(items.map((li) => li.getAttribute('data-testid'))).toEqual([
      'trends-lineup-1-2-3-4-5',
      'trends-lineup-1-2-3-4-6',
    ]);
    expect(q.getByTestId('trends-lineup-value-1-2-3-4-5').textContent).toBe('+0.8');
    expect(q.getByTestId('trends-lineup-value-1-2-3-4-6').textContent).toBe('+0.5');
    expect(items[0]!.textContent).toContain('25:00');
    expect(items[0]!.textContent).toContain('2 wedstrijden');
    expect(items[1]!.textContent).toContain('20:00');
    // Team +1.8: L1 -1.0 en L2 -1.3 -> slechter dan team (▼).
    expect(items[0]!.getAttribute('data-tone')).toBe('bad');
    expect(items[0]!.textContent).toContain('▼');
    expect(items[0]!.textContent).toContain('slechter dan team');
    expect(q.getByTestId('trends-lineup-delta-1-2-3-4-5').textContent).toContain(
      '-1.0 t.o.v. team (+1.8)',
    );
    // Teamgemiddelde in de kop.
    expect(q.getByTestId('trends-lineup-teamavg').textContent).toBe(
      'Teamgemiddelde +1.8 per 10 min',
    );
    expect(q.getByTestId('trends-lineup-title').textContent).toBe('Lineups: +/- per 10 min');
  });

  it('toegankelijke naam per rij met lineup, minuten, waarde per 10 min en toon', () => {
    const q = renderTrends();
    open(q, 'lineups');
    const li = q.getByTestId('trends-lineup-1-2-3-4-5');
    expect(li.getAttribute('aria-label')).toBe(
      '1-2-3-4-5, 25:00, +0.8 per 10 minuten, slechter dan team',
    );
    // De balken zijn decoratie.
    expect(li.querySelector('.trends-meter')!.getAttribute('aria-hidden')).toBe('true');
    // Ook in de Totaal-stand blijft de naam de waarde per 10 min noemen.
    expect(q.getByTestId('trends-lineup-value-1-2-3-4-5').textContent).toBe('+2');
  });

  it('Totaal-stand: ruwe totalen als waarde en de waarde per 10 min in de regel eronder', () => {
    const q = renderTrends();
    open(q, 'lineups');
    expect(q.getByTestId('trends-lineup-title').textContent).toBe('Lineups: +/- totaal');
    expect(q.getByTestId('trends-lineup-value-1-2-3-4-5').textContent).toBe('+2');
    expect(q.getByTestId('trends-lineup-value-1-2-3-4-6').textContent).toBe('+1');
    expect(q.getByTestId('trends-lineup-delta-1-2-3-4-5').textContent).toContain('+0.8 per 10 min');
  });

  it('lineup van 3:00 staat NIET in de ranglijst maar in de ingeklapte groep "Te weinig data"', () => {
    const q = renderTrends();
    lineupsPer10(q);
    expect(q.queryByTestId('trends-lineup-1-2-3-6-7')).toBeNull();
    expect(q.queryByTestId('trends-lineup-1-2-3-5-7')).toBeNull();
    const group = q.getByTestId('trends-lineup-lowdata') as HTMLDetailsElement;
    expect(group.tagName).toBe('DETAILS');
    expect(group.open).toBe(false);
    expect(group.querySelector('summary')!.textContent).toBe(
      'Te weinig data (2 lineups onder 5:00)',
    );
    const rows = Array.from(group.querySelectorAll('li'));
    // Gesorteerd op minuten aflopend: L3 (3:00) vóór L4 (2:00).
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'trends-lineup-low-1-2-3-6-7',
      'trends-lineup-low-1-2-3-5-7',
    ]);
    expect(rows[0]!.textContent).toContain('+4 in 3:00');
    expect(rows[1]!.textContent).toContain('+2 in 2:00');
    // Geen per-10-waarde (13.3 / 10.0) en geen toon in de groep.
    expect(group.textContent).not.toContain('13.3');
    expect(group.textContent).not.toMatch(/[▲●▼]/);
    expect(group.querySelector('[data-tone]')).toBeNull();
  });

  it('drempel "uit": waarschuwing, geen groep, en korte lineups staan bovenaan', () => {
    const q = renderTrends();
    lineupsPer10(q);
    expect(q.queryByTestId('trends-lineup-threshold-warning')).toBeNull();
    const btn = q.getByTestId('trends-threshold-btn');
    fireEvent.click(btn); // 10:00
    fireEvent.click(btn); // uit
    expect(btn.textContent).toBe('Drempel: uit');
    expect(q.getByTestId('trends-lineup-threshold-warning').textContent).toContain(
      '2 of 3 minuten',
    );
    expect(q.queryByTestId('trends-lineup-lowdata')).toBeNull();
    const order = Array.from(q.getByTestId('trends-lineup-list').querySelectorAll('li')).map((li) =>
      li.getAttribute('data-testid'),
    );
    expect(order).toEqual([
      'trends-lineup-1-2-3-6-7', // 13.3
      'trends-lineup-1-2-3-5-7', // 10.0
      'trends-lineup-1-2-3-4-5',
      'trends-lineup-1-2-3-4-6',
    ]);
    expect(q.getByTestId('trends-lineup-value-1-2-3-6-7').textContent).toBe('+13.3');
  });

  it('drempel 3:00 (grens telt mee): L3 komt in de ranglijst, beter dan team (▲)', () => {
    const q = renderTrends();
    lineupsPer10(q);
    const btn = q.getByTestId('trends-threshold-btn');
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn); // 3:00
    expect(btn.textContent).toBe('Drempel: 3:00');
    const li = q.getByTestId('trends-lineup-1-2-3-6-7');
    expect(li.getAttribute('data-tone')).toBe('good');
    expect(li.textContent).toContain('▲');
    expect(li.getAttribute('aria-label')).toBe(
      '1-2-3-6-7, 3:00, +13.3 per 10 minuten, beter dan team',
    );
    expect(q.getByTestId('trends-lineup-lowdata').querySelector('summary')!.textContent).toBe(
      'Te weinig data (1 lineup onder 3:00)',
    );
  });

  it('"rond gemiddelde" (●) bij |verschil| < 0,5 per 10 min', () => {
    const game = completed('X', '2026-09-01T10:00:00.000Z', [seg('x1', 1, L1, 600, 3, 1, 0)]);
    const q = renderTrends([game]);
    lineupsPer10(q);
    const li = q.getByTestId('trends-lineup-1-2-3-4-5');
    expect(li.getAttribute('data-tone')).toBe('flat');
    expect(li.textContent).toContain('●');
    expect(li.getAttribute('aria-label')).toContain('rond gemiddelde');
    expect(toneOfDelta(0.49, true)).toBe('flat');
    expect(toneOfDelta(-0.5, true)).toBe('bad');
    expect(toneOfDelta(0.5, false)).toBe('bad');
    expect(toneOfDelta(-0.5, false)).toBe('good');
  });

  it('kleur is nooit de enige aanwijzing: elke rij heeft symbool, tekst en toegankelijke naam', () => {
    const q = renderTrends();
    lineupsPer10(q);
    const btn = q.getByTestId('trends-threshold-btn');
    fireEvent.click(btn);
    fireEvent.click(btn); // uit: alle vier de rijen
    for (const metricId of ['pm', 'pfpa', 'tov']) {
      fireEvent.click(q.getByTestId(`trends-metric-${metricId}`));
      const items = Array.from(q.getByTestId('trends-lineup-list').querySelectorAll('li'));
      expect(items.length).toBe(4);
      for (const li of items) {
        expect(li.textContent).toMatch(/[▲●▼]/);
        expect(li.textContent).toMatch(/beter dan team|rond gemiddelde|slechter dan team/);
        expect(li.getAttribute('aria-label')).toMatch(
          /beter dan team|rond gemiddelde|slechter dan team/,
        );
      }
    }
  });

  it('Voor/Tegen: twee waarden per lineup; Tegen heeft een omgekeerde toon (lager is beter)', () => {
    const q = renderTrends();
    lineupsPer10(q);
    fireEvent.click(q.getByTestId('trends-metric-pfpa'));
    expect(q.getByTestId('trends-lineup-title').textContent).toBe(
      'Lineups: voor en tegen per 10 min',
    );
    expect(q.getByTestId('trends-lineup-for-1-2-3-4-5').textContent).toBe('9.6');
    expect(q.getByTestId('trends-lineup-against-1-2-3-4-5').textContent).toBe('8.8');
    // Team: voor 10.0 / tegen 8.2. L1: voor -0.4 (rond gemiddelde), tegen +0.6 (hoger = slechter).
    const li = q.getByTestId('trends-lineup-1-2-3-4-5');
    expect(li.getAttribute('aria-label')).toBe(
      '1-2-3-4-5, 25:00, voor 9.6 per 10 minuten, rond gemiddelde, tegen 8.8 per 10 minuten, slechter dan team',
    );
    const sides = li.querySelectorAll('.trends-lineup-side');
    expect(sides[0]!.getAttribute('data-tone')).toBe('flat');
    expect(sides[1]!.getAttribute('data-tone')).toBe('bad');
    // Totalen in de Totaal-stand.
    fireEvent.click(q.getByTestId('trends-per10-toggle'));
    expect(q.getByTestId('trends-lineup-for-1-2-3-4-5').textContent).toBe('24');
    expect(q.getByTestId('trends-lineup-against-1-2-3-4-5').textContent).toBe('22');
    // Groep "Te weinig data" toont ruwe voor/tegen.
    expect(q.getByTestId('trends-lineup-low-1-2-3-6-7').textContent).toContain(
      'Voor 4 · Tegen 0 in 3:00',
    );
  });

  it('metriek Turnovers: bestaande testids en toon; drempel + groep "Te weinig data"', () => {
    const q = renderTrends();
    lineupsPer10(q);
    fireEvent.click(q.getByTestId('trends-metric-tov'));
    expect(q.getByTestId('trends-tov-lineups').textContent).toContain('Laagste is het beste');
    const keys = Array.from(q.getByTestId('trends-lineup-list').querySelectorAll('li')).map((li) =>
      li.getAttribute('data-testid'),
    );
    expect(keys).toEqual(['trends-tov-lineup-1-2-3-4-5', 'trends-tov-lineup-1-2-3-4-6']);
    expect(q.getByTestId('trends-tov-lineup-value-1-2-3-4-5').textContent).toBe('1.6');
    expect(q.getByTestId('trends-tov-lineup-value-1-2-3-4-6').textContent).toBe('3.5');
    expect(q.getByTestId('trends-tov-lineup-1-2-3-4-5').getAttribute('data-tone')).toBe('good');
    expect(q.getByTestId('trends-tov-lineup-1-2-3-4-6').getAttribute('data-tone')).toBe('bad');
    expect(q.getByTestId('trends-tov-lineup-1-2-3-4-5').getAttribute('aria-label')).toBe(
      '1-2-3-4-5, 25:00, 1.6 turnovers per 10 minuten, beter dan team',
    );
    // De twee lineups met 0 turnovers (3:00 en 2:00) staan niet bovenaan maar in de groep.
    const group = q.getByTestId('trends-lineup-lowdata');
    expect(group.querySelector('summary')!.textContent).toBe(
      'Te weinig data (2 lineups onder 5:00)',
    );
    expect(group.textContent).toContain('Turnovers: 0 in 3:00');
    // Totaal-stand: turnovers tonen altijd per 10 min (onafhankelijk van de chip, review-fix M2).
    fireEvent.click(q.getByTestId('trends-per10-toggle'));
    expect(q.getByTestId('trends-tov-lineup-value-1-2-3-4-5').textContent).toBe('1.6');
    expect(q.getByTestId('trends-lineup-title').textContent).toBe('Lineups: turnovers per 10 min');
  });

  it('Turnovers met drempel "uit" is inhoudelijk gelijk aan de ongewijzigde domeinranglijst', () => {
    const q = renderTrends();
    lineupsPer10(q);
    fireEvent.click(q.getByTestId('trends-metric-tov'));
    const btn = q.getByTestId('trends-threshold-btn');
    fireEvent.click(btn);
    fireEvent.click(btn); // uit
    const scope = buildAnalysisScope(repoOf(fixture()), null);
    const expected = computeLineupTurnoverRanking(scope.games, null).rows.map(
      (r) => `trends-tov-lineup-${r.rosterIds.join('-')}`,
    );
    const rendered = Array.from(q.getByTestId('trends-lineup-list').querySelectorAll('li')).map(
      (li) => li.getAttribute('data-testid'),
    );
    // Review-fix M5: de presentatielaag past §E.4 toe (bij gelijke waarde eerst meer minuten), terwijl
    // `computeLineupTurnoverRanking` ongewijzigd op de sleutel valt. L3 (0 turnovers, 180 s) staat nu
    // voor L4 (0 turnovers, 120 s); dezelfde verzameling rijen, andere volgorde bij gelijke waarde.
    expect(expected[0]).toBe('trends-tov-lineup-1-2-3-5-7'); // domein: L4 (0) op sleutel, dan L3, L1, L2
    expect(rendered).toEqual([
      'trends-tov-lineup-1-2-3-6-7',
      'trends-tov-lineup-1-2-3-5-7',
      'trends-tov-lineup-1-2-3-4-5',
      'trends-tov-lineup-1-2-3-4-6',
    ]);
    expect([...rendered].sort()).toEqual([...expected].sort());
  });

  it('vaste uitleg (NL) en legenda', () => {
    const q = renderTrends();
    open(q, 'lineups');
    expect(q.getByTestId('trends-lineup-explain').textContent).toBe(
      'Beschrijvend: wat gebeurde er met deze vijf op het veld. Weinig minuten zegt bijna niets (drempel nu: 5:00). Per 10 min is geen balbezitcorrectie.',
    );
    expect(q.getByTestId('trends-lineup-legend').textContent).toContain('▲ beter dan team');
  });

  it('EN: uitleg, groep, toon en tabs zijn Engels', () => {
    const q = renderTrends(fixture(), { lang: 'en' });
    expect(q.getAllByRole('tab').map((tb) => tb.textContent)).toEqual([
      'Overview',
      'Lineups',
      'Players',
      'Quarters',
    ]);
    lineupsPer10(q);
    expect(q.getByTestId('trends-lineup-explain').textContent).toBe(
      'Descriptive: what happened with these five on court. Few minutes tell you almost nothing (threshold now: 5:00). Per 10 min is not a possession adjustment.',
    );
    expect(q.getByTestId('trends-lineup-lowdata').querySelector('summary')!.textContent).toBe(
      'Too little data (2 lineups under 5:00)',
    );
    expect(q.getByTestId('trends-lineup-1-2-3-4-5').getAttribute('aria-label')).toBe(
      '1-2-3-4-5, 25:00, +0.8 per 10 minutes, worse than team',
    );
    expect(q.getByTestId('trends-threshold-btn').textContent).toBe('Threshold: 5:00');
  });

  it('lege staat: geen lineups boven de drempel en lege selectie', () => {
    const q = renderTrends(fixture(), { gameIds: new Set() });
    open(q, 'lineups');
    expect(q.getByTestId('trends-lineup-empty')).toBeTruthy();
  });

  it('alle lineups onder de drempel: melding dat er geen lineup boven de drempel is', () => {
    const game = completed('X', '2026-09-01T10:00:00.000Z', [seg('x1', 1, L1, 120, 2, 1, 0)]);
    const q = renderTrends([game]);
    open(q, 'lineups');
    expect(q.getByTestId('trends-lineup-none-above').textContent).toBe(
      'Geen lineup boven de drempel van 5:00.',
    );
    expect(q.getByTestId('trends-lineup-lowdata')).toBeTruthy();
  });
});

describe('Trends: Spelers en Kwarten', () => {
  it('Spelers: compacte rijen die uitklappen tot de bestaande kaart; sorteerchip alleen hier', () => {
    const q = renderTrends();
    expect(q.queryByTestId('trends-sort-toggle')).toBeNull();
    open(q, 'players');
    expect(q.getByTestId('trends-sort-toggle').textContent).toContain('Nr');
    const list = q.getByTestId('trends-list');
    expect(list.querySelectorAll('[data-testid^="trends-card-"]').length).toBe(7);
    // Samenvatting in de rij; de uitgebreide kaart ontbreekt tot uitklappen.
    expect(q.getByTestId('trends-row-min-4').textContent).toBe('22.5'); // 2700 s / 60 / 2 wedstrijden
    expect(q.getByTestId('trends-row-pm-4').textContent).toBe('+3');
    expect(q.getByTestId('trends-row-tov-4').textContent).toBe('11');
    expect(q.queryByTestId('trends-tiles-4')).toBeNull();
    const toggle = q.getByTestId('trends-row-toggle-4');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(q.getByTestId('trends-tiles-4')).toBeTruthy();
    // Spelertrendgetallen ongewijzigd (zelfde als de rij).
    expect(q.getByTestId('trends-avgmin-4').textContent).toBe('22.5');
    expect(q.getByTestId('trends-totalpm-4').textContent).toBe('+3');
    fireEvent.click(toggle);
    expect(q.queryByTestId('trends-tiles-4')).toBeNull();
  });

  it('Spelers: sorteercyclus Nr -> MIN -> +/- -> Nr blijft werken', () => {
    const q = renderTrends();
    open(q, 'players');
    const sort = q.getByTestId('trends-sort-toggle');
    fireEvent.click(sort);
    expect(sort.textContent).toContain('MIN');
    fireEvent.click(sort);
    expect(sort.textContent).toContain('+/-');
    fireEvent.click(sort);
    expect(sort.textContent).toContain('Nr');
  });

  it('Kwarten: toont de kwartkaarten (inhoud: trendsQuartersView.spec.tsx)', () => {
    const q = renderTrends();
    open(q, 'quarters');
    expect(q.getByTestId('trends-quarters-title').textContent).toBe('Kwarten: +/- totaal');
    cleanup();
    const en = renderTrends(fixture(), { lang: 'en', initialView: 'quarters' });
    expect(en.getByTestId('trends-quarters-title').textContent).toBe('Quarters: +/- total');
  });

  it('zonder wedstrijden: alleen de "geen data"-melding, geen tabs', () => {
    const q = renderTrends([]);
    expect(q.getByTestId('trends-no-data')).toBeTruthy();
    expect(q.queryByRole('tablist')).toBeNull();
  });
});

describe('Trends: tokens en contrast van de nieuwe toon-kleuren', () => {
  it('gebruikt alleen bestaande tokens en geen losse hex-kleuren', () => {
    const css = readFileSync(resolve(__dirname, '../../src/styles/trends-views.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    for (const m of css.matchAll(/var\(--lt-color-([a-z0-9-]+)\)/g)) {
      expect(readFileSync(resolve(__dirname, '../../src/styles/tokens.css'), 'utf8')).toContain(
        `--lt-color-${m[1]}:`,
      );
    }
  });
});

// ---- Review-fixes set B: sortering in Totaal, turnovers per 10, toon, uitleg ----

describe('Trends: Lineups — sortering en turnovers (review-fixes M1/M2/M5)', () => {
  // L1: 1500 s, 16-10 (+6, 1,44 per 10), 3 tov; L2: 360 s, 5-2 (+3, 5,0 per 10), 1 tov.
  const sortFixture = () => [
    completed('S', '2026-09-20T10:00:00.000Z', [
      seg('s1', 1, L1, 1500, 16, 10, 3),
      seg('s2', 2, L2, 360, 5, 2, 1),
    ]),
  ];
  const order = (q: Q) =>
    Array.from(q.getByTestId('trends-lineup-list').querySelectorAll('li')).map((li) =>
      li.getAttribute('data-testid'),
    );

  it('Totaal: +/- sorteert op het getoonde totaal (+6 in 25:00 boven +3 in 6:00)', () => {
    const q = renderTrends(sortFixture());
    open(q, 'lineups');
    expect(order(q)).toEqual(['trends-lineup-1-2-3-4-5', 'trends-lineup-1-2-3-4-6']);
    expect(q.getByTestId('trends-lineup-value-1-2-3-4-5').textContent).toBe('+6');
    expect(q.getByTestId('trends-lineup-hint').textContent).toContain('Gesorteerd op het totaal');
  });

  it('Per 10 min: +/- sorteert zoals voorheen op de waarde per 10 (+5,0 boven +1,4)', () => {
    const q = renderTrends(sortFixture());
    lineupsPer10(q);
    expect(order(q)).toEqual(['trends-lineup-1-2-3-4-6', 'trends-lineup-1-2-3-4-5']);
    expect(q.getByTestId('trends-lineup-hint').textContent).toBe('Hoogste is het beste');
  });

  it('Totaal: Voor/Tegen sorteert op voor min tegen (totaal)', () => {
    const q = renderTrends(sortFixture());
    open(q, 'lineups');
    fireEvent.click(q.getByTestId('trends-metric-pfpa'));
    expect(order(q)).toEqual(['trends-lineup-1-2-3-4-5', 'trends-lineup-1-2-3-4-6']);
    fireEvent.click(q.getByTestId('trends-per10-toggle'));
    expect(order(q)).toEqual(['trends-lineup-1-2-3-4-6', 'trends-lineup-1-2-3-4-5']);
  });

  it('Totaal: gelijk totaal -> meer minuten eerst, dan de sleutel', () => {
    const games = [
      completed('T', '2026-09-20T10:00:00.000Z', [
        seg('t1', 1, L1, 400, 8, 6, 0), // +2 in 400 s
        seg('t2', 2, L2, 700, 9, 7, 0), // +2 in 700 s
      ]),
    ];
    const q = renderTrends(games);
    open(q, 'lineups');
    expect(order(q)).toEqual(['trends-lineup-1-2-3-4-6', 'trends-lineup-1-2-3-4-5']);
  });

  it('Turnovers tonen altijd per 10 min, ook in Totaal, met een titel die dat zegt', () => {
    const q = renderTrends(sortFixture());
    open(q, 'lineups'); // Totaal
    fireEvent.click(q.getByTestId('trends-metric-tov'));
    expect(q.getByTestId('trends-lineup-title').textContent).toBe('Lineups: turnovers per 10 min');
    expect(q.getByTestId('trends-tov-lineup-value-1-2-3-4-5').textContent).toBe('1.2');
    expect(q.getByTestId('trends-tov-lineup-value-1-2-3-4-6').textContent).toBe('1.7');
    // Laagste eerst en identiek in beide standen van de chip.
    expect(order(q)).toEqual(['trends-tov-lineup-1-2-3-4-5', 'trends-tov-lineup-1-2-3-4-6']);
    fireEvent.click(q.getByTestId('trends-per10-toggle'));
    expect(order(q)).toEqual(['trends-tov-lineup-1-2-3-4-5', 'trends-tov-lineup-1-2-3-4-6']);
    expect(q.getByTestId('trends-tov-lineup-value-1-2-3-4-5').textContent).toBe('1.2');
    // Het aantal staat erbij als aanvullende regel.
    expect(q.getByTestId('trends-tov-lineup-1-2-3-4-5').textContent).toContain('Turnovers: 3');
  });

  it('Turnovertoon: gemiddelde 2,2 en lineup 2,25 -> rond gemiddelde (niet binair rood)', () => {
    // A: 3 tov in 800 s = 2,25 per 10; B: 8 tov in 2200 s = 2,18; gemiddelde 11*600/3000 = 2,2.
    const game = completed('M', '2026-09-20T10:00:00.000Z', [
      seg('m1', 1, L1, 800, 6, 5, 3),
      seg('m2', 2, L2, 2200, 20, 18, 8),
    ]);
    const q = renderTrends([game]);
    open(q, 'lineups');
    fireEvent.click(q.getByTestId('trends-metric-tov'));
    const a = q.getByTestId('trends-tov-lineup-1-2-3-4-5');
    expect(a.getAttribute('data-tone')).toBe('flat');
    expect(a.textContent).toContain('●');
    expect(a.getAttribute('aria-label')).toContain('rond gemiddelde');
    expect(q.getByTestId('trends-tov-lineup-1-2-3-4-6').getAttribute('data-tone')).toBe('flat');
  });

  it('uitleg noemt de huidige drempel (3:00) of "uit" in plaats van een vaste 5', () => {
    const q = renderTrends();
    open(q, 'lineups');
    const btn = q.getByTestId('trends-threshold-btn');
    fireEvent.click(btn); // 5:00 -> 10:00
    fireEvent.click(btn); // -> uit
    expect(q.getByTestId('trends-lineup-explain').textContent).toContain('drempel nu: uit');
    fireEvent.click(btn); // -> 3:00
    expect(q.getByTestId('trends-lineup-explain').textContent).toContain('drempel nu: 3:00');
  });
});
