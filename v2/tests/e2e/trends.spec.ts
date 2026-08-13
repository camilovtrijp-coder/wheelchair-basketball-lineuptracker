import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const ACTIVE_GAME_KEY = 'lineup-tracker-v2-active-game:org-rotterdam:team-u23';
const COMPLETED_GAMES_KEY = 'lineup-tracker-v2-completed-games:org-rotterdam:team-u23';
// v1-compatibele roster-sleutel (`lineup-tracker-roster`, zie
// `domain/roster/types.ts` ROSTER_STORAGE_KEY) — deze e2e-suite draait in
// lokale modus (onvertrouwd apparaat, zie `fixtures.ts`), dus de "huidige
// roster" komt hieruit, niet uit de Firestore-seeddata. Trends toont per
// plan §C.1 alleen kaarten voor spelers die in DEZE roster voorkomen, dus
// moet expliciet gezet worden (Stats had deze afhankelijkheid niet: combo's
// komen daar rechtstreeks uit de segment-spelerssnapshots).
const CURRENT_ROSTER = [
  { id: 1, nr: '1', naam: 'Anna', kl: '3.0', vrouw: false, jeugd: false },
  { id: 2, nr: '2', naam: 'Bob', kl: '2.0', vrouw: false, jeugd: false },
  { id: 3, nr: '3', naam: 'Cees', kl: '3.5', vrouw: false, jeugd: false },
  { id: 4, nr: '4', naam: 'Dien', kl: '2.5', vrouw: false, jeugd: false },
  { id: 5, nr: '5', naam: 'Eve', kl: '3.0', vrouw: false, jeugd: false },
];

function player(id: string, rosterId: number, nr: string, naam: string) {
  return {
    id,
    rosterId,
    nr,
    naam,
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
  };
}

const FIVE_PLAYERS_A = [
  player('p1', 1, '1', 'Anna'),
  player('p2', 2, '2', 'Bob'),
  player('p3', 3, '3', 'Cees'),
  player('p4', 4, '4', 'Dien'),
  player('p5', 5, '5', 'Eve'),
];

/** Zelfde spelers, andere game-player-UUID's (rosterId blijft identiek — dit
 * moet als dezelfde trendkaart samenkomen, PR 6.5 §E.2). */
const FIVE_PLAYERS_B = [
  player('q1', 1, '1', 'Anna'),
  player('q2', 2, '2', 'Bob'),
  player('q3', 3, '3', 'Cees'),
  player('q4', 4, '4', 'Dien'),
  player('q5', 5, '5', 'Eve'),
];

