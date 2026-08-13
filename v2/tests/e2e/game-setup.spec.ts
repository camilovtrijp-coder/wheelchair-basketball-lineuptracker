import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const ACTIVE_GAME_KEY = 'lineup-tracker-v2-active-game:org-rotterdam:team-u23';

async function readActiveGame(page: Page): Promise<unknown> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), ACTIVE_GAME_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { __corrupt: raw };
  }
}

/**
 * Voegt 5 spelers toe en herlaadt daarna de pagina. Spiegelt v1's
 * `init()`-gedrag (index.html): een nog-niet-gestarte wedstrijdopzet wordt
 * alleen vers vanaf de roster afgeleid bij het (opnieuw) laden van de app —
 * niet live bij een tabwissel binnen dezelfde sessie (zie de toelichting bij
 * de gameRepo-effects in App.tsx). Zonder deze reload zou de wedstrijdopzet
 * hier de spelerslijst tonen van vóór het toevoegen — precies zoals in v1.
 */
async function addFiveNamedPlayersAndReload(page: Page): Promise<void> {
  // Vastzetten op Nederlands: de assertions hieronder controleren specifieke
  // NL-teksten (validatiemeldingen) om de i18n-wiring zelf mee te toetsen.
  // Zonder dit valt de taal terug op de browser-`navigator.language`, die in
  // een headless CI-omgeving doorgaans Engels is.
  await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
  await page.goto('/');
  await page.getByTestId('nav-roster').click();
  for (let i = 0; i < 5; i += 1) {
    await page.getByTestId('roster-add').click();
  }
  const names = page.locator('[data-testid^="roster-naam-"]');
  await expect(names).toHaveCount(5);
  for (let i = 0; i < 5; i += 1) {
    await names.nth(i).fill(`Speler ${i + 1}`);
  }
  await page.getByTestId('roster-save').click();
  await page.reload();
}

test.describe('v2 wedstrijdopzet (PR 6.1)', () => {
  test('vijf deelnemende spelers zonder gekozen starters mogen starten (automatische keuze)', async ({
    page,
  }) => {
    await addFiveNamedPlayersAndReload(page);
    await page.getByTestId('nav-game').click();

    await expect(page.locator('[data-testid^="game-participate-"]')).toHaveCount(5);
    await expect(page.getByTestId('game-starters-info')).toContainText('Geen starters gekozen');

    const startBtn = page.getByTestId('game-start-btn');
    await expect(startBtn).toBeEnabled();
    await expect(startBtn).toHaveText('Start wedstrijd');
  });

  test('minder dan 5 deelnemers blokkeert starten met de juiste foutmelding', async ({ page }) => {
    await addFiveNamedPlayersAndReload(page);
    await page.getByTestId('nav-game').click();

    // Eén speler op "niet meedoen" zetten → nog maar 4 deelnemers.
    await page.locator('[data-testid^="game-participate-"]').first().click();

    const startBtn = page.getByTestId('game-start-btn');
    await expect(startBtn).toBeDisabled();
    await expect(startBtn).toHaveText('Minimaal 5 deelnemende spelers nodig');
  });

  test('kiezen van 1-4 starters blokkeert starten; 5 starters staat toe', async ({ page }) => {
    await addFiveNamedPlayersAndReload(page);
    await page.getByTestId('nav-game').click();

    const startToggles = page.locator('[data-testid^="game-start-"]');
    await startToggles.nth(0).click();
    await startToggles.nth(1).click();

    const startBtn = page.getByTestId('game-start-btn');
    await expect(startBtn).toBeDisabled();
    await expect(startBtn).toHaveText('Kies precies 5 starters (of 0 voor automatisch)');

    await startToggles.nth(2).click();
    await startToggles.nth(3).click();
    await startToggles.nth(4).click();

    await expect(startBtn).toBeEnabled();
    await expect(page.getByTestId('game-starters-info')).toContainText('5/5');
  });

  test('starten persisteert de wedstrijd in "tracking"-fase, met het live-scherm en org/team-scope', async ({
    page,
  }) => {
    await addFiveNamedPlayersAndReload(page);
    await page.getByTestId('nav-game').click();
    await page.getByTestId('game-opponent').fill('Team B');
    await page.getByTestId('game-start-btn').click();

    // Live wedstrijdscherm (PR 6.2) vervangt de opzetflow zodra phase='tracking'.
    await expect(page.getByTestId('score-row-for')).toBeVisible();
    await expect(page.getByTestId('game-opponent')).not.toBeVisible();

    const stored = (await readActiveGame(page)) as {
      phase: string;
      organizationId: string;
      teamId: string;
      opponent: string;
      onCourt: string[];
      players: unknown[];
    };
    expect(stored.phase).toBe('tracking');
    expect(stored.organizationId).toBe('org-rotterdam');
    expect(stored.teamId).toBe('team-u23');
    expect(stored.opponent).toBe('Team B');
    expect(stored.onCourt).toHaveLength(5);
    expect(stored.players).toHaveLength(5);

    // Blijft na reload in het live-scherm staan (geen nieuwe wedstrijd, geen dataverlies) —
    // v1-pariteit: alleen een gestarte ('tracking') wedstrijd wordt hervat, zie App.tsx.
    await page.reload();
    await page.getByTestId('nav-game').click();
    await expect(page.getByTestId('score-row-for')).toBeVisible();
  });

  test('een nog-niet-gestarte opzet overleeft een reload NIET (v1-pariteit: alleen "tracking" hervat)', async ({
    page,
  }) => {
    await addFiveNamedPlayersAndReload(page);
    await page.getByTestId('nav-game').click();
    await page.getByTestId('game-opponent').fill('Weggegooide tegenstander');
    await page.getByTestId('game-competition').fill('Weggegooide competitie');

    // Spiegelt v1's init(): een `phase: 'setup'`-wedstrijd wordt bij het laden
    // genegeerd en vers vanaf de actuele roster afgeleid — pas na "Start
    // wedstrijd" (fase 'tracking') moet niets meer verloren gaan.
    await page.reload();
    await page.getByTestId('nav-game').click();
    await expect(page.getByTestId('game-opponent')).toHaveValue('');
    await expect(page.getByTestId('game-competition')).toHaveValue('');
    await expect(page.locator('[data-testid^="game-participate-"]')).toHaveCount(5);
  });
});
