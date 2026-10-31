import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

// v1-compatibele roster-sleutel (zie trends.spec.ts); de suite draait in lokale modus.
const ROSTER = [
  { id: 1, nr: '1', naam: 'Anna', kl: '3.0', vrouw: false, jeugd: false },
  { id: 2, nr: '2', naam: 'Bob', kl: '2.0', vrouw: false, jeugd: false },
  { id: 3, nr: '3', naam: 'Cees', kl: '3.5', vrouw: false, jeugd: false },
  { id: 4, nr: '4', naam: 'Dien', kl: '2.5', vrouw: false, jeugd: false },
  { id: 5, nr: '5', naam: 'Eve', kl: '3.0', vrouw: false, jeugd: false },
];

/**
 * Speelt een korte wedstrijd (fictieve spelers) en rondt die af: 3-1 in kwart 1,
 * klok van 10:00 naar 5:00 = 5:00 speeltijd voor alle vijf. Daarna Trends > Kwarten.
 */
async function finishGameAndOpenQuarters(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
  await page.addInitScript(
    (roster) => window.localStorage.setItem('lineup-tracker-roster', JSON.stringify(roster)),
    ROSTER,
  );
  await page.goto('/');
  await page.getByTestId('nav-game').click();
  await expect(page.locator('[data-testid^="game-participate-"]')).toHaveCount(5);
  await page.getByTestId('game-start-btn').click();
  await expect(page.getByTestId('score-row-for')).toBeVisible();
  await page.getByTestId('score-plus3-for').click();
  await page.getByTestId('score-plus1-against').click();
  await page.getByTestId('end-min').selectOption('5');
  await page.getByTestId('save-segment-btn').click();
  await expect(page.locator('[data-testid^="segment-item-"]')).toHaveCount(1);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('finish-game-btn').click();
  await expect(page.getByTestId('history-back-btn')).toBeVisible();

  await page.getByTestId('nav-trends').click();
  await page.getByTestId('trends-tab-quarters').click();
  await expect(page.getByTestId('trends-quarters-card')).toBeVisible();
}

test.describe('v2 Trends: weergave Kwarten (T5)', () => {
  test('toont het resultaat en de minuten per kwart na het afronden (NL en EN)', async ({
    page,
  }) => {
    await finishGameAndOpenQuarters(page);

    await expect(page.getByTestId('trends-quarters-title')).toHaveText('Kwarten: +/- totaal');
    await expect(page.getByTestId('trends-quarter-value-1')).toHaveText('+2');
    await expect(page.getByTestId('trends-quarter-1')).toContainText('5:00');
    await expect(page.getByTestId('trends-quarter-1')).toContainText('1 wedstr.');
    await expect(page.getByTestId('trends-quarter-1')).toHaveAccessibleName(
      'Kwart 1, 5:00, +2 totaal, rond gemiddelde',
    );
    // De andere kwarten hebben geen segmenten: "geen data", zonder toon.
    await expect(page.getByTestId('trends-quarter-value-2')).toHaveText('geen data');
    await expect(page.getByTestId('trends-quarter-2')).toHaveAccessibleName('Kwart 2, geen data');
    await expect(page.getByTestId('trends-quarter-4')).not.toContainText('▲');

    // Minuten per speler per kwart (m:ss met de cijfers altijd zichtbaar).
    await expect(page.getByTestId('trends-qmin-1-1')).toHaveText('5:00');
    await expect(page.getByTestId('trends-qmin-1-2')).toHaveText('0:00');
    await expect(page.locator('[data-testid^="trends-qmin-row-"]')).toHaveCount(5);

    await page.getByTestId('trends-per10-toggle').click();
    await expect(page.getByTestId('trends-quarters-title')).toHaveText('Kwarten: +/- per 10 min');
    await expect(page.getByTestId('trends-quarter-value-1')).toHaveText('+4.0');
    await expect(page.getByTestId('trends-quarter-1')).toHaveAccessibleName(
      'Kwart 1, 5:00, +4.0 per 10 minuten, rond gemiddelde',
    );

    await page.getByTestId('lang-switch').click();
    await expect(page.getByTestId('trends-quarters-title')).toHaveText('Quarters: +/- per 10 min');
    await expect(page.getByTestId('trends-quarter-1')).toContainText('1 games');
    await expect(page.getByTestId('trends-quarter-value-2')).toHaveText('no data');
    await expect(page.getByTestId('trends-quarter-1')).toHaveAccessibleName(
      'Quarter 1, 5:00, +4.0 per 10 minutes, around average',
    );
    await expect(page.getByTestId('trends-qmin-hint')).toContainText('Darker = more minutes');
  });

  test('op 320 px scrolt alleen de tabelcontainer, nooit de pagina', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await finishGameAndOpenQuarters(page);
    const pageOverflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await pageOverflow(), 'horizontale paginascroll op 320px').toBeLessThanOrEqual(1);
    await page.getByTestId('trends-per10-toggle').click();
    expect(await pageOverflow(), 'paginascroll per 10 min op 320px').toBeLessThanOrEqual(1);

    const scroll = page.getByTestId('trends-qmin-scroll');
    await expect(scroll).toBeVisible();
    const box = await scroll.evaluate((el) => ({
      client: el.clientWidth,
      scrollW: el.scrollWidth,
      overflowX: getComputedStyle(el).overflowX,
    }));
    expect(box.overflowX).toBe('auto');
    expect(box.client).toBeLessThanOrEqual(320);
    // De cijfers blijven bereikbaar: de laatste kolom is te bereiken door te scrollen.
    await scroll.scrollIntoViewIfNeeded();
    await scroll.evaluate((el) => (el.scrollLeft = el.scrollWidth));
    await expect(page.getByTestId('trends-qmin-1-4')).toBeInViewport();
    expect(await pageOverflow()).toBeLessThanOrEqual(1);
  });

  test('axe: geen WCAG-overtredingen in Kwarten (totaal, per 10, EN, 320 px)', async ({ page }) => {
    await finishGameAndOpenQuarters(page);
    await expectNoAxeViolations(page);
    await page.getByTestId('trends-per10-toggle').click();
    await expectNoAxeViolations(page);
    await page.getByTestId('lang-switch').click();
    await expectNoAxeViolations(page);
    await page.setViewportSize({ width: 320, height: 568 });
    await expectNoAxeViolations(page);
  });
});
