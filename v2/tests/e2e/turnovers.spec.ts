import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

// Turnovers registreren (live-rij in de scorekaart) en terugzien in het
// segment en in Historie. Vereist de Firebase-emulator via ./fixtures.

async function startTrackedGame(page: Page, playerCount = 5): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
  await page.goto('/');
  await page.getByTestId('nav-roster').click();
  for (let i = 0; i < playerCount; i += 1) {
    await page.getByTestId('roster-add').click();
  }
  const names = page.locator('[data-testid^="roster-naam-"]');
  await expect(names).toHaveCount(playerCount);
  for (let i = 0; i < playerCount; i += 1) {
    await names.nth(i).fill(`Speler ${i + 1}`);
  }
  await page.getByTestId('roster-save').click();
  await page.reload();
  await page.getByTestId('nav-game').click();
  await page.getByTestId('game-start-btn').click();
  await expect(page.getByTestId('score-row-for')).toBeVisible();
}

test.describe('v2 turnovers (live-rij, segment, Historie)', () => {
  test('+1/−1 per segment, het segment draagt TO en Historie toont de pil en het totaal', async ({
    page,
  }) => {
    await startTrackedGame(page);

    await expect(page.getByTestId('turnover-count')).toHaveText('0');
    await expect(page.getByTestId('turnover-minus')).toBeDisabled();

    await page.getByTestId('turnover-plus').click();
    await page.getByTestId('turnover-plus').click();
    await page.getByTestId('turnover-plus').click();
    await page.getByTestId('turnover-minus').click();
    await expect(page.getByTestId('turnover-count')).toHaveText('2');
    await expect(page.getByTestId('segment-turnovers')).toContainText('2');

    await page.getByTestId('end-min').selectOption('5');
    await page.getByTestId('save-segment-btn').click();

    const item = page.locator('[data-testid^="segment-item-"]').first();
    await expect(item).toContainText('TO 2');
    await expect(page.getByTestId('segment-turnovers')).toContainText('0');
    await expect(page.getByTestId('turnover-count')).toHaveText('2');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('finish-game-btn').click();

    await expect(page.getByTestId('history-back-btn')).toBeVisible();
    await expect(page.getByTestId('history-turnovers-total')).toContainText('2');
    await expect(page.locator('[data-testid^="history-segment-tov-"]').first()).toContainText(
      'TO 2',
    );
  });

  test('bewerken: het veld Turnovers van een segment is aanpasbaar', async ({ page }) => {
    await startTrackedGame(page);
    await page.getByTestId('turnover-plus').click();
    await page.getByTestId('end-min').selectOption('5');
    await page.getByTestId('save-segment-btn').click();

    await page.locator('[data-testid^="segment-item-"]').first().click();
    await expect(page.getByTestId('edit-tov')).toHaveValue('1');
    await page.getByTestId('edit-tov').fill('4');
    await page.getByTestId('edit-segment-save').click();

    await expect(page.locator('[data-testid^="segment-item-"]').first()).toContainText('TO 4');
    await expect(page.getByTestId('turnover-count')).toHaveText('4');
  });
});
