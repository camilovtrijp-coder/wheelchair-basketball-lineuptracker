// Compact wedstrijdscherm (bouwplan C2a–C3 + lineupkeuze bij kwart afsluiten en
// afrondterugkoppeling): browsertests tegen de Firebase-emulator (lokale modus via
// `./fixtures`, zoals de rest van de suite). Fictieve spelers: #4 Alex, #7 Sam,
// #9 Robin, #11 Kim, #13 Dani; bank #6 Bo, #12 Noa, #15 Jules.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { openAccountMenu } from './accountMenu';

const ACTIVE_GAME_KEY = 'lineup-tracker-v2-active-game:org-rotterdam:team-u23';
const GAME_SCREEN_KEY = 'lineup-tracker-v2-game-screen';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const ROSTER: Array<[string, string]> = [
  ['4', 'Alex'],
  ['7', 'Sam'],
  ['9', 'Robin'],
  ['11', 'Kim'],
  ['13', 'Dani'],
  ['6', 'Bo'],
  ['12', 'Noa'],
  ['15', 'Jules'],
];
const STARTERS = ['4', '7', '9', '11', '13'];

type Lang = 'nl' | 'en';

interface StoredAction {
  type: string;
  segment?: { lineup: string[]; durSec: number; pf: number; pa: number; tov?: number };
}
interface StoredGame {
  actions: StoredAction[];
  onCourt: string[];
  curQuarter: number;
  beginSec: number;
  pendingSwapLineup: string[] | null;
  players: Array<{ id: string; nr: string; naam: string }>;
}

async function readActiveGame(page: Page): Promise<StoredGame> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), ACTIVE_GAME_KEY);
  return JSON.parse(raw ?? 'null') as StoredGame;
}

function savedSegments(game: StoredGame) {
  return game.actions.filter((a) => a.type === 'segment-saved').map((a) => a.segment!);
}

/** Nummers (#) van de lineup, in positievolgorde. */
function nrsOf(game: StoredGame, ids: string[]): string[] {
  return ids.map((id) => game.players.find((p) => p.id === id)?.nr ?? '?');
}

/**
 * Zet het roster op (8 fictieve spelers), kiest #4/#7/#9/#11/#13 als starters en
 * start de wedstrijd. Het schermtype blijft zoals de browser het heeft (standaard Klassiek).
 */
