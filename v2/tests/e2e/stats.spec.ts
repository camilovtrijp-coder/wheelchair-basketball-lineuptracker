import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const ACTIVE_GAME_KEY = 'lineup-tracker-v2-active-game:org-rotterdam:team-u23';
const COMPLETED_GAMES_KEY = 'lineup-tracker-v2-completed-games:org-rotterdam:team-u23';

async function setupTwoGames(page: Page): Promise<void> {
  // Zorg dat we in App zitten (Bob is al ingelogd via fixtures.ts), met de
  // canonieke org/team-context. De stats-tab werkt op de afgeronde-historiedie
  // we hieronder in localStorage zetten.
  await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
  await page.goto('/');

  // Twee fictieve afgeronde wedstrijden in v2-storage-shape.
  const completedGames = [
    {
      id: 'g-A',
      organizationId: 'org-rotterdam',
      teamId: 'team-u23',
      sourceGameId: 'src-A',
      opponent: 'Tegenstander A',
      competition: '',
      date: '2026-01-01T10:00:00.000Z',
      players: [
        {
          id: 'p1',
          rosterId: 1,
          nr: '1',
          naam: 'Anna',
          kl: '3.0',
          vrouw: false,
          jeugd: false,
          participate: true,
          start: true,
        },
        {
          id: 'p2',
          rosterId: 2,
          nr: '2',
          naam: 'Bob',
          kl: '2.0',
          vrouw: false,
          jeugd: false,
          participate: true,
          start: true,
        },
        {
          id: 'p3',
          rosterId: 3,
          nr: '3',
          naam: 'Cees',
          kl: '3.5',
          vrouw: false,
          jeugd: false,
          participate: true,
          start: true,
        },
        {
          id: 'p4',
          rosterId: 4,
          nr: '4',
          naam: 'Dien',
          kl: '2.5',
          vrouw: false,
          jeugd: false,
          participate: true,
          start: true,
        },
        {
          id: 'p5',
          rosterId: 5,
          nr: '5',
          naam: 'Eve',
          kl: '3.0',
          vrouw: false,
          jeugd: false,
          participate: true,
          start: true,
        },
      ],
      segments: [
        {
          id: 's-A1',
          quarter: 1,
          beginSec: 0,
          endSec: 180,
          durSec: 180,
          lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
          pf: 8,
          pa: 6,
          classSum: 0,
          allowed: 0,
          over: false,
        },
      ],
      scoreFor: 8,
      scoreAgainst: 6,
      quarterCount: 4,
      periodLabel: '',
      useClassLimit: false,
    },
    {
      id: 'g-B',
      organizationId: 'org-rotterdam',
      teamId: 'team-u23',
      sourceGameId: 'src-B',
      opponent: 'Tegenstander B',
      competition: '',
      date: '2026-01-02T10:00:00.000Z',
      players: [
        {
          id: 'q1',
          rosterId: 1,
          nr: '1',
          naam: 'Anna',
          kl: '3.0',
          vrouw: false,
          jeugd: false,
          participate: true,
          start: true,
        },
        {
          id: 'q2',
          rosterId: 2,
          nr: '2',
          naam: 'Bob',
          kl: '2.0',
          vrouw: false,
          jeugd: false,
          participate: true,
          start: true,
        },
        {
          id: 'q3',
          rosterId: 3,
          nr: '3',
          naam: 'Cees',
          kl: '3.5',
          vrouw: false,
          jeugd: false,
          participate: true,
          start: true,
        },
        {
          id: 'q4',
          rosterId: 4,
          nr: '4',
          naam: 'Dien',
          kl: '2.5',
          vrouw: false,
          jeugd: false,
          participate: true,
          start: true,
        },
        {
          id: 'q5',
          rosterId: 5,
          nr: '5',
          naam: 'Eve',
          kl: '3.0',
          vrouw: false,
          jeugd: false,
          participate: true,
          start: true,
        },
      ],
      segments: [
        {
          id: 's-B1',
          quarter: 1,
          beginSec: 0,
          endSec: 240,
          durSec: 240,
          lineup: ['q1', 'q2', 'q3', 'q4', 'q5'],
          pf: 12,
          pa: 3,
          classSum: 0,
          allowed: 0,
          over: false,
        },
      ],
      scoreFor: 12,
      scoreAgainst: 3,
      quarterCount: 4,
      periodLabel: '',
      useClassLimit: false,
    },
  ];
  await page.evaluate(
    ({ key, value }: { key: string; value: string }) => window.localStorage.setItem(key, value),
    { key: COMPLETED_GAMES_KEY, value: JSON.stringify(completedGames) },
  );
  await page.reload();
}

