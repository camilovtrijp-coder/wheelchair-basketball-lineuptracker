// @vitest-environment jsdom
// Wisselschema in het Snel-wedstrijdscherm: schema maken/bewerken, geplande wissel
// uitvoeren, afwijken van het schema en kwart afsluiten met de geplande beginopstelling.
// Het schema is lokaal en geen onderdeel van de wedstrijd.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { QuickLivePanel } from '../../src/ui/game/QuickLivePanel';
import { deriveGameHistory } from '../../src/domain/game/tracking';
import { commitSegment } from '../../src/domain/game/liveCommands';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';
import type { RotationPlan } from '../../src/domain/game/rotationPlan';
import { readPlanForGame, storePlanForGame } from '../../src/infrastructure/game/rotationPlanStore';

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

/** Kwart 1: 13 gaat eruit voor 6 om 3:00. Kwart 2 start met 12 en 6 erbij, wisselt om 5:00 terug. */
function plan(): RotationPlan {
  return {
    quarters: {
      '1': [
        { toSec: 180, lineup: [4, 7, 9, 11, 13] },
        { toSec: 0, lineup: [4, 7, 9, 11, 6] },
      ],
      '2': [
        { toSec: 300, lineup: [4, 7, 9, 6, 12] },
        { toSec: 0, lineup: [4, 7, 9, 11, 13] },
      ],
      '3': [{ toSec: 0, lineup: [4, 7, 9, 11, 13] }],
      '4': [{ toSec: 0, lineup: [4, 7, 9, 11, 13] }],
    },
  };
}

