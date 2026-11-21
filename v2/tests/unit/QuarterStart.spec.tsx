// @vitest-environment jsdom
// Keuze van de opstelling voor het volgende kwart bij Einde kwart (bouwplan R3), in Rustig
// en Snel. Scenario's S10 (na de open tijdbevestigingen), S11 (nieuw kwart met een andere
// lineup dan het schema) en S12 (verlenging zonder schemablok). Fictieve spelers.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { CalmLivePanel } from '../../src/ui/game/CalmLivePanel';
import { QuickLivePanel } from '../../src/ui/game/QuickLivePanel';
import { deriveGameHistory } from '../../src/domain/game/tracking';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';
import type { RotationPlan } from '../../src/domain/game/rotationPlan';
import { storePlanForGame } from '../../src/infrastructure/game/rotationPlanStore';
import type { Lang } from '../../src/i18n/strings';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Klasse: op de vloer 3.0 elk (som 15.0 = precies de grens), Bo 2.0, Noa 4.5, Jules 3.0.
const ROSTER: Array<[number, string, string]> = [
  [4, 'Alex', '3.0'],
  [7, 'Sam', '3.0'],
  [9, 'Robin', '3.0'],
  [11, 'Kim', '3.0'],
  [13, 'Dani', '3.0'],
  [6, 'Bo', '2.0'],
  [12, 'Noa', '4.5'],
  [15, 'Jules', '3.0'],
];

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

const START = ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13'];

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
    limitStr: '15.0',
    onCourt: [...START],
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
  useClassLimit: true,
  classBaseLimit: 15,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1,
  bonusBoth: 2,
};

/** Kwart 2 start volgens het schema met Bo voor Dani (klasse 14.0, past). */
function plan(q2: number[] = [4, 7, 9, 11, 6]): RotationPlan {
  return {
    quarters: {
      '1': [{ toSec: 0, lineup: [4, 7, 9, 11, 13] }],
      '2': [{ toSec: 0, lineup: q2 }],
      '3': [{ toSec: 0, lineup: [4, 7, 9, 11, 13] }],
      '4': [{ toSec: 0, lineup: [4, 7, 9, 11, 13] }],
    },
  };
}

interface SetupOptions {
  variant?: 'calm' | 'quick';
  lang?: Lang;
  game?: ActiveGame;
  plan?: RotationPlan;
  quarterCount?: number;
  useClassLimit?: boolean;
}

function setup(opts: SetupOptions = {}) {
  const variant = opts.variant ?? 'calm';
  let latest: ActiveGame = opts.game ?? trackingGame();
  if (opts.plan != null) storePlanForGame(latest.id, opts.plan);
  const Panel = variant === 'calm' ? CalmLivePanel : QuickLivePanel;
  function Harness() {
    const [game, setGame] = useState<ActiveGame>(latest);
    return (
      <Panel
        lang={opts.lang ?? 'nl'}
        game={game}
        quarterCount={opts.quarterCount ?? 4}
        periodLabel="Kwart"
        classification={{ ...CLASSIFICATION, useClassLimit: opts.useClassLimit ?? true }}
        teamName="Eigen"
        tag1Label=""
        tag2Label=""
        onGameChange={(next) => {
          latest = next;
          setGame(next);
        }}
        onFinishGame={vi.fn()}
        canWrite
        saveError={false}
      />
    );
  }
  const utils = render(<Harness />);
  fireEvent.click(utils.getByTestId(`${variant === 'calm' ? 'calm' : 'quick'}-view-game`));
  return { ...utils, latest: () => latest, variant };
}
type Utils = ReturnType<typeof setup>;

const text = (el: Element) => el.textContent ?? '';

function openQuarterSheet(u: Utils) {
  fireEvent.click(u.getByTestId(u.variant === 'calm' ? 'calm-end-quarter' : 'quick-end-period'));
}

