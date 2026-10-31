import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

// Fictieve spelers; de suite draait in lokale modus (zie trends-quarters.spec.ts).
const ROSTER = [
  { id: 1, nr: '1', naam: 'Anna', kl: '3.0', vrouw: false, jeugd: false },
  { id: 2, nr: '2', naam: 'Bob', kl: '2.0', vrouw: false, jeugd: false },
  { id: 3, nr: '3', naam: 'Cees', kl: '3.5', vrouw: false, jeugd: false },
  { id: 4, nr: '4', naam: 'Dien', kl: '2.5', vrouw: false, jeugd: false },
  { id: 5, nr: '5', naam: 'Eve', kl: '3.0', vrouw: false, jeugd: false },
];

/** Speelt één korte wedstrijd, rondt die af en opent Trends (Overzicht). */
async function finishGameAndOpenTrends(page: Page): Promise<void> {
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
  await expect(page.getByTestId('trends-sticky')).toBeVisible();
}

async function stickyHeight(page: Page): Promise<number> {
  return page.getByTestId('trends-sticky').evaluate((el) => el.getBoundingClientRect().height);
}

for (const width of [320, 375]) {
  test.describe(`v2 Trends: inklapbare filterbalk op ${width} px`, () => {
    test.use({ viewport: { width, height: 700 } });

    test('vaste kop is compact, paneel opent en sluit en het filter werkt na openen', async ({
      page,
    }) => {
      await finishGameAndOpenTrends(page);

      // De vaste kop = tabbalk + samenvatting; minder dan ±120 px hoog (was ongeveer een kwart scherm).
      const closedHeight = await stickyHeight(page);
      test.info().annotations.push({
        type: 'sticky-hoogte',
        description: `${width}px: ${closedHeight.toFixed(1)}px`,
      });
      expect(closedHeight).toBeLessThan(120);

      // Geen horizontale scroll.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      // Standaard ingeklapt: samenvatting zichtbaar, chips niet in de DOM.
      const toggle = page.getByTestId('trends-filters-toggle');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('trends-filter-summary')).toHaveText(
        'Totaal · 1 wedstrijd · Drempel 5:00',
      );
      await expect(page.getByTestId('trends-per10-toggle')).toHaveCount(0);
      await expectNoAxeViolations(page);

      // Openen: de chips staan in de paginastroom onder de vaste kop; de kop wordt niet hoger.
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('trends-filterbar')).toBeVisible();
      expect(Math.abs((await stickyHeight(page)) - closedHeight)).toBeLessThanOrEqual(1);
      const panelTop = await page
        .getByTestId('trends-filterbar')
        .evaluate((el) => el.getBoundingClientRect().top);
      const stickyBottom = await page
        .getByTestId('trends-sticky')
        .evaluate((el) => el.getBoundingClientRect().bottom);
      expect(panelTop).toBeGreaterThanOrEqual(stickyBottom - 1);
      // "Laatste 5" lijkt niet actief zonder dat je erop tikte.
      await expect(page.getByTestId('trends-quick-last5')).toHaveAttribute('aria-pressed', 'false');
      await expectNoAxeViolations(page);

      // Filter werkt na openen en de samenvatting volgt.
      await page.getByTestId('trends-per10-toggle').click();
      await page.getByTestId('trends-threshold-btn').click();
      await expect(page.getByTestId('trends-filter-summary')).toHaveText(
        'Per 10 min · 1 wedstrijd · Drempel 10:00',
      );
      await page.getByTestId('trends-quick-last5').click();
      await expect(page.getByTestId('trends-quick-last5')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('trends-filter-summary')).toContainText('Laatste 5');
      await page.getByTestId('trends-quick-last5').click();
      await expect(page.getByTestId('trends-quick-last5')).toHaveAttribute('aria-pressed', 'false');

      // Toetsenbord: Escape sluit het paneel, de focus staat dan op de knop.
      await page.getByTestId('trends-threshold-btn').focus();
      await page.keyboard.press('Escape');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('trends-filterbar')).toHaveCount(0);
      await expect(toggle).toBeFocused();

      // Spatiebalk/Enter op de knop opent weer.
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });

    test('Spelers: het uitklappijltje staat in dezelfde regel als de naam', async ({ page }) => {
      await finishGameAndOpenTrends(page);
      await page.getByTestId('trends-tab-players').click();
      const toggle = page.getByTestId('trends-row-toggle-1');
      await expect(toggle).toBeVisible();
      const chev = toggle.locator('.trends-row__chev');
      const name = toggle.locator('.trends-row__name');
      const [c, n] = await Promise.all([chev.boundingBox(), name.boundingBox()]);
      expect(c).not.toBeNull();
      expect(n).not.toBeNull();
      // Het pijltje ligt verticaal binnen de naamregel en links van de naam.
      expect(c!.y).toBeGreaterThanOrEqual(n!.y - 2);
      expect(c!.y + c!.height).toBeLessThanOrEqual(n!.y + n!.height + 2);
      expect(c!.x).toBeLessThan(n!.x);
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expectNoAxeViolations(page);
    });
  });
}