function setup(opts: { game?: ActiveGame; canWrite?: boolean } = {}) {
  let latest: ActiveGame = opts.game ?? trackingGame();
  function Harness() {
    const [game, setGame] = useState<ActiveGame>(opts.game ?? trackingGame());
    return (
      <QuickLivePanel
        lang="nl"
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
  // Zonder segmenten opent Snel op het wisselschema (besluit 8); deze specs
  // beginnen vanaf het wedstrijdscherm en kiezen zelf het schema.
  fireEvent.click(utils.getByTestId('quick-view-game'));
  return { ...utils, latest: () => latest };
}

const text = (el: Element) => el.textContent ?? '';

describe('Wisselschema: maken en bewerken', () => {
  it('zonder schema biedt het scherm Schema maken aan en toont daarna blokken per kwart', () => {
    const { getByTestId, queryByTestId } = setup();
    fireEvent.click(getByTestId('quick-view-plan'));
    expect(queryByTestId('quick-plan-block-1-0')).toBeNull();
    expect((getByTestId('quick-plan-load-previous') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByTestId('quick-plan-create'));
    expect(getByTestId('quick-plan-block-1-0')).toBeTruthy();
    // Het schema is lokaal bewaard onder het wedstrijd-ID.
    expect(readPlanForGame('game-1')?.quarters['1']).toHaveLength(1);
    fireEvent.click(getByTestId('quick-plan-tab-3'));
    expect(getByTestId('quick-plan-block-3-0')).toBeTruthy();
  });

  it('een wisselmoment toevoegen en het blok aanpassen met tijd en spelers', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('quick-view-plan'));
    fireEvent.click(getByTestId('quick-plan-block-1-0'));
    expect(text(getByTestId('quick-plan-time'))).toBe('3:00');
    fireEvent.click(getByTestId('quick-plan-earlier'));
    expect(text(getByTestId('quick-plan-time'))).toBe('3:30');
    fireEvent.click(getByTestId('quick-plan-later'));
    fireEvent.click(getByTestId('quick-plan-later'));
    expect(text(getByTestId('quick-plan-time'))).toBe('2:30');
    // 4 eruit, 12 erin.
    fireEvent.click(getByTestId('quick-plan-court-0'));
    fireEvent.click(getByTestId('quick-plan-bench-12'));
    fireEvent.click(getByTestId('quick-plan-done'));
    const saved = readPlanForGame('game-1');
    expect(saved?.quarters['1']?.[0]).toEqual({ toSec: 150, lineup: [12, 7, 9, 11, 13] });
    // Blok toevoegen splitst het laatste blok.
    fireEvent.click(getByTestId('quick-plan-add-block'));
    expect(readPlanForGame('game-1')?.quarters['1']).toHaveLength(3);
  });

  it('het laatste blok heeft geen eigen wisselmoment en een blok is te verwijderen', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId, queryByTestId } = setup();
    fireEvent.click(getByTestId('quick-view-plan'));
    fireEvent.click(getByTestId('quick-plan-block-1-1'));
    expect(queryByTestId('quick-plan-time')).toBeNull();
    fireEvent.click(getByTestId('quick-plan-delete-block'));
    expect(readPlanForGame('game-1')?.quarters['1']).toHaveLength(1);
  });

  it('Zelfde als vorige wedstrijd laadt het schema van een andere wedstrijd', () => {
    storePlanForGame('game-0', plan());
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('quick-view-plan'));
    fireEvent.click(getByTestId('quick-plan-load-previous'));
    // Eerst een bevestiging: er is nog niets geladen.
    expect(readPlanForGame('game-1')).toBeNull();
    fireEvent.click(getByTestId('quick-plan-load-sheet-confirm'));
    expect(readPlanForGame('game-1')?.quarters['1']?.[0]).toEqual(plan().quarters['1']?.[0]);
  });

  it('gespeelde blokken zijn dicht; het lopende blok blijft qua wisseltijd aan te passen', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup({ game: trackingGame({ curQuarter: 2, beginSec: 600 }) });
    fireEvent.click(getByTestId('quick-view-plan'));
    fireEvent.click(getByTestId('quick-plan-tab-1'));
    expect((getByTestId('quick-plan-block-1-0') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('quick-plan-block-1-1') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByTestId('quick-plan-tab-2'));
    // Kwart 2: het lopende blok is te openen (tijd), het volgende blok is ook te bewerken.
    expect((getByTestId('quick-plan-block-2-0') as HTMLButtonElement).disabled).toBe(false);
    expect((getByTestId('quick-plan-block-2-1') as HTMLButtonElement).disabled).toBe(false);
  });

  it('aan het begin van kwart 1 zijn wisselmomenten toe te voegen en de wisseltijd aan te passen', () => {
    // Schema maken vanuit niets: één blok in kwart 1, dat meteen het lopende blok is.
    const { getByTestId, queryByTestId } = setup();
    fireEvent.click(getByTestId('quick-view-plan'));
    fireEvent.click(getByTestId('quick-plan-create'));
    expect(getByTestId('quick-plan-block-1-0').textContent).toContain('nu bezig');
    expect((getByTestId('quick-plan-block-1-0') as HTMLButtonElement).disabled).toBe(false);
    // Wisselmoment toevoegen splitst het lopende blok vanaf de huidige kloktijd (10:00 → 5:00).
    fireEvent.click(getByTestId('quick-plan-add-block'));
    expect(queryByTestId('quick-plan-notice')).toBeNull();
    expect(readPlanForGame('game-1')?.quarters['1']).toEqual([
      { toSec: 300, lineup: [4, 7, 9, 11, 13] },
      { toSec: 0, lineup: [4, 7, 9, 11, 13] },
    ]);
    // Het lopende blok: wisseltijd aan te passen en niet te verwijderen. Zolang er nog niets
    // gespeeld is, zijn de starters (kwart 1, blok 1) wel aan te passen (R4).
    fireEvent.click(getByTestId('quick-plan-block-1-0'));
    expect(getByTestId('quick-plan-time').textContent).toBe('5:00');
    fireEvent.click(getByTestId('quick-plan-later'));
    expect(getByTestId('quick-plan-time').textContent).toBe('4:30');
    expect((getByTestId('quick-plan-court-0') as HTMLButtonElement).disabled).toBe(false);
    expect(queryByTestId('quick-plan-delete-block')).toBeNull();
    fireEvent.click(getByTestId('quick-plan-done'));
    expect(readPlanForGame('game-1')?.quarters['1']?.[0]?.toSec).toBe(270);
    // Het volgende blok is volledig te bewerken: speler eruit/erin en verwijderen.
    fireEvent.click(getByTestId('quick-plan-block-1-1'));
    expect((getByTestId('quick-plan-court-0') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(getByTestId('quick-plan-court-0'));
    fireEvent.click(getByTestId('quick-plan-bench-12'));
    fireEvent.click(getByTestId('quick-plan-done'));
    expect(readPlanForGame('game-1')?.quarters['1']?.[1]?.lineup).toEqual([12, 7, 9, 11, 13]);
    // De geplande wissel verschijnt in het wedstrijdscherm.
    fireEvent.click(getByTestId('quick-view-game'));
    expect(getByTestId('quick-plan-card').textContent).toContain('rond 4:30');
  });

  it('het laatste blok van een kwart dat al helemaal gespeeld is, krijgt geen extra wisselmoment', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup({ game: trackingGame({ curQuarter: 2, beginSec: 600 }) });
    fireEvent.click(getByTestId('quick-view-plan'));
    fireEvent.click(getByTestId('quick-plan-tab-1'));
    fireEvent.click(getByTestId('quick-plan-add-block'));
    expect(getByTestId('quick-plan-notice').textContent).toContain('al gespeeld');
  });

  it('zonder schrijfrechten zijn de knoppen uitgeschakeld', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup({ canWrite: false });
    fireEvent.click(getByTestId('quick-view-plan'));
    expect((getByTestId('quick-plan-block-1-0') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('quick-plan-add-block') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Wisselschema: geplande wissel uitvoeren', () => {
  it('toont de geplande wissel met wie erin en eruit gaat', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup();
    expect(text(getByTestId('quick-plan-card'))).toContain('Kwart 1 · volgende wissel rond 3:00');
    expect(text(getByTestId('quick-plan-card-diff'))).toContain('In: Bo');
    expect(text(getByTestId('quick-plan-card-diff'))).toContain('Uit: Dani');
  });

  it('Wissel uitvoeren zet de opstelling klaar en opent het tijdwiel op de schematijd', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId, latest } = setup();
    fireEvent.click(getByTestId('quick-plan-run'));
    expect(latest().onCourt).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-6']);
    expect(latest().pendingSwapLineup).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13']);
    expect(text(getByTestId('quick-time-value'))).toBe('3:00');
    expect((getByTestId('quick-time-plan') as HTMLButtonElement).disabled).toBe(true);
    // De echte tijd weken af van het schema: 3:20.
    fireEvent.click(getByTestId('quick-nudge-earlier-10'));
    fireEvent.click(getByTestId('quick-nudge-earlier-10'));
    expect(text(getByTestId('quick-time-value'))).toBe('3:20');
    expect((getByTestId('quick-time-plan') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(getByTestId('quick-time-confirm'));
    const h = deriveGameHistory(latest());
    expect(h.segments).toHaveLength(1);
    expect(h.segments[0]).toMatchObject({ beginSec: 600, endSec: 200 });
    expect(h.segments[0]?.lineup).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13']);
    expect(latest().pendingSwapLineup).toBeNull();
    // Daarna is er in dit kwart geen wissel meer gepland.
    expect(() => getByTestId('quick-plan-card')).toThrow();
  });

  it('Eerst aanpassen zet de geplande opstelling klaar zonder tijdwiel; daarna zijn spelers aan te passen', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId, queryByTestId, latest } = setup();
    fireEvent.click(getByTestId('quick-plan-adjust'));
    expect(queryByTestId('quick-time-sheet')).toBeNull();
    expect(latest().onCourt).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-6']);
    expect(latest().pendingSwapLineup).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13']);
    // Nog een aanpassing: 12 erin voor 6.
    fireEvent.click(getByTestId('quick-chip-gp-6'));
    fireEvent.click(getByTestId('quick-chip-gp-12'));
    expect(latest().onCourt).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-12']);
    expect(text(getByTestId('quick-plan-deviation'))).toContain('Noa i.p.v. Bo');
    // De oorspronkelijke opstelling blijft de opstelling van vóór de wissel.
    expect(latest().pendingSwapLineup).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13']);
    fireEvent.click(getByTestId('quick-swap-done'));
    expect(text(getByTestId('quick-time-value'))).toBe('3:00');
    fireEvent.click(getByTestId('quick-time-confirm'));
    expect(deriveGameHistory(latest()).segments[0]?.lineup).toEqual([
      'gp-4',
      'gp-7',
      'gp-9',
      'gp-11',
      'gp-13',
    ]);
    expect(latest().onCourt).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-12']);
  });

  it('Spelers aanpassen in het tijdwiel sluit het wiel en laat de wissel openstaan', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId, queryByTestId, latest } = setup();
    fireEvent.click(getByTestId('quick-plan-run'));
    fireEvent.click(getByTestId('quick-time-adjust'));
    expect(queryByTestId('quick-time-sheet')).toBeNull();
    expect(latest().pendingSwapLineup).not.toBeNull();
    expect(deriveGameHistory(latest()).segments).toHaveLength(0);
    // Op het hoofdscherm is de wissel nog aan te passen en daarna vast te leggen.
    fireEvent.click(getByTestId('quick-chip-gp-6'));
    fireEvent.click(getByTestId('quick-chip-gp-15'));
    expect(latest().onCourt).toContain('gp-15');
    fireEvent.click(getByTestId('quick-swap-done'));
    fireEvent.click(getByTestId('quick-time-confirm'));
    expect(deriveGameHistory(latest()).segments).toHaveLength(1);
    expect(latest().pendingSwapLineup).toBeNull();
  });

  it('bij alleen een segment (geen wissel) staat geen Spelers aanpassen in het tijdwiel', () => {
    const { getByTestId, queryByTestId } = setup();
    fireEvent.click(getByTestId('quick-primary'));
    expect(queryByTestId('quick-time-adjust')).toBeNull();
  });

  it('Terug naar schema zet de tijd weer op de geplande tijd', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('quick-primary'));
    expect(text(getByTestId('quick-time-value'))).toBe('3:00');
    fireEvent.click(getByTestId('quick-nudge-later-10'));
    expect(text(getByTestId('quick-time-value'))).toBe('2:50');
    fireEvent.click(getByTestId('quick-time-plan'));
    expect(text(getByTestId('quick-time-value'))).toBe('3:00');
  });

  it('zonder schema blijft de eindtijd afgeleid van het vorige segment', () => {
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('quick-primary'));
    expect(text(getByTestId('quick-time-value'))).toBe('9:00');
    expect(() => getByTestId('quick-time-plan')).toThrow();
  });

  it('een speler die niet meedoet maakt de geplande wissel onbeschikbaar', () => {
    const p = plan();
    p.quarters['1']![1]!.lineup = [4, 7, 9, 11, 99];
    storePlanForGame('game-1', p);
    const { getByTestId } = setup();
    expect(() => getByTestId('quick-plan-card')).toThrow();
    expect(getByTestId('quick-primary')).toBeTruthy();
  });
});