describe('Rustig: kwartstart-keuze (S10, S11)', () => {
  it('S10: na de open tijdbevestigingen volgt het keuzescherm, met het schema als standaard', () => {
    const u = setup({ plan: plan() });
    fireEvent.click(u.getByTestId('calm-chip-gp-7'));
    fireEvent.click(u.getByTestId('calm-chip-gp-12'));
    fireEvent.click(u.getByTestId('calm-swap-run'));
    fireEvent.click(u.getByTestId('calm-end-quarter'));
    expect(u.getByTestId('calm-confirm-sheet')).toBeTruthy();
    expect(() => u.getByTestId('quarter-start')).toThrow();
    fireEvent.click(u.getByTestId('calm-confirm-all'));
    // Pas nu, in het kwartblad, kies je de opstelling voor kwart 2.
    expect(u.getByTestId('quarter-start')).toBeTruthy();
    expect(u.getByTestId('quarter-start-option-plan').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(u.getByTestId('quick-time-confirm'));
    expect(u.latest().curQuarter).toBe(2);
    expect(u.latest().onCourt).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-6']);
  });

  it('S11: drie opties met klassesom en in/uit t.o.v. het veld', () => {
    const u = setup({ plan: plan() });
    openQuarterSheet(u);
    expect(u.getByTestId('quarter-start-option-field')).toBeTruthy();
    expect(u.getByTestId('quarter-start-option-plan')).toBeTruthy();
    expect(u.getByTestId('quarter-start-option-custom')).toBeTruthy();
    // Veld: Alex, Sam, Robin, Kim, Dani = 15.0 / 15.0, past nog net.
    expect(text(u.getByTestId('quarter-start-class-field'))).toBe('klasse 15.0 / 15.0');
    expect(u.getByTestId('quarter-start-class-field').className).toContain('--ok');
    // Schema: Bo voor Dani = 14.0.
    expect(text(u.getByTestId('quarter-start-class-plan'))).toBe('klasse 14.0 / 15.0');
    expect(text(u.getByTestId('quarter-start-diff-plan'))).toBe('In: Bo · Uit: Dani');
  });

  it('zoals het veld nu staat laat de opstelling ongemoeid, ook met een afwijkend schema', () => {
    const u = setup({ plan: plan() });
    openQuarterSheet(u);
    fireEvent.click(u.getByTestId('quarter-start-option-field'));
    fireEvent.click(u.getByTestId('quick-time-confirm'));
    expect(u.latest().curQuarter).toBe(2);
    expect(u.latest().onCourt).toEqual(START);
  });

  it('een te hoge klassesom waarschuwt rood maar blokkeert niet', () => {
    // Noa (4.5) voor Dani: 16.5 > 15.
    const u = setup({ plan: plan([4, 7, 9, 11, 12]) });
    openQuarterSheet(u);
    const cls = u.getByTestId('quarter-start-class-plan');
    expect(text(cls)).toContain('klasse 16.5 / 15.0');
    expect(text(cls)).toContain('te hoog, mag wel');
    expect(cls.className).toContain('--over');
    const confirm = u.getByTestId('quick-time-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(u.latest().onCourt).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-12']);
  });

  it('zelf samenstellen: pas bij precies 5 spelers te bevestigen, en het veld verandert pas dan', () => {
    const u = setup({ plan: plan() });
    openQuarterSheet(u);
    fireEvent.click(u.getByTestId('quarter-start-option-custom'));
    // Beginselectie = het veld (5). Haal Dani eraf: 4 gekozen, bevestigen kan niet.
    fireEvent.click(u.getByTestId('quarter-start-custom-gp-13'));
    expect(text(u.getByTestId('quarter-start-count'))).toBe('4 van 5 gekozen');
    expect(u.getByTestId('quarter-start-need')).toBeTruthy();
    expect((u.getByTestId('quick-time-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(u.latest().onCourt).toEqual(START);
    // Jules erbij: 5 gekozen.
    fireEvent.click(u.getByTestId('quarter-start-custom-gp-15'));
    expect(text(u.getByTestId('quarter-start-diff-custom'))).toBe('In: Jules · Uit: Dani');
    expect(text(u.getByTestId('quarter-start-class-custom'))).toBe('klasse 15.0 / 15.0');
    // Een zesde speler wordt niet toegevoegd.
    fireEvent.click(u.getByTestId('quarter-start-custom-gp-6'));
    expect(text(u.getByTestId('quarter-start-count'))).toBe('5 van 5 gekozen');
    fireEvent.click(u.getByTestId('quick-time-confirm'));
    expect(u.latest().curQuarter).toBe(2);
    expect(u.latest().onCourt).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-15']);
  });

  it('het afgesloten kwart wordt vastgelegd met de oude opstelling, de keuze geldt voor het volgende', () => {
    const u = setup({ plan: plan() });
    openQuarterSheet(u);
    fireEvent.click(u.getByTestId('quick-time-confirm'));
    const segs = deriveGameHistory(u.latest()).segments;
    expect(segs).toHaveLength(1);
    expect(segs[0]?.lineup).toEqual(START);
    expect(u.latest().onCourt).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-6']);
  });

  it('zonder klassegrens staat er geen klassesom bij de opties', () => {
    const u = setup({ plan: plan(), useClassLimit: false });
    openQuarterSheet(u);
    expect(() => u.getByTestId('quarter-start-class-plan')).toThrow();
    expect(u.getByTestId('quarter-start-diff-plan')).toBeTruthy();
  });

  it('zonder schema: alleen veld en zelf samenstellen, het veld blijft de standaard', () => {
    const u = setup();
    openQuarterSheet(u);
    expect(() => u.getByTestId('quarter-start-option-plan')).toThrow();
    expect(u.getByTestId('quarter-start-option-field').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(u.getByTestId('quick-time-confirm'));
    expect(u.latest().onCourt).toEqual(START);
  });

  it('Engelse teksten', () => {
    const u = setup({ plan: plan(), lang: 'en' });
    openQuarterSheet(u);
    expect(text(u.getByTestId('quarter-start-option-plan'))).toContain(
      'According to the rotation plan',
    );
    expect(text(u.getByTestId('quarter-start-diff-plan'))).toBe('In: Bo · Out: Dani');
  });
});

describe('S12: verlenging', () => {
  it('zonder schemablok voor het extra kwart blijven veld en zelf samenstellen over', () => {
    // 4 gewone kwarten + 1 verlenging (quarterCount 5); het schema kent alleen kwart 1–4.
    const u = setup({
      plan: plan(),
      quarterCount: 5,
      game: trackingGame({ curQuarter: 4, onCourt: ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-6'] }),
    });
    openQuarterSheet(u);
    expect(() => u.getByTestId('quarter-start-option-plan')).toThrow();
    expect(u.getByTestId('quarter-start-option-field').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(u.getByTestId('quick-time-confirm'));
    expect(u.latest().curQuarter).toBe(5);
    expect(u.latest().onCourt).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-6']);
  });

  it('in het laatste kwart is er geen keuze (Einde kwart sluit alleen af)', () => {
    const u = setup({ plan: plan(), game: trackingGame({ curQuarter: 4 }) });
    openQuarterSheet(u);
    expect(() => u.getByTestId('quarter-start')).toThrow();
  });
});

describe('Snel: dezelfde keuze in de kwart-afsluiten-sheet', () => {
  it('toont de drie opties en past de gekozen opstelling toe', () => {
    const u = setup({ variant: 'quick', plan: plan() });
    openQuarterSheet(u);
    expect(u.getByTestId('quarter-start-option-plan').getAttribute('aria-checked')).toBe('true');
    expect(text(u.getByTestId('quick-quarter-note'))).toContain('uit het schema');
    fireEvent.click(u.getByTestId('quarter-start-option-custom'));
    expect(text(u.getByTestId('quick-quarter-note'))).not.toContain('uit het schema');
    fireEvent.click(u.getByTestId('quarter-start-custom-gp-13'));
    fireEvent.click(u.getByTestId('quarter-start-custom-gp-12'));
    expect(text(u.getByTestId('quarter-start-class-custom'))).toContain('te hoog, mag wel');
    fireEvent.click(u.getByTestId('quick-time-confirm'));
    expect(u.latest().curQuarter).toBe(2);
    expect(u.latest().onCourt).toEqual(['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-12']);
  });

  it('zoals het veld nu staat houdt de opstelling', () => {
    const u = setup({ variant: 'quick', plan: plan() });
    openQuarterSheet(u);
    fireEvent.click(u.getByTestId('quarter-start-option-field'));
    fireEvent.click(u.getByTestId('quick-time-confirm'));
    expect(u.latest().onCourt).toEqual(START);
  });
});
