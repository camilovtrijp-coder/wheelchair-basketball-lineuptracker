// Stap 5/5 (v1-look): licht/donker-schakelaar in het accountmenu. Donker is de
// standaard; de keuze blijft na herladen en is in beide thema's zonder
// axe-contrastschendingen. Vereist de Firebase Auth-/Firestore-emulator via
// `./fixtures`.
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { test } from './fixtures';
import { openAccountMenu } from './accountMenu';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function contrastViolations(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.filter((v) => v.id === 'color-contrast');
}

test.describe('v2 licht/donker-schakelaar (stap 5/5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (!window.sessionStorage.getItem('theme-test-seeded')) {
        window.sessionStorage.setItem('theme-test-seeded', '1');
        window.localStorage.removeItem('lineup-tracker-v2-theme');
      }
      window.localStorage.setItem('lineup-tracker-lang', 'nl');
    });
  });

  test('standaard donker; uitzetten geeft licht en blijft na herladen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await openAccountMenu(page);
    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(241, 245, 249)');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await openAccountMenu(page);
    await expect(page.getByTestId('theme-toggle')).not.toBeChecked();

    await page.getByTestId('theme-toggle').check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(9, 13, 22)');
  });

  test('geen axe-contrastschendingen in donker en in licht (instellingen, wedstrijd, menu open)', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('settings-teamName')).toBeVisible();
    expect(await contrastViolations(page)).toEqual([]);

    await page.getByTestId('nav-game').click();
    expect(await contrastViolations(page)).toEqual([]);

    await openAccountMenu(page);
    await page.getByTestId('theme-toggle').uncheck();
    expect(await contrastViolations(page)).toEqual([]);

    await page.getByTestId('nav-roster').click();
    expect(await contrastViolations(page)).toEqual([]);
    await page.getByTestId('nav-settings').click();
    expect(await contrastViolations(page)).toEqual([]);
  });
});