describe('Wisselschema: afwijken van het schema', () => {
  it('toont de afwijking en past de rest van het schema aan', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId, latest } = setup();
    // Gepland: 6 erin voor 13. Echt: 12 erin voor 13.
    fireEvent.click(getByTestId('quick-chip-gp-13'));
    fireEvent.click(getByTestId('quick-chip-gp-12'));
    expect(latest().pendingSwapLineup).not.toBeNull();
    expect(text(getByTestId('quick-plan-deviation'))).toContain('Noa i.p.v. Bo');
    fireEvent.click(getByTestId('quick-plan-propagate'));
    // Pas na bevestiging wordt doorgevoerd.
    expect(getByTestId('quick-plan-propagate-sheet')).toBeTruthy();
    expect(readPlanForGame('game-1')).toEqual(plan());
    fireEvent.click(getByTestId('quick-plan-propagate-sheet-confirm'));
    expect(() => getByTestId('quick-plan-deviation')).toThrow();
    const saved = readPlanForGame('game-1');
    // Kwart 2, blok 0 had 6 en 12: 12 ↔ 6 wordt geruild (beide stonden erin, dus ongewijzigd).
    expect(saved?.quarters['2']?.[0]?.lineup).toEqual([4, 7, 9, 6, 12]);
    // Het eerstvolgende blok (kwart 1, blok 1) blijft tot het vastleggen ongemoeid.
    expect(saved?.quarters['1']?.[1]?.lineup).toEqual([4, 7, 9, 11, 6]);
  });

  it('na het vastleggen wordt het volgende blok wat er echt op de vloer stond', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('quick-chip-gp-13'));
    fireEvent.click(getByTestId('quick-chip-gp-12'));
    fireEvent.click(getByTestId('quick-swap-done'));
    fireEvent.click(getByTestId('quick-time-confirm'));
    expect(readPlanForGame('game-1')?.quarters['1']?.[1]?.lineup).toEqual([4, 7, 9, 11, 12]);
  });

  it('een wissel zonder afwijking laat het schema ongemoeid', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('quick-plan-run'));
    expect(() => getByTestId('quick-plan-deviation')).toThrow();
    fireEvent.click(getByTestId('quick-time-confirm'));
    expect(readPlanForGame('game-1')).toEqual(plan());
  });
});

