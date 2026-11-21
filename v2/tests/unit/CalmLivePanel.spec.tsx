// @vitest-environment jsdom
// Rustig wedstrijdscherm (Rustig-bouwplan R2): scenario's S1–S7, S9, S10 en S13
// uit §5b met fictieve spelers, plus ongedaan maken, de vaste slot-indeling en
// NL/EN. Alles loopt via de R1-commando's; geen datacontractwijziging.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { CalmLivePanel, calmNowSec } from '../../src/ui/game/CalmLivePanel';
import { commitSegment } from '../../src/domain/game/liveCommands';
import { deriveGameHistory } from '../../src/domain/game/tracking';
import type { RotationPlan } from '../../src/domain/game/rotationPlan';
import { readPlanForGame, storePlanForGame } from '../../src/infrastructure/game/rotationPlanStore';
import {
  markSwapTimeUnconfirmed,
  readSwapFlowState,
} from '../../src/infrastructure/game/swapFlowStore';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';
import type { Lang } from '../../src/i18n/strings';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// Fictieve spelers: [nr, naam, klasse]. Starters #4 #7 #9 #11 #13 (som 14.0).
const ROSTER: Array<[number, string, string]> = [
  [4, 'Alex', '1.0'],
  [7, 'Sam', '2.0'],
  [9, 'Robin', '3.0'],
  [11, 'Kim', '4.0'],
  [13, 'Dani', '4.0'],
  [6, 'Bo', '1.0'],
  [12, 'Noa', '4.5'],
  [15, 'Jules', '1.0'],
];
const STARTERS = ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13'];

function player([nr, naam, kl]: [number, string, string]): GamePlayer {
  return {
    id: `gp-${nr}`,
    rosterId: nr,
    nr: String(nr),
    naam,
    kl,
    vrouw: false,
    jeugd: false,
    participate: true,
    start: [4, 7, 9, 11, 13].includes(nr),
  };
}

