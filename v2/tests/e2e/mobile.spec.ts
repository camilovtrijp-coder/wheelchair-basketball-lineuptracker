import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

// Zelfde iPhone-14-viewport als de v1-mobiele-suite (tests/mobile-lang.spec.js),
// voor consistentie tussen v1- en v2-mobiele tests.
const MOBILE_VIEWPORT = { width: 390, height: 844 };

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
  expect(overflow, 'pagina heeft horizontale overflow op mobiele viewport').toBeLessThanOrEqual(1);
}

async function waitForServiceWorkerController(page: Page): Promise<void> {
  await expect(async () => {
    const regCount = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return -1;
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? 1 : 0;
    });
    expect(regCount).toBe(1);
  }).toPass({ timeout: 20_000, intervals: [250, 500, 1000] });

  const hasController = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  if (!hasController) {
    await page.reload();
  }

  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      timeout: 15_000,
      intervals: [250, 500],
    })
    .toBe(true);
}

test.describe('v2 mobiele viewport', () => {
  test('settings- en teamflow werkt op een mobiele viewport (NL)', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/');
    await assertNoHorizontalOverflow(page);

    await expect(page.getByTestId('nav-settings')).toBeVisible();
    await expect(page.getByTestId('nav-roster')).toBeVisible();

    await page.getByTestId('settings-teamName').fill('Mobiel Team');
    await page.getByTestId('settings-save').click();
    await assertNoHorizontalOverflow(page);

    await page.getByTestId('nav-roster').click();
    await assertNoHorizontalOverflow(page);
    await page.getByTestId('roster-add').click();
    await page.locator('[data-testid^="roster-naam-"]').first().fill('Mobiele Speler');
    await page.getByTestId('roster-save').click();

    await expect(page.getByTestId('roster-save')).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test('NL/EN-wissel op mobiele viewport toont de juiste labels', async ({ page, context }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await context.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
      key: 'lineup-tracker-lang',
      value: 'nl',
    });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Instellingen' })).toBeVisible();
    await page.getByTestId('nav-roster').click();
    await expect(page.getByText('+ Speler toevoegen', { exact: true })).toBeVisible();

    await page.getByTestId('lang-switch').click();
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
    await expect(page.getByText('+ Add player', { exact: true })).toBeVisible();

    await page.getByTestId('nav-settings').click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('settings- en teamdata blijven beschikbaar na offline reload op mobiele viewport', async ({
    page,
    context,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/');

    await page.getByTestId('settings-teamName').fill('Offline Team');
    await page.getByTestId('settings-save').click();

    await page.getByTestId('nav-roster').click();
    await page.getByTestId('roster-add').click();
    await page.locator('[data-testid^="roster-naam-"]').first().fill('Offline Speler');
    await page.getByTestId('roster-save').click();

    await waitForServiceWorkerController(page);

    await context.setOffline(true);
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Offline Team' })).toBeVisible();
    await page.getByTestId('nav-roster').click();
    await expect(page.locator('[data-testid^="roster-naam-"]')).toHaveValue('Offline Speler');

    await context.setOffline(false);
  });
});
