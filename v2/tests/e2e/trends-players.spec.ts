import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

const COMPLETED_GAMES_KEY = 'lineup-tracker-v2-completed-games:org-rotterdam:team-u23';

// Fictieve data: 6 spelers, een wedstrijd met twee kwarten.
// Q1: 1-2-3-4-5, 10:00, 10-6 -> speler 5 op +4 (+4,0 per 10); Q2: 1-2-3-4-6, 10:00, 6-8.
// Speler 5: op 10:00 (+4,0 per 10), af 10:00 (-2,0) -> verschil +6,0 -> beter.
// Speler 6: op 10:00 (-2,0), af 10:00 (+4,0) -> verschil -6,0 -> slechter.
// Spelers 1-4 speelden alles (+1,0 per 10 over 20:00), 2 stints van 10:00.
const ROSTER = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '3.0',
  vrouw: false,
  jeugd: false,
}));

const GAME_PLAYERS = ROSTER.map((p) => ({
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
  const games = [
    {
      id: 'g-P',
      organizationId: 'org-rotterdam',
      teamId: 'team-u23',
      sourceGameId: 'src-P',
      opponent: 'Tegenstander P',
      competition: '',
      date: '2026-01-01T10:00:00.000Z',
      players: GAME_PLAYERS,
      segments: [
        {
          id: 's-1',
          quarter: 1,
          beginSec: 600,
          endSec: 0,
          durSec: 600,
          lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
          pf: 10,
          pa: 6,
          classSum: 0,
          allowed: 0,
          over: false,
        },
        {
          id: 's-2',
          quarter: 2,
          beginSec: 600,
          endSec: 0,
          durSec: 600,
          lineup: ['p1', 'p2', 'p3', 'p4', 'p6'],
          pf: 6,
          pa: 8,
          classSum: 0,
          allowed: 0,
          over: false,
        },
      ],
      scoreFor: 16,
      scoreAgainst: 14,
      quarterCount: 4,
      periodLabel: '',
      useClassLimit: false,
    },
  ];
  await page.evaluate(
    ({ key, value }: { key: string; value: string }) => window.localStorage.setItem(key, value),
    { key: COMPLETED_GAMES_KEY, value: JSON.stringify(games) },
  );
  await page.reload();
  await page.getByTestId('nav-trends').click();
  await page.getByTestId('trends-tab-players').click();
}

test.describe('v2 Trends: weergave Spelers (on/off en stints)', () => {
  test('uitklappen toont on/off en stints (NL)', async ({ page }) => {
    await setup(page);
    await expect(page.getByTestId('trends-players-row-onoff-5')).toContainText('Op +4.0 · Af -2.0');
    await expect(page.getByTestId('trends-players-row-onoff-5')).toContainText('▲');
    await expect(page.getByTestId('trends-players-row-onoff-1')).toHaveText('Speelde alles');

    await page.getByTestId('trends-row-toggle-5').click();
    await expect(page.getByTestId('trends-players-on-5')).toHaveText('+4.0');
    await expect(page.getByTestId('trends-players-on-min-5')).toContainText('10:00');
    await expect(page.getByTestId('trends-players-off-5')).toHaveText('-2.0');
    await expect(page.getByTestId('trends-players-diff-value-5')).toHaveText('+6.0');
    await expect(page.getByTestId('trends-players-diff-5')).toContainText('beter');
    await expect(page.getByTestId('trends-players-onoff-group-5')).toHaveAccessibleName(
      'Speler 5: op het veld +4.0 per 10 in 10:00, af het veld -2.0 in 10:00, verschil +6.0, beter',
    );
    await expect(page.getByTestId('trends-players-stints-count-5')).toHaveText('1');
    await expect(page.getByTestId('trends-players-stints-longest-5')).toHaveText('10:00');
    // Bestaande kaart blijft aanwezig.
    await expect(page.getByTestId('trends-totalpm-5')).toHaveText('+4');

    await page.getByTestId('trends-row-toggle-6').click();
    await expect(page.getByTestId('trends-players-diff-6')).toContainText('slechter');
    await expect(page.getByTestId('trends-players-diff-6')).toContainText('▼');

    await page.getByTestId('trends-row-toggle-1').click();
    await expect(page.getByTestId('trends-players-off-1')).toHaveText('Speelde alles');
    await expect(page.getByTestId('trends-players-stints-count-1')).toHaveText('2');
    await expect(page.getByTestId('trends-players-stints-avg-1')).toHaveText('10:00');
    await expect(page.getByTestId('trends-players-stints-warn-1')).toHaveCount(0);
  });

  test('toont Engelse teksten', async ({ page }) => {
    await setup(page, 'en');
    await expect(page.getByTestId('trends-players-row-onoff-1')).toHaveText('Played all minutes');
    await page.getByTestId('trends-row-toggle-5').click();
    await expect(page.getByTestId('trends-players-onoff-5')).toContainText('On and off the court');
    await expect(page.getByTestId('trends-players-diff-5')).toContainText('better');
    await expect(page.getByTestId('trends-players-stints-5')).toContainText('Stints');
  });

  test('past op 320 px zonder horizontale scroll, ook uitgeklapt', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await setup(page);
    await page.getByTestId('trends-row-toggle-5').click();
    await page.getByTestId('trends-row-toggle-1').click();
    await expect(page.getByTestId('trends-players-stints-5')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('heeft geen axe-overtredingen (uitgeklapt)', async ({ page }) => {
    await setup(page);
    await page.getByTestId('trends-row-toggle-5').click();
    await page.getByTestId('trends-row-toggle-6').click();
    await page.getByTestId('trends-row-toggle-1').click();
    await expectNoAxeViolations(page);
  });
});