function trackingGame(overrides: Partial<ActiveGame> = {}): ActiveGame {
  return {
    id: 'game-calm',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: ROSTER.map(player),
    opponent: 'Tegen',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: [...STARTERS],
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

const NO_CLASS = {
  useClassLimit: false,
  classBaseLimit: 14.5,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1,
  bonusBoth: 2,
};
const WITH_CLASS = { ...NO_CLASS, useClassLimit: true };

/** Schema kwart 1: wissel om 8:00 (Bo voor Alex), daarna tot het einde. */
const PLAN: RotationPlan = {
  quarters: {
    '1': [
      { toSec: 480, lineup: [4, 7, 9, 11, 13] },
      { toSec: 0, lineup: [6, 7, 9, 11, 13] },
    ],
  },
};

interface SetupOptions {
  canWrite?: boolean;
  lang?: Lang;
  game?: ActiveGame;
  classification?: typeof NO_CLASS;
  /** Standaard tikt setup op Wedstrijd; `false` laat de beginweergave staan. */
  openGameView?: boolean;
  quarterCount?: number;
}

function setup(opts: SetupOptions = {}) {
  let latest: ActiveGame = opts.game ?? trackingGame();
  const onFinishGame = vi.fn(() => true);
  function Harness() {
    const [game, setGame] = useState<ActiveGame>(latest);
    return (
      <CalmLivePanel
        lang={opts.lang ?? 'nl'}
        game={game}
        quarterCount={opts.quarterCount ?? 4}
        periodLabel="Kwart"
        classification={opts.classification ?? NO_CLASS}
        teamName="Eigen"
        tag1Label=""
        tag2Label=""
        onGameChange={(next) => {
          latest = next;
          setGame(next);
        }}
        onFinishGame={onFinishGame}
        canWrite={opts.canWrite ?? true}
        saveError={false}
      />
    );
  }
  const utils = render(<Harness />);
  if (opts.openGameView !== false) fireEvent.click(utils.getByTestId('calm-view-game'));
  return { ...utils, latest: () => latest, onFinishGame };
}

const text = (el: Element) => el.textContent ?? '';
const segmentsOf = (game: ActiveGame) => deriveGameHistory(game).segments;

function tap(getByTestId: (id: string) => HTMLElement, ...ids: string[]) {
  for (const id of ids) fireEvent.click(getByTestId(id));
}

describe('CalmLivePanel: beginweergave en indeling', () => {
  it('Wisselschema is de eerste knop en de beginweergave zonder segment', () => {
    const { getByTestId } = setup({ openGameView: false });
    const buttons = getByTestId('calm-view-plan').parentElement!.querySelectorAll('button');
    expect(Array.from(buttons).map((b) => b.dataset.testid)).toEqual([
      'calm-view-plan',
      'calm-view-game',
    ]);
    expect(getByTestId('calm-view-plan').getAttribute('aria-pressed')).toBe('true');
  });

  it('opent op Wedstrijd zodra er een segment is (ook na herladen)', () => {
    const committed = commitSegment(trackingGame(), { endSec: 480, classification: NO_CLASS });
    if (!committed.ok) throw new Error('commit faalde');
    const { getByTestId } = setup({ openGameView: false, game: committed.game });
    expect(getByTestId('calm-view-game').getAttribute('aria-pressed')).toBe('true');
  });

  it('toont stand, Turnover naast Ongedaan maken, strook, vloer, slot, bank en bottombar', () => {
    const { getByTestId, queryByTestId, container } = setup();
    expect(container.querySelectorAll('[data-testid="calm-court"] .calm-chip')).toHaveLength(5);
    expect(container.querySelectorAll('[data-testid="calm-bench"] .calm-chip')).toHaveLength(3);
    expect(text(getByTestId('calm-period'))).toBe('Kwart 1/4');
    expect(text(getByTestId('calm-strip-since'))).toBe('Huidige vijf · sinds 10:00');
    expect(getByTestId('calm-turnover').nextElementSibling).toBe(getByTestId('calm-undo'));
    expect(getByTestId('calm-idle-card')).toBeTruthy();
    expect(text(getByTestId('calm-segments'))).toBe('Segmenten (0)');
    expect(text(getByTestId('calm-end-period'))).toBe('Einde kwart');
    // Geen losse opslaanknop.
    expect(text(getByTestId('calm-bottombar'))).not.toContain('Opslaan');
    expect(queryByTestId('calm-finish-game')).toBeNull();
  });

  it('+1/+2/+3 en Turnover tellen in de strook van de huidige vijf', () => {
    const { getByTestId, latest } = setup();
    tap(getByTestId, 'calm-score-plus-for-3', 'calm-score-plus-for-2', 'calm-score-plus-against-1');
    tap(getByTestId, 'calm-turnover');
    const h = deriveGameHistory(latest());
    expect([h.scoreFor, h.scoreAgainst, h.turnovers]).toEqual([5, 1, 1]);
    expect(text(getByTestId('calm-strip-pm'))).toBe('+4');
    expect(text(getByTestId('calm-strip-to'))).toBe('TO 1');
    expect(text(getByTestId('calm-score-value-for'))).toBe('5');
  });

  it('alles is uitgeschakeld zonder schrijfrechten', () => {
    const { getByTestId } = setup({ canWrite: false });
    expect(getByTestId('game-read-only')).toBeTruthy();
    for (const id of ['calm-score-plus-for-2', 'calm-turnover', 'calm-undo', 'calm-end-period']) {
      expect((getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
    }
    expect((getByTestId('calm-chip-gp-4') as HTMLButtonElement).disabled).toBe(true);
  });

  it('toont Engelse teksten', () => {
    const { getByTestId } = setup({ lang: 'en' });
    expect(text(getByTestId('calm-undo'))).toContain('Undo');
    expect(text(getByTestId('calm-strip-since'))).toBe('Current five · since 10:00');
    expect(text(getByTestId('calm-segments'))).toBe('Segments (0)');
    expect(text(getByTestId('calm-forgot-swap'))).toBe('Missed a substitution?');
  });

  it('Wedstrijd afronden in het laatste kwart roept onFinishGame aan', () => {
    const committed = commitSegment(trackingGame({ curQuarter: 4 }), {
      endSec: 0,
      classification: NO_CLASS,
    });
    if (!committed.ok) throw new Error('commit faalde');
    const { getByTestId, onFinishGame } = setup({ game: committed.game });
    fireEvent.click(getByTestId('calm-finish-game'));
    fireEvent.click(getByTestId('finish-choose-without'));
    expect(onFinishGame).toHaveBeenCalled();
  });
});

describe('CalmLivePanel: ongedaan maken', () => {
  it('draait de laatste score terug, meldt wat, en staat daarna uit (één niveau)', () => {
    const { getByTestId, latest } = setup();
    tap(getByTestId, 'calm-score-plus-for-2', 'calm-score-plus-for-3');
    fireEvent.click(getByTestId('calm-undo'));
    expect(deriveGameHistory(latest()).scoreFor).toBe(2);
    expect(text(getByTestId('calm-notice-text'))).toBe('+3 voor Eigen teruggedraaid');
    expect((getByTestId('calm-undo') as HTMLButtonElement).disabled).toBe(true);
    // Een nieuwe actie zet de knop weer aan.
    fireEvent.click(getByTestId('calm-turnover'));
    expect((getByTestId('calm-undo') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(getByTestId('calm-undo'));
    expect(text(getByTestId('calm-notice-text'))).toBe('Turnover teruggedraaid');
    expect(deriveGameHistory(latest()).turnovers).toBe(0);
  });
});

describe('CalmLivePanel: scenario’s §5b', () => {
  it('S1: wissel volgens schema op de geplande tijd: één tik, schematijd, niet open', () => {
    storePlanForGame('game-calm', PLAN);
    const { getByTestId, latest } = setup();
    expect(text(getByTestId('calm-plan-card'))).toContain('volgende wissel rond 8:00');
    expect(text(getByTestId('calm-plan-diff'))).toBe('In: Bo · Uit: Alex');
    fireEvent.click(getByTestId('calm-plan-run'));
    const [seg] = segmentsOf(latest());
    expect(seg?.endSec).toBe(480);
    expect(seg?.lineup).toEqual(STARTERS);
    expect(latest().onCourt).toEqual(['gp-6', 'gp-7', 'gp-9', 'gp-11', 'gp-13']);
    expect(latest().beginSec).toBe(480);
    // Schematijd telt niet als open (reviewpunt 2) ...
    expect(readSwapFlowState('game-calm').unconfirmedSegmentIds).toEqual([]);
    // ... maar de tijdkaart verschijnt wel om bij te stellen.
    expect(text(getByTestId('calm-time-line'))).toBe('Om 8:00 (schematijd) · In: Bo · Uit: Alex');
    expect(text(getByTestId('calm-notice-text'))).toBe('Wissel vastgelegd · In: Bo · Uit: Alex');
    expect(getByTestId('calm-chip-gp-6').className).toContain('calm-chip--new');
    // Einde kwart vraagt niets: direct het tijdblad van het kwart.
    fireEvent.click(getByTestId('calm-end-period'));
    expect(getByTestId('quick-time-sheet')).toBeTruthy();
  });

  it('S1: "Klopt" op de schematijd verbergt de tijdkaart zonder actie', () => {
    storePlanForGame('game-calm', PLAN);
    const { getByTestId, queryByTestId, latest } = setup();
    fireEvent.click(getByTestId('calm-plan-run'));
    const actions = latest().actions.length;
    fireEvent.click(getByTestId('calm-time-confirm'));
    expect(latest().actions).toHaveLength(actions);
    expect(queryByTestId('calm-time-card')).toBeNull();
  });

  it('S2: schemawissel later dan gepland: bijstellen met −10s en typen', () => {
    storePlanForGame('game-calm', PLAN);
    const { getByTestId, latest } = setup();
    fireEvent.click(getByTestId('calm-plan-run'));
    fireEvent.click(getByTestId('calm-time-minus'));
    expect((getByTestId('calm-time-input') as HTMLInputElement).value).toBe('7:50');
    fireEvent.input(getByTestId('calm-time-input'), { target: { value: '7:40' } });
    fireEvent.click(getByTestId('calm-time-confirm'));
    expect(segmentsOf(latest())[0]?.endSec).toBe(460);
    expect(latest().beginSec).toBe(460);
    expect(text(getByTestId('calm-strip-since'))).toBe('Huidige vijf · sinds 7:40');
    expect(text(getByTestId('calm-notice-text'))).toBe('Tijd bevestigd: 7:40');
  });

  it('S2: een ongeldige of onmogelijke tijd wordt geweigerd met een melding', () => {
    storePlanForGame('game-calm', PLAN);
    const { getByTestId, latest } = setup();
    fireEvent.click(getByTestId('calm-plan-run'));
    fireEvent.input(getByTestId('calm-time-input'), { target: { value: '7x' } });
    fireEvent.click(getByTestId('calm-time-confirm'));
    expect(text(getByTestId('calm-time-error'))).toContain('mm:ss');
    // Na het begin van het segment (10:00) kan niet: duur moet > 0 blijven.
    fireEvent.input(getByTestId('calm-time-input'), { target: { value: '10:00' } });
    fireEvent.click(getByTestId('calm-time-confirm'));
    expect(text(getByTestId('calm-time-error'))).toBe('Kies een tijd tussen 9:59 en 0:00.');
    expect(segmentsOf(latest())[0]?.endSec).toBe(480);
  });

  it('S3: andere speler dan gepland via "Eerst aanpassen", klassesom onder de bank', () => {
    storePlanForGame('game-calm', PLAN);
    const { getByTestId, queryByTestId, latest } = setup({ classification: WITH_CLASS });
    fireEvent.click(getByTestId('calm-plan-adjust'));
    expect(latest().pendingSwapLineup).toEqual(STARTERS);
    // Volgens schema komt Bo erin; de coach zet Jules in plaats van Bo ("Frank voor Henk").
    fireEvent.click(getByTestId('calm-chip-gp-6'));
    expect(getByTestId('calm-chip-gp-6').className).toContain('calm-chip--selected');
    expect(text(getByTestId('calm-help-title'))).toBe('Wie komt erin voor #6 Bo?');
    // Na de wissel: Sam(2)+Robin(3)+Kim(4)+Dani(4)=13 + bankspeler. Alex(1)=14.0, Noa(4.5)=17.5, Jules(1)=14.0.
    expect(text(getByTestId('calm-after-gp-15'))).toBe('14.0');
    expect(getByTestId('calm-after-gp-15').dataset.over).toBe('false');
    expect(text(getByTestId('calm-after-gp-12'))).toBe('17.5');
    expect(getByTestId('calm-after-gp-12').dataset.over).toBe('true');
    expect(text(getByTestId('calm-after-gp-4'))).toBe('14.0');
    expect(queryByTestId('calm-after-gp-9')).toBeNull();
    fireEvent.click(getByTestId('calm-chip-gp-15'));
    expect(text(getByTestId('calm-help-line'))).toBe('In: Jules · Uit: Alex');
    fireEvent.click(getByTestId('calm-swap-run'));
    const [seg] = segmentsOf(latest());
    expect(seg?.lineup).toEqual(STARTERS);
    expect(seg?.endSec).toBe(480);
    expect(latest().onCourt).toEqual(['gp-15', 'gp-7', 'gp-9', 'gp-11', 'gp-13']);
    // Het volgende blok neemt de echte opstelling over.
    expect(readPlanForGame('game-calm')?.quarters['1']?.[1]?.lineup).toEqual([15, 7, 9, 11, 13]);
  });

  it('S4: meerdere wissels in één concept geven één segmentgrens met geschatte tijd', () => {
    const { getByTestId, latest } = setup();
    tap(getByTestId, 'calm-chip-gp-4', 'calm-chip-gp-6', 'calm-chip-gp-7', 'calm-chip-gp-12');
    tap(getByTestId, 'calm-chip-gp-9', 'calm-chip-gp-15');
    expect(segmentsOf(latest())).toHaveLength(0);
    fireEvent.click(getByTestId('calm-swap-run'));
    const segs = segmentsOf(latest());
    expect(segs).toHaveLength(1);
    expect(segs[0]?.lineup).toEqual(STARTERS);
    expect(segs[0]?.endSec).toBe(540);
    expect(latest().onCourt).toEqual(['gp-6', 'gp-12', 'gp-15', 'gp-11', 'gp-13']);
    expect(readSwapFlowState('game-calm').unconfirmedSegmentIds).toEqual([segs[0]?.id]);
    expect(text(getByTestId('calm-time-line'))).toContain('Om 9:00 (geschat)');
  });

  it('S5: klassegrens overschreden: waarschuwen, maar wel toestaan', () => {
    const { getByTestId, latest } = setup({ classification: WITH_CLASS });
    tap(getByTestId, 'calm-chip-gp-4', 'calm-chip-gp-12');
    expect(text(getByTestId('calm-help-warn'))).toBe('Klassesom 17.5 > 14.5. Mag wel, let op.');
    expect((getByTestId('calm-swap-run') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(getByTestId('calm-swap-run'));
    expect(latest().onCourt).toContain('gp-12');
    expect(segmentsOf(latest())).toHaveLength(1);
  });

  it('S6: twee wissels snel na elkaar: "2 tijden nog bevestigen", oudste eerst', () => {
    const { getByTestId, latest } = setup();
    tap(getByTestId, 'calm-chip-gp-4', 'calm-chip-gp-6', 'calm-swap-run');
    tap(getByTestId, 'calm-chip-gp-7', 'calm-chip-gp-12', 'calm-swap-run');
    const [first, second] = segmentsOf(latest());
    expect([first?.endSec, second?.endSec]).toEqual([540, 480]);
    expect(text(getByTestId('calm-time-title'))).toBe('2 tijden nog bevestigen · oudste eerst');
    expect(text(getByTestId('calm-time-line'))).toBe('Om 9:00 (geschat) · In: Bo · Uit: Alex');
    fireEvent.input(getByTestId('calm-time-input'), { target: { value: '9:20' } });
    fireEvent.click(getByTestId('calm-time-confirm'));
    expect(segmentsOf(latest()).map((s) => [s.beginSec, s.endSec])).toEqual([
      [600, 560],
      [560, 480],
    ]);
    expect(text(getByTestId('calm-time-title'))).toBe('Tijd van de wissel');
    expect(text(getByTestId('calm-time-line'))).toBe('Om 8:00 (geschat) · In: Noa · Uit: Sam');
    // De volgorde blijft geldig: de tweede wissel kan niet vóór de eerste.
    fireEvent.input(getByTestId('calm-time-input'), { target: { value: '9:30' } });
    fireEvent.click(getByTestId('calm-time-confirm'));
    expect(text(getByTestId('calm-time-error'))).toBe('Kies een tijd tussen 9:19 en 0:00.');
    fireEvent.input(getByTestId('calm-time-input'), { target: { value: '8:00' } });
    fireEvent.click(getByTestId('calm-time-confirm'));
    expect(readSwapFlowState('game-calm').unconfirmedSegmentIds).toEqual([]);
  });

  it('S6: "Later" verbergt de tijdkaart; de hint toont hoeveel tijden nog open staan', () => {
    const { getByTestId, queryByTestId } = setup();
    tap(getByTestId, 'calm-chip-gp-4', 'calm-chip-gp-6', 'calm-swap-run');
    tap(getByTestId, 'calm-chip-gp-7', 'calm-chip-gp-12', 'calm-swap-run');
    fireEvent.click(getByTestId('calm-time-later'));
    expect(queryByTestId('calm-time-card')).toBeNull();
    expect(text(getByTestId('calm-open-times'))).toBe('2 tijden nog bevestigen');
    fireEvent.click(getByTestId('calm-open-times'));
    expect(getByTestId('calm-time-card')).toBeTruthy();
  });

  it('S7: verkeerde speler: ongedaan maken zet de vorige vijf en segmentstart terug', () => {
    storePlanForGame('game-calm', PLAN);
    const { getByTestId, latest } = setup();
    fireEvent.click(getByTestId('calm-score-plus-for-2'));
    // Coach tikt per ongeluk Noa in voor Kim.
    tap(getByTestId, 'calm-chip-gp-11', 'calm-chip-gp-12', 'calm-swap-run');
    expect(segmentsOf(latest())).toHaveLength(1);
    expect(getByTestId('calm-notice-undo')).toBeTruthy();
    fireEvent.click(getByTestId('calm-notice-undo'));
    const game = latest();
    expect(segmentsOf(game)).toHaveLength(0);
    expect(game.onCourt).toEqual(STARTERS);
    expect(game.beginSec).toBe(600);
    expect(deriveGameHistory(game).scoreFor - deriveGameHistory(game).segStartFor).toBe(2);
    expect(text(getByTestId('calm-notice-text'))).toBe('Wissel Noa ↔ Kim teruggedraaid');
    expect(readSwapFlowState('game-calm').unconfirmedSegmentIds).toEqual([]);
    expect((getByTestId('calm-undo') as HTMLButtonElement).disabled).toBe(true);
    // Het schema staat weer zoals vóór de verkeerde wissel.
    expect(readPlanForGame('game-calm')).toEqual(PLAN);
    expect(text(getByTestId('calm-plan-diff'))).toBe('In: Bo · Uit: Alex');
  });

  it('S9: wissel vergeten: kies de tijd en tik de grens in de lijst acties', () => {
    const { getByTestId, latest } = setup();
    fireEvent.click(getByTestId('calm-score-plus-for-2'));
    fireEvent.click(getByTestId('calm-score-plus-against-3'));
    fireEvent.click(getByTestId('calm-turnover'));
    fireEvent.click(getByTestId('calm-forgot-swap'));
    expect(text(getByTestId('calm-help-title'))).toContain('Vergeten wissel');
    tap(getByTestId, 'calm-chip-gp-4', 'calm-chip-gp-6', 'calm-retro-next');
    expect(text(getByTestId('calm-retro-lineup'))).toBe('In: Bo · Uit: Alex');
    expect(text(getByTestId('calm-retro-boundary-1'))).toBe('1. +2 Eigen');
    expect(text(getByTestId('calm-retro-boundary-2'))).toBe('2. +3 Tegenstander');
    expect(text(getByTestId('calm-retro-boundary-3'))).toBe('3. Turnover +1');
    expect((getByTestId('calm-retro-commit') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(getByTestId('calm-retro-time-input'), { target: { value: '8:30' } });
    fireEvent.click(getByTestId('calm-retro-boundary-1'));
    fireEvent.click(getByTestId('calm-retro-commit'));
    const game = latest();
    const [seg] = segmentsOf(game);
    expect(seg).toMatchObject({ beginSec: 600, endSec: 510, pf: 2, pa: 0, tov: 0 });
    expect(seg?.lineup).toEqual(STARTERS);
    const h = deriveGameHistory(game);
    expect([h.scoreFor, h.scoreAgainst, h.turnovers]).toEqual([2, 3, 1]);
    expect(h.scoreAgainst - h.segStartAgainst).toBe(3);
    expect(h.turnovers - h.segStartTurnovers).toBe(1);
    expect(game.onCourt[0]).toBe('gp-6');
    expect(game.beginSec).toBe(510);
    expect(text(getByTestId('calm-notice-text'))).toBe('Vergeten wissel vastgelegd om 8:30');
    // In één stap niet terug te draaien.
    expect((getByTestId('calm-undo') as HTMLButtonElement).disabled).toBe(true);
    expect(readSwapFlowState('game-calm').unconfirmedSegmentIds).toEqual([]);
  });

  it('S10: Einde kwart met open tijden vraagt eerst bevestiging; "Klopt allemaal"', () => {
    const { getByTestId, queryByTestId, latest } = setup();
    tap(getByTestId, 'calm-chip-gp-4', 'calm-chip-gp-6', 'calm-swap-run');
    tap(getByTestId, 'calm-chip-gp-7', 'calm-chip-gp-12', 'calm-swap-run');
    fireEvent.click(getByTestId('calm-end-period'));
    expect(getByTestId('calm-end-check')).toBeTruthy();
    expect(queryByTestId('quick-time-sheet')).toBeNull();
    const [first] = segmentsOf(latest());
    expect(text(getByTestId(`calm-end-check-${first!.id}`))).toBe('Kwart 1 · om 9:00 · In: Bo');
    fireEvent.click(getByTestId('calm-end-check-all'));
    expect(readSwapFlowState('game-calm').unconfirmedSegmentIds).toEqual([]);
    expect(getByTestId('quick-time-sheet')).toBeTruthy();
    fireEvent.click(getByTestId('quick-time-confirm'));
    const game = latest();
    expect(game.curQuarter).toBe(2);
    expect(segmentsOf(game).map((s) => s.endSec)).toEqual([540, 480, 0]);
  });

  it('S10: "Eén voor één bevestigen" sluit het blad en toont de tijdkaart', () => {
    const { getByTestId, queryByTestId } = setup();
    tap(getByTestId, 'calm-chip-gp-4', 'calm-chip-gp-6', 'calm-swap-run');
    fireEvent.click(getByTestId('calm-time-later'));
    fireEvent.click(getByTestId('calm-end-period'));
    fireEvent.click(getByTestId('calm-end-check-one'));
    expect(queryByTestId('calm-end-check')).toBeNull();
    expect(getByTestId('calm-time-card')).toBeTruthy();
  });

  it('S13: na herladen blijven open tijden en de ongedaan-blokkade staan', () => {
    const first = setup();
    tap(first.getByTestId, 'calm-chip-gp-4', 'calm-chip-gp-6', 'calm-swap-run');
    tap(first.getByTestId, 'calm-score-plus-for-2', 'calm-undo');
    const saved = first.latest();
    cleanup();
    const second = setup({ game: saved, openGameView: false });
    // Een segment bestaat: het scherm opent op Wedstrijd.
    expect(second.getByTestId('calm-view-game').getAttribute('aria-pressed')).toBe('true');
    expect(text(second.getByTestId('calm-time-line'))).toContain('Om 9:00 (geschat)');
    // De laatste actie is al teruggedraaid: niet nog een niveau terug.
    expect((second.getByTestId('calm-undo') as HTMLButtonElement).disabled).toBe(true);
  });

  it('S13: een opgeslagen open id van een verdwenen segment valt stil weg', () => {
    markSwapTimeUnconfirmed('game-calm', 'bestaat-niet');
    const { queryByTestId, getByTestId } = setup();
    expect(queryByTestId('calm-time-card')).toBeNull();
    expect(getByTestId('calm-idle-card')).toBeTruthy();
  });
});

describe('CalmLivePanel: wisselen', () => {
  it('"Annuleer wissel" zet het concept en de selectie terug', () => {
    const { getByTestId, latest } = setup();
    tap(getByTestId, 'calm-chip-gp-4', 'calm-chip-gp-6');
    expect(latest().pendingSwapLineup).toEqual(STARTERS);
    fireEvent.click(getByTestId('calm-swap-cancel'));
    expect(latest().onCourt).toEqual(STARTERS);
    expect(latest().pendingSwapLineup).toBeNull();
    expect(getByTestId('calm-idle-card')).toBeTruthy();
  });

  it('de groene omlijsting van de nieuwe speler verdwijnt na korte tijd', () => {
    vi.useFakeTimers();
    const { getByTestId } = setup();
    tap(getByTestId, 'calm-chip-gp-4', 'calm-chip-gp-6', 'calm-swap-run');
    expect(getByTestId('calm-chip-gp-6').className).toContain('calm-chip--new');
    vi.advanceTimersByTime(5000);
    // Rerender via een tik die niets wijzigt (selecteren en weer deselecteren).
    tap(getByTestId, 'calm-chip-gp-9', 'calm-chip-gp-9');
    expect(getByTestId('calm-chip-gp-6').className).not.toContain('calm-chip--new');
  });

  it('het slot heeft één vaste plek voor hulp-, tijd- en schemakaart', () => {
    storePlanForGame('game-calm', PLAN);
    const { getByTestId } = setup();
    const slot = getByTestId('calm-slot');
    expect(slot.children).toHaveLength(1);
    expect(slot.firstElementChild?.getAttribute('data-testid')).toBe('calm-plan-card');
    fireEvent.click(getByTestId('calm-chip-gp-4'));
    expect(slot.firstElementChild?.getAttribute('data-testid')).toBe('calm-help-card');
    tap(getByTestId, 'calm-chip-gp-6', 'calm-swap-run');
    expect(slot.firstElementChild?.getAttribute('data-testid')).toBe('calm-time-card');
  });

  it('de huidige kloktijd voor tijdbevestiging is het einde van het kwart', () => {
    expect(calmNowSec(trackingGame())).toBe(0);
    expect(calmNowSec(trackingGame({ clockDown: false, beginSec: 0, endSec: 0 }))).toBe(600);
  });
});
