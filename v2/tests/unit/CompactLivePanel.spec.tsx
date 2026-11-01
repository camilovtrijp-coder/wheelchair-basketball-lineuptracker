// @vitest-environment jsdom
// Compact wedstrijdscherm C2a: hoofdscherm (vijf spelers, periode, turnovers, stand,
// Uitwedstrijd als lokale presentatievoorkeur, read-only, NL/EN, classificatie).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { CompactLivePanel } from '../../src/ui/game/CompactLivePanel';
import {
  deriveGameHistory,
  scoreDeltaAction,
  segmentTurnovers,
} from '../../src/domain/game/tracking';
import {
  COMPACT_AWAY_STORAGE_KEY,
  parseAwayGameIds,
  readAwayPreference,
  storeAwayPreference,
} from '../../src/infrastructure/game/compactAwayPreference';
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
    start: nr === 4 || nr === 7 || nr === 9 || nr === 11 || nr === 13,
  };
}

function trackingGame(id = 'game-1'): ActiveGame {
  return {
    id,
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: ROSTER.map(player),
    opponent: 'Tegen',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13'],
    curQuarter: 2,
    beginSec: 390,
    endSec: 390,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
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
  classification?: typeof CLASSIFICATION;
}

function setup(opts: SetupOptions = {}) {
  let latest: ActiveGame = opts.game ?? trackingGame();
  const onChange = vi.fn((g: ActiveGame) => {
    latest = g;
  });
  function Harness() {
    const [game, setGame] = useState<ActiveGame>(opts.game ?? trackingGame());
    return (
      <CompactLivePanel
        lang={opts.lang ?? 'nl'}
        game={game}
        quarterCount={4}
        periodLabel="Kwart"
        classification={opts.classification ?? CLASSIFICATION}
        teamName="Eigen"
        tag1Label=""
        tag2Label=""
        onGameChange={(next) => {
          setGame(next);
          onChange(next);
        }}
        onFinishGame={vi.fn()}
        canWrite={opts.canWrite ?? true}
        saveError={false}
      />
    );
  }
  const utils = render(<Harness />);
  return { ...utils, onChange, latest: () => latest };
}

const text = (el: Element) => el.textContent ?? '';

describe('CompactLivePanel: hoofdscherm', () => {
  it('toont de vijf actieve spelers met rugnummer en naam, geen bankspelers', () => {
    const { getByTestId, queryByText, container } = setup();
    for (const [nr, naam] of ROSTER.slice(0, 5)) {
      const li = getByTestId(`compact-player-gp-${nr}`);
      expect(text(li)).toContain(String(nr));
      expect(text(li)).toContain(naam);
    }
    expect(container.querySelectorAll('.compact-player')).toHaveLength(5);
    expect(queryByText('Bo')).toBeNull();
  });

  it('toont periodenaam, kwart, aantal en begintijd van de actieve lineup', () => {
    const { getByTestId } = setup();
    expect(text(getByTestId('compact-period'))).toContain('Kwart 2 van 4');
    expect(text(getByTestId('compact-begin'))).toContain('6:30');
    expect(text(getByTestId('compact-begin'))).toContain('resterende tijd');
  });

  it('toont bij een oplopende klok gespeelde tijd', () => {
    const { getByTestId } = setup({ game: { ...trackingGame(), clockDown: false, beginSec: 90 } });
    expect(text(getByTestId('compact-begin'))).toContain('1:30');
    expect(text(getByTestId('compact-begin'))).toContain('gespeelde tijd');
  });

  it('heeft wissel-, segment-, kwart-, overzicht- en afrondknop en geen Klassieke ids of C2b-notitie', () => {
    const { container, getByTestId } = setup();
    for (const id of [
      'save-segment-btn',
      'swap-done-btn',
      'finish-game-btn',
      'compact-finish-note',
    ]) {
      expect(container.querySelector(`[data-testid="${id}"]`)).toBeNull();
    }
    // Geen +1/+2/+3/-1 en geen score-dropdowns meer (besluit 9): 2 turnoverknoppen,
    // 3 acties (Wisselen, Segment, Kwart), 1 overzichtsknop en 1 knop Wedstrijd afronden.
    expect(container.querySelectorAll('button')).toHaveLength(7);
    expect(container.querySelectorAll('[data-testid^="compact-score-plus"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid^="compact-score-minus"]')).toHaveLength(0);
    expect(container.querySelectorAll('select')).toHaveLength(0);
    expect(getByTestId('compact-finish-game').textContent).toBe('Wedstrijd afronden');
  });
});

describe('CompactLivePanel: turnovers', () => {
  it('+1 en −1 wijzigen open segment en totaal conform de bestaande acties', () => {
    const { getByTestId, latest } = setup();
    expect(text(getByTestId('compact-turnover-open'))).toBe('0');
    expect((getByTestId('compact-turnover-minus') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(getByTestId('compact-turnover-plus'));
    fireEvent.click(getByTestId('compact-turnover-plus'));
    expect(text(getByTestId('compact-turnover-open'))).toBe('2');
    expect(text(getByTestId('compact-turnover-total'))).toContain('2');
    expect(deriveGameHistory(latest()).turnovers).toBe(2);

    fireEvent.click(getByTestId('compact-turnover-minus'));
    expect(text(getByTestId('compact-turnover-open'))).toBe('1');
    const h = deriveGameHistory(latest());
    expect(h.turnovers).toBe(1);
    expect(h.turnovers - h.segStartTurnovers).toBe(1);
    expect(latest().actions.map((a) => a.type)).toEqual([
      'turnover-delta',
      'turnover-delta',
      'turnover-delta',
    ]);
  });

  it('toont het open segment apart van het wedstrijdtotaal na een eerder segment', () => {
    const base = trackingGame();
    // Eerder segment met 3 turnovers + 1 open turnover.
    const seg = {
      id: 's1',
      quarter: 1,
      beginSec: 600,
      endSec: 390,
      durSec: 210,
      lineup: base.onCourt,
      pf: 0,
      pa: 0,
      classSum: 0,
      allowed: 14.5,
      over: false,
      tov: 3,
    };
    const game: ActiveGame = {
      ...base,
      actions: [
        { type: 'turnover-delta', id: 'a', delta: 3, at: 'x' },
        { type: 'segment-saved', id: 'b', segment: seg, at: 'x' },
        { type: 'turnover-delta', id: 'c', delta: 1, at: 'x' },
      ],
    };
    expect(segmentTurnovers(seg)).toBe(3);
    const { getByTestId } = setup({ game });
    expect(text(getByTestId('compact-turnover-open'))).toBe('1');
    expect(text(getByTestId('compact-turnover-total'))).toContain('4');
  });
});

const withOpenPoints = (): ActiveGame => ({
  ...trackingGame(),
  actions: [scoreDeltaAction('for', 3), scoreDeltaAction('against', 1)],
});

describe('CompactLivePanel: stand (alleen-lezen, besluit 9)', () => {
  it('toont beide scores groot en alleen-lezen, zonder invoer', () => {
    const { getByTestId, container, onChange } = setup({ game: withOpenPoints() });
    expect(text(getByTestId('compact-score-caption'))).toBe('Laatst vastgelegde stand');
    expect(text(getByTestId('compact-score-value-for'))).toBe('3');
    expect(text(getByTestId('compact-score-value-against'))).toBe('1');
    expect(container.querySelectorAll('[data-testid="compact-score"] button')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="compact-score"] select')).toHaveLength(0);
    expect(
      container.querySelectorAll('[data-testid="compact-score"] input[type="text"]'),
    ).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('toont open punten alleen-lezen met plus/min; zonder open punten geen hint', () => {
    const { getByTestId, queryByTestId } = setup({ game: withOpenPoints() });
    expect(text(getByTestId('compact-open-points'))).toBe('Punten buiten een segment: 3–1');
    expect(text(getByTestId('compact-segment-pm'))).toContain('+2');
    cleanup();
    const empty = setup();
    expect(empty.queryByTestId('compact-segment-pm')).toBeNull();
    expect(empty.container.textContent).not.toContain('nog niet bijgewerkt');
    expect(queryByTestId('compact-open-points')).toBeNull();
  });
});

describe('CompactLivePanel: Uitwedstrijd', () => {
  const order = (c: Element) =>
    Array.from(c.querySelectorAll('[data-testid="compact-score-sides"] > div')).map((el) =>
      el.getAttribute('data-testid'),
    );

  it('draait alleen de presentatie om; for/against en de game blijven aan eigen team gekoppeld', () => {
    const { getByTestId, container, onChange, latest } = setup();
    expect(order(container)).toEqual(['compact-score-for', 'compact-score-against']);

    fireEvent.click(getByTestId('compact-away'));
    expect(order(container)).toEqual(['compact-score-against', 'compact-score-for']);
    expect(onChange).not.toHaveBeenCalled();
    expect(latest()).toEqual(trackingGame());

    fireEvent.click(getByTestId('compact-away'));
    expect(order(container)).toEqual(['compact-score-for', 'compact-score-against']);
  });

  it('toont de stand alleen-lezen in omgedraaide volgorde; open punten en plus/min blijven eigen team', () => {
    const { getByTestId, container, onChange } = setup({ game: withOpenPoints() });
    fireEvent.click(getByTestId('compact-away'));
    const values = Array.from(
      container.querySelectorAll('[data-testid="compact-score-sides"] output'),
    ).map((el) => el.textContent);
    expect(values).toEqual(['1', '3']);
    expect(text(getByTestId('compact-open-points'))).toBe('Punten buiten een segment: 1–3');
    expect(text(getByTestId('compact-segment-pm'))).toContain('+2');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('bewaart de keuze per wedstrijd-ID onder één key en herstelt die', () => {
    const first = setup();
    fireEvent.click(first.getByTestId('compact-away'));
    expect(window.localStorage.getItem(COMPACT_AWAY_STORAGE_KEY)).toBe('["game-1"]');
    expect(window.localStorage.length).toBe(1);
    first.unmount();

    const again = setup();
    expect((again.getByTestId('compact-away') as HTMLInputElement).checked).toBe(true);
    expect(order(again.container)[0]).toBe('compact-score-against');
    again.unmount();

    const other = setup({ game: trackingGame('game-2') });
    expect((other.getByTestId('compact-away') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(other.getByTestId('compact-away'));
    expect(parseAwayGameIds(window.localStorage.getItem(COMPACT_AWAY_STORAGE_KEY))).toEqual([
      'game-1',
      'game-2',
    ]);
    fireEvent.click(other.getByTestId('compact-away'));
    expect(readAwayPreference('game-1')).toBe(true);
    expect(readAwayPreference('game-2')).toBe(false);
  });

  it.each(['niet-json{', '{"game-1":true}', '[1,null,{}]', '"game-1"', ''])(
    'valt bij ongeldige opslag (%s) terug op thuis',
    (raw) => {
      window.localStorage.setItem(COMPACT_AWAY_STORAGE_KEY, raw);
      const { getByTestId, container } = setup();
      expect((getByTestId('compact-away') as HTMLInputElement).checked).toBe(false);
      expect(order(container)[0]).toBe('compact-score-for');
    },
  );

  it('blijft werken als localStorage leest en schrijft faalt', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage uit');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage vol');
    });
    const { getByTestId, container } = setup();
    expect((getByTestId('compact-away') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(getByTestId('compact-away'));
    expect(order(container)[0]).toBe('compact-score-against');
    expect(() => storeAwayPreference('x', true)).not.toThrow();
    expect(readAwayPreference('x')).toBe(false);
  });

  it('parseAwayGameIds filtert niet-strings en dubbelen', () => {
    expect(parseAwayGameIds('["a","a",3,"","b"]')).toEqual(['a', 'b']);
    expect(parseAwayGameIds(null)).toEqual([]);
  });
});

describe('CompactLivePanel: alleen-lezen', () => {
  it('zet alle schrijfacties uit en toont de melding; Uitwedstrijd is lokaal en blijft bruikbaar', () => {
    const { container, getByTestId, onChange } = setup({ canWrite: false });
    expect(getByTestId('game-read-only')).toBeTruthy();
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(7);
    // Alle schrijfacties zijn uit; alleen het in-/uitklappen van het overzicht (lezen) blijft bruikbaar.
    expect(buttons.filter((b) => !b.disabled).map((b) => b.getAttribute('data-testid'))).toEqual([
      'compact-segments-toggle',
    ]);
    fireEvent.click(getByTestId('compact-turnover-plus'));
    expect(onChange).not.toHaveBeenCalled();
    expect((getByTestId('compact-away') as HTMLInputElement).disabled).toBe(false);
  });
});

describe('CompactLivePanel: NL en EN', () => {
  it('toont Nederlandse teksten', () => {
    const { container, getByTestId } = setup({ lang: 'nl' });
    expect(text(getByTestId('compact-turnovers'))).toContain('Turnover +1');
    expect(text(container.querySelector('.compact-away') as HTMLElement)).toContain('Uitwedstrijd');
    expect(text(getByTestId('compact-score-caption'))).toBe('Laatst vastgelegde stand');
  });

  it('toont Engelse teksten', () => {
    const { container, getByTestId } = setup({ lang: 'en' });
    expect(text(getByTestId('compact-period'))).toContain('Kwart 2 of 4');
    expect(text(getByTestId('compact-begin'))).toContain('time remaining');
    expect(text(getByTestId('compact-turnovers'))).toContain('Game total:');
    expect(text(container.querySelector('.compact-away') as HTMLElement)).toContain('Away game');
    expect(text(getByTestId('compact-score-caption'))).toBe('Last recorded score');
    expect(
      container
        .querySelector('[data-testid="compact-score-value-against"]')
        ?.getAttribute('aria-label'),
    ).toBe('Score Opponent');
  });
});

describe('CompactLivePanel: classificatie', () => {
  const limited = { ...CLASSIFICATION, useClassLimit: true };
  const withLimit = (limitStr: string): ActiveGame => ({ ...trackingGame(), limitStr });

  it('toont de som en een waarschuwing bij overschrijding', () => {
    const { getByTestId } = setup({ classification: limited, game: withLimit('10.0') });
    // 5 spelers x 3.0 = 15.0 > 10.0
    expect(text(getByTestId('class-badge'))).toBe('15.0 / 10.0');
    expect(getByTestId('class-badge').className).toContain('class-badge--over');
    expect(text(getByTestId('class-warning'))).toContain('Te veel classificatiepunten');
    expect(text(getByTestId('compact-player-gp-4'))).toContain('3.0');
  });

  it('toont geen waarschuwing binnen de limiet en niets zonder classificatielimiet', () => {
    const ok = setup({ classification: limited, game: withLimit('20.0') });
    expect(text(ok.getByTestId('class-badge'))).toBe('15.0 / 20.0');
    expect(ok.queryByTestId('class-warning')).toBeNull();
    ok.unmount();
    const none = setup();
    expect(none.queryByTestId('class-badge')).toBeNull();
    expect(none.queryByTestId('class-warning')).toBeNull();
  });

  it('meldt een openstaand wisselconcept en biedt bevestigen/annuleren (C2b)', () => {
    const game: ActiveGame = { ...trackingGame(), pendingSwapLineup: trackingGame().onCourt };
    const { getByTestId, container } = setup({ game });
    expect(getByTestId('compact-swap-pending')).toBeTruthy();
    // 4 basisknoppen + 3 acties (disabled) + bevestigen/annuleren van de openstaande wissel.
    expect(container.querySelectorAll('button')).toHaveLength(9);
  });
});
