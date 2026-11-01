// @vitest-environment jsdom
// Compact wedstrijdscherm C2b: wisselconcept, losse segmenten, kwart afsluiten,
// tijd-/scoreinvoer (typen en dropdown), weigeringsmeldingen en pariteit met Klassiek.
// Rekenvoorbeelden A-D uit docs/wedstrijdscherm-compact-bouwplan.md (fictieve spelers).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { CompactLivePanel } from '../../src/ui/game/CompactLivePanel';
import { LiveTrackingPanel } from '../../src/ui/game/LiveTrackingPanel';
import { deriveGameHistory, segmentTurnovers } from '../../src/domain/game/tracking';
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

function q1Game(overrides: Partial<ActiveGame> = {}): ActiveGame {
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
  quarterCount?: number;
  panel?: 'compact' | 'classic';
}

function setup(opts: SetupOptions = {}) {
  let latest: ActiveGame = opts.game ?? q1Game();
  const onChange = vi.fn((g: ActiveGame) => {
    latest = g;
  });
  const onFinishGame = vi.fn();
  const Panel = opts.panel === 'classic' ? LiveTrackingPanel : CompactLivePanel;
  function Harness() {
    const [game, setGame] = useState<ActiveGame>(opts.game ?? q1Game());
    return (
      <Panel
        lang={opts.lang ?? 'nl'}
        game={game}
        quarterCount={opts.quarterCount ?? 4}
        periodLabel="Kwart"
        classification={CLASSIFICATION}
        teamName="Eigen"
        tag1Label=""
        tag2Label=""
        onGameChange={(next) => {
          setGame(next);
          onChange(next);
        }}
        onFinishGame={onFinishGame}
        canWrite={opts.canWrite ?? true}
        saveError={false}
      />
    );
  }
  const utils = render(<Harness />);
  const $ = (id: string) => utils.getByTestId(id);
  const q = (id: string) => utils.queryByTestId(id);
  const click = (id: string) => fireEvent.click($(id));
  const type = (id: string, value: string) => fireEvent.input($(id), { target: { value } });
  const setClock = (min: string, sec: string) => {
    type('compact-dialog-clock-min', min);
    type('compact-dialog-clock-sec', sec);
  };
  const setScores = (own: string, opp: string) => {
    type('compact-dialog-score-for', own);
    type('compact-dialog-score-against', opp);
  };
  return {
    ...utils,
    $,
    q,
    click,
    type,
    setClock,
    setScores,
    onChange,
    onFinishGame,
    latest: () => latest,
  };
}

type H = ReturnType<typeof setup>;

function doSwap(
  h: H,
  outs: number[],
  ins: number[],
  min: string,
  sec: string,
  own: string,
  opp: string,
) {
  h.click('compact-swap-open');
  outs.forEach((n) => h.click(`compact-swap-out-gp-${n}`));
  ins.forEach((n) => h.click(`compact-swap-in-gp-${n}`));
  h.click('compact-swap-next');
  h.setClock(min, sec);
  h.setScores(own, opp);
  h.click('compact-dialog-review');
  h.click('compact-dialog-confirm');
}

const nrs = (g: ActiveGame, ids: string[]) =>
  ids.map((id) => g.players.find((p) => p.id === id)?.nr);

