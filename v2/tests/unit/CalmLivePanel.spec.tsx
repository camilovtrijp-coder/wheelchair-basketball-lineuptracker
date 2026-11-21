// @vitest-environment jsdom
// Rustig wedstrijdscherm (vierde optie): scenario's S1–S7, S9, S10 en S13 uit
// docs/wedstrijdscherm-rustig-bouwplan.md §5b, met fictieve spelers. De
// domeinregels zelf staan in swapFlow.spec.ts; hier gaat het om de bediening.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { CalmLivePanel } from '../../src/ui/game/CalmLivePanel';
import { deriveGameHistory } from '../../src/domain/game/tracking';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';
import type { RotationPlan } from '../../src/domain/game/rotationPlan';
import { storePlanForGame } from '../../src/infrastructure/game/rotationPlanStore';
import { readSwapFlowState } from '../../src/infrastructure/game/swapFlowStore';
import type { Lang } from '../../src/i18n/strings';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Klasse per speler (S3/S5): op de vloer 3.0 elk (som 15.0), bank Bo 2.0, Noa 4.5, Jules 3.0.
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

/** Schema Q1: om 8:00 (480) Noa voor Sam; daarna loopt het laatste blok door. */
function planQ1(): RotationPlan {
  return {
    quarters: {
      '1': [
        { toSec: 480, lineup: [4, 7, 9, 11, 13] },
        { toSec: 0, lineup: [4, 12, 9, 11, 13] },
      ],
    },
  };
}

interface SetupOptions {
  canWrite?: boolean;
  lang?: Lang;
  game?: ActiveGame;
  plan?: RotationPlan;
  /** Standaard tikt setup op Wedstrijd; `false` laat de beginweergave staan. */
  openGameView?: boolean;
}

