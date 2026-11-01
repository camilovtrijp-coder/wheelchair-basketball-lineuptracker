import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { openTrendsFilters } from './trendsFilters';

// H1: het gedeelde wedstrijdfilter ("Deze wedstrijd" courtside) blijft na het
// afronden naar de afgeronde wedstrijd wijzen, in Trends én Statistieken.
// Fictieve data; lokale modus (zie `fixtures.ts`).

async function startTrackedGameWithSegment(page: Page): Promise<void> {
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
  await page.getByTestId('score-plus3-for').click();
  await page.getByTestId('score-plus1-against').click();
  await page.getByTestId('end-min').selectOption('5');
  await page.getByTestId('save-segment-btn').click();
  await expect(page.locator('[data-testid^="segment-item-"]')).toHaveCount(1);
}

test.describe('Trends en Statistieken: wedstrijdfilter na afronden (H1)', () => {
  test('"Deze wedstrijd" kiezen, afronden: de afgeronde wedstrijd blijft zichtbaar', async ({
    page,
  }) => {
    await startTrackedGameWithSegment(page);

    // Courtside: alleen de lopende wedstrijd kiezen.
    await page.getByTestId('nav-trends').click();
    await openTrendsFilters(page);
    await page.getByTestId('trends-quick-current').click();
    await expect(page.getByTestId('trends-games-btn')).toHaveText('Wedstrijden (1)');

    // Afronden (nieuwe id voor de afgeronde wedstrijd).
    await page.getByTestId('nav-game').click();
    await page.getByTestId('finish-game-btn').click();
    // Afronden loopt altijd via de afrondkeuze (geen window.confirm meer).
    await page.getByTestId('finish-choose-without').click();
    await expect(page.getByTestId('history-back-btn')).toBeVisible();

    // Trends: nog steeds 1 wedstrijd, niet 0, en geen lege staat.
    await page.getByTestId('nav-trends').click();
    await openTrendsFilters(page);
    await expect(page.getByTestId('trends-games-btn')).toHaveText('Wedstrijden (1)');
    await expect(page.getByTestId('trends-team-meta')).toContainText('1 wedstrijd');
    await expect(page.getByTestId('trends-team-meta')).not.toContainText('0 wedstrijden');
    await expect(page.getByTestId('trends-no-data')).toHaveCount(0);

    // Statistieken: hetzelfde gedeelde filter, met lineups.
    await page.getByTestId('nav-stats').click();
    await expect(page.getByTestId('stats-games-btn')).toContainText('(1)');
    await expect(page.getByTestId('stats-no-combos')).toHaveCount(0);
    await expect(page.getByTestId('stats-no-data')).toHaveCount(0);
    await expect(page.getByTestId('stats-list')).toBeVisible();
  });
});