async function setupTwoGames(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
  await page.addInitScript(
    (roster) => window.localStorage.setItem('lineup-tracker-roster', JSON.stringify(roster)),
    CURRENT_ROSTER,
  );
  await page.goto('/');

  const completedGames = [
    {
      id: 'g-A',
      organizationId: 'org-rotterdam',
      teamId: 'team-u23',
      sourceGameId: 'src-A',
      opponent: 'Tegenstander A',
      competition: '',
      date: '2026-01-01T10:00:00.000Z',
      players: FIVE_PLAYERS_A,
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
      date: '2026-01-08T10:00:00.000Z',
      players: FIVE_PLAYERS_B,
      segments: [
        {
          id: 's-B1',
          quarter: 1,
          beginSec: 0,
          endSec: 240,
          durSec: 240,
          lineup: ['q1', 'q2', 'q3', 'q4', 'q5'],
          pf: 5,
          pa: 4,
          classSum: 0,
          allowed: 0,
          over: false,
        },
      ],
      scoreFor: 5,
      scoreAgainst: 4,
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

test.describe('v2 Trends-tab (PR 6.5)', () => {
  test('Trends-tab is bereikbaar en toont een kaart per gespeelde speler met gemiddelden', async ({
    page,
  }) => {
    await setupTwoGames(page);
    await page.getByTestId('nav-trends').click();
    await expect(page.getByTestId('trends-list')).toBeVisible();
    // rosterId 1 speelde beide wedstrijden onder twee verschillende
    // game-player-UUID's ('p1'/'q1') — moet als één kaart samenkomen.
    const card = page.getByTestId('trends-card-1');
    await expect(card).toBeVisible();
    // totaal 180+240=420s / 60 / 2 wedstrijden = 3.5
    await expect(page.getByTestId('trends-avgmin-1')).toHaveText('3.5');
    // pm: (8-6) + (5-4) = 3, /2 wedstrijden = +1.5
    await expect(page.getByTestId('trends-avgpm-1')).toHaveText('+1.5');
    // grafieken hebben een toegankelijke naam...
    await expect(page.getByTestId('trends-line-chart-1')).toHaveAttribute('role', 'img');
    await expect(page.getByTestId('trends-line-chart-1')).toHaveAccessibleName(/Anna/);
    await expect(page.getByTestId('trends-bar-chart-1')).toHaveAttribute('role', 'img');
    await expect(page.getByTestId('trends-bar-chart-1')).toHaveAccessibleName(/Anna/);
    // ...en de exacte per-punt waarden zijn al beschikbaar (aria-describedby)
    // ZONDER de wedstrijdlijst eerst uit te klappen — vóór de externe
    // PR-6.5-review stonden die waarden alleen in de conditioneel
    // gerenderde uitklaplijst.
    await expect(page.getByTestId('trends-line-points-1')).toContainText('+2.0');
    await expect(page.getByTestId('trends-line-points-1')).toContainText('+1.0');
    await expect(page.getByTestId('trends-bar-points-1')).toContainText('3.0 MIN');
    await expect(page.getByTestId('trends-bar-points-1')).toContainText('4.0 MIN');
  });

  test('per10-toggle herberekent het gemiddelde plus/min per speler', async ({ page }) => {
    await setupTwoGames(page);
    await page.getByTestId('nav-trends').click();
    await expect(page.getByTestId('trends-avgpm-1')).toHaveText('+1.5');
    await page.getByTestId('trends-per10-toggle').click();
    // per punt genormaliseerd: (2*600/180 + 1*600/240)/2 = (6.667+2.5)/2 ≈ 4.6
    await expect(page.getByTestId('trends-avgpm-1')).toHaveText('+4.6');
  });

  test('sorteercyclus doorloopt rugnummer -> minuten -> plus/min', async ({ page }) => {
    await setupTwoGames(page);
    await page.getByTestId('nav-trends').click();
    const toggle = page.getByTestId('trends-sort-toggle');
    await expect(toggle).toContainText('Nr');
    await toggle.click();
    await expect(toggle).toContainText('MIN');
    await toggle.click();
    await expect(toggle).toContainText('+/-');
    await toggle.click();
    await expect(toggle).toContainText('Nr');
  });

  test('wedstrijdlijst kan uit- en ingeklapt worden en toont ruwe minuten/plus-min', async ({
    page,
  }) => {
    await setupTwoGames(page);
    await page.getByTestId('nav-trends').click();
    await page.getByTestId('trends-toggle-games-1').click();
    const list = page.getByTestId('trends-games-list-1');
    await expect(list).toBeVisible();
    await expect(list).toContainText('3:00'); // g-A: 180s
    await expect(list).toContainText('4:00'); // g-B: 240s
    await page.getByTestId('trends-toggle-games-1').click();
    await expect(list).toHaveCount(0);
  });

  test('wedstrijdfilter is gedeeld tussen Stats en Trends', async ({ page }) => {
    await setupTwoGames(page);
    await page.getByTestId('nav-stats').click();
    await page.getByTestId('stats-games-btn').click();
    await expect(page.getByTestId('stats-games-modal')).toBeVisible();
    // Deselecteer wedstrijd B in de Stats-tab.
    await page.getByTestId('stats-game-check-g-B').click();
    await page.getByTestId('stats-games-modal-done').click();

    await page.getByTestId('nav-trends').click();
    // Dezelfde selectie geldt nu in Trends: gemiddelde minuten is alleen van g-A.
    await expect(page.getByTestId('trends-avgmin-1')).toHaveText('3.0'); // 180s/60/1
    await page.getByTestId('trends-games-btn').click();
    await expect(page.getByTestId('trends-game-check-g-B')).not.toBeChecked();
  });

  test('actieve wedstrijd met segmenten verschijnt als voorlopig laatste punt', async ({
    page,
  }) => {
    await setupTwoGames(page);
    const activeGame = {
      id: 'live-1',
      organizationId: 'org-rotterdam',
      teamId: 'team-u23',
      phase: 'tracking',
      players: [
        player('a1', 1, '1', 'Anna'),
        player('a2', 2, '2', 'Bob'),
        player('a3', 3, '3', 'Cees'),
        player('a4', 4, '4', 'Dien'),
        player('a5', 5, '5', 'Eve'),
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
          at: '2026-02-01T00:00:00.000Z',
        },
      ],
      createdAt: '2026-02-01T00:00:00.000Z',
      startedAt: '2026-02-01T00:00:00.000Z',
    };
    await page.evaluate(
      ({ key, value }: { key: string; value: string }) => window.localStorage.setItem(key, value),
      { key: ACTIVE_GAME_KEY, value: JSON.stringify(activeGame) },
    );
    await page.reload();
    await page.getByTestId('nav-trends').click();
    await page.getByTestId('trends-toggle-games-1').click();
    // De lijst toont nieuwste-eerst (TrendsPanel keert de chronologische
    // old->new-punten om voor weergave), dus de EERSTE rij hoort bij de
    // chronologisch laatste — de actieve — wedstrijd en draagt het
    // "Voorlopig"-label.
    const rows = page.getByTestId('trends-games-list-1').locator('li');
    await expect(rows.first()).toContainText('Voorlopig');
  });

  test('Trends-tab op een 320px-viewport toont geen horizontale overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await setupTwoGames(page);
    await page.getByTestId('nav-trends').click();
    await expect(page.getByTestId('trends-list')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, 'pagina heeft horizontale overflow op 320px').toBeLessThanOrEqual(1);
  });

  test('NL/EN: alle zichtbare trends-teksten vertalen mee', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'en'));
    await page.goto('/');
    await page.getByTestId('nav-trends').click();
    await expect(page.locator('.app-nav__tab--active')).toHaveText('Trends');
    await page.getByTestId('lang-switch').click();
    await expect(page.locator('.app-nav__tab--active')).toHaveText('Trends');
  });

  test('Trends-tab toont de "Geen data"-melding zonder afgeronde wedstrijden', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
    await page.goto('/');
    await page.getByTestId('nav-trends').click();
    await expect(page.getByTestId('trends-no-data')).toBeVisible();
  });

  test('Trends-tab toont een foutmelding wanneer de opslag read faalt', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
    await page.goto('/');
    await page.evaluate(
      ({ key }: { key: string }) => window.localStorage.setItem(key, 'not-json'),
      { key: COMPLETED_GAMES_KEY },
    );
    await page.reload();
    await page.getByTestId('nav-trends').click();
    await expect(page.getByTestId('trends-read-error')).toBeVisible();
    await expect(page.getByTestId('trends-no-data')).toHaveCount(0);
  });
});
