import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

// PR 7.5b: één segment van een afgeronde wedstrijd corrigeren in Historie,
// lokaal en zonder netwerk. Vereist (net als de rest van deze suite) de
// Firebase-emulator via ./fixtures; fictieve spelersdata.

async function playAndFinishOneSegment(page: Page, lang: 'nl' | 'en'): Promise<void> {
  await page.addInitScript((l) => window.localStorage.setItem('lineup-tracker-lang', l), lang);
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
  await page.getByTestId('turnover-plus').click();
  await page.getByTestId('end-min').selectOption('5');
  await page.getByTestId('save-segment-btn').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('finish-game-btn').click();
  await expect(page.getByTestId('history-back-btn')).toBeVisible();
}

for (const lang of ['nl', 'en'] as const) {
  test(`correctie na afronden, offline (${lang}): tijd, score en turnovers aanpassen`, async ({
    page,
    context,
  }) => {
    await playAndFinishOneSegment(page, lang);
    await context.setOffline(true);

    await expect(page.getByTestId('history-corrected-badge')).toHaveCount(0);
    await page.locator('[data-testid^="history-segment-"]').first().click();
    const dialog = page.getByTestId('correct-segment-modal');
    await expect(dialog).toBeVisible();

    await page.getByTestId('correct-pf').fill('3');
    await page.getByTestId('correct-tov').fill('2');
    await page.getByTestId('correct-segment-review').click();
    await expect(page.getByTestId('correct-segment-summary')).toBeVisible();
    await page.getByTestId('correct-segment-confirm').click();

    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('history-correction-saved')).toBeVisible();
    await expect(page.getByTestId('history-corrected-badge')).toBeVisible();
    await expect(page.getByTestId('history-turnovers-total')).toContainText('2');
    await page.getByTestId('history-corrections').locator('summary').click();
    await expect(page.getByTestId('history-corrections').locator('li').first()).toContainText(
      'TO 1',
    );

    // Blijft bewaard na herladen (localStorage), ook zonder netwerk.
    await context.setOffline(false);
    await page.reload();
    await page.getByTestId('nav-history').click();
    await page.locator('[data-testid^="history-item-"]').first().click();
    await expect(page.getByTestId('history-corrected-badge')).toBeVisible();
  });
}