async function startGame(page: Page, lang: Lang = 'nl', screen?: 'compact'): Promise<void> {
  await page.addInitScript(
    ({ l, s, key }) => {
      window.localStorage.setItem('lineup-tracker-lang', l);
      if (s) window.localStorage.setItem(key, s);
    },
    { l: lang, s: screen, key: GAME_SCREEN_KEY },
  );
  await page.goto('/');
  await page.getByTestId('nav-roster').click();
  for (let i = 0; i < ROSTER.length; i += 1) {
    await page.getByTestId('roster-add').click();
  }
  const nameInputs = page.locator('[data-testid^="roster-naam-"]');
  await expect(nameInputs).toHaveCount(ROSTER.length);
  // Eerst alle namen (de volgorde blijft stabiel), daarna per speler-id het nummer:
  // het roster sorteert op nummer, dus op index vullen zou rijen door elkaar halen.
  const ids: string[] = [];
  for (let i = 0; i < ROSTER.length; i += 1) {
    const testId = await nameInputs.nth(i).getAttribute('data-testid');
    ids.push(testId!.replace('roster-naam-', ''));
    await nameInputs.nth(i).fill(ROSTER[i]![1]);
  }
  for (let i = 0; i < ROSTER.length; i += 1) {
    await page.getByTestId(`roster-nr-${ids[i]}`).fill(ROSTER[i]![0]);
  }
  // Opslaan is idempotent: bij een gemiste klik (smal scherm) opnieuw proberen.
  await expect(async () => {
    await page.getByTestId('roster-save').click();
    await expect(page.getByTestId('roster-save-success')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await page.reload();

  await page.getByTestId('nav-game').click();
  for (const nr of STARTERS) {
    const card = page.locator('.game-setup-card', { hasText: new RegExp(`#${nr} `) });
    await card.locator('[data-testid^="game-start-"]').click();
  }
  await expect(page.getByTestId('game-starters-info')).toContainText('5/5');
  await page.getByTestId('game-start-btn').click();
}

async function startCompactGame(page: Page, lang: Lang = 'nl'): Promise<void> {
  await startGame(page, lang, 'compact');
  await expect(page.getByTestId('compact-actions')).toBeVisible();
}

const dialog = (page: Page) => page.getByTestId('compact-dialog');

async function fillClock(page: Page, min: string, sec: string): Promise<void> {
  await page.getByTestId('compact-dialog-clock-min').fill(min);
  await page.getByTestId('compact-dialog-clock-sec').fill(sec);
}

async function fillScores(page: Page, own: string, opp: string): Promise<void> {
  await page.getByTestId('compact-dialog-score-for').fill(own);
  await page.getByTestId('compact-dialog-score-against').fill(opp);
}

/** Een speler (op naam) in het Eruit- of Erin-grid van een open dialoog. */
function pick(page: Page, side: 'out' | 'in', naam: string) {
  return dialog(page).locator(`[data-testid^="compact-swap-${side}-"]`, { hasText: naam });
}

async function swapPlayers(page: Page, outs: string[], ins: string[]): Promise<void> {
  for (const naam of outs) await pick(page, 'out', naam).click();
  for (const naam of ins) await pick(page, 'in', naam).click();
}

/** Wissel: Eruit/Erin kiezen, tijd en stand invullen, controleren en bevestigen. */
async function doSwap(
  page: Page,
  outs: string[],
  ins: string[],
  clock: [string, string],
  score: [string, string],
): Promise<void> {
  await page.getByTestId('compact-swap-open').click();
  await swapPlayers(page, outs, ins);
  await page.getByTestId('compact-swap-next').click();
  await fillScores(page, score[0], score[1]);
  await fillClock(page, clock[0], clock[1]);
  await page.getByTestId('compact-dialog-review').click();
  await page.getByTestId('compact-dialog-confirm').click();
  await expect(dialog(page)).toHaveCount(0);
}

/** Q1 t/m D uit het bouwplan, behalve het afsluiten van het kwart (stap D). */
async function playScenarioAtoC(page: Page): Promise<void> {
  // B: 2 turnovers, wissel 7 -> 12 bij 6:30, stand 8-6.
  await page.getByTestId('compact-turnover-plus').click();
  await page.getByTestId('compact-turnover-plus').click();
  await expect(page.getByTestId('compact-turnover-open')).toHaveText('2');
  await doSwap(page, ['Sam'], ['Noa'], ['6', '30'], ['8', '6']);
  // C: 1 turnover, wissel 4 -> 6 en 11 -> 15 samen bij 3:00, stand 12-10.
  await page.getByTestId('compact-turnover-plus').click();
  await doSwap(page, ['Alex', 'Kim'], ['Bo', 'Jules'], ['3', '00'], ['12', '10']);
}

async function openQuarterReview(page: Page, own: string, opp: string): Promise<void> {
  await page.getByTestId('compact-close-quarter').click();
  // Standaard het einde van het kwart (aftellend 0:00).
  await expect(page.getByTestId('compact-dialog-clock-min')).toHaveValue('0');
  await expect(page.getByTestId('compact-dialog-clock-sec')).toHaveValue('00');
  await fillScores(page, own, opp);
  await page.getByTestId('compact-dialog-review').click();
  await expect(dialog(page)).toHaveAttribute('data-step', 'review');
}

async function assertNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement.scrollWidth - window.innerWidth;
    const modal = document.querySelector<HTMLElement>('.modal');
    const modalOverflow = modal ? modal.scrollWidth - modal.clientWidth : 0;
    const rect = modal?.getBoundingClientRect();
    return {
      doc,
      modalOverflow,
      left: rect?.left ?? 0,
      right: rect ? rect.right - window.innerWidth : 0,
    };
  });
  expect(overflow.doc, 'pagina scrolt horizontaal').toBeLessThanOrEqual(1);
  expect(overflow.modalOverflow, 'dialoog scrolt horizontaal').toBeLessThanOrEqual(1);
  expect(overflow.left, 'dialoog valt links buiten beeld').toBeGreaterThanOrEqual(-1);
  expect(overflow.right, 'dialoog valt rechts buiten beeld').toBeLessThanOrEqual(1);
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.describe('Compact wedstrijdscherm: schakelaar', () => {
  test('standaard Klassiek; schakelen via het apparaatmenu; keuze blijft na herladen', async ({
    page,
  }) => {
    await startGame(page);
    // Standaard Klassiek.
    await expect(page.getByTestId('score-row-for')).toBeVisible();
    await expect(page.getByTestId('compact-actions')).toHaveCount(0);

    await openAccountMenu(page);
    await expect(page.getByTestId('game-screen-classic')).toBeChecked();
    await page.getByTestId('game-screen-compact').check();
    await expect(page.getByTestId('compact-actions')).toBeVisible();
    await expect(page.getByTestId('score-row-for')).toHaveCount(0);
    // De spelers staan er met nummer en naam.
    await expect(page.locator('[data-testid^="compact-player-"]')).toHaveCount(5);
    await expect(page.locator('[data-testid^="compact-player-"]').first()).toContainText('Alex');

    // Herladen: dezelfde wedstrijd in Compact, keuze bewaard op dit apparaat.
    await page.reload();
    await page.getByTestId('nav-game').click();
    await expect(page.getByTestId('compact-actions')).toBeVisible();
    expect(await page.evaluate((k) => window.localStorage.getItem(k), GAME_SCREEN_KEY)).toBe(
      'compact',
    );
    await openAccountMenu(page);
    await expect(page.getByTestId('game-screen-compact')).toBeChecked();

    // Terug naar Klassiek werkt ook, met dezelfde wedstrijd.
    await page.getByTestId('game-screen-classic').check();
    await expect(page.getByTestId('score-row-for')).toBeVisible();
  });
});

test.describe('Compact wedstrijdscherm: scenario A-D uit het bouwplan', () => {
  test('2 TO, wissel 7->12 bij 6:30 (8-6), 4->6 + 11->15 bij 3:00 (12-10), kwart sluiten bij 0:00 (16-12)', async ({
    page,
  }) => {
    await startCompactGame(page);
    // A: Q1 aftellend vanaf 10:00, stand 0-0.
    await expect(page.getByTestId('compact-period')).toContainText('1 van 4');
    await expect(page.getByTestId('compact-begin')).toContainText('10:00');
    await expect(page.getByTestId('compact-score-value-for')).toHaveText('0');
    await expect(page.getByTestId('compact-score-value-against')).toHaveText('0');

    await playScenarioAtoC(page);

    // Na B: lineup 4/9/11/13/12 volgens positie => 4/12/9/11/13; na C 6/12/9/15/13.
    const afterC = await readActiveGame(page);
    expect(nrsOf(afterC, afterC.onCourt)).toEqual(['6', '12', '9', '15', '13']);
    let segs = savedSegments(afterC);
    expect(segs).toHaveLength(2);
    expect(nrsOf(afterC, segs[0]!.lineup)).toEqual(['4', '7', '9', '11', '13']);
    expect(segs[0]).toMatchObject({ durSec: 210, pf: 8, pa: 6, tov: 2 });
    expect(nrsOf(afterC, segs[1]!.lineup)).toEqual(['4', '12', '9', '11', '13']);
    expect(segs[1]).toMatchObject({ durSec: 210, pf: 4, pa: 4, tov: 1 });
    await expect(page.getByTestId('compact-turnover-open')).toHaveText('0');
    await expect(page.getByTestId('compact-turnover-total')).toContainText('3');

    // D: sluit Q1 op 0:00, stand 16-12 (zelfde lineup houden: één tik op Bevestigen).
    await openQuarterReview(page, '16', '12');
    await page.getByTestId('compact-dialog-confirm').click();
    await expect(dialog(page)).toHaveCount(0);

    const afterD = await readActiveGame(page);
    segs = savedSegments(afterD);
    expect(segs).toHaveLength(3);
    expect(segs[2]).toMatchObject({ durSec: 180, pf: 4, pa: 2, tov: 0 });
    expect(segs.reduce((a, s) => a + s.durSec, 0)).toBe(600);
    expect(segs.reduce((a, s) => a + (s.pf - s.pa), 0)).toBe(4);
    expect(segs.reduce((a, s) => a + (s.tov ?? 0), 0)).toBe(3);
    // Rondt niet af: Kwart 2 start op 10:00 met dezelfde lineup.
    await expect(page.getByTestId('compact-period')).toContainText('2 van 4');
    await expect(page.getByTestId('compact-begin')).toContainText('10:00');
    await expect(page.getByTestId('compact-score-value-for')).toHaveText('16');
    await expect(page.getByTestId('compact-score-value-against')).toHaveText('12');
    expect(nrsOf(afterD, afterD.onCourt)).toEqual(['6', '12', '9', '15', '13']);

    // Segmentoverzicht: 210 s / 8-6 / +2 / TO 2, 210 s / 4-4 / 0 / TO 1, 180 s / 4-2 / +2 / TO 0.
    await page.getByTestId('compact-segments-toggle').click();
    const rows = page.locator('[data-testid^="compact-segment-stats-"]');
    await expect(rows).toHaveCount(3);
    const durs = page.locator('[data-testid^="compact-segment-dur-"]');
    await expect(durs).toHaveText(['3:30', '3:30', '3:00']);
    await expect(rows.nth(0)).toContainText('Punten 8–6');
    await expect(rows.nth(0)).toContainText('+2');
    await expect(rows.nth(0)).toContainText('TO 2');
    await expect(rows.nth(1)).toContainText('Punten 4–4');
    await expect(rows.nth(1)).toContainText('TO 1');
    await expect(rows.nth(2)).toContainText('Punten 4–2');
    await expect(rows.nth(2)).toContainText('+2');
    await expect(rows.nth(2)).toContainText('TO 0');
  });
});

test.describe('Compact wedstrijdscherm: kwart afsluiten met lineupkeuze', () => {
  test('met lineupwijziging 7->12: Q1 met de oude lineup, Q2 met de nieuwe, geen extra segment', async ({
    page,
  }) => {
    await startCompactGame(page);
    await openQuarterReview(page, '10', '8');

    // Controle toont de huidige vijf spelers (nr + naam) onder 'Lineup volgend kwart'.
    const section = page.getByTestId('compact-quarter-lineup');
    await expect(section).toContainText('Lineup volgend kwart');
    for (const [nr, naam] of ROSTER.filter(([n]) => STARTERS.includes(n))) {
      await expect(section).toContainText(`${nr}${naam}`);
    }
    await expect(page.getByTestId('compact-quarter-keep')).toHaveAttribute('aria-pressed', 'true');

    // Aanpassen en annuleren laat de keuze ongemoeid.
    await page.getByTestId('compact-quarter-adjust').click();
    await swapPlayers(page, ['Sam'], ['Noa']);
    await page.getByTestId('compact-quarter-lineup-cancel').click();
    await expect(dialog(page)).toHaveAttribute('data-step', 'review');
    await expect(page.getByTestId('compact-quarter-keep')).toHaveAttribute('aria-pressed', 'true');
    await expect(section).toContainText('7Sam');

    // Nu echt aanpassen en overnemen: de controle toont de nieuwe lineup vóór bevestigen.
    await page.getByTestId('compact-quarter-adjust').click();
    await swapPlayers(page, ['Sam'], ['Noa']);
    await page.getByTestId('compact-quarter-lineup-apply').click();
    await expect(section).toContainText('12Noa');
    await expect(section).not.toContainText('7Sam');
    expect(savedSegments(await readActiveGame(page))).toHaveLength(0);

    await page.getByTestId('compact-dialog-confirm').click();
    await expect(dialog(page)).toHaveCount(0);

    const game = await readActiveGame(page);
    const segs = savedSegments(game);
    expect(segs).toHaveLength(1);
    expect(nrsOf(game, segs[0]!.lineup)).toEqual(['4', '7', '9', '11', '13']);
    expect(segs[0]).toMatchObject({ durSec: 600, pf: 10, pa: 8 });
    expect(nrsOf(game, game.onCourt)).toEqual(['4', '12', '9', '11', '13']);
    expect(game.curQuarter).toBe(2);
    expect(game.beginSec).toBe(600);
    expect(game.pendingSwapLineup).toBeNull();
    await expect(page.getByTestId('compact-period')).toContainText('2 van 4');
    await expect(page.locator('[data-testid^="compact-player-"]')).toHaveCount(5);
    await expect(page.getByTestId('compact-court')).toContainText('Noa');
    await expect(page.getByTestId('compact-court')).not.toContainText('Sam');
  });

  test('zonder lineupwijziging: één tik op Bevestigen, lineup ongewijzigd', async ({ page }) => {
    await startCompactGame(page);
    await openQuarterReview(page, '6', '4');
    await page.getByTestId('compact-dialog-confirm').click();
    await expect(dialog(page)).toHaveCount(0);
    const game = await readActiveGame(page);
    expect(savedSegments(game)).toHaveLength(1);
    expect(nrsOf(game, game.onCourt)).toEqual(STARTERS);
    expect(game.curQuarter).toBe(2);
  });

  test('in het laatste kwart geen lineupkeuze en afsluiten rondt niet af', async ({ page }) => {
    await startCompactGame(page);
    // Q1 t/m Q3 afsluiten (stand blijft 0-0; 10 minuten per kwart).
    for (let q = 1; q <= 3; q += 1) {
      await openQuarterReview(page, '0', '0');
      await page.getByTestId('compact-dialog-confirm').click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.getByTestId('compact-period')).toContainText(`${q + 1} van 4`);
    }
    await page.getByTestId('compact-close-quarter').click();
    await expect(page.getByTestId('compact-quarter-note')).toContainText('niet afgerond');
    await fillClock(page, '5', '00');
    await page.getByTestId('compact-dialog-review').click();
    await expect(dialog(page)).toHaveAttribute('data-step', 'review');
    await expect(page.getByTestId('compact-quarter-lineup')).toHaveCount(0);
    await page.getByTestId('compact-dialog-confirm').click();
    await expect(dialog(page)).toHaveCount(0);
    // Nog steeds Kwart 4 in een lopende wedstrijd.
    await expect(page.getByTestId('compact-period')).toContainText('4 van 4');
    await expect(page.getByTestId('compact-finish-game')).toBeVisible();
  });
});

