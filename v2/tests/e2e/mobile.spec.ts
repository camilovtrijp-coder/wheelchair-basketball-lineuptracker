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

  // PR 5.3c-1: deze test verwacht een volledige offline page-reload die de
  // hele app (incl. AuthGate's organisatie-/teamlidmaatschap) intact laat.
  // Sinds PR 5.2 zit App achter AuthGate; de fixture (tests/e2e/fixtures.ts)
  // kiest sinds deze PR bewust "onvertrouwd apparaat" (memoryLocalCache) zodat
  // de rest van deze suite in lokale modus blijft draaien op de v1-keys — zie
  // selectRepositories()/resolveAppRepositories.ts. Zonder persistente cache
  // kan AuthGate na een offline reload het organisatielidmaatschap niet
  // herstellen (netwerkfout ipv gecachte data) en toont "No access to an
  // organization" i.p.v. de gecachte team-/instellingendata. Met "vertrouwd
  // apparaat" zou App zelf in cloud-modus komen, en is de vraag "blijft
  // gecachte cloud-data zichtbaar na offline reload" precies de nog OPEN harde
  // gate uit issue #27 / PR 5.3d (docs/pr-5.3-plan.md §C/5.3d) — niet iets wat
  // 5.3c-1 al bewijst. `test.fail()` houdt deze regel zichtbaar (zelfde
  // conventie als P0-1 in PR 1.6/1.7, zie docs/IMPLEMENTATION_PLAN.md §6) i.p.v.
  // de test stil te verwijderen; PR 5.3d's eigen, gerichte offline-reload-suite
  // (tests/e2e-auth/offline-reload-cache-write-second-client.spec.ts) vervangt 'm.
  test('settings- en teamdata blijven beschikbaar na offline reload op mobiele viewport', async ({
    page,
    context,
  }) => {
    test.fail(
      true,
      'Volledige offline reload vereist een vertrouwd apparaat (persistente cache); ' +
        'zie issue #27 / PR 5.3d.',
    );
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
