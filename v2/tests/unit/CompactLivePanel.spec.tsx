// @vitest-environment jsdom
// Compact wedstrijdscherm C2a: hoofdscherm (vijf spelers, periode, turnovers, stand,
// Uitwedstrijd als lokale presentatievoorkeur, read-only, NL/EN, classificatie).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { CompactLivePanel } from '../../src/ui/game/CompactLivePanel';
import { deriveGameHistory, segmentTurnovers } from '../../src/domain/game/tracking';
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

  it('heeft (C2b) wissel-, segment- en kwartknoppen maar nog geen afrondknop', () => {
    const { container } = setup();
    for (const id of ['save-segment-btn', 'swap-done-btn', 'finish-game-btn']) {
      expect(container.querySelector(`[data-testid="${id}"]`)).toBeNull();
    }
    // 4 scoreknoppen per kant, 2 turnoverknoppen, 3 acties (Wisselen, Segment, Kwart).
    expect(container.querySelectorAll('button')).toHaveLength(13);
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

describe('CompactLivePanel: stand', () => {
  it('+1/+2/+3/−1 werken via de bestaande score-acties', () => {
    const { getByTestId, latest } = setup();
    fireEvent.click(getByTestId('compact-score-plus1-for'));
    fireEvent.click(getByTestId('compact-score-plus2-for'));
    fireEvent.click(getByTestId('compact-score-plus3-against'));
    fireEvent.click(getByTestId('compact-score-minus1-for'));
    const h = deriveGameHistory(latest());
    expect(h.scoreFor).toBe(2);
    expect(h.scoreAgainst).toBe(3);
    expect((getByTestId('compact-score-select-for') as HTMLSelectElement).value).toBe('2');
    expect((getByTestId('compact-score-select-against') as HTMLSelectElement).value).toBe('3');
    expect(latest().actions.map((a) => a.type)).toEqual([
      'score-delta',
      'score-delta',
      'score-delta',
      'score-delta',
    ]);
  });

  it('selectie van een stand gebruikt setScore (score-set) en slaat ongewijzigde waarde over', () => {
    const { getByTestId, latest, onChange } = setup();
    const select = getByTestId('compact-score-select-for') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '8' } });
    expect(deriveGameHistory(latest()).scoreFor).toBe(8);
    expect(latest().actions.at(-1)?.type).toBe('score-set');
    const calls = onChange.mock.calls.length;
    fireEvent.change(select, { target: { value: '8' } });
    expect(onChange.mock.calls.length).toBe(calls);
  });

  it('labelt de stand als laatst vastgelegd en toont plus/min pas als de stand is bijgewerkt', () => {
    const { getByTestId } = setup();
    expect(text(getByTestId('compact-score-caption'))).toBe('Laatst vastgelegde stand');
    expect(text(getByTestId('compact-segment-pm'))).toBe(
      'Stand nog niet bijgewerkt in dit segment',
    );
    expect(text(getByTestId('compact-segment-pm'))).not.toContain('+0');
    fireEvent.click(getByTestId('compact-score-plus3-for'));
    fireEvent.click(getByTestId('compact-score-plus1-against'));
    expect(text(getByTestId('compact-segment-pm'))).toContain('Plus/min dit segment');
    expect(text(getByTestId('compact-segment-pm'))).toContain('+2');
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

    // Rechts staat nu het eigen team; +2 daar blijft een 'for'-actie.
    fireEvent.click(getByTestId('compact-score-plus2-for'));
    const action = latest().actions[0];
    expect(action).toMatchObject({ type: 'score-delta', team: 'for', delta: 2 });
    const h = deriveGameHistory(latest());
    expect(h.scoreFor).toBe(2);
    expect(h.scoreAgainst).toBe(0);
    expect(text(getByTestId('compact-segment-pm'))).toContain('+2');

    fireEvent.click(getByTestId('compact-away'));
    expect(order(container)).toEqual(['compact-score-for', 'compact-score-against']);
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
    expect(buttons).toHaveLength(13);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect((getByTestId('compact-score-select-for') as HTMLSelectElement).disabled).toBe(true);
    expect((getByTestId('compact-score-select-against') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(getByTestId('compact-turnover-plus'));
    fireEvent.click(getByTestId('compact-score-plus1-for'));
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
    expect(text(getByTestId('compact-segment-pm'))).toBe('Score not updated in this segment yet');
    expect(
      container
        .querySelector('[data-testid="compact-score-plus2-against"]')
        ?.getAttribute('aria-label'),
    ).toBe('Score Opponent: +2');
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
    // 10 basisknoppen + 3 acties (disabled) + bevestigen/annuleren van de openstaande wissel.
    expect(container.querySelectorAll('button')).toHaveLength(15);
  });
});