test.describe('Compact wedstrijdscherm: afronden', () => {
  test('afronden via de dialoog; Historie toont score, segmenten en turnovers + bevestiging', async ({
    page,
  }) => {
    await startCompactGame(page);
    await playScenarioAtoC(page);
    await openQuarterReview(page, '16', '12');
    await page.getByTestId('compact-dialog-confirm').click();
    await expect(dialog(page)).toHaveCount(0);

    await page.getByTestId('compact-finish-game').click();
    await expect(page.getByTestId('finish-dialog')).toBeVisible();
    await expect(page.getByTestId('finish-nothing-open')).toBeVisible();
    await page.getByTestId('finish-choose-without').click();

    await expect(page.getByTestId('history-back-btn')).toBeVisible();
    await expect(page.locator('.history-detail__meta')).toContainText('16 - 12');
    await expect(page.locator('.segment-item')).toHaveCount(3);
    await expect(page.getByTestId('history-turnovers-total')).toContainText('3');
    const segs = page.locator('.segment-item');
    await expect(segs.nth(0)).toContainText('Q1');
    await expect(segs.nth(0)).toContainText('3:30');
    await expect(segs.nth(0)).toContainText('+2');
    await expect(segs.nth(0)).toContainText('TO 2');
    await expect(segs.nth(1)).toContainText('3:30');
    await expect(segs.nth(1)).toContainText('TO 1');
    await expect(segs.nth(2)).toContainText('3:00');
    await expect(segs.nth(2)).toContainText('+2');

    // Korte bevestiging: lokale opslag, en (lokale modus) geen cloudclaim.
    await expect(page.getByTestId('history-finished-notice-local')).toHaveText(
      'Wedstrijd afgerond en lokaal op dit apparaat opgeslagen.',
    );
    await expect(page.getByTestId('history-finished-notice-cloud')).toHaveCount(0);

    // De bevestiging verdwijnt zodra je de wedstrijd sluit.
    await page.getByTestId('history-back-btn').click();
    await page.locator('[data-testid^="history-item-"]').first().click();
    await expect(page.getByTestId('history-finished-notice')).toHaveCount(0);
  });

  test('een opslagfout blijft bij de afrondactie zichtbaar; opnieuw proberen rondt één keer af', async ({
    page,
  }) => {
    await startCompactGame(page);
    await page.getByTestId('compact-turnover-plus').click();
    await doSwap(page, ['Sam'], ['Noa'], ['5', '00'], ['2', '0']);

    await page.getByTestId('compact-finish-game').click();
    await expect(page.getByTestId('finish-dialog')).toBeVisible();

    // Opslag van afgeronde wedstrijden laten falen (quota).
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (window as unknown as { __restoreSetItem: () => void }).__restoreSetItem = () => {
        Storage.prototype.setItem = original;
      };
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key.includes('completed-games')) throw new DOMException('quota', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    await page.getByTestId('finish-choose-without').click();
    await expect(page.getByTestId('finish-save-error')).toBeVisible();
    await expect(page.getByTestId('finish-save-error')).toContainText('Afronden is niet gelukt');
    // De dialoog blijft open, we blijven op het wedstrijdscherm.
    await expect(page.getByTestId('finish-dialog')).toBeVisible();
    await expect(page.getByTestId('history-back-btn')).toHaveCount(0);

    // Herstel de opslag en probeer opnieuw.
    await page.evaluate(() =>
      (window as unknown as { __restoreSetItem: () => void }).__restoreSetItem(),
    );
    await page.getByTestId('finish-choose-without').click();
    await expect(page.getByTestId('history-back-btn')).toBeVisible();
    await expect(page.getByTestId('history-finished-notice')).toBeVisible();

    // Precies één afgeronde wedstrijd.
    const completed = await page.evaluate(() => {
      const key = Object.keys(window.localStorage).find((k) => k.includes('completed-games'));
      return key ? (JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown[]).length : -1;
    });
    expect(completed).toBe(1);
  });
});

