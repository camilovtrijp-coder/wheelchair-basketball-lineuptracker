// v1-look voor Historie en Instellingen: contrast (axe) in donker (standaard)
// én licht, de gekleurde actieknoppen, en het geselecteerde kleurstaal met
// vinkje. Vereist de Firebase Auth-/Firestore-emulator via `./fixtures`.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const COMPLETED_GAMES_KEY = 'lineup-tracker-v2-completed-games:org-rotterdam:team-u23';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function contrastViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.filter((v) => v.id === 'color-contrast');
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

/** Een afgeronde wedstrijd direct in localStorage zetten (fictieve data). */
async function seedCompletedGame(page: Page): Promise<void> {
  await page.evaluate((key) => {
    const players = [1, 2, 3, 4, 5].map((n) => ({
      id: `p${n}`,
      rosterId: `r${n}`,
      nr: String(n * 3),
      naam: `Speler ${n}`,
      kl: '3.0',
      vrouw: false,
      jeugd: false,
    }));
    const segment = (id: string, quarter: number, pf: number, pa: number) => ({
      id,
      quarter,
      lineup: players.map((p) => p.id),
      beginSec: 600,
      endSec: 300,
      durSec: 300,
      pf,
      pa,
    });
    const game = {
      id: 'seed-game-1',
      organizationId: 'org-rotterdam',
      teamId: 'team-u23',
      sourceGameId: 'seed-active-1',
      opponent: 'Voorbeeld BC',
      competition: 'Beker',
      date: '2026-01-15T12:00:00.000Z',
      players,
      segments: [segment('s1', 1, 8, 4), segment('s2', 2, 2, 7)],
      scoreFor: 10,
      scoreAgainst: 11,
      quarterCount: 4,
      periodLabel: 'Kwart',
      useClassLimit: false,
      revision: 0,
      deletedAt: null,
      deletedBy: null,
    };
    window.localStorage.setItem(key, JSON.stringify([game]));
  }, COMPLETED_GAMES_KEY);
}

test.describe('v2 historie en instellingen in v1-look', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
  });

  test('instellingen: geen contrastschendingen in donker en licht, geselecteerd staal heeft een vinkje', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('settings-teamName')).toBeVisible();

    const selected = page.locator('.settings-panel .swatch--selected').first();
    await expect(selected).toBeVisible();
    const check = await selected.evaluate((el) => getComputedStyle(el, '::after').content);
    expect(check).toContain('✓');

    await setTheme(page, 'dark');
    expect(await contrastViolations(page)).toEqual([]);
    await setTheme(page, 'light');
    expect(await contrastViolations(page)).toEqual([]);
  });

  test('historielijst en -detail: contrast in beide thema’s, rode en groene actieknop', async ({
    page,
  }) => {
    await page.goto('/');
    await seedCompletedGame(page);
    await page.reload();
    await page.getByTestId('nav-history').click();

    const item = page.getByTestId('history-item-seed-game-1');
    await expect(item).toBeVisible();
    await expect(item.locator('.history-item__dot--neg')).toBeVisible();
    await expect(item.locator('.history-item__chevron')).toBeVisible();

    await setTheme(page, 'dark');
    expect(await contrastViolations(page)).toEqual([]);
    await setTheme(page, 'light');
    expect(await contrastViolations(page)).toEqual([]);

    await item.click();
    await expect(page.getByTestId('history-delete-btn')).toHaveClass(/btn-danger/);
    await expect(page.getByTestId('history-export-btn')).toHaveClass(/btn-success/);
    await expect(page.locator('[data-testid^="history-segment-"]')).toHaveCount(2);

    await setTheme(page, 'dark');
    expect(await contrastViolations(page)).toEqual([]);
    await setTheme(page, 'light');
    expect(await contrastViolations(page)).toEqual([]);
  });
});