describe('Wisselschema: einde kwart', () => {
  it('start het volgende kwart met de geplande beginopstelling', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId, latest } = setup({
      game: trackingGame({
        onCourt: ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-6'],
        beginSec: 180,
        endSec: 180,
      }),
    });
    fireEvent.click(getByTestId('quick-end-period'));
    expect(text(getByTestId('quick-quarter-note'))).toContain('uit het schema');
    fireEvent.click(getByTestId('quick-time-confirm'));
    const game = latest();
    expect(game.curQuarter).toBe(2);
    expect(game.onCourt).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-6', 'gp-12']);
    expect(deriveGameHistory(game).segments[0]?.lineup).toEqual([
      'gp-4',
      'gp-7',
      'gp-9',
      'gp-11',
      'gp-6',
    ]);
  });

  it('zonder schema blijft de opstelling gelijk', () => {
    const { getByTestId, latest } = setup();
    fireEvent.click(getByTestId('quick-end-period'));
    fireEvent.click(getByTestId('quick-time-confirm'));
    expect(latest().curQuarter).toBe(2);
    expect(latest().onCourt).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13']);
  });
});

/** Spel waarin kwart 1 al één segment heeft (opstelling van `onCourt`, tot `endSec`). */
function gameWithSegment(onCourt: string[], endSec: number): ActiveGame {
  const base = trackingGame({ onCourt });
  const result = commitSegment(base, { endSec, classification: CLASSIFICATION });
  if (!result.ok) throw new Error(`segment mislukt: ${result.error}`);
  return result.game;
}

