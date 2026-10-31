import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

/**
 * Trends > Lineups, extra kaarten (T7): sorteeroptie "voorzichtig", beste en
 * slechtste duo's/trio's, start- en sluitlineup en de consistentieregel.
 * Net als trends.spec.ts draait dit in lokale modus; de afgeronde wedstrijden
 * staan onder de v1-compatibele localStorage-sleutel (fictieve data).
 */

const COMPLETED_GAMES_KEY = 'lineup-tracker-v2-completed-games:org-rotterdam:team-u23';

const ROSTER = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '3.0',
  vrouw: false,
  jeugd: false,
}));

const PLAYERS = ROSTER.map((p) => ({
  id: `p${p.id}`,
  rosterId: p.id,
  nr: p.nr,
  naam: p.naam,
  kl: '3.0',
  vrouw: false,
  jeugd: false,
  participate: true,
  start: true,
}));

const L1 = ['p1', 'p2', 'p3', 'p4', 'p5'];
const L2 = ['p1', 'p2', 'p3', 'p4', 'p6'];
const L3 = ['p1', 'p2', 'p3', 'p5', 'p6'];

function seg(
  id: string,
  quarter: number,
  beginSec: number,
  endSec: number,
  lineup: string[],
  pf: number,
  pa: number,
) {
  return {
    id,
    quarter,
    beginSec,
    endSec,
    durSec: beginSec - endSec,
    lineup,
    pf,
    pa,
    classSum: 0,
    allowed: 0,
    over: false,
  };
}

/**
 * G1: Q1 L1 10:00 (+4), Q4 L2 10:00 (+2).
 * G2: Q1 L1 5:00 (+2), Q1 L2 5:00 (+3), Q4 L3 10:00 (-2).
 * Start: L1 15:00, +6, 2 wedstrijden. Sluit: L2 10:00 +2 en L3 10:00 -2 (1 wedstrijd elk).
 * Consistentie (vijftallen): L1 2 van 2, L2 2 van 2, L3 0 van 1.
 */
function completedGames() {
  const base = {
    organizationId: 'org-rotterdam',
    teamId: 'team-u23',
    competition: '',
    players: PLAYERS,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
  };
  return [
    {
      ...base,
      id: 'g-1',
      sourceGameId: 'src-1',
      opponent: 'Tegenstander 1',
      date: '2026-01-01T10:00:00.000Z',
      segments: [seg('s-1a', 1, 600, 0, L1, 10, 6), seg('s-1b', 4, 600, 0, L2, 8, 6)],
      scoreFor: 18,
      scoreAgainst: 12,
    },
    {
      ...base,
      id: 'g-2',
      sourceGameId: 'src-2',
      opponent: 'Tegenstander 2',
      date: '2026-01-08T10:00:00.000Z',
      segments: [
        seg('s-2a', 1, 600, 300, L1, 6, 4),
        seg('s-2b', 1, 300, 0, L2, 5, 2),
        seg('s-2c', 4, 600, 0, L3, 6, 8),
      ],
      scoreFor: 17,
      scoreAgainst: 14,
    },
  ];
}