describe('Compact wissel: acceptatie A-D (handmatig narekenbaar)', () => {
  it('B: 2 TO, 6:30 stand 8-6, wissel 7->12 sluit segment van 210 s af', () => {
    const h = setup();
    h.click('compact-turnover-plus');
    h.click('compact-turnover-plus');
    h.onChange.mockClear();
    doSwap(h, [7], [12], '6', '30', '8', '6');
    const g = h.latest();
    const hist = deriveGameHistory(g);
    expect(hist.segments).toHaveLength(1);
    const seg = hist.segments[0]!;
    expect(seg.durSec).toBe(210);
    expect([seg.pf, seg.pa, seg.pf - seg.pa]).toEqual([8, 6, 2]);
    expect(segmentTurnovers(seg)).toBe(2);
    expect(nrs(g, seg.lineup)).toEqual(['4', '7', '9', '11', '13']);
    // swapOnCourt: positie van de vervangen speler blijft behouden.
    expect(nrs(g, g.onCourt)).toEqual(['4', '12', '9', '11', '13']);
    expect([...nrs(g, g.onCourt)].sort()).toEqual(['11', '12', '13', '4', '9'].sort());
    expect(g.pendingSwapLineup).toBeNull();
    expect(g.beginSec).toBe(390);
    expect(hist.turnovers - hist.segStartTurnovers).toBe(0);
    expect(hist.turnovers).toBe(2);
    expect(h.onChange).toHaveBeenCalledTimes(1);
    expect(h.q('compact-dialog')).toBeNull();
  });

  it('A-D: twee wissels op een tijdstip, kwart sluiten zonder afronden', () => {
    const h = setup();
    h.click('compact-turnover-plus');
    h.click('compact-turnover-plus');
    doSwap(h, [7], [12], '6', '30', '8', '6');
    h.click('compact-turnover-plus');
    doSwap(h, [4, 11], [6, 15], '3', '00', '12', '10');
    let hist = deriveGameHistory(h.latest());
    expect(hist.segments).toHaveLength(2);
    const second = hist.segments[1]!;
    expect(second.durSec).toBe(210);
    expect([second.pf, second.pa, second.pf - second.pa]).toEqual([4, 4, 0]);
    expect(segmentTurnovers(second)).toBe(1);
    expect(nrs(h.latest(), second.lineup)).toEqual(['4', '12', '9', '11', '13']);
    expect(nrs(h.latest(), h.latest().onCourt)).toEqual(['6', '12', '9', '15', '13']);

    h.click('compact-close-quarter');
    h.setClock('0', '00');
    h.setScores('16', '12');
    h.click('compact-dialog-review');
    h.click('compact-dialog-confirm');
    const g = h.latest();
    hist = deriveGameHistory(g);
    expect(hist.segments).toHaveLength(3);
    const third = hist.segments[2]!;
    expect(third.durSec).toBe(180);
    expect([third.pf, third.pa, third.pf - third.pa]).toEqual([4, 2, 2]);
    expect(segmentTurnovers(third)).toBe(0);
    expect(hist.segments.reduce((n, s) => n + s.durSec, 0)).toBe(600);
    expect(hist.segments.reduce((n, s) => n + s.durSec * 5, 0)).toBe(3000);
    expect(nrs(g, third.lineup)).toEqual(['6', '12', '9', '15', '13']);
    expect(hist.scoreFor - hist.scoreAgainst).toBe(4);
    expect(hist.turnovers).toBe(3);
    expect(g.curQuarter).toBe(2);
    expect(g.beginSec).toBe(600);
    expect(g.phase).toBe('tracking');
    expect(h.onFinishGame).not.toHaveBeenCalled();
  });

  it('controlestap toont stand, punten, turnovers, tijden, duur en Nieuwe lineup met nr en naam', () => {
    const h = setup();
    h.click('compact-turnover-plus');
    h.click('compact-turnover-plus');
    h.onChange.mockClear();
    h.click('compact-swap-open');
    h.click('compact-swap-out-gp-7');
    h.click('compact-swap-in-gp-12');
    h.click('compact-swap-next');
    h.setClock('6', '30');
    h.setScores('8', '6');
    h.click('compact-dialog-review');
    expect(h.$('compact-review-start').textContent).toBe('0–0');
    expect(h.$('compact-review-end').textContent).toBe('8–6');
    expect(h.$('compact-review-points').textContent).toBe('8–6');
    expect(h.$('compact-review-turnovers').textContent).toBe('2');
    expect(h.$('compact-review-times').textContent).toBe('10:00 – 6:30');
    expect(h.$('compact-review-duration').textContent).toBe('3:30');
    const lineup = h.$('compact-review-lineup');
    expect(lineup.textContent).toContain('Nieuwe lineup');
    expect(h.$('compact-review-player-gp-12').textContent).toBe('12Noa');
    expect(lineup.querySelectorAll('li')).toHaveLength(5);
    // Nog niets vastgelegd.
    expect(h.onChange).not.toHaveBeenCalled();
  });
});