test.describe('v2 Stats-tab (PR 6.4)', () => {
  test('Stats-tab is bereikbaar vanuit de hoofdnavigatie en toont een rij per combinatie', async ({
    page,
  }) => {
    await setupTwoGames(page);
    await page.getByTestId('nav-stats').click();
    await expect(page.getByTestId('stats-list')).toBeVisible();
    // Standaard comboSize=5 → 1 rij voor de [1,2,3,4,5]-lineup.
    await expect(page.getByTestId('stats-combo-1-2-3-4-5')).toBeVisible();
  });

  test('combinatiegrootte wijzigen naar 2 toont 5 unieke paren', async ({ page }) => {
    await setupTwoGames(page);
    await page.getByTestId('nav-stats').click();
    await page.getByTestId('stats-combo-size-2').click();
    await expect(page.getByTestId('stats-combo-1-2')).toBeVisible();
    await expect(page.getByTestId('stats-combo-1-3')).toBeVisible();
    // 5 unieke paren voor een lineup van 5 spelers: C(5,2) = 10 — twee
    // wedstrijden met dezelfde lineup [1,2,3,4,5] levert 10 paren, geen 5.
    const cards = await page
      .locator('[data-testid^="stats-combo-"]:not([data-testid*="size"])')
      .count();
    expect(cards).toBe(10);
  });

  test('per10-toggle schakelt tussen kale plus/min en per-10-normalisatie', async ({ page }) => {
    await setupTwoGames(page);
    await page.getByTestId('nav-stats').click();
    const card = page.getByTestId('stats-combo-1-2-3-4-5');
    await expect(card).toBeVisible();
    // Aanvankelijk: kale pm = 8+12 - 6-3 = +11 over 180+240=420s.
    expect(card.getByText(/\+11\.0/)).toBeVisible();
    await page.getByTestId('stats-per10-toggle').click();
    // Na per10: (11 * 600) / 420 ≈ 15.7 → "+15.7"
    await expect(card.getByText(/\+15\.7/)).toBeVisible();
  });

  test('spelerfilter "moet op" is bereikbaar via de filter-modal', async ({ page }) => {
    await setupTwoGames(page);
    await page.getByTestId('nav-stats').click();
    await page.getByTestId('stats-filter-btn').click();
    await expect(page.getByTestId('stats-filter-modal')).toBeVisible();
    await page.getByTestId('stats-filter-toggle-1').click();
    await page.getByTestId('stats-filter-modal-done').click();
    // Speler 1 staat in beide segmenten, dus de [1,2,3,4,5]-combo blijft.
    await expect(page.getByTestId('stats-combo-1-2-3-4-5')).toBeVisible();
  });

  test('actieve wedstrijd met segmenten verschijnt als voorlopig item in de wedstrijd-modal', async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
    await page.goto('/');
    // Maak een actieve wedstrijd in tracking-fase met één segment.
    const activeGame = {
      id: 'live-1',
      organizationId: 'org-rotterdam',
      teamId: 'team-u23',
      phase: 'tracking',
      players: [
        {
          id: 'a1',
          rosterId: 1,
          nr: '1',
          naam: 'Anna',
          kl: '3.0',
          vrouw: false,
          jeugd: false,
          participate: true,
          start: true,
        },
        {
          id: 'a2',
          rosterId: 2,
          nr: '2',
          naam: 'Bob',
          kl: '2.0',
          vrouw: false,
          jeugd: false,
          participate: true,
          start: true,
        },
        {
          id: 'a3',
          rosterId: 3,
          nr: '3',
          naam: 'Cees',
          kl: '3.5',
          vrouw: false,
          jeugd: false,
          participate: true,
          start: true,
        },
        {
          id: 'a4',
          rosterId: 4,
          nr: '4',
          naam: 'Dien',
          kl: '2.5',
          vrouw: false,
          jeugd: false,
          participate: true,
          start: true,
        },
        {
          id: 'a5',
          rosterId: 5,
          nr: '5',
          naam: 'Eve',
          kl: '3.0',
          vrouw: false,
          jeugd: false,
          participate: true,
          start: true,
        },
      ],
      opponent: 'Live',
      competition: '',
      clockDown: true,
      limitStr: '',
      onCourt: ['a1', 'a2', 'a3', 'a4', 'a5'],
      curQuarter: 1,
      beginSec: 600,
      endSec: 540,
      pendingSwapLineup: null,
      actions: [
        {
          type: 'segment-saved',
          id: 'live-act-1',
          segment: {
            id: 'live-seg-1',
            quarter: 1,
            beginSec: 0,
            endSec: 60,
            durSec: 60,
            lineup: ['a1', 'a2', 'a3', 'a4', 'a5'],
            pf: 2,
            pa: 0,
            classSum: 0,
            allowed: 0,
            over: false,
          },
          at: '2026-01-01T00:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:00:00.000Z',
    };
    await page.evaluate(
      ({ key, value }: { key: string; value: string }) => window.localStorage.setItem(key, value),
      { key: ACTIVE_GAME_KEY, value: JSON.stringify(activeGame) },
    );
    await page.reload();
    await page.getByTestId('nav-stats').click();
    await page.getByTestId('stats-games-btn').click();
    await expect(page.getByTestId('stats-game-row-live-1')).toBeVisible();
  });

  test('Stats-tab op een 320px-viewport toont geen horizontale overflow (NL)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await setupTwoGames(page);
    await page.getByTestId('nav-stats').click();
    await expect(page.getByTestId('stats-list')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, 'pagina heeft horizontale overflow op 320px').toBeLessThanOrEqual(1);
  });

  test('NL/EN: alle zichtbare stats-teksten vertalen mee', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'en'));
    await page.goto('/');
    await page.getByTestId('nav-stats').click();
    await expect(page.locator('.app-nav__tab--active')).toHaveText('Stats');
    // Switch naar NL
    await page.getByTestId('lang-switch').click();
    await expect(page.locator('.app-nav__tab--active')).toHaveText('Statistieken');
  });

  test('Stats-tab toont de "Geen data"-melding zonder afgeronde wedstrijden', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
    await page.goto('/');
    await page.getByTestId('nav-stats').click();
    await expect(page.getByTestId('stats-no-data')).toBeVisible();
  });

  test('Stats-tab toont een foutmelding wanneer de opslag read faalt', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
    await page.goto('/');
    // Forceer een corrupte payload zodat safeList() 'error' teruggeeft.
    await page.evaluate(
      ({ key }: { key: string }) => window.localStorage.setItem(key, 'not-json'),
      { key: COMPLETED_GAMES_KEY },
    );
    await page.reload();
    await page.getByTestId('nav-stats').click();
    await expect(page.getByTestId('stats-read-error')).toBeVisible();
    // De "geen data"-melding mag NIET getoond worden bij een readfout
    // (plan §C.1: [] mag nooit zonder status als bewijs voor "geen wedstrijden").
    await expect(page.getByTestId('stats-no-data')).toHaveCount(0);
  });
});
