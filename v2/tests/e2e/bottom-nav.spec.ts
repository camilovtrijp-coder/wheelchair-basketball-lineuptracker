import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

// Stap 4 van de v1-look: vaste onderbalk met vijf tabs; Instellingen staat als
// ⚙ in de header (data-testid="nav-settings" blijft bestaan).
const VIEWPORTS = [
  { name: 'iPhone 14', width: 390, height: 844 },
  { name: 'iPhone SE', width: 375, height: 667 },
];

const TAB_IDS = ['roster', 'game', 'stats', 'trends', 'history'];

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, 'horizontale overflow met onderbalk').toBeLessThanOrEqual(1);
}

for (const vp of VIEWPORTS) {
  test.describe(`onderbalk-navigatie (${vp.name} ${vp.width}x${vp.height})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
      await page.goto('/');
    });

    test('balk zit onderin, toont vijf tabs met icoon en label en past in de breedte', async ({
      page,
    }) => {
      const nav = page.locator('nav.app-nav');
      await expect(nav).toBeVisible();
      await expect(nav).toHaveAttribute('aria-label', 'Hoofdnavigatie');

      const box = await nav.boundingBox();
      expect(box).not.toBeNull();
      expect(Math.round(box!.y + box!.height)).toBe(vp.height);
      expect(box!.width).toBeLessThanOrEqual(vp.width);

      await expect(nav.locator('.app-nav__tab')).toHaveCount(5);
      for (const id of TAB_IDS) {
        const tab = page.getByTestId(`nav-${id}`);
        await expect(tab).toBeVisible();
        await expect(tab.locator('svg[aria-hidden="true"]')).toHaveCount(1);
        const tabBox = await tab.boundingBox();
        expect(tabBox!.height).toBeGreaterThanOrEqual(44);
        expect(tabBox!.width).toBeGreaterThanOrEqual(44);
      }
      // Instellingen zit niet in de balk.
      await expect(nav.getByTestId('nav-settings')).toHaveCount(0);
      await assertNoHorizontalOverflow(page);
    });

    test('⚙ in de header opent Instellingen; actieve tab krijgt aria-current', async ({ page }) => {
      const gear = page.locator('header.app-header').getByTestId('nav-settings');
      await expect(gear).toBeVisible();
      await expect(gear).toHaveAttribute('aria-label', 'Instellingen');

      await page.getByTestId('nav-roster').click();
      await expect(page.getByTestId('nav-roster')).toHaveAttribute('aria-current', 'page');
      await expect(gear).not.toHaveAttribute('aria-current', 'page');

      await gear.click();
      await expect(page.getByTestId('settings-teamName')).toBeVisible();
      await expect(gear).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('nav-roster')).not.toHaveAttribute('aria-current', 'page');
    });

    test('inhoud valt niet achter de balk: onderkant van de pagina blijft boven de balk', async ({
      page,
    }) => {
      await page.getByTestId('nav-roster').click();
      const navTop = (await page.locator('nav.app-nav').boundingBox())!.y;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const lastChildBottom = await page.evaluate(() => {
        const main = document.querySelector('main.app-main')!;
        const last = main.lastElementChild;
        return last ? last.getBoundingClientRect().bottom : 0;
      });
      expect(lastChildBottom).toBeLessThanOrEqual(navTop + 1);
    });
  });
}
