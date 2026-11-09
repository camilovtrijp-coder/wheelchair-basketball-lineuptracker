// @vitest-environment jsdom
// Snel wedstrijdscherm (derde optie naast Klassiek en Compact): stand via wiel en
// knoppen, eindtijd via minuten-/secondenwiel met bijstelknoppen, wisselen en
// kwart afsluiten via de bestaande liveCommands, read-only en NL/EN.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { act, render, cleanup, fireEvent } from '@testing-library/preact';
import { QuickLivePanel } from '../../src/ui/game/QuickLivePanel';
import { commitSegment } from '../../src/domain/game/liveCommands';
import { deriveGameHistory, scoreDeltaAction } from '../../src/domain/game/tracking';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';
import type { Lang } from '../../src/i18n/strings';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ROSTER: Array<[number, string]> = [
  [4, 'Alex'],
  [7, 'Sam'],
  [9, 'Robin'],
  [11, 'Kim'],
  [13, 'Dani'],
  [6, 'Bo'],
  [12, 'Noa'],
  [15, 'Jules'],
];

function player([nr, naam]: [number, string]): GamePlayer {
  return {
    id: `gp-${nr}`,
    rosterId: nr,
    nr: String(nr),
    naam,
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: [4, 7, 9, 11, 13].includes(nr),
  };
}

