// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { TrendsPanel } from '../../src/ui/trends/TrendsPanel';
import type { CompletedGameRepository } from '../../src/application/game/CompletedGameRepository';
import type { ActiveGame } from '../../src/domain/game/types';
import type { CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';
import type { RosterPlayer } from '../../src/domain/roster/types';
import type { Lang } from '../../src/i18n/strings';

afterEach(() => cleanup());

// ---- fixtures (fictief) ----

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

function seg(id: string, durSec: number): Segment {
  return {
    id,
    quarter: 1,
    beginSec: durSec,
    endSec: 0,
    durSec,
    lineup: [1, 2, 3, 4, 5].map((n) => `p${n}`),
    pf: 4,
    pa: 2,
    classSum: 14,
    allowed: 14,
    over: false,
  };
}

function completed(id: string, date: string): CompletedGame {
  return {
    id,
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: `src-${id}`,
    opponent: `Tegenstander ${id}`,
    competition: '',
    date,
    players: [1, 2, 3, 4, 5].map(gp),
    segments: [seg(`${id}-1`, 600)],
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

const roster: RosterPlayer[] = [1, 2, 3, 4, 5].map((n) => ({
  id: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '1.0',
  vrouw: false,
  jeugd: false,
}));

function liveGame(): ActiveGame {
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

/** Houdt het gedeelde wedstrijdfilter vast, zoals `app/App.tsx` dat doet. */
function Harness({
  games,
  lang = 'nl',
  activeGame = null,
  initial = null,
}: {
  games: CompletedGame[];
  lang?: Lang;
  activeGame?: ActiveGame | null;
  initial?: Set<string> | null;
}) {
  const [gameIds, setGameIds] = useState<Set<string> | null>(initial);
  return (
    <TrendsPanel
      lang={lang}
      repository={repoOf(games)}
      activeGame={activeGame}
      roster={roster}
      gameIds={gameIds}
      onGameIdsChange={setGameIds}
    />
  );
}

const ONE = [completed('A', '2026-09-05T10:00:00.000Z')];
const THREE = [
  completed('A', '2026-09-05T10:00:00.000Z'),
  completed('B', '2026-09-12T10:00:00.000Z'),
  completed('C', '2026-09-19T10:00:00.000Z'),
];

type Q = ReturnType<typeof render>;
const toggle = (q: Q) => q.getByTestId('trends-filters-toggle');
const openPanel = (q: Q) => fireEvent.click(toggle(q));
const pressed = (q: Q, id: string) => q.getByTestId(id).getAttribute('aria-pressed');
const summary = (q: Q) => q.getByTestId('trends-filter-summary').textContent;

describe('Laatste 5 / Deze wedstrijd: alleen actief bij een EXPLICIETE selectie', () => {
  it('een wedstrijd, geen selectie: niet ingedrukt; na tikken wel; nogmaals tikken weer niet', () => {
    const q = render(<Harness games={ONE} />);
    openPanel(q);
    expect(pressed(q, 'trends-quick-last5')).toBe('false');
    fireEvent.click(q.getByTestId('trends-quick-last5'));
    expect(pressed(q, 'trends-quick-last5')).toBe('true');
    // De selectie is nu expliciet; de chip "Wedstrijden (n)" blijft kloppen.
    expect(q.getByTestId('trends-games-btn').textContent).toBe('Wedstrijden (1)');
    fireEvent.click(q.getByTestId('trends-quick-last5'));
    expect(pressed(q, 'trends-quick-last5')).toBe('false');
  });

  it('minder dan 5 wedstrijden en geen selectie: Laatste 5 staat niet in', () => {
    const q = render(<Harness games={THREE} />);
    openPanel(q);
    expect(pressed(q, 'trends-quick-last5')).toBe('false');
    fireEvent.click(q.getByTestId('trends-quick-last5'));
    expect(pressed(q, 'trends-quick-last5')).toBe('true');
  });

  it('"Deze wedstrijd": alleen de lopende wedstrijd en geen selectie: niet ingedrukt tot je tikt', () => {
    const q = render(<Harness games={[]} activeGame={liveGame()} />);
    openPanel(q);
    expect(pressed(q, 'trends-quick-current')).toBe('false');
    fireEvent.click(q.getByTestId('trends-quick-current'));
    expect(pressed(q, 'trends-quick-current')).toBe('true');
    fireEvent.click(q.getByTestId('trends-quick-current'));
    expect(pressed(q, 'trends-quick-current')).toBe('false');
  });

  it('een expliciete selectie gelijk aan de laatste 5 staat wel in (van buiten gezet)', () => {
    const q = render(<Harness games={THREE} initial={new Set(['A', 'B', 'C'])} />);
    openPanel(q);
    expect(pressed(q, 'trends-quick-last5')).toBe('true');
  });
});

describe('Filterbalk: inklapbaar', () => {
  it('is standaard ingeklapt: knop met aria-expanded=false en geen chips in de DOM', () => {
    const q = render(<Harness games={THREE} />);
    const btn = toggle(q);
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBeTruthy();
    expect(btn.textContent).toContain('Filters');
    for (const id of [
      'trends-per10-toggle',
      'trends-games-btn',
      'trends-threshold-btn',
      'trends-quick-last5',
      'trends-quick-current',
      'trends-filterbar',
    ]) {
      expect(q.queryByTestId(id), id).toBeNull();
    }
  });

  it('opent en sluit het paneel; aria-controls wijst naar het paneel', () => {
    const q = render(<Harness games={THREE} />);
    openPanel(q);
    expect(toggle(q).getAttribute('aria-expanded')).toBe('true');
    const panel = q.getByTestId('trends-filterbar');
    expect(panel.id).toBe(toggle(q).getAttribute('aria-controls'));
    expect(panel.querySelector('[data-testid="trends-per10-toggle"]')).not.toBeNull();
    expect(panel.querySelector('[data-testid="trends-games-btn"]')).not.toBeNull();
    // Het paneel staat NIET in het vaste (sticky) deel maar eronder in de paginastroom.
    expect(q.getByTestId('trends-sticky').contains(panel)).toBe(false);
    expect(q.getByTestId('trends-sticky').contains(toggle(q))).toBe(true);
    expect(q.getByTestId('trends-sticky').contains(q.getByTestId('trends-tablist'))).toBe(true);
    fireEvent.click(toggle(q));
    expect(toggle(q).getAttribute('aria-expanded')).toBe('false');
    expect(q.queryByTestId('trends-filterbar')).toBeNull();
  });

  it('Escape sluit het paneel en zet de focus terug op de knop', () => {
    const q = render(<Harness games={THREE} />);
    openPanel(q);
    const chip = q.getByTestId('trends-threshold-btn');
    chip.focus();
    fireEvent.keyDown(chip, { key: 'Escape' });
    expect(q.queryByTestId('trends-filterbar')).toBeNull();
    expect(toggle(q).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle(q));
  });

  it('een filter werkt na openen en de samenvatting volgt', () => {
    const q = render(<Harness games={THREE} />);
    expect(summary(q)).toBe('Totaal · 3 wedstrijden · Drempel 5:00');
    openPanel(q);
    fireEvent.click(q.getByTestId('trends-per10-toggle'));
    fireEvent.click(q.getByTestId('trends-threshold-btn'));
    expect(summary(q)).toBe('Per 10 min · 3 wedstrijden · Drempel 10:00');
  });

  it('samenvatting noemt een actief snelfilter en dat de selectie niet "alles" is', () => {
    const q = render(<Harness games={THREE} initial={new Set(['A', 'B', 'C'])} />);
    expect(summary(q)).toBe('Totaal · 3 wedstrijden · Drempel 5:00 · Laatste 5');
    cleanup();
    const q2 = render(<Harness games={THREE} initial={new Set(['A'])} />);
    expect(summary(q2)).toBe('Totaal · 1 van 3 wedstrijden · Drempel 5:00 · Gefilterd');
    cleanup();
    const q3 = render(
      <Harness games={ONE} activeGame={liveGame()} initial={new Set(['live-1'])} />,
    );
    expect(summary(q3)).toBe(
      'Totaal · 1 van 2 wedstrijden · Drempel 5:00 · Deze wedstrijd · Gefilterd',
    );
  });

  it('samenvatting zonder drempel en in het Engels', () => {
    const q = render(<Harness games={ONE} lang="en" />);
    expect(summary(q)).toBe('Total · 1 game · Threshold 5:00');
    expect(toggle(q).textContent).toContain('Filters');
    openPanel(q);
    fireEvent.click(q.getByTestId('trends-per10-toggle'));
    const t = q.getByTestId('trends-threshold-btn');
    fireEvent.click(t);
    fireEvent.click(t); // 10:00 -> off
    expect(summary(q)).toBe('Per 10 min · 1 game · Threshold off');
    cleanup();
    const q2 = render(<Harness games={THREE} lang="en" initial={new Set(['A'])} />);
    expect(summary(q2)).toBe('Total · 1 of 3 games · Threshold 5:00 · Filtered');
  });

  it('de toestand wordt niet opgeslagen: een nieuwe mount is weer ingeklapt', () => {
    const q = render(<Harness games={THREE} />);
    openPanel(q);
    cleanup();
    const q2 = render(<Harness games={THREE} />);
    expect(toggle(q2).getAttribute('aria-expanded')).toBe('false');
  });

  it('het vaste deel is alleen tabs + samenvatting (CSS: sticky op .trends-sticky, niet op het paneel)', () => {
    const css = readFileSync(resolve(__dirname, '../../src/styles/trends-views.css'), 'utf8');
    const rule = (sel: string) =>
      css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)));
    const sticky = rule('.trends-panel .trends-sticky');
    expect(sticky).toContain('position: sticky');
    expect(sticky).toContain('top: 0');
    expect(sticky).toContain('env(safe-area-inset-top)');
    expect(rule('.trends-panel .trends-filterbar')).not.toContain('sticky');
  });
});