describe('R4: Schema wissen', () => {
  it('vraagt bevestiging; annuleren laat het schema staan', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('quick-view-plan'));
    fireEvent.click(getByTestId('quick-plan-clear'));
    expect(text(getByTestId('quick-plan-clear-sheet'))).toContain('Schema wissen?');
    fireEvent.click(getByTestId('quick-plan-clear-sheet-cancel'));
    expect(() => getByTestId('quick-plan-clear-sheet')).toThrow();
    expect(readPlanForGame('game-1')).toEqual(plan());
  });

  it('bevestigen wist het schema lokaal en toont weer Schema maken; de wedstrijd blijft', () => {
    storePlanForGame('game-0', plan());
    storePlanForGame('game-1', plan());
    const { getByTestId, latest } = setup();
    const before = latest();
    fireEvent.click(getByTestId('quick-view-plan'));
    fireEvent.click(getByTestId('quick-plan-clear'));
    fireEvent.click(getByTestId('quick-plan-clear-sheet-confirm'));
    expect(readPlanForGame('game-1')).toBeNull();
    // Het schema van een andere wedstrijd blijft ongemoeid.
    expect(readPlanForGame('game-0')).toEqual(plan());
    expect(getByTestId('quick-plan-create')).toBeTruthy();
    expect(latest()).toBe(before);
  });

  it('zonder schrijfrechten is de knop uitgeschakeld', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup({ canWrite: false });
    fireEvent.click(getByTestId('quick-view-plan'));
    expect((getByTestId('quick-plan-clear') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('R4: Zelfde als vorige wedstrijd met overzicht', () => {
  it('toont wat er verandert en laat het huidige schema staan bij annuleren', () => {
    const previous = plan();
    previous.quarters['1']![1] = { toSec: 0, lineup: [4, 7, 9, 11, 15] }; // Jules i.p.v. Bo
    storePlanForGame('game-0', previous);
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('quick-view-plan'));
    fireEvent.click(getByTestId('quick-plan-load-previous'));
    expect(text(getByTestId('quick-plan-changes'))).toContain('Kwart 1 · blok 2');
    expect(text(getByTestId('quick-plan-changes'))).toContain('In: Jules · Uit: Bo');
    fireEvent.click(getByTestId('quick-plan-load-sheet-cancel'));
    expect(readPlanForGame('game-1')).toEqual(plan());
  });

  it('bevestigen vervangt het schema', () => {
    const previous = plan();
    previous.quarters['1']![1] = { toSec: 0, lineup: [4, 7, 9, 11, 15] };
    storePlanForGame('game-0', previous);
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('quick-view-plan'));
    fireEvent.click(getByTestId('quick-plan-load-previous'));
    fireEvent.click(getByTestId('quick-plan-load-sheet-confirm'));
    expect(readPlanForGame('game-1')?.quarters['1']?.[1]?.lineup).toEqual([4, 7, 9, 11, 15]);
  });

  it('identiek schema: het overzicht meldt geen verschillen', () => {
    storePlanForGame('game-0', plan());
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('quick-view-plan'));
    fireEvent.click(getByTestId('quick-plan-load-previous'));
    expect(text(getByTestId('quick-plan-changes-none'))).toContain('Geen verschillen');
  });
});

