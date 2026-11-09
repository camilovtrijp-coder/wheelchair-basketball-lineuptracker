// @vitest-environment jsdom
// Wisselschema in het Snel-wedstrijdscherm: schema maken/bewerken, geplande wissel
// uitvoeren, afwijken van het schema en kwart afsluiten met de geplande beginopstelling.
// Het schema is lokaal en geen onderdeel van de wedstrijd.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { QuickLivePanel } from '../../src/ui/game/QuickLivePanel';
import { deriveGameHistory } from '../../src/domain/game/tracking';
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
    expect(readPlanForGame('game-1')?.quarters['1']?.[0]).toEqual(plan().quarters['1']?.[0]);
  });

  it('gespeelde blokken zijn niet meer te bewerken', () => {
    storePlanForGame('game-1', plan());
    const { getByTestId } = setup({ game: trackingGame({ curQuarter: 2, beginSec: 600 }) });
    fireEvent.click(getByTestId('quick-view-plan'));
    fireEvent.click(getByTestId('quick-plan-tab-1'));
    expect((getByTestId('quick-plan-block-1-0') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('quick-plan-block-1-1') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByTestId('quick-plan-tab-2'));
    // Kwart 2: het lopende blok is dicht, het volgende blok is te bewerken.
    expect((getByTestId('quick-plan-block-2-0') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('quick-plan-block-2-1') as HTMLButtonElement).disabled).toBe(false);
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