test.describe('Compact wedstrijdscherm: smalle schermen', () => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
  ]) {
    test(`geen horizontale scroll op ${viewport.width}x${viewport.height} (hoofdscherm en dialogen)`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await startCompactGame(page);
      await assertNoHorizontalScroll(page);

      // Wissel: selectiestap, invoerstap, controle.
      await page.getByTestId('compact-swap-open').click();
      await assertNoHorizontalScroll(page);
      await swapPlayers(page, ['Sam', 'Alex'], ['Noa', 'Bo']);
      await page.getByTestId('compact-swap-next').click();
      await assertNoHorizontalScroll(page);
      await fillClock(page, '8', '00');
      await page.getByTestId('compact-dialog-review').click();
      await expect(dialog(page)).toHaveAttribute('data-step', 'review');
      await assertNoHorizontalScroll(page);
      await page.getByTestId('compact-dialog-cancel').click();

      // Segment opslaan.
      await page.getByTestId('compact-save-segment').click();
      await assertNoHorizontalScroll(page);
      await page.getByTestId('compact-dialog-cancel').click();

      // Kwart afsluiten: controle met lineupkeuze en de lineup-aanpassing.
      await openQuarterReview(page, '0', '0');
      await assertNoHorizontalScroll(page);
      await page.getByTestId('compact-quarter-adjust').click();
      await assertNoHorizontalScroll(page);
      await page.getByTestId('compact-quarter-lineup-cancel').click();
      await page.getByTestId('compact-dialog-cancel').click();

      // Afrondkeuze (afronden vraagt minstens één vastgelegd segment).
      await doSwap(page, ['Sam'], ['Noa'], ['8', '00'], ['2', '0']);
      await page.getByTestId('compact-finish-game').click();
      await expect(page.getByTestId('finish-dialog')).toBeVisible();
      await assertNoHorizontalScroll(page);
    });
  }
});