describe('R4: Rest van het schema aanpassen met bevestiging', () => {
  it('annuleren voert niets door en laat de afwijking staan', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup();
    // Gepland: Bo (6) voor Dani (13). Echt: Jules (15) voor Dani.
    fireEvent.click(getByTestId('quick-chip-gp-13'));
    fireEvent.click(getByTestId('quick-chip-gp-15'));
    fireEvent.click(getByTestId('quick-plan-propagate'));
    expect(text(getByTestId('quick-plan-propagate-sheet'))).toContain(
      'Rest van het schema aanpassen?',
    );
    // Kwart 2, blok 1 had Bo erin: Jules komt daarvoor in de plaats.
    expect(text(getByTestId('quick-plan-changes'))).toContain('Kwart 2 · blok 1');
    expect(text(getByTestId('quick-plan-changes'))).toContain('In: Jules · Uit: Bo');
    fireEvent.click(getByTestId('quick-plan-propagate-sheet-cancel'));
    expect(readPlanForGame('game-1')).toEqual(plan());
    expect(getByTestId('quick-plan-deviation')).toBeTruthy();
  });

  it('bevestigen schrijft de wijziging weg en verbergt de knop', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('quick-chip-gp-13'));
    fireEvent.click(getByTestId('quick-chip-gp-15'));
    fireEvent.click(getByTestId('quick-plan-propagate'));
    fireEvent.click(getByTestId('quick-plan-propagate-sheet-confirm'));
    expect(readPlanForGame('game-1')?.quarters['2']?.[0]?.lineup).toEqual([4, 7, 9, 15, 12]);
    expect(() => getByTestId('quick-plan-propagate')).toThrow();
  });
});

