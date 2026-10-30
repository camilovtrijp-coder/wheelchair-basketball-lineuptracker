import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

// Turnovers in Statistieken en Trends. Fictieve data, handmatig narekenbaar:
//  wedstrijd A: 1-2-3-4-5 gedurende 600 s, +4/-2, 3 turnovers;
//  wedstrijd B: 1-2-3-4-5 gedurende 300 s, +2/-3, 2 turnovers.
// Totaal: 5 turnovers in 2 wedstrijden over 900 s = 3,3 per 10 min.
const COMPLETED_GAMES_KEY = 'lineup-tracker-v2-completed-games:org-rotterdam:team-u23';
const CURRENT_ROSTER = [1, 2, 3, 4, 5].map((n) => ({
  id: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '3.0',
  vrouw: false,
  jeugd: false,
}));

function players(prefix: string) {
  return [1, 2, 3, 4, 5].map((n) => ({
    id: `${prefix}${n}`,
    rosterId: n,
    nr: String(n),
    naam: `Speler ${n}`,
    kl: '3.0',
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
  tov: number | undefined,
) {
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
        beginSec: durSec,
        endSec: 0,
        durSec,
        lineup: [1, 2, 3, 4, 5].map((n) => `${prefix}${n}`),
        pf,
        pa,
        classSum: 0,
        allowed: 0,
        over: false,
        ...(tov === undefined ? {} : { tov }),
      },
    ],
    scoreFor: pf,
    scoreAgainst: pa,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
  };
}

async function seed(page: Page, withTov: boolean): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
  await page.addInitScript(
    (roster) => window.localStorage.setItem('lineup-tracker-roster', JSON.stringify(roster)),
    CURRENT_ROSTER,
  );
  await page.goto('/');
  const games = [
    game('A', 'p', '2026-01-01T10:00:00.000Z', 600, 4, 2, withTov ? 3 : undefined),
    game('B', 'q', '2026-01-08T10:00:00.000Z', 300, 2, 3, withTov ? 2 : undefined),
  ];
  await page.evaluate(
    ({ key, value }: { key: string; value: string }) => window.localStorage.setItem(key, value),
    { key: COMPLETED_GAMES_KEY, value: JSON.stringify(games) },
  );
  await page.reload();
}

test.describe('Turnovers in Statistieken en Trends', () => {
  test('Statistieken toont "TO met/zonder hen" voor een opstelling', async ({ page }) => {
    await seed(page, true);
    await page.getByTestId('nav-stats').click();
    await expect(page.getByTestId('stats-tov-on-1-2-3-4-5')).toHaveText('5');
    await expect(page.getByTestId('stats-tov-off-1-2-3-4-5')).toHaveText('–');
    await page.getByTestId('stats-per10-toggle').click();
    // 5 * 600 / 900 = 3,3 per 10 min
    await expect(page.getByTestId('stats-tov-on-1-2-3-4-5')).toHaveText('3.3/10′');
  });

  test('Trends toont totaalregel, lineup-ranglijst en tegels per speler', async ({ page }) => {
    await seed(page, true);
    await page.getByTestId('nav-trends').click();
    await expect(page.getByTestId('trends-tov-total')).toHaveText('5');
    await expect(page.getByTestId('trends-tov-summary')).toContainText('in 2 wedstrijden');
    await expect(page.getByTestId('trends-tov-per10')).toHaveText('3.3');
    await expect(page.getByTestId('trends-tov-lineup-value-1-2-3-4-5')).toHaveText('3.3');
    // speler 1: +/- (4-2)+(2-3) = +1 totaal, 5 turnovers, gemiddeld 15 min / 2 wedstrijden = 7,5 min
    await expect(page.getByTestId('trends-totalpm-1')).toHaveText('+1');
    await expect(page.getByTestId('trends-tov-1')).toHaveText('5');
    await expect(page.getByTestId('trends-avgmin-1')).toHaveText('7.5');
  });

  test('oude wedstrijden zonder turnovers: totaalregel op 0, geen lineup- of spelerdetails', async ({
    page,
  }) => {
    await seed(page, false);
    await page.getByTestId('nav-stats').click();
    await expect(page.getByTestId('stats-combo-1-2-3-4-5')).toBeVisible();
    await expect(page.getByTestId('stats-tov-1-2-3-4-5')).toHaveCount(0);
    await page.getByTestId('nav-trends').click();
    await expect(page.getByTestId('trends-card-1')).toBeVisible();
    await expect(page.getByTestId('trends-tov-total')).toHaveText('0');
    await expect(page.getByTestId('trends-tov-per10')).toHaveText('0.0');
    await expect(page.getByTestId('trends-tov-lineups')).toHaveCount(0);
    await expect(page.getByTestId('trends-tov-1')).toHaveCount(0);
  });
});
