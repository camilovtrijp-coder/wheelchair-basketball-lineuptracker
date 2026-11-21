// Rustig wedstrijdscherm (Rustig-bouwplan R2): hoofdflow in de browser tegen de
// Firebase-emulator (lokale modus via `./fixtures`, zoals de rest van de suite).
// Fictieve spelers: #4 Alex, #7 Sam, #9 Robin, #11 Kim, #13 Dani; bank #6 Bo,
// #12 Noa, #15 Jules. Telefoonformaat ~400×800: alles zonder scrollen.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const ACTIVE_GAME_KEY = 'lineup-tracker-v2-active-game:org-rotterdam:team-u23';
const GAME_SCREEN_KEY = 'lineup-tracker-v2-game-screen';
const SWAP_FLOW_KEY = 'lineup-tracker-v2-swap-flow';
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

interface StoredAction {
  type: string;
  segment?: { lineup: string[]; beginSec: number; endSec: number; pf: number; pa: number };
}
interface StoredGame {
  actions: StoredAction[];
  onCourt: string[];
  curQuarter: number;
  beginSec: number;
  players: Array<{ id: string; nr: string; naam: string }>;
}

async function readActiveGame(page: Page): Promise<StoredGame> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), ACTIVE_GAME_KEY);
  return JSON.parse(raw ?? 'null') as StoredGame;
}

function nrsOf(game: StoredGame, ids: string[]): string[] {
  return ids.map((id) => game.players.find((p) => p.id === id)?.nr ?? '?');
}

/** Roster opzetten, starters kiezen en de wedstrijd starten met het Rustig-scherm. */
async function startCalmGame(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key }) => {
      window.localStorage.setItem('lineup-tracker-lang', 'nl');
      window.localStorage.setItem(key, 'calm');
    },
    { key: GAME_SCREEN_KEY },
  );
  await page.goto('/');
  await page.getByTestId('nav-roster').click();
  for (let i = 0; i < ROSTER.length; i += 1) {
    await page.getByTestId('roster-add').click();
  }
  const nameInputs = page.locator('[data-testid^="roster-naam-"]');
  await expect(nameInputs).toHaveCount(ROSTER.length);
  const ids: string[] = [];
  for (let i = 0; i < ROSTER.length; i += 1) {
    const testId = await nameInputs.nth(i).getAttribute('data-testid');
    ids.push(testId!.replace('roster-naam-', ''));
    await nameInputs.nth(i).fill(ROSTER[i]![1]);
  }
  for (let i = 0; i < ROSTER.length; i += 1) {
    await page.getByTestId(`roster-nr-${ids[i]}`).fill(ROSTER[i]![0]);
  }
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

/** Positie van het vaste slot t.o.v. de pagina (onafhankelijk van scrollen). */
async function slotBox(page: Page): Promise<{ top: number; height: number }> {
  return page.getByTestId('calm-slot').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top + window.scrollY), height: Math.round(r.height) };
  });
}

/** Speler op naam in het Rustig-scherm (vloer of bank). */
function chip(page: Page, naam: string) {
  return page.locator('.calm-chip', { hasText: naam });
}

test.describe('Rustig wedstrijdscherm', () => {
  test('hoofdflow: wissel met tijd achteraf, ongedaan maken, einde kwart en herladen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await startCalmGame(page);

    // Zonder segment opent Rustig op het wisselschema (besluit 8).
    await expect(page.getByTestId('calm-view-plan')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('calm-view-game').click();
    await expect(page.getByTestId('calm-strip-since')).toHaveText('Huidige vijf · sinds 10:00');

    // Eén scherm: vanaf de stand tot en met de bottombar past zonder te scrollen.
    const top = await page.getByTestId('calm-score').boundingBox();
    const bottom = await page.getByTestId('calm-bottombar').boundingBox();
    expect(top).not.toBeNull();
    expect(bottom).not.toBeNull();
    expect(bottom!.y + bottom!.height - top!.y).toBeLessThanOrEqual(800);
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflowX).toBe(false);

    // Score en wissel: Bo komt in voor Alex; meteen vastgelegd met geschatte tijd 9:00.
    await page.getByTestId('calm-score-plus-for-2').click();
    const slotBefore = await slotBox(page);
    await chip(page, 'Alex').click();
    await expect(page.getByTestId('calm-help-title')).toHaveText('Wie komt erin voor #4 Alex?');
    await chip(page, 'Bo').click();
    await page.getByTestId('calm-swap-run').click();
    await expect(page.getByTestId('calm-notice-text')).toHaveText(
      'Wissel vastgelegd · In: Bo · Uit: Alex',
    );
    await expect(page.getByTestId('calm-time-line')).toContainText('Om 9:00 (geschat)');
    // Het slot verspringt niet tussen hulp- en tijdkaart.
    const slotAfter = await slotBox(page);
    expect(slotAfter).toEqual(slotBefore);
    await page.screenshot({ path: test.info().outputPath('rustig-tijdkaart.png') });

    let game = await readActiveGame(page);
    const saved = game.actions.filter((a) => a.type === 'segment-saved');
    expect(saved).toHaveLength(1);
    expect(nrsOf(game, saved[0]!.segment!.lineup)).toEqual(STARTERS);
    expect(saved[0]!.segment!.pf).toBe(2);

    // Tijd bijstellen: typen en "Klopt".
    await page.getByTestId('calm-time-input').fill('8:40');
    await page.getByTestId('calm-time-confirm').click();
    await expect(page.getByTestId('calm-notice-text')).toHaveText('Tijd bevestigd: 8:40');
    await expect(page.getByTestId('calm-strip-since')).toHaveText('Huidige vijf · sinds 8:40');
    game = await readActiveGame(page);
    expect(game.beginSec).toBe(520);

    // Ongedaan maken van de laatste score.
    await page.getByTestId('calm-score-plus-against-3').click();
    await page.getByTestId('calm-undo').click();
    await expect(page.getByTestId('calm-notice-text')).toHaveText(
      '+3 voor Tegenstander teruggedraaid',
    );
    await expect(page.getByTestId('calm-undo')).toBeDisabled();

    // Nog een wissel zonder bevestiging: Einde kwart vraagt eerst de open tijd.
    await chip(page, 'Sam').click();
    await chip(page, 'Noa').click();
    await page.getByTestId('calm-swap-run').click();
    await page.getByTestId('calm-time-later').click();
    await expect(page.getByTestId('calm-open-times')).toHaveText('1 tijd nog bevestigen');

    // Herladen: de open tijd blijft staan.
    await page.reload();
    // Na herladen opent de app nog op een ander tabblad (bouwplan R6, buiten scope).
    await page.getByTestId('nav-game').click();
    await expect(page.getByTestId('calm-view-game')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('calm-time-line')).toContainText('Om 7:40 (geschat)');
    const flow = await page.evaluate((key) => window.localStorage.getItem(key), SWAP_FLOW_KEY);
    expect(flow).toContain('segmentIds');

    await page.getByTestId('calm-end-period').click();
    await expect(page.getByTestId('calm-end-check')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
    await page.getByTestId('calm-end-check-all').click();
    await page.getByTestId('quick-time-confirm').click();
    game = await readActiveGame(page);
    expect(game.curQuarter).toBe(2);
    expect(game.actions.filter((a) => a.type === 'segment-saved')).toHaveLength(3);
    await expect(page.getByTestId('calm-segments')).toHaveText('Segmenten (3)');
  });

  test('hoofdscherm zonder axe-schendingen', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await startCalmGame(page);
    await page.getByTestId('calm-view-game').click();
    await chip(page, 'Alex').click();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
