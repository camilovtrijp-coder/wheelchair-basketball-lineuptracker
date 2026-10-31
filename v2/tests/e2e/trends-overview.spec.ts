import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

// T6: Trends > Overzicht met klassegrens aan (classificatieprofiel, tijd over
// de limiet, datakwaliteit). Fictieve data; lokale modus (zie `fixtures.ts`).

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SETTINGS_KEY = 'lineup-tracker-settings';
const COMPLETED_GAMES_KEY = 'lineup-tracker-v2-completed-games:org-rotterdam:team-u23';

const CURRENT_ROSTER = [1, 2, 3, 4, 5].map((n) => ({
  id: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '3.0',
  vrouw: false,
  jeugd: false,
}));

const PLAYERS = [1, 2, 3, 4, 5].map((n) => ({
  id: `p${n}`,
  rosterId: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '3.0',
  vrouw: false,
  jeugd: false,
  participate: true,
  start: true,
}));

function segment(
  id: string,
  quarter: number,
  durSec: number,
  pf: number,
  pa: number,
  classSum: number,
  over: boolean,
) {
  return {
    id,
    quarter,
    beginSec: durSec,
    endSec: 0,
    durSec,
    lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
    pf,
    pa,
    classSum,
    allowed: 14,
    over,
    tov: 1,
  };
}

// Op de grens: S1 (10:00, +6). Ruimte over: S2 (2:00, -1, onder de drempel van 5:00).
// Over de grens: S3 (2:00, +2, onder de drempel). Alleen kwart 1 en 2: kwart 3 en 4 ontbreken.
const COMPLETED_GAME = {
  id: 'g-C',
  organizationId: 'org-rotterdam',
  teamId: 'team-u23',
  sourceGameId: 'src-C',
  opponent: 'Tegenstander C',
  competition: '',
  date: '2026-09-12T10:00:00.000Z',
  players: PLAYERS,
  segments: [
    segment('s1', 1, 600, 10, 4, 14, false),
    segment('s2', 2, 120, 2, 3, 12, false),
    segment('s3', 2, 120, 2, 0, 14.5, true),
  ],
  scoreFor: 14,
  scoreAgainst: 7,
  quarterCount: 4,
  periodLabel: '',
  useClassLimit: true,
};

async function setup(page: Page, lang: 'nl' | 'en'): Promise<void> {
  await page.addInitScript((l) => window.localStorage.setItem('lineup-tracker-lang', l), lang);
  await page.addInitScript(
    (roster) => window.localStorage.setItem('lineup-tracker-roster', JSON.stringify(roster)),
    CURRENT_ROSTER,
  );
  await page.goto('/');
  await page.evaluate(
    ({ settingsKey, gamesKey, games }) => {
      window.localStorage.setItem(
        settingsKey,
        JSON.stringify({ useClassLimit: true, baseLimit: 14 }),
      );
      window.localStorage.setItem(gamesKey, JSON.stringify(games));
    },
    { settingsKey: SETTINGS_KEY, gamesKey: COMPLETED_GAMES_KEY, games: [COMPLETED_GAME] },
  );
  await page.reload();
  await page.getByTestId('nav-trends').click();
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.describe('v2 Trends > Overzicht (T6)', () => {
  test('toont classificatieprofiel, tijd over de limiet en datakwaliteit (NL)', async ({
    page,
  }) => {
    await setup(page, 'nl');
    await expect(page.getByTestId('trends-overview')).toBeVisible();

    const klass = page.getByTestId('trends-class-card');
    await expect(klass).toBeVisible();
    await expect(page.getByTestId('trends-class-time-vol')).toHaveText('10:00');
    await expect(page.getByTestId('trends-class-value-vol')).toHaveText('+6');
    await expect(page.getByTestId('trends-class-tone-vol')).toContainText('beter dan team');
    await expect(page.getByTestId('trends-class-low-ruimte')).toContainText('Te weinig data');
    await expect(page.getByTestId('trends-class-low-over')).toContainText('Te weinig data');
    await expect(page.getByTestId('trends-class-note')).toContainText('Beschrijvend');

    await expect(page.getByTestId('trends-overlimit-g-C')).toContainText(
      '2:00 in 1 van 3 segmenten',
    );

    const quality = page.getByTestId('trends-quality');
    await expect(quality).toBeVisible();
    await expect(quality).toContainText('Kwart 3 heeft in geen enkele wedstrijd een segment.');
    await expect(quality).toContainText('speeltijd 14:00 (minder dan 40:00)');
  });

  test('toont dezelfde onderdelen in het Engels', async ({ page }) => {
    await setup(page, 'en');
    await expect(page.getByTestId('trends-class-card')).toContainText('Classification and result');
    await expect(page.getByTestId('trends-class-low-ruimte')).toContainText('Too little data');
    await expect(page.getByTestId('trends-overlimit-g-C')).toContainText('2:00 in 1 of 3 segments');
    await expect(page.getByTestId('trends-quality')).toContainText(
      'Quarter 3 has no segment in any game.',
    );
  });

  test('de kaarten ontbreken met klassegrens uit, de datakwaliteit blijft', async ({ page }) => {
    await setup(page, 'nl');
    await page.evaluate((key) => {
      window.localStorage.setItem(key, JSON.stringify({ useClassLimit: false }));
    }, SETTINGS_KEY);
    await page.reload();
    await page.getByTestId('nav-trends').click();
    await expect(page.getByTestId('trends-overview')).toBeVisible();
    await expect(page.getByTestId('trends-class-card')).toHaveCount(0);
    await expect(page.getByTestId('trends-overlimit-card')).toHaveCount(0);
    await expect(page.getByTestId('trends-quality')).toBeVisible();
  });

  test('past op 320 px zonder horizontale paginascroll', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await setup(page, 'nl');
    await expect(page.getByTestId('trends-class-card')).toBeVisible();
    await expect(page.getByTestId('trends-quality')).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('heeft geen axe-overtredingen (desktop en 320 px)', async ({ page }) => {
    await setup(page, 'nl');
    await expect(page.getByTestId('trends-class-card')).toBeVisible();
    await expectNoAxeViolations(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await expectNoAxeViolations(page);
  });
});
