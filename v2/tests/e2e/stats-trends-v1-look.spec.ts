// Stats en Trends in v1-look: gekleurde +/--pillen, kolommen Tijd/Pnt/Teg,
// groene lijn en teal staafgrafiek, en geen axe-contrastschendingen in donker
// (standaard) en licht. Alleen presentatie: de getallen komen uit dezelfde
// berekeningen als daarvoor (zie stats.spec.ts/trends.spec.ts). Vereist de
// Firebase Auth-/Firestore-emulator via `./fixtures`.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const COMPLETED_GAMES_KEY = 'lineup-tracker-v2-completed-games:org-rotterdam:team-u23';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const ROSTER = [
  { id: 1, nr: '1', naam: 'Anna', kl: '3.0', vrouw: false, jeugd: false },
  { id: 2, nr: '2', naam: 'Bob', kl: '2.0', vrouw: false, jeugd: false },
  { id: 3, nr: '3', naam: 'Cees', kl: '3.5', vrouw: false, jeugd: false },
  { id: 4, nr: '4', naam: 'Dien', kl: '2.5', vrouw: false, jeugd: false },
  { id: 5, nr: '5', naam: 'Eve', kl: '3.0', vrouw: false, jeugd: false },
];

function players(prefix: string) {
  return ROSTER.map((r) => ({
    id: `${prefix}${r.id}`,
    rosterId: r.id,
    nr: r.nr,
    naam: r.naam,
    kl: r.kl,
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
  }));
}

function game(
  id: string,
  prefix: string,
  date: string,
  durSec: number,
  pf: number,
  pa: number,
): object {
  return {
    id,
    organizationId: 'org-rotterdam',
    teamId: 'team-u23',
    sourceGameId: `src-${id}`,
    opponent: `Tegenstander ${id}`,
    competition: '',
    date,
    players: players(prefix),
    segments: [
      {
        id: `s-${id}`,
        quarter: 1,
        beginSec: 0,
        endSec: durSec,
        durSec,
        lineup: ROSTER.map((r) => `${prefix}${r.id}`),
        pf,
        pa,
        classSum: 0,
        allowed: 0,
        over: false,
      },
    ],
    scoreFor: pf,
    scoreAgainst: pa,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
  };
}

/** Twee afgeronde wedstrijden. `second` bepaalt of het totaal positief of negatief is. */
async function seed(page: Page, second: { pf: number; pa: number }): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
  await page.addInitScript(
    (roster) => window.localStorage.setItem('lineup-tracker-roster', JSON.stringify(roster)),
    ROSTER,
  );
  await page.goto('/');
  const games = [
    game('g-A', 'p', '2026-01-01T10:00:00.000Z', 180, 8, 6),
    game('g-B', 'q', '2026-01-08T10:00:00.000Z', 240, second.pf, second.pa),
  ];
  await page.evaluate(
    ({ key, value }: { key: string; value: string }) => window.localStorage.setItem(key, value),
    { key: COMPLETED_GAMES_KEY, value: JSON.stringify(games) },
  );
  await page.reload();
}

async function contrastViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.filter((v) => v.id === 'color-contrast');
}

async function setLight(page: Page): Promise<void> {
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
}

test.describe('v2 Stats en Trends in v1-look', () => {
  test('Stats: positief totaal geeft een groene pil, de ontbrekende kant een neutrale pil', async ({
    page,
  }) => {
    await seed(page, { pf: 5, pa: 4 });
    await page.getByTestId('nav-stats').click();
    await page.getByTestId('stats-combo-size-5').click();

    const card = page.getByTestId('stats-combo-1-2-3-4-5');
    await expect(card).toBeVisible();
    const pills = card.locator('.badge-pm');
    await expect(pills).toHaveCount(2);

    // 8-6 plus 5-4 = +3: groen, met teken (kleur is nooit het enige signaal).
    await expect(pills.nth(0)).toHaveClass(/live-pm--pos/);
    await expect(pills.nth(0)).toHaveText('+3');
    await expect(pills.nth(0)).toHaveCSS('color', 'rgb(52, 211, 153)');
    await expect(pills.nth(1)).toHaveClass(/live-pm--flat/);

    // Tijd/Pnt/Teg staan als kolommen boven de twee pillen.
    const cells = card.locator('.statsgrid > div');
    await expect(cells).toHaveCount(5);
    const first = await cells.nth(0).boundingBox();
    const fourth = await cells.nth(3).boundingBox();
    expect(first).not.toBeNull();
    expect(fourth).not.toBeNull();
    expect(fourth!.y).toBeGreaterThan(first!.y);
  });

  test('Stats: negatief totaal geeft een rode pil met min-teken', async ({ page }) => {
    await seed(page, { pf: 4, pa: 12 });
    await page.getByTestId('nav-stats').click();
    await page.getByTestId('stats-combo-size-5').click();

    const pill = page.getByTestId('stats-combo-1-2-3-4-5').locator('.badge-pm').first();
    await expect(pill).toHaveClass(/live-pm--neg/);
    await expect(pill).toHaveText(/^[-−]/);
    await expect(pill).toHaveCSS('color', 'rgb(251, 113, 133)');
  });

  test('Trends: groene lijn, teal staven en uitklapbare wedstrijdenlijst', async ({ page }) => {
    await seed(page, { pf: 5, pa: 4 });
    await page.getByTestId('nav-trends').click();

    const line = page.getByTestId('trends-line-chart-1').locator('polyline');
    await expect(line).toHaveCSS('stroke', 'rgb(52, 211, 153)');

    const bar = page.getByTestId('trends-card-1').locator('.trends-bar-chart__bar').first();
    await expect(bar).toHaveCSS('background-image', /rgb\(45, 212, 191\)/);

    await page.getByTestId('trends-toggle-games-1').click();
    await expect(page.getByTestId('trends-games-list-1')).toBeVisible();
    await expect(page.getByTestId('trends-toggle-games-1')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  test('geen axe-contrastschendingen op Stats en Trends in donker en licht', async ({ page }) => {
    await seed(page, { pf: 4, pa: 12 });

    await page.getByTestId('nav-stats').click();
    await page.getByTestId('stats-combo-size-5').click();
    await expect(page.getByTestId('stats-combo-1-2-3-4-5')).toBeVisible();
    expect(await contrastViolations(page)).toEqual([]);

    await page.getByTestId('stats-filter-btn').click();
    await expect(page.getByTestId('stats-filter-toggle-1')).toBeVisible();
    await page.getByTestId('stats-filter-toggle-1').click();
    await page.getByTestId('stats-filter-toggle-2').click();
    await page.getByTestId('stats-filter-toggle-2').click();
    expect(await contrastViolations(page)).toEqual([]);
    await page.keyboard.press('Escape');

    await page.getByTestId('nav-trends').click();
    await page.getByTestId('trends-toggle-games-1').click();
    expect(await contrastViolations(page)).toEqual([]);

    await setLight(page);
    expect(await contrastViolations(page)).toEqual([]);
    await page.getByTestId('nav-stats').click();
    await page.getByTestId('stats-combo-size-5').click();
    await expect(page.getByTestId('stats-combo-1-2-3-4-5')).toBeVisible();
    expect(await contrastViolations(page)).toEqual([]);
  });
});
