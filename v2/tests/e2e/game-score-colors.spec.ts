import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

// Stap 2 (v1-look): eigen team = teamkleur, tegenstander = vast oranje.
async function startGame(page: Page): Promise<void> {
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

test.describe('v2 live wedstrijd: gekleurde scoreknoppen (stap 2)', () => {
  test('eigen-team-scoreknop rendert de teamkleur, de tegenstanderknop oranje', async ({
    page,
  }) => {
    await startGame(page);

    // DEFAULT_SETTINGS.primaryColor = #2563eb; afgeleide voorgrond = wit.
    const own = page.getByTestId('score-plus2-for');
    await expect(own).toHaveCSS('background-color', 'rgb(37, 99, 235)');
    await expect(own).toHaveCSS('color', 'rgb(255, 255, 255)');

    // Tegenstander: vast oranje (#f97316) met zwarte tekst.
    const opp = page.getByTestId('score-plus2-against');
    await expect(opp).toHaveCSS('background-color', 'rgb(249, 115, 22)');
    await expect(opp).toHaveCSS('color', 'rgb(0, 0, 0)');

    // De -1-correctieknop blijft een neutrale outline-knop.
    await expect(page.getByTestId('score-minus1-for')).not.toHaveCSS(
      'background-color',
      'rgb(37, 99, 235)',
    );
  });
});
