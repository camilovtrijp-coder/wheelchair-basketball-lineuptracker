// v1-look voor Team, wedstrijdopzet en segmentkaart. Bewijst in een echte browser
// dat de gedragsonderdelen (testids, labels, toggles) intact zijn en dat de
// nieuwe stijl daadwerkelijk wordt toegepast. Vereist de Firebase Auth-/Firestore-
// emulator via `./fixtures`.
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

async function fillRoster(page: Page, count: number): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
  await page.goto('/');
  await page.getByTestId('nav-roster').click();
  for (let i = 0; i < count; i += 1) {
    await page.getByTestId('roster-add').click();
  }
  const names = page.locator('[data-testid^="roster-naam-"]');
  await expect(names).toHaveCount(count);
  for (let i = 0; i < count; i += 1) {
    await names.nth(i).fill(`Speler ${i + 1}`);
  }
  await page.getByTestId('roster-save').click();
  await page.reload();
}

test.describe('v2 team, opzet en segmentkaart in v1-look', () => {
  test('team: placeholders voor rugnummer en naam, verwijderknop met icoon en toegankelijke naam', async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
    await page.goto('/');
    await page.getByTestId('nav-roster').click();
    await page.getByTestId('roster-add').click();

    const nr = page.locator('[data-testid^="roster-nr-"]').first();
    const naam = page.locator('[data-testid^="roster-naam-"]').first();
    await expect(nr).toHaveAttribute('placeholder', 'Rugnummer');
    await expect(naam).toHaveAttribute('placeholder', 'Naam');

    const remove = page.locator('[data-testid^="roster-remove-"]').first();
    await expect(remove.locator('svg')).toHaveCount(1);
    await expect(remove).toHaveAttribute('aria-label', /.+/);
    const box = await remove.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('opzet: de klokoptie blijft een bedienbare checkbox, gestyled als schakelaar', async ({
    page,
  }) => {
    await fillRoster(page, 5);
    await page.getByTestId('nav-game').click();

    const clock = page.getByTestId('game-clock-down');
    await expect(clock).toBeChecked();
    await expect(clock).toHaveCSS('appearance', 'none');
    await clock.uncheck();
    await expect(clock).not.toBeChecked();
    await clock.check();
    await expect(clock).toBeChecked();

    const start = page.getByTestId('game-start-btn');
    const startBox = await start.boundingBox();
    const viewport = page.viewportSize()!;
    expect(startBox!.width).toBeGreaterThan(viewport.width * 0.7);
    expect(startBox!.height).toBeGreaterThanOrEqual(48);
  });

  test('opzet: Meedoen toont een vinkje-toggle in groen, uitzetten verbergt Start', async ({
    page,
  }) => {
    await fillRoster(page, 5);
    await page.getByTestId('nav-game').click();

    const participate = page.locator('[data-testid^="game-participate-"]').first();
    await expect(participate).toHaveAttribute('aria-pressed', 'true');
    await expect(participate).toHaveCSS('border-top-color', 'rgb(52, 211, 153)');

    await participate.click();
    await expect(participate).toHaveAttribute('aria-pressed', 'false');
    await expect(participate).not.toHaveCSS('border-top-color', 'rgb(52, 211, 153)');
  });

  test('live: segment opslaan is groen met leesbare tekst, actief kwart is omrand', async ({
    page,
  }) => {
    await fillRoster(page, 5);
    await page.getByTestId('nav-game').click();
    await page.getByTestId('game-start-btn').click();
    await expect(page.getByTestId('score-row-for')).toBeVisible();

    const save = page.getByTestId('save-segment-btn');
    await expect(save).toHaveCSS('background-color', 'rgb(52, 211, 153)');
    await expect(save).toHaveCSS('color', 'rgb(5, 46, 22)');

    const active = page.getByTestId('quarter-btn-1');
    await expect(active).toHaveCSS('border-top-color', 'rgb(96, 165, 250)');
    await expect(active).toHaveCSS('text-decoration-line', 'underline');
  });
});