describe('Compact wissel: concept, annuleren en weigeringen', () => {
  it('annuleren na meerdere keuzes laat de game ongewijzigd en het concept vervalt', () => {
    const game = q1Game();
    const h = setup({ game });
    h.click('compact-swap-open');
    h.click('compact-swap-out-gp-4');
    h.click('compact-swap-out-gp-7');
    h.click('compact-swap-in-gp-6');
    h.click('compact-swap-in-gp-15');
    h.click('compact-swap-next');
    h.setClock('3', '00');
    h.click('compact-dialog-cancel');
    expect(h.onChange).not.toHaveBeenCalled();
    expect(h.latest()).toBe(game);
    expect(h.q('compact-dialog')).toBeNull();
    h.click('compact-swap-open');
    expect(h.$('compact-swap-out-gp-4').getAttribute('aria-pressed')).toBe('false');
  });

  it('selectie opheffen en aantal eruit/erin moet gelijk zijn', () => {
    const h = setup();
    h.click('compact-swap-open');
    h.click('compact-swap-out-gp-4');
    expect((h.$('compact-swap-next') as HTMLButtonElement).disabled).toBe(true);
    expect(h.$('compact-swap-unequal')).not.toBeNull();
    h.click('compact-swap-in-gp-6');
    expect((h.$('compact-swap-next') as HTMLButtonElement).disabled).toBe(false);
    h.click('compact-swap-out-gp-4'); // tikken heft op
    expect(h.$('compact-swap-out-gp-4').getAttribute('aria-pressed')).toBe('false');
    h.click('compact-swap-clear');
    expect(h.$('compact-swap-in-gp-6').getAttribute('aria-pressed')).toBe('false');
  });

  it('bank van zes of meer loopt door in een raster van vijf kolommen', () => {
    const extra = [1, 2, 3].map((n) => player([20 + n, `Extra${n}`]));
    const h = setup({ game: q1Game({ players: [...ROSTER.map(player), ...extra] }) });
    h.click('compact-swap-open');
    const grids = h.container.querySelectorAll('.compact-pick__grid');
    expect(grids).toHaveLength(2);
    expect(grids[0]!.children).toHaveLength(5);
    expect(grids[1]!.children).toHaveLength(6);
  });

  it.each([
    ['11', '00'],
    ['0', '75'],
    ['10', '30'],
    ['', '10'],
  ])('tijd %s:%s buiten bereik geeft zichtbare melding zonder commit', (min, sec) => {
    const h = setup();
    h.click('compact-swap-open');
    h.click('compact-swap-out-gp-4');
    h.click('compact-swap-in-gp-6');
    h.click('compact-swap-next');
    h.setClock(min, sec);
    h.click('compact-dialog-review');
    const alert = h.$('compact-dialog-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toBe('Begin- of eindtijd is ongeldig.');
    expect(h.onChange).not.toHaveBeenCalled();
  });

  it('score buiten 0-150 wordt geweigerd', () => {
    const h = setup();
    h.click('compact-save-segment');
    h.setClock('5', '00');
    h.type('compact-dialog-score-for', '151');
    h.click('compact-dialog-review');
    expect(h.$('compact-dialog-error').textContent).toContain('score is ongeldig');
    expect(h.onChange).not.toHaveBeenCalled();
  });

  it('invalid-duration: eindtijd gelijk aan begintijd bij Segment opslaan', () => {
    const h = setup();
    h.click('compact-save-segment');
    h.click('compact-dialog-review');
    expect(h.$('compact-dialog-error').textContent).toBe('Eind moet ná begin liggen.');
    expect(h.onChange).not.toHaveBeenCalled();
  });

  it('nulsecondeswissel zonder scorewijziging: geen leeg segment, open turnovers naar nieuwe lineup', () => {
    const h = setup();
    h.click('compact-turnover-plus');
    h.click('compact-swap-open');
    h.click('compact-swap-out-gp-7');
    h.click('compact-swap-in-gp-12');
    h.click('compact-swap-next');
    h.click('compact-dialog-review');
    expect(h.$('compact-review-nosegment')).not.toBeNull();
    h.click('compact-dialog-confirm');
    const g = h.latest();
    const hist = deriveGameHistory(g);
    expect(hist.segments).toHaveLength(0);
    expect(nrs(g, g.onCourt)).toEqual(['4', '12', '9', '11', '13']);
    expect(g.pendingSwapLineup).toBeNull();
    expect(hist.turnovers - hist.segStartTurnovers).toBe(1);
  });

  it('nulsecondeswissel met scorewijziging wordt geweigerd (score-changed), geen gedeeltelijke commit', () => {
    const h = setup();
    h.click('compact-swap-open');
    h.click('compact-swap-out-gp-7');
    h.click('compact-swap-in-gp-12');
    h.click('compact-swap-next');
    h.setScores('2', '0');
    h.click('compact-dialog-review');
    const alert = h.$('compact-dialog-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('De stand is gewijzigd terwijl er geen speeltijd');
    expect(h.onChange).not.toHaveBeenCalled();
    expect(deriveGameHistory(h.latest()).scoreFor).toBe(0);
  });

  it('score onder de beginstand van het segment wordt geweigerd met de beginstand in de melding', () => {
    const h = setup();
    doSwap(h, [7], [12], '6', '30', '8', '6');
    h.click('compact-save-segment');
    h.setClock('5', '00');
    h.setScores('5', '6');
    h.click('compact-dialog-review');
    expect(h.$('compact-dialog-error').textContent).toBe(
      'De stand mag niet lager zijn dan de beginstand van dit segment (8-6).',
    );
    expect(h.onChange).toHaveBeenCalledTimes(1);
  });

  it('melding in het Engels', () => {
    const h = setup({ lang: 'en' });
    h.click('compact-save-segment');
    h.click('compact-dialog-review');
    expect(h.$('compact-dialog-error').textContent).toBe('End must be after start.');
    expect(h.$('compact-swap-open').textContent).toBe('Substitute');
  });
});

describe('Compact tijd- en scorevelden: typen en dropdown', () => {
  function openTime(h: H) {
    h.click('compact-save-segment');
  }

  it('begint met de eindtijd van het open segment; seconden altijd twee cijfers', () => {
    const h = setup({ game: q1Game({ beginSec: 395, endSec: 395 }) });
    openTime(h);
    expect((h.$('compact-dialog-clock-min') as HTMLInputElement).value).toBe('6');
    expect((h.$('compact-dialog-clock-sec') as HTMLInputElement).value).toBe('35');
    expect(h.$('compact-dialog-clock-min').getAttribute('inputmode')).toBe('numeric');
  });

  it('typen: cijfers worden gefilterd en seconden worden bij verlaten opgevuld', () => {
    const h = setup();
    openTime(h);
    h.type('compact-dialog-clock-sec', '5x');
    expect((h.$('compact-dialog-clock-sec') as HTMLInputElement).value).toBe('5');
    fireEvent.blur(h.$('compact-dialog-clock-sec'));
    expect((h.$('compact-dialog-clock-sec') as HTMLInputElement).value).toBe('05');
  });

  it('dropdown: kiezen vult het veld; seconden met twee cijfers; 10 min zet seconden op 00', () => {
    const h = setup({ game: q1Game({ beginSec: 395, endSec: 395 }) });
    openTime(h);
    fireEvent.change(h.$('compact-dialog-clock-sec-pick'), { target: { value: '7' } });
    expect((h.$('compact-dialog-clock-sec') as HTMLInputElement).value).toBe('07');
    fireEvent.change(h.$('compact-dialog-clock-min-pick'), { target: { value: '10' } });
    expect((h.$('compact-dialog-clock-min') as HTMLInputElement).value).toBe('10');
    expect((h.$('compact-dialog-clock-sec') as HTMLInputElement).value).toBe('00');
    const secOptions = Array.from(h.$('compact-dialog-clock-sec-pick').querySelectorAll('option'));
    expect(secOptions.map((o) => o.value)).toEqual(['0']);
    const minOptions = h.$('compact-dialog-clock-min-pick').querySelectorAll('option');
    expect(minOptions).toHaveLength(11);
  });

  it('scorevelden: typen en dropdown 0-150', () => {
    const h = setup();
    openTime(h);
    fireEvent.change(h.$('compact-dialog-score-for-pick'), { target: { value: '12' } });
    expect((h.$('compact-dialog-score-for') as HTMLInputElement).value).toBe('12');
    h.type('compact-dialog-score-against', '9');
    expect((h.$('compact-dialog-score-against') as HTMLInputElement).value).toBe('9');
    const opts = h.$('compact-dialog-score-for-pick').querySelectorAll('option');
    expect(opts).toHaveLength(151);
    h.setClock('5', '00');
    h.click('compact-dialog-review');
    h.click('compact-dialog-confirm');
    const hist = deriveGameHistory(h.latest());
    expect([hist.scoreFor, hist.scoreAgainst]).toEqual([12, 9]);
    expect(hist.segments[0]!.durSec).toBe(300);
  });
});

describe('Compact losse acties', () => {
  it('Segment opslaan zonder wissel laat de lineup staan en start een nieuw segment', () => {
    const h = setup();
    h.click('compact-save-segment');
    h.setClock('8', '00');
    h.setScores('4', '2');
    h.click('compact-dialog-review');
    h.click('compact-dialog-confirm');
    const g = h.latest();
    expect(deriveGameHistory(g).segments[0]!.durSec).toBe(120);
    expect(nrs(g, g.onCourt)).toEqual(['4', '7', '9', '11', '13']);
    expect(g.beginSec).toBe(480);
  });

  it('Kwart afsluiten in het laatste kwart rondt de wedstrijd niet af', () => {
    const h = setup({
      game: q1Game({ curQuarter: 4, beginSec: 120, endSec: 120 }),
      quarterCount: 4,
    });
    h.click('compact-close-quarter');
    expect(h.$('compact-quarter-note').textContent).toContain('niet afgerond');
    h.setClock('0', '00');
    h.setScores('2', '0');
    h.click('compact-dialog-review');
    h.click('compact-dialog-confirm');
    const g = h.latest();
    expect(g.curQuarter).toBe(4);
    expect(g.phase).toBe('tracking');
    expect(deriveGameHistory(g).segments).toHaveLength(1);
    expect(h.onFinishGame).not.toHaveBeenCalled();
  });

  it('openstaande wissel uit Klassiek: acties geblokkeerd; bevestigen en annuleren zijn expliciet', () => {
    const base = q1Game();
    const pending = q1Game({
      onCourt: ['gp-4', 'gp-12', 'gp-9', 'gp-11', 'gp-13'],
      pendingSwapLineup: base.onCourt,
      beginSec: 400,
      endSec: 400,
    });
    const h = setup({ game: pending });
    expect((h.$('compact-swap-open') as HTMLButtonElement).disabled).toBe(true);
    expect((h.$('compact-save-segment') as HTMLButtonElement).disabled).toBe(true);
    h.click('compact-pending-confirm');
    h.setClock('5', '00');
    h.setScores('2', '1');
    h.click('compact-dialog-review');
    expect(h.$('compact-review-player-gp-12').textContent).toBe('12Noa');
    h.click('compact-dialog-confirm');
    const g = h.latest();
    expect(g.pendingSwapLineup).toBeNull();
    expect(nrs(g, deriveGameHistory(g).segments[0]!.lineup)).toEqual(['4', '7', '9', '11', '13']);
    expect(nrs(g, g.onCourt)).toEqual(['4', '12', '9', '11', '13']);
  });

  it('openstaande wissel annuleren zet de oude lineup terug (discardSwaps)', () => {
    const base = q1Game();
    const h = setup({
      game: q1Game({
        onCourt: ['gp-4', 'gp-12', 'gp-9', 'gp-11', 'gp-13'],
        pendingSwapLineup: base.onCourt,
      }),
    });
    h.click('compact-pending-discard');
    expect(h.latest().pendingSwapLineup).toBeNull();
    expect(nrs(h.latest(), h.latest().onCourt)).toEqual(['4', '7', '9', '11', '13']);
  });

  it('alleen-lezen: alle acties zijn disabled', () => {
    const h = setup({ canWrite: false });
    for (const id of ['compact-swap-open', 'compact-save-segment', 'compact-close-quarter']) {
      expect((h.$(id) as HTMLButtonElement).disabled).toBe(true);
    }
    h.click('compact-swap-open');
    expect(h.q('compact-dialog')).toBeNull();
  });
});

describe('Pariteit Klassiek en Compact (scenario B via dezelfde props)', () => {
  it('geeft dezelfde segmentuitkomst en lineup', () => {
    const compact = setup();
    compact.click('compact-turnover-plus');
    compact.click('compact-turnover-plus');
    doSwap(compact, [7], [12], '6', '30', '8', '6');
    cleanup();

    const classic = setup({ panel: 'classic' });
    fireEvent.change(classic.$('score-select-for'), { target: { value: '8' } });
    fireEvent.change(classic.$('score-select-against'), { target: { value: '6' } });
    classic.click('turnover-plus');
    classic.click('turnover-plus');
    classic.click('court-chip-gp-7');
    classic.click('bench-chip-gp-12');
    classic.click('swap-done-btn');
    fireEvent.change(classic.$('swap-confirm-min'), { target: { value: '6' } });
    fireEvent.change(classic.$('swap-confirm-sec'), { target: { value: '30' } });
    classic.click('swap-confirm-confirm');

    const a = compact.latest();
    const b = classic.latest();
    const strip = (g: ActiveGame) =>
      deriveGameHistory(g).segments.map((seg) => ({ ...seg, id: '' }));
    expect(strip(b)).toEqual(strip(a));
    expect(b.onCourt).toEqual(a.onCourt);
    expect(b.beginSec).toBe(a.beginSec);
    expect(b.pendingSwapLineup).toBeNull();
  });
});

describe('Compact dialoog: Uitwedstrijd, geen stille klem, bevestiging bij sluiten', () => {
  function fieldOrder(h: H) {
    return Array.from(h.container.querySelectorAll('.compact-dialog__scores input')).map((el) =>
      el.getAttribute('data-testid'),
    );
  }

  it('uit: eigen team links; ingevoerde waarden belanden in for/against', () => {
    const h = setup();
    h.click('compact-save-segment');
    expect(fieldOrder(h)).toEqual(['compact-dialog-score-for', 'compact-dialog-score-against']);
    h.setClock('5', '00');
    h.setScores('7', '3');
    h.click('compact-dialog-review');
    expect(h.$('compact-review-end').textContent).toBe('7–3');
    h.click('compact-dialog-confirm');
    const hist = deriveGameHistory(h.latest());
    expect([hist.scoreFor, hist.scoreAgainst]).toEqual([7, 3]);
  });

  it('aan: tegenstander links, waarden blijven aan het juiste team gekoppeld, plus/min identiek', () => {
    const h = setup();
    h.click('compact-away');
    h.click('compact-save-segment');
    expect(fieldOrder(h)).toEqual(['compact-dialog-score-against', 'compact-dialog-score-for']);
    expect(h.container.querySelector('.compact-dialog__scores')!.textContent).toContain('Eigen');
    h.setClock('5', '00');
    // linker veld = tegenstander
    h.type('compact-dialog-score-against', '3');
    h.type('compact-dialog-score-for', '7');
    h.click('compact-dialog-review');
    expect(h.$('compact-review-start').textContent).toBe('0–0');
    expect(h.$('compact-review-end').textContent).toBe('3–7');
    expect(h.$('compact-review-points').textContent).toBe('3–7');
    h.click('compact-dialog-confirm');
    const seg = deriveGameHistory(h.latest()).segments[0]!;
    expect([seg.pf, seg.pa, seg.pf - seg.pa]).toEqual([7, 3, 4]);
  });

  it('typen van 10 minuten laat seconden ongemoeid; validatie meldt de fout', () => {
    const h = setup({ game: q1Game({ beginSec: 600, endSec: 600 }) });
    h.click('compact-save-segment');
    h.type('compact-dialog-clock-sec', '30');
    h.type('compact-dialog-clock-min', '10');
    expect((h.$('compact-dialog-clock-sec') as HTMLInputElement).value).toBe('30');
    h.click('compact-dialog-review');
    expect(h.$('compact-dialog-error').getAttribute('role')).toBe('alert');
    expect(h.onChange).not.toHaveBeenCalled();
  });

  it('Bevestigen kan maar een keer onChange geven', () => {
    const h = setup();
    h.click('compact-save-segment');
    h.setClock('5', '00');
    h.click('compact-dialog-review');
    const btn = h.$('compact-dialog-confirm');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(h.onChange).toHaveBeenCalledTimes(1);
  });

  it('Escape en achtergrond vragen bevestiging zodra er invoer is; weigeren houdt het concept', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const h = setup();
    h.click('compact-save-segment');
    h.setClock('5', '00');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(h.q('compact-dialog')).not.toBeNull();
    fireEvent.click(h.container.querySelector('.modal-overlay__backdrop')!);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(h.q('compact-dialog')).not.toBeNull();
    confirm.mockReturnValue(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(h.q('compact-dialog')).toBeNull();
    expect(h.onChange).not.toHaveBeenCalled();
  });

  it('zonder invoer sluit Escape zonder vraag; Engelse tekst', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const h = setup({ lang: 'en' });
    h.click('compact-swap-open');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(confirm).not.toHaveBeenCalled();
    expect(h.q('compact-dialog')).toBeNull();
    h.click('compact-save-segment');
    h.setClock('5', '00');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(confirm).toHaveBeenCalledWith('Your input will be lost. Close the window anyway?');
  });
});
