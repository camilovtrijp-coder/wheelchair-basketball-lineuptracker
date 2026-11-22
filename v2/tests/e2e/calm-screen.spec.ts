// Rustig wedstrijdscherm (bouwplan wedstrijdscherm-rustig R2): browsertests tegen de
// Firebase-emulator (lokale modus via `./fixtures`, zoals de rest van de suite).
// Fictieve spelers: #4 Alex, #7 Sam, #9 Robin, #11 Kim, #13 Dani; bank #6 Bo,
// #12 Noa, #15 Jules. De CI draait deze spec; lokaal is de emulator nodig.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

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

interface StoredSegment {
  id: string;
  lineup: string[];
  beginSec: number;
  endSec: number;
  durSec: number;
  pf: number;
  pa: number;
}
interface StoredAction {
  type: string;
  segment?: StoredSegment;
  segmentId?: string;
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

/** Vastgelegde segmenten van de actielog, zonder de verwijderde (zoals de afleiding in de app). */
function liveSegments(game: StoredGame): StoredSegment[] {
  const deleted = new Set(
    game.actions.filter((a) => a.type === 'segment-deleted').map((a) => a.segmentId),
  );
  const saved: StoredSegment[] = [];
  for (const a of game.actions) {
    if (a.type === 'segment-saved' && a.segment != null && !deleted.has(a.segment.id)) {
      saved.push(a.segment);
    }
  }
  // Bijgestelde tijden (segment-edited) vervangen het opgeslagen segment.
  return saved.map((s) => {
    const edits = game.actions.filter((a) => a.type === 'segment-edited' && a.segment?.id === s.id);
    return edits.length > 0 ? edits[edits.length - 1]!.segment! : s;
  });
}

function nrsOf(game: StoredGame, ids: string[]): string[] {
  return ids.map((id) => game.players.find((p) => p.id === id)?.nr ?? '?');
}

/** Zet het roster op, kiest #4/#7/#9/#11/#13 als starters en start de wedstrijd (scherm: Rustig). */
async function startGame(page: Page, lang: Lang = 'nl'): Promise<void> {
  await page.addInitScript(
    ({ l, s, key }) => {
      window.localStorage.setItem('lineup-tracker-lang', l);
      window.localStorage.setItem(key, s);
    },
    { l: lang, s: 'calm', key: GAME_SCREEN_KEY },
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

async function startCalmGame(page: Page, lang: Lang = 'nl'): Promise<void> {
  await startGame(page, lang);
  // Zonder segment opent Rustig op het wisselschema (besluit 8): naar Wedstrijd.
  await expect(page.getByTestId('calm-view-plan')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('calm-view-game').click();
  await expect(page.getByTestId('calm-court')).toBeVisible();
}

/** Tik een vloerspeler (op naam) en een bankspeler (op naam) aan. */
async function pickSwap(page: Page, out: string, inn: string): Promise<void> {
  await page.getByTestId('calm-court').locator('.calm-chip', { hasText: out }).click();
  await page.getByTestId('calm-bench').locator('.calm-chip', { hasText: inn }).click();
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.describe('Rustig wedstrijdscherm', () => {
  test('hoofdflow: wissel uitvoeren, tijd bevestigen, tweede wissel', async ({ page }) => {
    await startCalmGame(page);
    await page.getByTestId('calm-score-plus-for-2').click();
    await page.getByTestId('calm-turnover-plus').click();

    // Eerst wisselen: één tik op Wissel uitvoeren legt het segment direct vast (geschatte tijd 9:00).
    await pickSwap(page, 'Sam', 'Noa');
    await expect(page.getByTestId('calm-slot-pending')).toBeVisible();
    await page.getByTestId('calm-swap-run').click();
    // De tijdkaart staat direct in het vaste vak (eerst wisselen, tijd achteraf); de
    // melding volgt pas in de rustige stand, na het bevestigen.
    await expect(page.getByTestId('calm-time-count')).toHaveText('1 tijd nog bevestigen');
    await expect(page.getByTestId('calm-slot-notice')).toHaveCount(0);
    let game = await readActiveGame(page);
    let segs = liveSegments(game);
    expect(segs).toHaveLength(1);
    expect([segs[0]!.beginSec, segs[0]!.endSec, segs[0]!.pf]).toEqual([600, 540, 2]);
    expect(nrsOf(game, segs[0]!.lineup)).toEqual(STARTERS);

    // Tijd achteraf bijstellen: −10s (eerder) = 9:10, Klopt.
    await page.getByTestId('calm-time-earlier').click();
    await expect(page.getByTestId('calm-time-input')).toHaveValue('9:10');
    await page.getByTestId('calm-time-ok').click();
    // Daarna kort de melding in het vak; een tik sluit hem.
    await expect(page.getByTestId('calm-slot').getByTestId('calm-notice-text')).toContainText(
      'vastgelegd',
    );
    await page.getByTestId('calm-slot-notice').click();
    await expect(page.getByTestId('calm-slot-idle')).toBeVisible();
    game = await readActiveGame(page);
    segs = liveSegments(game);
    expect([segs[0]!.endSec, game.beginSec]).toEqual([550, 550]);

    // Tweede wissel: nieuw segment; Ongedaan maken bestaat niet meer in Rustig (R9).
    await pickSwap(page, 'Robin', 'Bo');
    await page.getByTestId('calm-swap-run').click();
    await expect(page.getByTestId('calm-segments-btn')).toHaveText('Segmenten (2)');
    await expect(page.getByTestId('calm-undo')).toHaveCount(0);
    game = await readActiveGame(page);
    expect(game.beginSec).toBeLessThan(550);
    expect(nrsOf(game, game.onCourt)).toEqual(['4', '12', '6', '11', '13']);
  });

  test('scorebediening: −1, turnover per segment en de scorekeuzelijst', async ({ page }) => {
    await startCalmGame(page);
    await expect(page.getByTestId('calm-strip-title')).toHaveText(/Q1$/);
    await expect(page.getByTestId('calm-score-minus-for')).toBeDisabled();
    await page.getByTestId('calm-score-plus-for-3').click();
    await page.getByTestId('calm-score-minus-for').click();
    await expect(page.getByTestId('calm-score-value-for')).toHaveText('2');
    await expect(page.getByTestId('calm-segline-for')).toContainText('+2');

    await expect(page.getByTestId('calm-turnover-minus')).toBeDisabled();
    await page.getByTestId('calm-turnover-plus').click();
    await expect(page.getByTestId('calm-turnover-count')).toHaveText('1');
    await page.getByTestId('calm-turnover-minus').click();
    await expect(page.getByTestId('calm-turnover-count')).toHaveText('0');

    // Keuzelijst: opent met de huidige score in beeld, kiezen zet de score, Escape sluit.
    await page.getByTestId('calm-score-value-against').click();
    await expect(page.getByTestId('calm-score-option-0')).toBeFocused();
    await page.getByTestId('calm-score-option-48').scrollIntoViewIfNeeded();
    await page.getByTestId('calm-score-option-48').click();
    await expect(page.getByTestId('calm-score-value-against')).toHaveText('48');
    await expect(page.getByTestId('calm-score-picker')).toHaveCount(0);
    await expect(page.getByTestId('calm-score-value-against')).toBeFocused();
    await page.getByTestId('calm-score-value-for').click();
    await expect(page.getByTestId('calm-score-option-2')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('calm-score-picker')).toHaveCount(0);
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflowX, 'pagina scrolt horizontaal').toBeLessThanOrEqual(1);
  });

  test('Einde kwart vraagt eerst de open tijden; Klopt allemaal gaat door', async ({ page }) => {
    await startCalmGame(page);
    await pickSwap(page, 'Sam', 'Noa');
    await page.getByTestId('calm-swap-run').click();
    await page.getByTestId('calm-end-quarter').click();
    await expect(page.getByTestId('calm-confirm-sheet')).toBeVisible();
    await page.getByTestId('calm-confirm-all').click();
    await expect(page.getByTestId('quick-time-sheet')).toBeVisible();
    await page.getByTestId('quick-time-confirm').click();
    await expect(page.getByTestId('calm-strip-title')).toContainText('10:00');
    const game = await readActiveGame(page);
    expect(game.curQuarter).toBe(2);
  });

  test('open tijden blijven staan na herladen', async ({ page }) => {
    await startCalmGame(page);
    await pickSwap(page, 'Sam', 'Noa');
    await page.getByTestId('calm-swap-run').click();
    await expect(page.getByTestId('calm-time-count')).toBeVisible();
    await page.reload();
    // De app opent na herladen (nog) niet altijd op de Wedstrijd-tab (dat regelt R6);
    // daarom eerst naar de tab. Binnen Rustig opent de Wedstrijd-weergave (er is een segment).
    await page.getByTestId('nav-game').click();
    await expect(page.getByTestId('calm-view-game')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('calm-time-count')).toHaveText('1 tijd nog bevestigen');
  });

  test('alles op één scherm op een telefoon van 400x800, zonder horizontale scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await startCalmGame(page);
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflowX, 'pagina scrolt horizontaal').toBeLessThanOrEqual(1);
    // De onderbalk (Segmenten / Einde kwart) staat zonder scrollen in beeld.
    const box = await page.getByTestId('calm-end-quarter').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height, 'onderbalk valt buiten beeld').toBeLessThanOrEqual(800);
  });

  test('toegankelijk (axe) en Engelse teksten', async ({ page }) => {
    await startCalmGame(page, 'en');
    await expect(page.getByTestId('calm-undo')).toHaveCount(0);
    await expect(page.getByTestId('calm-segline')).toContainText('This segment');
    await expect(page.getByTestId('calm-segments-btn')).toHaveText('Segments (0)');
    await pickSwap(page, 'Sam', 'Noa');
    await expect(page.getByTestId('calm-swap-run')).toHaveText('Make substitution');
    await expectNoAxeViolations(page);
  });

  test('R9: −1 met witte tekst en axe-contrast in donker en licht', async ({ page }) => {
    for (const theme of ['dark', 'light'] as const) {
      await page.addInitScript(
        (t) => window.localStorage.setItem('lineup-tracker-v2-theme', t),
        theme,
      );
      if (theme === 'dark') {
        await startCalmGame(page);
      } else {
        await page.reload();
        const view = page.getByTestId('calm-view-game');
        if ((await view.getAttribute('aria-pressed')) !== 'true') await view.click();
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.getByTestId('calm-score-plus-for-2').click();
      await page.getByTestId('calm-turnover-plus').click();
      for (const id of [
        'calm-score-minus-for',
        'calm-score-minus-against',
        'calm-turnover-minus',
      ]) {
        // Wit, ook als de knop uit staat (tegenstander op 0).
        await expect(page.getByTestId(id)).toHaveCSS('color', 'rgb(255, 255, 255)');
      }
      await expectNoAxeViolations(page);
    }
  });
});
