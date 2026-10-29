// Stap 3/5 (v1-look): compacte accountchip met uitklapmenu in de app-header.
// Bewijst in een echte browser: toetsenbord (Enter opent, Tab bereikt de items,
// Escape sluit en geeft focus terug aan de chip), klik buiten sluit, het menu
// blijft binnen een smalle viewport, en axe vindt geen schendingen met het
// menu open. Vereist de Firebase Auth-/Firestore-emulator via `./fixtures`.
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { test } from './fixtures';

test.describe('v2 accountmenu in de header (stap 3/5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
  });

  test('toetsenbord: Enter opent, Tab bereikt de items, Escape sluit en focus keert terug', async ({
    page,
  }) => {
    await page.goto('/');
    const trigger = page.getByTestId('account-menu-trigger');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('account-menu')).toHaveCount(0);

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('account-menu')).toBeVisible();
    await expect(page.getByTestId('session-account-email')).toHaveText('bob@example.test');

    await page.keyboard.press('Tab');
    await expect(page.getByTestId('switch-context')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('trusted-device-setting-toggle')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('sign-out')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('account-menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('een klik buiten het menu sluit het', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('account-menu-trigger').click();
    await expect(page.getByTestId('account-menu')).toBeVisible();
    await page.locator('.app-main').click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId('account-menu')).toHaveCount(0);
  });

  test('op een smalle telefoon blijft het menu binnen het scherm', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/');
    await page.getByTestId('account-menu-trigger').click();
    const box = await page.getByTestId('account-menu').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  });

  test('axe: geen schendingen met het menu open', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('account-menu-trigger').click();
    await expect(page.getByTestId('account-menu')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