function trackingGame(overrides: Partial<ActiveGame> = {}): ActiveGame {
  return {
    id: 'game-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: ROSTER.map(player),
    opponent: 'Tegen',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13'],
    curQuarter: 1,
    beginSec: 600,
    endSec: 600,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const CLASSIFICATION = {
  useClassLimit: false,
  classBaseLimit: 14.5,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1,
  bonusBoth: 2,
};

interface SetupOptions {
  canWrite?: boolean;
  lang?: Lang;
  game?: ActiveGame;
}

function setup(opts: SetupOptions = {}) {
  let latest: ActiveGame = opts.game ?? trackingGame();
  function Harness() {
    const [game, setGame] = useState<ActiveGame>(opts.game ?? trackingGame());
    return (
      <QuickLivePanel
        lang={opts.lang ?? 'nl'}
        game={game}
        quarterCount={4}
        periodLabel="Kwart"
        classification={CLASSIFICATION}
        teamName="Eigen"
        tag1Label=""
        tag2Label=""
        onGameChange={(next) => {
          latest = next;
          setGame(next);
        }}
        onFinishGame={vi.fn()}
        canWrite={opts.canWrite ?? true}
        saveError={false}
      />
    );
  }
  const utils = render(<Harness />);
  return { ...utils, latest: () => latest };
}

const text = (el: Element) => el.textContent ?? '';

describe('QuickLivePanel: hoofdscherm', () => {
  it('toont de vijf spelers op de vloer, de bank en de periode', () => {
    const { getByTestId, container } = setup();
    expect(container.querySelectorAll('[data-testid="quick-court"] .quick-chip')).toHaveLength(5);
    expect(container.querySelectorAll('[data-testid="quick-bench"] .quick-chip')).toHaveLength(3);
    expect(text(getByTestId('quick-period'))).toContain('Kwart 1/4');
    expect(text(getByTestId('quick-begin'))).toContain('10:00');
  });

  it('+2 en −1 leggen score-acties vast en tonen het open segment', () => {
    const { getByTestId, latest } = setup();
    fireEvent.click(getByTestId('quick-score-plus-for-2'));
    fireEvent.click(getByTestId('quick-score-plus-for-3'));
    fireEvent.click(getByTestId('quick-score-plus-against-2'));
    fireEvent.click(getByTestId('quick-score-minus-for'));
    const h = deriveGameHistory(latest());
    expect(h.scoreFor).toBe(4);
    expect(h.scoreAgainst).toBe(2);
    expect(text(getByTestId('quick-score-value-for'))).toContain('4');
    expect(text(getByTestId('quick-segment-pm'))).toContain('+2');
  });

  it('turnover +1 telt mee in het open segment', () => {
    const { getByTestId, latest } = setup();
    fireEvent.click(getByTestId('quick-turnover-plus'));
    expect(deriveGameHistory(latest()).turnovers).toBe(1);
  });

  it('alles is uitgeschakeld zonder schrijfrechten', () => {
    const { getByTestId } = setup({ canWrite: false });
    expect(getByTestId('game-read-only')).toBeTruthy();
    expect((getByTestId('quick-score-plus-for-2') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('quick-score-value-for') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('quick-primary') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('quick-end-period') as HTMLButtonElement).disabled).toBe(true);
  });

  it('toont Engelse teksten', () => {
    const { getByTestId } = setup({ lang: 'en' });
    expect(text(getByTestId('quick-primary'))).toContain('Save');
    expect(text(getByTestId('quick-end-period'))).toContain('End of kwart');
  });
});

describe('QuickLivePanel: stand met wiel', () => {
  it('kiest een stand in het wiel en legt die bij Klaar vast', () => {
    const { getByTestId, latest } = setup();
    fireEvent.click(getByTestId('quick-score-value-for'));
    fireEvent.click(getByTestId('quick-score-wheel-opt-12'));
    expect(text(getByTestId('quick-score-meta'))).toContain('+12');
    fireEvent.click(getByTestId('quick-score-done'));
    expect(deriveGameHistory(latest()).scoreFor).toBe(12);
    expect(() => getByTestId('quick-score-sheet')).toThrow();
  });

  it('weigert een stand onder de beginstand van het segment', () => {
    // Eerst 5 punten en een segment vastleggen: de beginstand van het open segment is dan 5.
    let game = trackingGame({
      actions: [scoreDeltaAction('for', 2), scoreDeltaAction('for', 3)],
    });
    const committed = commitSegment(game, { endSec: 420, classification: CLASSIFICATION });
    if (!committed.ok) throw new Error('segment moet lukken');
    game = committed.game;
    const { getByTestId, latest } = setup({ game });
    fireEvent.click(getByTestId('quick-score-value-for'));
    fireEvent.click(getByTestId('quick-score-wheel-opt-3'));
    fireEvent.click(getByTestId('quick-score-done'));
    expect(getByTestId('quick-score-error')).toBeTruthy();
    expect(deriveGameHistory(latest()).scoreFor).toBe(5);
  });
});

describe('QuickLivePanel: eindtijd met wiel', () => {
  it('begint bij het voorstel en stelt de tijd bij met eerder/later', () => {
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('quick-primary'));
    // Zonder eerder segment: voorstel is 1 minuut na het begin (9:00 op de aflopende klok).
    expect(text(getByTestId('quick-time-value'))).toBe('9:00');
    fireEvent.click(getByTestId('quick-nudge-earlier-10'));
    expect(text(getByTestId('quick-time-value'))).toBe('9:10');
    fireEvent.click(getByTestId('quick-nudge-later-5'));
    expect(text(getByTestId('quick-time-value'))).toBe('9:05');
    fireEvent.click(getByTestId('quick-nudge-later-1'));
    expect(text(getByTestId('quick-time-value'))).toBe('9:04');
  });

  it('snel opeenvolgende bijstelknoppen tellen allemaal mee', () => {
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('quick-primary'));
    const earlier = getByTestId('quick-nudge-earlier-10');
    // Direct achter elkaar binnen één update, zonder tussentijdse render (zoals twee snelle tikken).
    act(() => {
      for (let i = 0; i < 3; i += 1)
        earlier.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(text(getByTestId('quick-time-value'))).toBe('9:30');
  });

  it('legt een segment vast op de gekozen tijd en zet de begintijd door', () => {
    const { getByTestId, latest } = setup();
    fireEvent.click(getByTestId('quick-score-plus-for-2'));
    fireEvent.click(getByTestId('quick-primary'));
    fireEvent.click(getByTestId('quick-minutes-wheel-opt-7'));
    fireEvent.click(getByTestId('quick-seconds-wheel-opt-0'));
    expect(text(getByTestId('quick-time-value'))).toBe('7:00');
    expect(text(getByTestId('quick-played-line'))).toContain('Gespeeld 3:00');
    fireEvent.click(getByTestId('quick-time-confirm'));
    const game = latest();
    const h = deriveGameHistory(game);
    expect(h.segments).toHaveLength(1);
    expect(h.segments[0]).toMatchObject({ beginSec: 600, endSec: 420, durSec: 180, pf: 2, pa: 0 });
    expect(game.beginSec).toBe(420);
    expect(text(getByTestId('quick-begin'))).toContain('7:00');
  });

  it('weigert een eindtijd die niet na het begin ligt', () => {
    const { getByTestId, latest } = setup();
    fireEvent.click(getByTestId('quick-primary'));
    fireEvent.click(getByTestId('quick-minutes-wheel-opt-10'));
    expect(text(getByTestId('quick-time-value'))).toBe('10:00');
    expect((getByTestId('quick-time-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(deriveGameHistory(latest()).segments).toHaveLength(0);
  });

  it('klemt de klok op 10:00 en 0:00', () => {
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('quick-primary'));
    fireEvent.click(getByTestId('quick-minutes-wheel-opt-0'));
    fireEvent.click(getByTestId('quick-seconds-wheel-opt-0'));
    fireEvent.click(getByTestId('quick-nudge-later-10'));
    expect(text(getByTestId('quick-time-value'))).toBe('0:00');
    fireEvent.click(getByTestId('quick-nudge-earlier-10'));
    expect(text(getByTestId('quick-time-value'))).toBe('0:10');
  });

  it('wiel bedienbaar met het toetsenbord', () => {
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('quick-primary'));
    const listbox = getByTestId('quick-seconds-wheel').querySelector('[role="listbox"]')!;
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(text(getByTestId('quick-time-value'))).toBe('9:01');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(text(getByTestId('quick-time-value'))).toBe('9:02');
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(text(getByTestId('quick-time-value'))).toBe('9:01');
    // Het secondenwiel loopt niet door naar de minuut ervoor: bij 00 stopt het.
    fireEvent.keyDown(listbox, { key: 'Home' });
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(text(getByTestId('quick-time-value'))).toBe('9:00');
  });

  it('bij een oplopende klok betekent eerder een lagere kloktijd', () => {
    const { getByTestId } = setup({
      game: trackingGame({ clockDown: false, beginSec: 0, endSec: 0 }),
    });
    fireEvent.click(getByTestId('quick-primary'));
    expect(text(getByTestId('quick-time-value'))).toBe('1:00');
    fireEvent.click(getByTestId('quick-nudge-earlier-10'));
    expect(text(getByTestId('quick-time-value'))).toBe('0:50');
  });
});

describe('QuickLivePanel: wisselen', () => {
  it('wissel bewaart de oude opstelling en legt het segment vast bij Klaar met wisselen', () => {
    const { getByTestId, latest } = setup();
    fireEvent.click(getByTestId('quick-chip-gp-4'));
    expect(getByTestId('swap-selected')).toBeTruthy();
    fireEvent.click(getByTestId('quick-chip-gp-6'));
    let game = latest();
    expect(game.onCourt).toContain('gp-6');
    expect(game.onCourt).not.toContain('gp-4');
    expect(game.pendingSwapLineup).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13']);
    expect(getByTestId('quick-swap-pending')).toBeTruthy();
    expect(text(getByTestId('quick-primary'))).toContain('Wissel opslaan');

    fireEvent.click(getByTestId('quick-swap-done'));
    fireEvent.click(getByTestId('quick-minutes-wheel-opt-8'));
    fireEvent.click(getByTestId('quick-seconds-wheel-opt-30'));
    fireEvent.click(getByTestId('quick-time-confirm'));
    game = latest();
    const h = deriveGameHistory(game);
    expect(h.segments).toHaveLength(1);
    expect(h.segments[0]?.lineup).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13']);
    expect(h.segments[0]).toMatchObject({ beginSec: 600, endSec: 510 });
    expect(game.pendingSwapLineup).toBeNull();
    expect(game.onCourt).toContain('gp-6');
  });

  it('annuleren zet de oude opstelling terug', () => {
    const { getByTestId, latest } = setup();
    fireEvent.click(getByTestId('quick-chip-gp-4'));
    fireEvent.click(getByTestId('quick-chip-gp-6'));
    fireEvent.click(getByTestId('quick-swap-cancel'));
    expect(latest().onCourt).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13']);
    expect(latest().pendingSwapLineup).toBeNull();
  });
});

describe('QuickLivePanel: einde kwart', () => {
  it('sluit het kwart af op 0:00 en start het volgende kwart', () => {
    const { getByTestId, latest } = setup();
    fireEvent.click(getByTestId('quick-score-plus-for-2'));
    fireEvent.click(getByTestId('quick-end-period'));
    expect(text(getByTestId('quick-time-value'))).toBe('0:00');
    expect(text(getByTestId('quick-quarter-note'))).toContain('Kwart 2');
    fireEvent.click(getByTestId('quick-time-confirm'));
    const game = latest();
    const h = deriveGameHistory(game);
    expect(h.segments).toHaveLength(1);
    expect(h.segments[0]).toMatchObject({ quarter: 1, beginSec: 600, endSec: 0, pf: 2 });
    expect(game.curQuarter).toBe(2);
    expect(game.beginSec).toBe(600);
  });

  it('rondt de wedstrijd nooit af in het laatste kwart', () => {
    const { getByTestId, latest } = setup({
      game: trackingGame({ curQuarter: 4, beginSec: 120, endSec: 120 }),
    });
    fireEvent.click(getByTestId('quick-end-period'));
    expect(text(getByTestId('quick-quarter-note'))).toContain('Laatste periode');
    fireEvent.click(getByTestId('quick-time-confirm'));
    expect(latest().curQuarter).toBe(4);
    expect(latest().phase).toBe('tracking');
  });
});
