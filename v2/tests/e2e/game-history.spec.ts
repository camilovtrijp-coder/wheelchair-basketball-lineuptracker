import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const ACTIVE_GAME_KEY = 'lineup-tracker-v2-active-game:org-rotterdam:team-u23';
const COMPLETED_GAMES_KEY = 'lineup-tracker-v2-completed-games:org-rotterdam:team-u23';

async function readJson(page: Page, key: string): Promise<unknown> {
  const raw = await page.evaluate((k) => window.localStorage.getItem(k), key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { __corrupt: raw };
  }
}

/** Zie game-tracking.spec.ts `startTrackedGame()` — zelfde opzet, hergebruikt
 * hier zodat elke test meteen op het live-scherm begint. */
async function startTrackedGame(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
  await page.goto('/');
  await page.getByTestId('nav-roster').click();
  for (let i = 0; i < 5; i += 1) {
    await page.getByTestId('roster-add').click();
  }
  const names = page.locator('[data-testid^="roster-naam-"]');
  await expect(names).toHaveCount(5);
  for (let i = 0; i < 5; i += 1) {
    await names.nth(i).fill(`Speler ${i + 1}`);
  }
  await page.getByTestId('roster-save').click();
  await page.reload();

  await page.getByTestId('nav-game').click();
  await page.getByTestId('game-start-btn').click();
  await expect(page.getByTestId('score-row-for')).toBeVisible();
}

test.describe('v2 afronden, historie en export (PR 6.3)', () => {
  test('Afronden is uitgeschakeld zonder segmenten', async ({ page }) => {
    await startTrackedGame(page);
    await expect(page.getByTestId('finish-game-btn')).toBeDisabled();
  });

  test('afronden slaat de wedstrijd op, reset het live-scherm en opent de historie', async ({
    page,
  }) => {
    await startTrackedGame(page);
    await page.getByTestId('score-plus3-for').click();
    await page.getByTestId('score-plus1-against').click();
    await page.getByTestId('end-min').selectOption('5');
    await page.getByTestId('save-segment-btn').click();
    await expect(page.locator('[data-testid^="segment-item-"]')).toHaveCount(1);

    await expect(page.getByTestId('finish-game-btn')).toBeEnabled();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('finish-game-btn').click();

    // Historie-tab wordt automatisch geopend met de net afgeronde wedstrijd (v1-pariteit).
    await expect(page.getByTestId('history-back-btn')).toBeVisible();
    await expect(page.locator('[data-testid^="history-segment-"]')).toHaveCount(1);

    const completed = (await readJson(page, COMPLETED_GAMES_KEY)) as Array<{
      id: string;
      scoreFor: number;
      scoreAgainst: number;
      segments: unknown[];
    }>;
    expect(completed).toHaveLength(1);
    const [first] = completed;
    expect(first?.scoreFor).toBe(3);
    expect(first?.scoreAgainst).toBe(1);
    expect(first?.segments).toHaveLength(1);

    // De actieve wedstrijd is gereset naar een verse opzet (v1: freshState()).
    const active = (await readJson(page, ACTIVE_GAME_KEY)) as { phase: string; actions: unknown[] };
    expect(active?.phase).toBe('setup');
    expect(active?.actions).toEqual([]);

    await page.getByTestId('history-back-btn').click();
    await expect(page.getByTestId('history-list')).toBeVisible();
    await expect(page.locator('[data-testid^="history-item-"]')).toHaveCount(1);
  });

  test('historie toont de leeg-state zonder afgeronde wedstrijden', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
    await page.goto('/');
    await page.getByTestId('nav-history').click();
    await expect(page.getByTestId('history-empty')).toBeVisible();
  });

  test('CSV-export downloadt een bestand voor de afgeronde wedstrijd', async ({ page }) => {
    await startTrackedGame(page);
    await page.getByTestId('score-plus2-for').click();
    await page.getByTestId('end-min').selectOption('5');
    await page.getByTestId('save-segment-btn').click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('finish-game-btn').click();
    await expect(page.getByTestId('history-back-btn')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('history-export-btn').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^.+-\d{8}-\d{4}\.csv$/);
  });

  test('een afgeronde wedstrijd verwijderen haalt hem uit de lijst', async ({ page }) => {
    await startTrackedGame(page);
    await page.getByTestId('score-plus2-for').click();
    await page.getByTestId('end-min').selectOption('5');
    await page.getByTestId('save-segment-btn').click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('finish-game-btn').click();
    await expect(page.getByTestId('history-back-btn')).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('history-delete-btn').click();

    await expect(page.getByTestId('history-empty')).toBeVisible();
    const completed = await readJson(page, COMPLETED_GAMES_KEY);
    expect(completed).toEqual([]);
  });
});