test.describe('Compact wedstrijdscherm: toegankelijkheid (axe)', () => {
  for (const lang of ['nl', 'en'] as const) {
    test(`hoofdscherm en dialogen (${lang})`, async ({ page }) => {
      await startCompactGame(page, lang);
      await expectNoAxeViolations(page);

      await page.getByTestId('compact-swap-open').click();
      await expect(dialog(page)).toBeVisible();
      await expectNoAxeViolations(page);
      await page.getByTestId('compact-dialog-cancel').click();

      await openQuarterReview(page, '0', '0');
      await expectNoAxeViolations(page);
      await page.getByTestId('compact-quarter-adjust').click();
      await expectNoAxeViolations(page);
      await page.getByTestId('compact-quarter-lineup-cancel').click();
      await page.getByTestId('compact-dialog-cancel').click();

      await doSwap(page, ['Sam'], ['Noa'], ['8', '00'], ['2', '0']);
      await page.getByTestId('compact-finish-game').click();
      await expect(page.getByTestId('finish-dialog')).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }
});

test.describe('Compact wedstrijdscherm: Escape, bevestigen en lege klokvelden', () => {
  test('Escape zonder invoer sluit direct; met invoer vraagt het eerst bevestiging', async ({
    page,
  }) => {
    await startCompactGame(page);
    await page.getByTestId('compact-save-segment').click();
    await expect(dialog(page)).toBeVisible();
    // Zonder invoer: geen bevestiging, direct dicht.
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);

    await page.getByTestId('compact-save-segment').click();
    await page.getByTestId('compact-dialog-score-for').fill('4');
    const messages: string[] = [];
    page.once('dialog', (d) => {
      messages.push(d.message());
      void d.dismiss();
    });
    await page.keyboard.press('Escape');
    // Geweigerd: het venster en de invoer blijven.
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toContain('Je invoer gaat verloren');
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByTestId('compact-dialog-score-for')).toHaveValue('4');

    page.once('dialog', (d) => void d.accept());
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    // Niets vastgelegd en de stand is niet veranderd.
    expect(savedSegments(await readActiveGame(page))).toHaveLength(0);
    await expect(page.getByTestId('compact-score-value-for')).toHaveText('0');
  });

  test('lege klokvelden geven een melding en leggen niets vast (Segment opslaan en Wisselen)', async ({
    page,
  }) => {
    await startCompactGame(page);
    const before = (await readActiveGame(page)).actions.length;

    // Segment opslaan: de klokvelden zijn bij openen leeg.
    await page.getByTestId('compact-save-segment').click();
    await expect(page.getByTestId('compact-dialog-clock-min')).toHaveValue('');
    await expect(page.getByTestId('compact-dialog-clock-sec')).toHaveValue('');
    await fillScores(page, '2', '0');
    await page.getByTestId('compact-dialog-review').click();
    await expect(page.getByTestId('compact-dialog-error')).toContainText(
      'Vul zowel minuten als seconden in.',
    );
    await expect(dialog(page)).toHaveAttribute('data-step', 'time');
    // Alleen minuten ingevuld is ook leeg.
    await page.getByTestId('compact-dialog-clock-min').fill('8');
    await page.getByTestId('compact-dialog-review').click();
    await expect(page.getByTestId('compact-dialog-error')).toContainText('minuten als seconden');
    await page.getByTestId('compact-dialog-cancel').click();

    // Wisselen: zelfde gedrag.
    await page.getByTestId('compact-swap-open').click();
    await swapPlayers(page, ['Sam'], ['Noa']);
    await page.getByTestId('compact-swap-next').click();
    await page.getByTestId('compact-dialog-review').click();
    await expect(page.getByTestId('compact-dialog-error')).toBeVisible();
    await page.getByTestId('compact-dialog-cancel').click();

    const after = await readActiveGame(page);
    expect(after.actions.length).toBe(before);
    expect(after.pendingSwapLineup).toBeNull();
    expect(nrsOf(after, after.onCourt)).toEqual(STARTERS);
    await expect(page.getByTestId('compact-score-value-for')).toHaveText('0');
  });

  test('meldingen zijn ook in het Engels zichtbaar (lege klok)', async ({ page }) => {
    await startCompactGame(page, 'en');
    await page.getByTestId('compact-save-segment').click();
    await fillScores(page, '2', '0');
    await page.getByTestId('compact-dialog-review').click();
    await expect(page.getByTestId('compact-dialog-error')).toContainText(
      'Fill in both minutes and seconds.',
    );
  });
});
