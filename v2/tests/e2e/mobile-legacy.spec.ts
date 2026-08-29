import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

// PR 8.2c (docs/pr-8.2-plan.md §B punt 6): tweede, kleiner/ouder
// viewportprofiel naast het bestaande iPhone-14-profiel in mobile.spec.ts —
// nog courtside-relevant materieel (iPhone SE 2016/iPhone 8-formaat).
// **Open besluitpunt (externe review PR #80): deze 375×667-keuze is een
// voorstel van de implementeerder, geen vastgelegd feit — vraagt expliciete
// bevestiging van de repo-eigenaar vóór 8.2c gemerged wordt.**
const LEGACY_MOBILE_VIEWPORT = { width: 375, height: 667 };

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
  expect(
    overflow,
    'pagina heeft horizontale overflow op oudere mobiele viewport',
  ).toBeLessThanOrEqual(1);
}

// Representatieve subset van mobile.spec.ts's kernscenario's (settings-/
// teamflow + taalwissel), tegen het kleinere/oudere profiel — geen
// duplicatie van de volledige suite, zelfde "geen tweede parallelle suite"-
// discipline als §B punt 7 voor de netwerkemulatie.
test.describe('v2 mobiele viewport — ouder/kleiner toestelprofiel (iPhone SE 2016/8)', () => {
  test('settings- en teamflow werkt op een ouder/kleiner mobiel viewport (NL)', async ({
    page,
  }) => {
    await page.setViewportSize(LEGACY_MOBILE_VIEWPORT);
    await page.goto('/');
    await assertNoHorizontalOverflow(page);

    await expect(page.getByTestId('nav-settings')).toBeVisible();
    await expect(page.getByTestId('nav-roster')).toBeVisible();

    await page.getByTestId('settings-teamName').fill('Ouder Toestel Team');
    await page.getByTestId('settings-save').click();
    await assertNoHorizontalOverflow(page);

    await page.getByTestId('nav-roster').click();
    await assertNoHorizontalOverflow(page);
    await page.getByTestId('roster-add').click();
    await page.locator('[data-testid^="roster-naam-"]').first().fill('Speler Ouder Toestel');
    await page.getByTestId('roster-save').click();

    await expect(page.getByTestId('roster-save')).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test('NL/EN-wissel op een ouder/kleiner mobiel viewport toont de juiste labels', async ({
    page,
    context,
  }) => {
    await page.setViewportSize(LEGACY_MOBILE_VIEWPORT);
    await context.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
      key: 'lineup-tracker-lang',
      value: 'nl',
    });
    await page.goto('/');
    await assertNoHorizontalOverflow(page);

    await expect(page.getByRole('heading', { name: 'Instellingen' })).toBeVisible();
    await page.getByTestId('nav-roster').click();
    await expect(page.getByText('+ Speler toevoegen', { exact: true })).toBeVisible();

    await page.getByTestId('lang-switch').click();
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
    await expect(page.getByText('+ Add player', { exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.getByTestId('nav-settings').click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });
});