function setup(opts: SetupOptions = {}) {
  let latest: ActiveGame = opts.game ?? trackingGame();
  if (opts.plan != null) storePlanForGame(latest.id, opts.plan);
  function Harness() {
    const [game, setGame] = useState<ActiveGame>(latest);
    return (
      <CalmLivePanel
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
  if (opts.openGameView !== false) fireEvent.click(utils.getByTestId('calm-view-game'));
  return { ...utils, latest: () => latest };
}

const text = (el: Element) => el.textContent ?? '';
type Utils = ReturnType<typeof setup>;

/** Tik vloerspeler `out` en bankspeler `inn` aan (nummers) en zet daarmee een wissel klaar. */
function pickSwap(u: Utils, out: number, inn: number) {
  fireEvent.click(u.getByTestId(`calm-chip-gp-${out}`));
  fireEvent.click(u.getByTestId(`calm-chip-gp-${inn}`));
}

function segments(u: Utils) {
  return deriveGameHistory(u.latest()).segments;
}

describe('CalmLivePanel: beginweergave en schakelaar', () => {
  it('Wisselschema is de eerste knop en opent tot het eerste segment', () => {
    const u = setup({ openGameView: false });
    const buttons = u.getByTestId('calm-view-plan').parentElement!.querySelectorAll('button');
    expect(Array.from(buttons).map((b) => b.dataset.testid)).toEqual([
      'calm-view-plan',
      'calm-view-game',
    ]);
    expect(u.getByTestId('calm-view-plan').getAttribute('aria-pressed')).toBe('true');
  });

  it('opent op Wedstrijd zodra er een segment is vastgelegd', () => {
    const first = setup();
    pickSwap(first, 7, 12);
    fireEvent.click(first.getByTestId('calm-swap-run'));
    const game = first.latest();
    cleanup();
    const u = setup({ openGameView: false, game });
    expect(u.getByTestId('calm-view-game').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('CalmLivePanel: hoofdscherm', () => {
  it('toont stand, turnover, ongedaan maken, strook, vloer, bank en onderbalk', () => {
    const u = setup();
    expect(u.container.querySelectorAll('[data-testid="calm-court"] .calm-chip')).toHaveLength(5);
    expect(u.container.querySelectorAll('[data-testid="calm-bench"] .calm-chip')).toHaveLength(3);
    expect(text(u.getByTestId('calm-strip-title'))).toBe('Huidige vijf · sinds 10:00');
    expect(text(u.getByTestId('calm-segments-btn'))).toBe('Segmenten (0)');
    expect(text(u.getByTestId('calm-end-quarter'))).toContain('Einde kwart');
    // Geen losse Opslaan-knop in Rustig.
    expect(u.container.querySelector('[data-testid="quick-primary"]')).toBeNull();
    expect((u.getByTestId('calm-undo') as HTMLButtonElement).disabled).toBe(true);
  });

  it('+1/+2/+3 voor en tegen en Turnover tellen mee in het open segment', () => {
    const u = setup();
    fireEvent.click(u.getByTestId('calm-score-plus-for-2'));
    fireEvent.click(u.getByTestId('calm-score-plus-for-3'));
    fireEvent.click(u.getByTestId('calm-score-plus-against-1'));
    fireEvent.click(u.getByTestId('calm-turnover-plus'));
    const h = deriveGameHistory(u.latest());
    expect([h.scoreFor, h.scoreAgainst, h.turnovers]).toEqual([5, 1, 1]);
    expect(text(u.getByTestId('calm-score-value-for'))).toBe('5');
    expect(text(u.getByTestId('calm-strip-stats'))).toContain('+/− +4 · TO 1');
  });

  it('alles is uitgeschakeld zonder schrijfrechten', () => {
    const u = setup({ canWrite: false });
    expect(u.getByTestId('game-read-only')).toBeTruthy();
    for (const id of ['calm-score-plus-for-2', 'calm-turnover-plus', 'calm-end-quarter']) {
      expect((u.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('toont Engelse teksten', () => {
    const u = setup({ lang: 'en' });
    expect(text(u.getByTestId('calm-undo'))).toBe('Undo');
    expect(text(u.getByTestId('calm-segments-btn'))).toBe('Segments (0)');
    expect(text(u.getByTestId('calm-strip-title'))).toBe('Current five · since 10:00');
  });
});

describe('S1/S2: wissel volgens schema, tijd bijstellen', () => {
  it('S1: schemakaart, één tik op Wissel uitvoeren, tijd = schematijd, geen open bevestiging', () => {
    const u = setup({ plan: planQ1() });
    expect(text(u.getByTestId('calm-slot-plan'))).toContain('Eerst aanpassen');
    fireEvent.click(u.getByTestId('calm-plan-run'));
    const [seg] = segments(u);
    expect([seg?.beginSec, seg?.endSec, seg?.durSec]).toEqual([600, 480, 120]);
    expect(seg?.lineup).toEqual(START);
    expect(u.latest().onCourt).toContain('gp-12');
    expect(u.latest().pendingSwapLineup).toBeNull();
    // Reviewpunt 2: de tijdkaart verschijnt ook bij een schematijd, zonder "geschat" en zonder teller.
    expect(text(u.getByTestId('calm-time-title'))).toBe('Wissel om 8:00 · klopt de tijd?');
    expect(() => u.getByTestId('calm-time-count')).toThrow();
    expect(readSwapFlowState('game-1').unconfirmedSegmentIds).toEqual([]);
    expect(text(u.getByTestId('calm-notice-text'))).toBe('Wissel Noa ↔ Sam vastgelegd');
  });

  it('S1: Einde kwart na een schematijd vraagt geen open tijden (direct het kwartblad)', () => {
    const u = setup({ plan: planQ1() });
    fireEvent.click(u.getByTestId('calm-plan-run'));
    fireEvent.click(u.getByTestId('calm-end-quarter'));
    expect(u.getByTestId('quick-time-sheet')).toBeTruthy();
    expect(() => u.getByTestId('calm-confirm-sheet')).toThrow();
  });

  it('S2: bijstellen met −10s (eerder) legt de nieuwe tijd vast en sluit de tijdkaart', () => {
    const u = setup({ plan: planQ1() });
    fireEvent.click(u.getByTestId('calm-plan-run'));
    fireEvent.click(u.getByTestId('calm-time-earlier'));
    expect((u.getByTestId('calm-time-input') as HTMLInputElement).value).toBe('8:10');
    fireEvent.click(u.getByTestId('calm-time-ok'));
    expect(segments(u)[0]?.endSec).toBe(490);
    expect(u.latest().beginSec).toBe(490);
    expect(text(u.getByTestId('calm-strip-title'))).toBe('Huidige vijf · sinds 8:10');
    expect(u.getByTestId('calm-slot-idle')).toBeTruthy();
  });

  it('S2: +10s (later) en typen mm:ss; ongeldige invoer blokkeert Klopt', () => {
    const u = setup({ plan: planQ1() });
    fireEvent.click(u.getByTestId('calm-plan-run'));
    fireEvent.click(u.getByTestId('calm-time-later'));
    expect((u.getByTestId('calm-time-input') as HTMLInputElement).value).toBe('7:50');
    const input = u.getByTestId('calm-time-input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'abc' } });
    expect(u.getByTestId('calm-time-error')).toBeTruthy();
    expect((u.getByTestId('calm-time-ok') as HTMLButtonElement).disabled).toBe(true);
    // 10:00 = het begin van het segment: duur 0, buiten de grenzen.
    fireEvent.input(input, { target: { value: '10:00' } });
    expect((u.getByTestId('calm-time-ok') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(input, { target: { value: '7:45' } });
    expect((u.getByTestId('calm-time-ok') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(u.getByTestId('calm-time-ok'));
    expect(segments(u)[0]?.endSec).toBe(465);
    expect(u.latest().beginSec).toBe(465);
  });
});

describe('S3–S5: afwijken, meerdere wissels, klasse', () => {
  it('S3: Eerst aanpassen zet het schema klaar; een andere speler erin dan gepland', () => {
    const u = setup({ plan: planQ1() });
    fireEvent.click(u.getByTestId('calm-plan-adjust'));
    expect(u.latest().pendingSwapLineup).toEqual(START);
    expect(u.latest().onCourt).toContain('gp-12');
    // Bo (2.0) in plaats van Noa: de bankspeler Bo laat de klassesom onder de grens.
    pickSwap(u, 12, 6);
    expect(u.latest().onCourt).toContain('gp-6');
    expect(u.latest().onCourt).not.toContain('gp-12');
    expect(u.getByTestId('calm-slot-pending')).toBeTruthy();
    fireEvent.click(u.getByTestId('calm-swap-run'));
    expect(segments(u)[0]?.lineup).toEqual(START);
    expect(u.latest().onCourt).toContain('gp-6');
  });

  it('S3: klassesom na de wissel staat onder elke bankspeler (groen of rood)', () => {
    const u = setup();
    fireEvent.click(u.getByTestId('calm-chip-gp-7'));
    // Sam (3.0) eruit: Bo 2.0 -> 14.0 past, Jules 3.0 -> 15.0 past (grens 15.0), Noa 4.5 -> 16.5 te hoog.
    const sum = (nr: number) => u.getByTestId(`calm-bench-sum-gp-${nr}`);
    expect([text(sum(6)), sum(6).dataset.status]).toEqual(['14.0 ✓', 'ok']);
    expect([text(sum(15)), sum(15).dataset.status]).toEqual(['15.0 ✓', 'ok']);
    expect([text(sum(12)), sum(12).dataset.status]).toEqual(['16.5 !', 'over']);
    expect(sum(12).getAttribute('aria-label')).toBe('Klassesom na wissel 16.5, te hoog');
    // Zonder gekozen vloerspeler staat er niets onder de bankspelers.
    fireEvent.click(u.getByTestId('calm-chip-gp-7'));
    expect(sum(12).dataset.status).toBe('none');
  });

  it('S3: hulpkaart vraagt wie erin komt of wie eruit gaat', () => {
    const u = setup();
    fireEvent.click(u.getByTestId('calm-chip-gp-4'));
    expect(text(u.getByTestId('calm-slot-help'))).toContain('Wie komt erin voor #4 Alex?');
    fireEvent.click(u.getByTestId('calm-chip-gp-4'));
    fireEvent.click(u.getByTestId('calm-chip-gp-6'));
    expect(text(u.getByTestId('calm-slot-help'))).toContain('Wie gaat eruit voor #6 Bo?');
  });

  it('S3: de geselecteerde speler heeft een blauwe rand (klasse calm-chip--selected)', () => {
    const u = setup();
    fireEvent.click(u.getByTestId('calm-chip-gp-4'));
    expect(u.getByTestId('calm-chip-gp-4').classList.contains('calm-chip--selected')).toBe(true);
    expect(u.getByTestId('calm-chip-gp-7').classList.contains('calm-chip--selected')).toBe(false);
  });

  it('S4: twee wissels in één concept geven één segmentgrens met de oude vijf', () => {
    const u = setup();
    fireEvent.click(u.getByTestId('calm-score-plus-for-2'));
    pickSwap(u, 7, 12);
    pickSwap(u, 9, 6);
    expect(u.latest().onCourt).toEqual(['gp-4', 'gp-12', 'gp-6', 'gp-11', 'gp-13']);
    expect(u.latest().pendingSwapLineup).toEqual(START);
    fireEvent.click(u.getByTestId('calm-swap-run'));
    expect(segments(u)).toHaveLength(1);
    expect(segments(u)[0]?.lineup).toEqual(START);
    expect(segments(u)[0]?.pf).toBe(2);
    expect(text(u.getByTestId('calm-notice-text'))).toContain('vastgelegd');
  });

  it('S5: een rode speler blijft kiesbaar: waarschuwen, maar wel toestaan', () => {
    const u = setup();
    pickSwap(u, 7, 12); // Noa 4.5: 16.5 > 15.0
    expect(u.getByTestId('calm-class-warning')).toBeTruthy();
    expect(text(u.getByTestId('calm-class-warning'))).toContain('16.5');
    expect((u.getByTestId('calm-swap-run') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(u.getByTestId('calm-swap-run'));
    expect(segments(u)).toHaveLength(1);
    expect(u.latest().onCourt).toContain('gp-12');
  });

  it('Annuleer wissel zet de vorige vijf terug', () => {
    const u = setup();
    pickSwap(u, 7, 12);
    fireEvent.click(u.getByTestId('calm-swap-cancel'));
    expect(u.latest().onCourt).toEqual(START);
    expect(u.latest().pendingSwapLineup).toBeNull();
    expect(segments(u)).toHaveLength(0);
  });
});

describe('S6: twee wissels snel na elkaar', () => {
  it('toont "n tijden nog bevestigen", oudste eerst, en de volgorde blijft geldig', () => {
    const u = setup();
    pickSwap(u, 7, 12);
    fireEvent.click(u.getByTestId('calm-swap-run')); // schatting 9:00
    expect(text(u.getByTestId('calm-time-count'))).toBe('1 tijd nog bevestigen');
    expect(text(u.getByTestId('calm-time-title'))).toContain('9:00');
    expect(text(u.getByTestId('calm-time-title'))).toContain('geschat');
    pickSwap(u, 9, 6);
    fireEvent.click(u.getByTestId('calm-swap-run')); // schatting 8:00
    expect(text(u.getByTestId('calm-time-count'))).toBe('2 tijden nog bevestigen');
    // Oudste eerst: de kaart toont nog de eerste wissel (9:00).
    expect(text(u.getByTestId('calm-time-title'))).toContain('9:00');
    expect(readSwapFlowState('game-1').unconfirmedSegmentIds).toHaveLength(2);
    // 9:00 -> 8:50 (−10s = eerder): het tweede segment begint dan op 8:50.
    fireEvent.click(u.getByTestId('calm-time-earlier'));
    fireEvent.click(u.getByTestId('calm-time-ok'));
    const [a, b] = segments(u);
    expect([a?.endSec, b?.beginSec, b?.endSec]).toEqual([550, 550, 480]);
    expect(text(u.getByTestId('calm-time-count'))).toBe('1 tijd nog bevestigen');
    expect(text(u.getByTestId('calm-time-title'))).toContain('8:00');
  });
});

describe('S7: verkeerde speler ingetikt', () => {
  it('ongedaan maken na Wissel uitvoeren zet de vorige vijf, de begintijd en de punten terug', () => {
    const u = setup();
    fireEvent.click(u.getByTestId('calm-score-plus-for-2'));
    fireEvent.click(u.getByTestId('calm-turnover-plus'));
    pickSwap(u, 7, 12);
    fireEvent.click(u.getByTestId('calm-swap-run'));
    expect(segments(u)).toHaveLength(1);
    fireEvent.click(u.getByTestId('calm-undo'));
    expect(u.latest().onCourt).toEqual(START);
    expect(u.latest().beginSec).toBe(600);
    expect(segments(u)).toHaveLength(0);
    const h = deriveGameHistory(u.latest());
    expect([h.scoreFor, h.segStartFor, h.turnovers, h.segStartTurnovers]).toEqual([2, 0, 1, 0]);
    expect(text(u.getByTestId('calm-notice-text'))).toBe('Wissel Sam ↔ Noa teruggedraaid');
    // De wissel hoeft zijn tijd niet meer te bevestigen, en de knop staat uit tot een nieuwe actie.
    expect(readSwapFlowState('game-1').unconfirmedSegmentIds).toEqual([]);
    expect((u.getByTestId('calm-undo') as HTMLButtonElement).disabled).toBe(true);
    expect(text(u.getByTestId('calm-strip-title'))).toBe('Huidige vijf · sinds 10:00');
  });

  it('de melding bij een wissel heeft zelf ook "Ongedaan maken"', () => {
    const u = setup();
    pickSwap(u, 7, 12);
    fireEvent.click(u.getByTestId('calm-swap-run'));
    fireEvent.click(u.getByTestId('calm-notice-undo'));
    expect(u.latest().onCourt).toEqual(START);
  });

  it('één niveau: na een teruggedraaide score staat de knop uit; een nieuwe actie zet hem weer aan', () => {
    const u = setup();
    fireEvent.click(u.getByTestId('calm-score-plus-for-3'));
    fireEvent.click(u.getByTestId('calm-undo'));
    expect(deriveGameHistory(u.latest()).scoreFor).toBe(0);
    expect(text(u.getByTestId('calm-notice-text'))).toBe('+3 punten Eigen teruggedraaid');
    expect((u.getByTestId('calm-undo') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(u.getByTestId('calm-turnover-plus'));
    expect((u.getByTestId('calm-undo') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(u.getByTestId('calm-undo'));
    expect(deriveGameHistory(u.latest()).turnovers).toBe(0);
    expect(text(u.getByTestId('calm-notice-text'))).toBe('Turnover teruggedraaid');
  });

  it('de blokkade overleeft herladen (lokale opslag)', () => {
    const u = setup();
    fireEvent.click(u.getByTestId('calm-score-plus-for-2'));
    fireEvent.click(u.getByTestId('calm-undo'));
    const game = u.latest();
    cleanup();
    const again = setup({ game });
    expect((again.getByTestId('calm-undo') as HTMLButtonElement).disabled).toBe(true);
  });

  it('S8: tijdens een openstaande wissel staat ongedaan maken uit (gebruik Annuleer wissel)', () => {
    const u = setup();
    fireEvent.click(u.getByTestId('calm-score-plus-for-2'));
    pickSwap(u, 7, 12);
    expect((u.getByTestId('calm-undo') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('S9: wissel vergeten, met terugwerkende kracht', () => {
  it('kiest een tijd en een grens in de lijst; de punten worden gesplitst', () => {
    const u = setup();
    fireEvent.click(u.getByTestId('calm-score-plus-for-2'));
    fireEvent.click(u.getByTestId('calm-score-plus-for-3'));
    fireEvent.click(u.getByTestId('calm-turnover-plus'));
    fireEvent.click(u.getByTestId('calm-score-plus-against-2'));
    pickSwap(u, 7, 12);
    fireEvent.click(u.getByTestId('calm-retro-open'));
    const rows = u.container.querySelectorAll('[data-testid^="calm-retro-entry-"]');
    expect(Array.from(rows).map((r) => text(r))).toEqual([
      '+2 Eigen',
      '+3 Eigen',
      'Turnover +1',
      '+2 Tegenstander',
    ]);
    // Zonder gekozen grens kan het niet.
    expect((u.getByTestId('calm-retro-confirm') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(rows[1] as HTMLElement); // t/m de +3 hoort bij de oude vijf
    fireEvent.input(u.getByTestId('calm-retro-time-input'), { target: { value: '6:40' } });
    fireEvent.click(u.getByTestId('calm-retro-confirm'));
    const [seg] = segments(u);
    expect([seg?.beginSec, seg?.endSec, seg?.durSec, seg?.pf, seg?.pa, seg?.tov]).toEqual([
      600, 400, 200, 5, 0, 0,
    ]);
    expect(seg?.lineup).toEqual(START);
    const h = deriveGameHistory(u.latest());
    expect([h.scoreFor, h.scoreAgainst, h.turnovers]).toEqual([5, 2, 1]);
    expect([h.scoreFor - h.segStartFor, h.scoreAgainst - h.segStartAgainst]).toEqual([0, 2]);
    expect(u.latest().beginSec).toBe(400);
    expect(u.latest().pendingSwapLineup).toBeNull();
    expect(text(u.getByTestId('calm-notice-text'))).toBe('Wissel Noa ↔ Sam vastgelegd om 6:40');
    // De gesplitste wissel is niet met één stap terug te draaien.
    expect((u.getByTestId('calm-undo') as HTMLButtonElement).disabled).toBe(true);
  });

  it('"Niets hoorde bij de oude vijf" geeft alles aan de nieuwe vijf', () => {
    const u = setup();
    fireEvent.click(u.getByTestId('calm-score-plus-for-2'));
    pickSwap(u, 7, 12);
    fireEvent.click(u.getByTestId('calm-retro-open'));
    fireEvent.click(u.getByTestId('calm-retro-none'));
    fireEvent.click(u.getByTestId('calm-retro-confirm'));
    expect(segments(u)[0]?.pf).toBe(0);
    expect(deriveGameHistory(u.latest()).scoreFor).toBe(2);
  });

  it('een tijd buiten het kwart (na het begin) is niet te kiezen', () => {
    const u = setup();
    fireEvent.click(u.getByTestId('calm-score-plus-for-2'));
    pickSwap(u, 7, 12);
    fireEvent.click(u.getByTestId('calm-retro-open'));
    fireEvent.click(u.getByTestId('calm-retro-none'));
    fireEvent.input(u.getByTestId('calm-retro-time-input'), { target: { value: '10:00' } });
    expect((u.getByTestId('calm-retro-confirm') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('S10: Einde kwart met open tijdbevestigingen', () => {
  function withTwoEstimates() {
    const u = setup();
    pickSwap(u, 7, 12);
    fireEvent.click(u.getByTestId('calm-swap-run'));
    pickSwap(u, 9, 6);
    fireEvent.click(u.getByTestId('calm-swap-run'));
    return u;
  }

  it('vraagt eerst de open schattingen; Klopt allemaal gaat door naar het kwartblad', () => {
    const u = withTwoEstimates();
    fireEvent.click(u.getByTestId('calm-end-quarter'));
    expect(u.getByTestId('calm-confirm-sheet')).toBeTruthy();
    expect(u.container.querySelectorAll('[data-testid^="calm-confirm-row-"]')).toHaveLength(2);
    expect(() => u.getByTestId('quick-time-sheet')).toThrow();
    fireEvent.click(u.getByTestId('calm-confirm-all'));
    expect(readSwapFlowState('game-1').unconfirmedSegmentIds).toEqual([]);
    expect(u.getByTestId('quick-time-sheet')).toBeTruthy();
    fireEvent.click(u.getByTestId('quick-time-confirm'));
    expect(u.latest().curQuarter).toBe(2);
    expect(segments(u)).toHaveLength(3);
  });

  it('Bijstellen sluit het blad en zet die wissel op de tijdkaart', () => {
    const u = withTwoEstimates();
    fireEvent.click(u.getByTestId('calm-end-quarter'));
    const rows = u.container.querySelectorAll('[data-testid^="calm-confirm-adjust-"]');
    fireEvent.click(rows[1] as HTMLElement);
    expect(() => u.getByTestId('calm-confirm-sheet')).toThrow();
    expect(text(u.getByTestId('calm-time-title'))).toContain('8:00');
  });
});

describe('S13: herladen midden in een kwart', () => {
  it('de open tijdbevestigingen blijven staan na opnieuw openen', () => {
    const first = setup();
    pickSwap(first, 7, 12);
    fireEvent.click(first.getByTestId('calm-swap-run'));
    pickSwap(first, 9, 6);
    fireEvent.click(first.getByTestId('calm-swap-run'));
    const game = first.latest();
    cleanup();
    const again = setup({ game });
    expect(text(again.getByTestId('calm-time-count'))).toBe('2 tijden nog bevestigen');
    expect(text(again.getByTestId('calm-time-title'))).toContain('9:00');
    fireEvent.click(again.getByTestId('calm-time-ok'));
    expect(text(again.getByTestId('calm-time-count'))).toBe('1 tijd nog bevestigen');
  });
});

describe('Segmenten en afronden', () => {
  it('Segmenten (n) opent het overzicht', () => {
    const u = setup();
    fireEvent.click(u.getByTestId('calm-score-plus-for-2'));
    pickSwap(u, 7, 12);
    fireEvent.click(u.getByTestId('calm-swap-run'));
    expect(text(u.getByTestId('calm-segments-btn'))).toBe('Segmenten (1)');
    fireEvent.click(u.getByTestId('calm-segments-btn'));
    expect(u.getByTestId('calm-segments-sheet')).toBeTruthy();
    expect(u.getByTestId('calm-segments-sheet').textContent).toContain('#7 Sam');
  });

  it('Wedstrijd afronden werkt als in Snel: uit zonder segment, daarna een dialoog met keuze', () => {
    const u = setup();
    expect((u.getByTestId('calm-finish-game') as HTMLButtonElement).disabled).toBe(true);
    pickSwap(u, 7, 12);
    fireEvent.click(u.getByTestId('calm-swap-run'));
    fireEvent.click(u.getByTestId('calm-finish-game'));
    expect(u.getByTestId('finish-dialog')).toBeTruthy();
  });
});

describe('R7: speeltijd per speler', () => {
  it('staat standaard uit: geen tijden op de tegels', () => {
    const u = setup();
    expect(u.getByTestId('calm-playtime-toggle').getAttribute('aria-pressed')).toBe('false');
    expect(u.container.querySelectorAll('.calm-chip__time')).toHaveLength(0);
  });

  it('aan: elke tegel (veld en bank) toont de speeltijd t/m de laatste wissel', () => {
    const u = setup();
    pickSwap(u, 7, 12);
    fireEvent.click(u.getByTestId('calm-swap-run')); // schatting 9:00: 1:00 voor de oude vijf
    fireEvent.click(u.getByTestId('calm-playtime-toggle'));
    expect(u.container.querySelectorAll('.calm-chip__time')).toHaveLength(8);
    const time = (nr: number) => text(u.getByTestId(`calm-playtime-gp-${nr}`));
    // Alex, Robin, Kim, Dani en Sam stonden 60 s; Noa, Bo en Jules nog niet.
    expect([time(4), time(7), time(9), time(11), time(13)]).toEqual(Array(5).fill('1:00'));
    expect([time(12), time(6), time(15)]).toEqual(['0:00', '0:00', '0:00']);
    // Het open segment telt niet mee en dat staat in de tooltip en (zodra het slot vrij is) in de uitleg.
    fireEvent.click(u.getByTestId('calm-time-ok'));
    expect(text(u.getByTestId('calm-playtime-note'))).toContain('t/m laatste wissel');
    expect(u.getByTestId('calm-chip-gp-7').getAttribute('title')).toContain('t/m laatste wissel');
    expect(window.localStorage.getItem('lineup-tracker-v2-play-time')).toBe('on');
  });

  it('een bijgestelde tijd werkt direct door; de keuze blijft na opnieuw openen', () => {
    const u = setup();
    pickSwap(u, 7, 12);
    fireEvent.click(u.getByTestId('calm-swap-run'));
    fireEvent.click(u.getByTestId('calm-playtime-toggle'));
    fireEvent.click(u.getByTestId('calm-time-earlier')); // 9:10 => 50 s gespeeld
    fireEvent.click(u.getByTestId('calm-time-ok'));
    expect(text(u.getByTestId('calm-playtime-gp-4'))).toBe('0:50');
    const game = u.latest();
    cleanup();
    const again = setup({ game });
    expect(again.getByTestId('calm-playtime-toggle').getAttribute('aria-pressed')).toBe('true');
    expect(text(again.getByTestId('calm-playtime-gp-4'))).toBe('0:50');
  });

  it('toont Engelse teksten en uit zet de tijden weer weg', () => {
    const u = setup({ lang: 'en' });
    fireEvent.click(u.getByTestId('calm-playtime-toggle'));
    expect(text(u.getByTestId('calm-playtime-note'))).toContain('up to the last substitution');
    fireEvent.click(u.getByTestId('calm-playtime-toggle'));
    expect(u.container.querySelectorAll('.calm-chip__time')).toHaveLength(0);
  });
});
