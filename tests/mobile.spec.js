const { test, expect } = require('@playwright/test');
const { createMockRoster, clearLocalStorage, seedLocalStorage } = require('./fixtures/test-helpers');

test.describe('ROBA Lineup Tracker - Mobile Smoke Test Suite (Mobile Chrome)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorage(page);
    await page.reload();
  });

  test('Mobile Smoke 1: Mobiele weergave van live wedstrijd en wissel-modus pulse', async ({ page }) => {
    const mockRoster = createMockRoster();
    await seedLocalStorage(page, { roster: mockRoster });
    await page.goto('/');

    // 1. Ga naar Wedstrijd tabblad en start wedstrijd
    await page.locator('.tabbtn', { hasText: /Wedstrijd|Track/i }).click();
    await page.locator('#startbtn').click();

    // 2. Assert dat de mobiele tabbar onderin staat en 5 tabs bevat
    const tabBtns = page.locator('.tabbar .tabbtn');
    await expect(tabBtns).toHaveCount(5);

    // 3. Assert dat 5 veldspeler chips netjes op de vloer staan
    const courtChips = page.getByTestId('court-list').locator('.chip');
    await expect(courtChips).toHaveCount(5);

    // 4. Tik op de eerste veldspeler chip en verifieer dat de wisselmodus (pulse animation / class sel) geactiveerd wordt
    const firstChip = courtChips.first();
    await firstChip.click();
    await expect(firstChip).toHaveClass(/sel/);

    // Assert dat de wisselbanner actief is
    const swapBanner = page.locator('.swap-banner');
    await expect(swapBanner).toHaveClass(/active/);
  });

  test('Mobile Smoke 2: Mobiele navigatie en instellingen overlay', async ({ page }) => {
    await page.goto('/');

    // 1. Schakel naar Stats tab
    await page.locator('.tabbtn', { hasText: /Stats/i }).click();
    await expect(page.locator('.tabbtn', { hasText: /Stats/i })).toHaveClass(/on/);

    // 2. Schakel naar History tab
    await page.locator('.tabbtn', { hasText: /Historie|History/i }).click();
    await expect(page.locator('.tabbtn', { hasText: /Historie|History/i })).toHaveClass(/on/);

    // 3. Open Instellingen overlay (⚙) op mobiel
    await page.locator('.tabbtn', { hasText: /Team|Roster/i }).click();
    await page.locator('button', { hasText: '⚙' }).click();

    // Assert dat de modal overlay van beneden opent (.overlay.bottom)
    const modal = page.locator('.overlay.bottom .modal');
    await expect(modal).toBeVisible();
  });
});