async function setup(page: Page, lang: 'nl' | 'en' = 'nl'): Promise<void> {
  await page.addInitScript(
    (l: string) => window.localStorage.setItem('lineup-tracker-lang', l),
    lang,
  );
  await page.addInitScript(
    (roster) => window.localStorage.setItem('lineup-tracker-roster', JSON.stringify(roster)),
    ROSTER,
  );
  await page.goto('/');
  await page.evaluate(
    ({ key, value }: { key: string; value: string }) => window.localStorage.setItem(key, value),
    { key: COMPLETED_GAMES_KEY, value: JSON.stringify(completedGames()) },
  );
  await page.reload();
  await page.getByTestId('nav-trends').click();
  await page.getByTestId('trends-tab-lineups').click();
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe('v2 Trends > Lineups: extra kaarten (T7)', () => {
  test('sorteeroptie: standaard gewoon, "voorzichtig" toont label en uitleg', async ({ page }) => {
    await setup(page);
    await expect(page.getByTestId('trends-lineup-sort-value')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('trends-lineup-sort-badge')).toHaveCount(0);
    await page.getByTestId('trends-lineup-sort-careful').click();
    await expect(page.getByTestId('trends-lineup-sort-careful')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('trends-lineup-sort-badge')).toHaveText('volgorde: voorzichtig');
    await expect(page.getByTestId('trends-lineup-sort-explain')).toContainText(
      'Voorzichtig = alsof de lineup nog 10 minuten gelijk speelde; korte lineups tellen daardoor minder zwaar.',
    );
    // Alleen voor +/-: bij Voor/Tegen verdwijnt de keuze.
    await page.getByTestId('trends-metric-pfpa').click();
    await expect(page.getByTestId('trends-lineup-sort')).toHaveCount(0);
  });

  test('consistentie, duo’s/trio’s en start- en sluitlineup staan in de weergave', async ({
    page,
  }) => {
    await setup(page);
    await expect(page.getByTestId('trends-lineup-consistency-1-2-3-4-5')).toHaveText(
      '2 van 2 wedstrijden positief (n klein)',
    );
    await expect(page.getByTestId('trends-lineup-consistency-1-2-3-5-6')).toHaveText(
      '0 van 1 wedstrijd positief (n klein)',
    );

    const combo = page.getByTestId('trends-combo-card');
    await expect(combo).toBeVisible();
    await expect(combo).toContainText('Weggelaten: 3.'); // paren 1-2, 1-3 en 2-3 speelden altijd samen
    await expect(page.getByTestId('trends-combo-best')).toBeVisible();
    await page.getByTestId('trends-combo-size-3').click();
    await expect(page.getByTestId('trends-combo-size-3')).toHaveAttribute('aria-pressed', 'true');
    await expect(combo).toContainText('Weggelaten: 1.');
    for (const row of await page.getByTestId('trends-combo-best').locator('li').all()) {
      await expect(row).toHaveAccessibleName(/^Trio .*per 10 minuten, /);
      await expect(row).toContainText(/▲|●|▼/);
    }

    const start = page.getByTestId('trends-startclose-start-1-2-3-4-5');
    await expect(start).toContainText('15:00');
    await expect(start).toContainText('+6');
    await expect(start).toContainText('2 wedstrijden');
    await expect(page.getByTestId('trends-startclose-close-1-2-3-4-6')).toContainText('+2');
    await expect(page.getByTestId('trends-startclose-close-1-2-3-5-6')).toContainText('-2');
    await expect(page.getByTestId('trends-startclose-unreliable')).toHaveCount(0);
    await expect(page.getByTestId('trends-startclose-explain')).toContainText('één segment');
  });

  test('NL/EN: nieuwe teksten wisselen mee van taal', async ({ page }) => {
    await setup(page, 'en');
    await expect(page.getByTestId('trends-combo-card')).toContainText('Best and worst pairs/trios');
    await expect(page.getByTestId('trends-startclose-card')).toContainText(
      'Starting and closing lineup',
    );
    await expect(page.getByTestId('trends-lineup-consistency-1-2-3-4-5')).toHaveText(
      '2 of 2 games positive (small n)',
    );
    await page.getByTestId('trends-lineup-sort-careful').click();
    await expect(page.getByTestId('trends-lineup-sort-badge')).toHaveText('order: careful');
    await page.getByTestId('lang-switch').click();
    await expect(page.getByTestId('trends-combo-card')).toContainText("Beste en slechtste duo's");
    await expect(page.getByTestId('trends-lineup-sort-badge')).toHaveText('volgorde: voorzichtig');
  });

  test('320px: geen horizontale paginascroll met de nieuwe kaarten', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await setup(page);
    expect(await overflow(page), 'basis').toBeLessThanOrEqual(1);
    await page.getByTestId('trends-lineup-sort-careful').click();
    expect(await overflow(page), 'voorzichtig').toBeLessThanOrEqual(1);
    await page.getByTestId('trends-combo-size-3').click();
    expect(await overflow(page), 'trio’s').toBeLessThanOrEqual(1);
    await page.getByTestId('trends-startclose-card').scrollIntoViewIfNeeded();
    expect(await overflow(page), 'start/sluit').toBeLessThanOrEqual(1);
  });

  test('axe: geen WCAG-overtredingen met de nieuwe kaarten (NL en EN)', async ({ page }) => {
    await setup(page);
    await expectNoAxeViolations(page);
    await page.getByTestId('trends-lineup-sort-careful').click();
    await expectNoAxeViolations(page);
    await page.getByTestId('trends-combo-size-3').click();
    await expectNoAxeViolations(page);
    await page.getByTestId('lang-switch').click();
    await expectNoAxeViolations(page);
  });
});