describe('R4: starters aanpasbaar', () => {
  it('vóór het spelen is het starters-blok aan te passen, met uitleg', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup();
    fireEvent.click(getByTestId('quick-view-plan'));
    fireEvent.click(getByTestId('quick-plan-block-1-0'));
    expect((getByTestId('quick-plan-court-0') as HTMLButtonElement).disabled).toBe(false);
    expect(text(getByTestId('quick-plan-sheet-note'))).toContain('starters');
    fireEvent.click(getByTestId('quick-plan-court-0'));
    fireEvent.click(getByTestId('quick-plan-bench-12'));
    fireEvent.click(getByTestId('quick-plan-done'));
    expect(readPlanForGame('game-1')?.quarters['1']?.[0]?.lineup).toEqual([12, 7, 9, 11, 13]);
  });

  it('een aangepaste starter komt ook op de vloer van het live-scherm', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId, latest } = setup();
    fireEvent.click(getByTestId('quick-view-plan'));
    fireEvent.click(getByTestId('quick-plan-block-1-0'));
    // Alex (4) eruit, Noa (12) erin.
    fireEvent.click(getByTestId('quick-plan-court-0'));
    fireEvent.click(getByTestId('quick-plan-bench-12'));
    expect(latest().onCourt).toEqual(['gp-12', 'gp-7', 'gp-9', 'gp-11', 'gp-13']);
    expect(latest().pendingSwapLineup).toBeNull();
    // Een ander blok (niet de starters) laat de vloer ongemoeid.
    fireEvent.click(getByTestId('quick-plan-done'));
    fireEvent.click(getByTestId('quick-plan-block-1-1'));
    fireEvent.click(getByTestId('quick-plan-court-1'));
    fireEvent.click(getByTestId('quick-plan-bench-15'));
    expect(latest().onCourt).toEqual(['gp-12', 'gp-7', 'gp-9', 'gp-11', 'gp-13']);
  });

  it('een extra wissel geeft een tweede uitvoeringsregel bij hetzelfde blok', () => {
    storePlanForGame('game-1', plan());
    const first = gameWithSegment(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13'], 400);
    const second = commitSegment(
      { ...first, onCourt: ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-15'] },
      { endSec: 300, classification: CLASSIFICATION },
    );
    if (!second.ok) throw new Error('segment mislukt');
    const { getByTestId } = setup({ game: second.game });
    fireEvent.click(getByTestId('quick-view-plan'));
    expect(getByTestId('quick-plan-actual-1-0')).toBeTruthy();
    expect(text(getByTestId('quick-plan-actual-1-0-1'))).toContain('Jules i.p.v. Dani');
  });

  it('na het eerste segment is het starters-blok dicht', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup({
      game: gameWithSegment(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13'], 400),
    });
    fireEvent.click(getByTestId('quick-view-plan'));
    expect((getByTestId('quick-plan-block-1-0') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('R4: plan naast uitvoering', () => {
  it('een gespeeld blok zoals gepland toont zoals gepland', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup({
      game: gameWithSegment(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13'], 400),
    });
    fireEvent.click(getByTestId('quick-view-plan'));
    const actual = getByTestId('quick-plan-actual-1-0');
    expect(text(actual)).toContain('Gespeeld 10:00 – 6:40 · zoals gepland');
    expect(actual.className).not.toContain('--diff');
  });

  it('een afwijkend gespeeld blok markeert het verschil', () => {
    storePlanForGame('game-1', plan());
    // Gespeeld: Jules (15) i.p.v. Dani (13).
    const { getByTestId } = setup({
      game: gameWithSegment(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-15'], 400),
    });
    fireEvent.click(getByTestId('quick-view-plan'));
    const actual = getByTestId('quick-plan-actual-1-0');
    expect(text(actual)).toContain('afwijkend: Jules i.p.v. Dani');
    expect(actual.className).toContain('--diff');
    expect(actual.querySelectorAll('.quick-plan__mini--diff')).toHaveLength(1);
  });

  it('een blok zonder segment toont geen uitvoering', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId, queryByTestId } = setup();
    fireEvent.click(getByTestId('quick-view-plan'));
    expect(queryByTestId('quick-plan-actual-1-0')).toBeNull();
  });
});
