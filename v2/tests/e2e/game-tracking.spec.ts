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
 * Zet spelers op, herlaadt (v1-pariteit — zie game-setup.spec.ts) en start de
 * wedstrijd, zodat elke test hier meteen op het live-scherm begint. Bij meer
 * dan 5 spelers kiest "Start wedstrijd" automatisch de 5 laagste rugnummers
 * (geen expliciete starters gekozen), zodat de rest op de bank begint.
 */
async function startTrackedGame(page: Page, playerCount = 5): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
  await page.goto('/');
  await page.getByTestId('nav-roster').click();
  for (let i = 0; i < playerCount; i += 1) {
    await page.getByTestId('roster-add').click();
  }
  const names = page.locator('[data-testid^="roster-naam-"]');
  await expect(names).toHaveCount(playerCount);
  for (let i = 0; i < playerCount; i += 1) {
    await names.nth(i).fill(`Speler ${i + 1}`);
  }
  await page.getByTestId('roster-save').click();
  await page.reload();

  await page.getByTestId('nav-game').click();
  await page.getByTestId('game-start-btn').click();
  await expect(page.getByTestId('score-row-for')).toBeVisible();
}

test.describe('v2 live wedstrijd (PR 6.2)', () => {
  test('score-knoppen tellen op en klemmen, en persisteren via de actielog', async ({ page }) => {
    await startTrackedGame(page);

    await page.getByTestId('score-plus2-for').click();
    await page.getByTestId('score-plus3-for').click();
    await expect(page.getByTestId('score-select-for')).toHaveValue('5');

    await page.getByTestId('score-plus1-against').click();
    await expect(page.getByTestId('score-select-against')).toHaveValue('1');

    await page.getByTestId('score-minus1-for').click();
    await expect(page.getByTestId('score-select-for')).toHaveValue('4');

    const stored = (await readActiveGame(page)) as { actions: Array<{ type: string }> };
    expect(stored.actions.filter((a) => a.type === 'score-delta')).toHaveLength(4);

    await page.reload();
    await page.getByTestId('nav-game').click();
    await expect(page.getByTestId('score-select-for')).toHaveValue('4');
    await expect(page.getByTestId('score-select-against')).toHaveValue('1');
  });

  test('score kan ook absoluut gezet worden via de select', async ({ page }) => {
    await startTrackedGame(page);
    await page.getByTestId('score-select-for').selectOption('12');
    await expect(page.getByTestId('score-select-for')).toHaveValue('12');
  });

  test('rechtstreeks een segment opslaan (zonder wissel) registreert het segment en schuift begin/eind door', async ({
    page,
  }) => {
    await startTrackedGame(page);
    await page.getByTestId('score-plus3-for').click();
    await page.getByTestId('score-plus1-against').click();

    // Klok telt af vanaf 10:00; eind op 5:00 zetten → 5 minuten segment.
    await page.getByTestId('end-min').selectOption('5');
    await expect(page.getByTestId('segment-duration')).toContainText('5:00');

    await page.getByTestId('save-segment-btn').click();

    await expect(page.locator('[data-testid^="segment-item-"]')).toHaveCount(1);
    await expect(page.getByTestId('begin-min')).toHaveValue('5');
    await expect(page.getByTestId('end-min')).toHaveValue('5');

    const stored = (await readActiveGame(page)) as {
      actions: Array<{ type: string; segment?: { durSec: number; pf: number; pa: number } }>;
    };
    const saved = stored.actions.find((a) => a.type === 'segment-saved');
    expect(saved?.segment?.durSec).toBe(300);
    expect(saved?.segment?.pf).toBe(3);
    expect(saved?.segment?.pa).toBe(1);
  });

  test('Segment opslaan blijft uitgeschakeld zolang de duur ongeldig is', async ({ page }) => {
    await startTrackedGame(page);
    // Eind gelijk aan begin (10:00) → duur 0, ongeldig.
    await expect(page.getByTestId('save-segment-btn')).toBeDisabled();
  });

  test('volledige wisselflow: tikken, klaar met wisselen, kloktijd bevestigen sluit het segment met de opstelling van vóór de wissel', async ({
    page,
  }) => {
    await startTrackedGame(page, 6);

    const courtChips = page.locator('[data-testid^="court-chip-"]');
    const benchChips = page.locator('[data-testid^="bench-chip-"]');
    await expect(courtChips).toHaveCount(5);
    await expect(benchChips).toHaveCount(1);

    const courtIdBefore = await courtChips.first().getAttribute('data-testid');
    const benchId = await benchChips.first().getAttribute('data-testid');

    await courtChips.first().click();
    await expect(page.getByTestId('swap-selected')).toBeVisible();
    await benchChips.first().click();

    // Na de wissel: de bank-speler staat nu op de vloer, de oude vloerspeler op de bank.
    await expect(page.getByTestId(benchId!.replace('bench-chip-', 'court-chip-'))).toBeVisible();
    await expect(
      page.getByTestId(courtIdBefore!.replace('court-chip-', 'bench-chip-')),
    ).toBeVisible();

    await page.getByTestId('swap-done-btn').click();
    await expect(page.getByTestId('swap-confirm-modal')).toBeVisible();
    await page.getByTestId('swap-confirm-min').selectOption('6'); // 4 minuten sinds begin (10:00)
    await expect(page.getByTestId('swap-confirm-duration')).toContainText('4:00');
    await page.getByTestId('swap-confirm-confirm').click();

    await expect(page.getByTestId('swap-confirm-modal')).not.toBeVisible();
    await expect(page.locator('[data-testid^="segment-item-"]')).toHaveCount(1);

    const stored = (await readActiveGame(page)) as {
      actions: Array<{ type: string; segment?: { lineup: string[]; durSec: number } }>;
      onCourt: string[];
    };
    const saved = stored.actions.find((a) => a.type === 'segment-saved');
    expect(saved?.segment?.durSec).toBe(240);
    // Het opgeslagen segment gebruikt de opstelling van VÓÓR de wissel.
    expect(saved?.segment?.lineup).not.toEqual(stored.onCourt);
  });

  test('een segment bewerken herberekent de score; verwijderen ook', async ({ page }) => {
    await startTrackedGame(page);
    await page.getByTestId('score-plus2-for').click();
    await page.getByTestId('end-min').selectOption('5');
    await page.getByTestId('save-segment-btn').click();
    await expect(page.locator('[data-testid^="segment-item-"]')).toHaveCount(1);

    // Extra, nog niet opgeslagen score na het segment.
    await page.getByTestId('score-plus1-for').click();
    await expect(page.getByTestId('score-select-for')).toHaveValue('3'); // 2 (segment) + 1 (live)

    await page.locator('[data-testid^="segment-item-"]').first().click();
    await expect(page.getByTestId('edit-segment-modal')).toBeVisible();
    await page.getByTestId('edit-pf').fill('5');
    await page.getByTestId('edit-segment-save').click();

    await expect(page.getByTestId('edit-segment-modal')).not.toBeVisible();
    await expect(page.getByTestId('score-select-for')).toHaveValue('6'); // 5 (nieuw) + 1 (live behouden)

    await page.locator('[data-testid^="segment-item-"]').first().click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('edit-segment-delete').click();

    await expect(page.locator('[data-testid^="segment-item-"]')).toHaveCount(0);
    await expect(page.getByTestId('score-select-for')).toHaveValue('1'); // alleen de live-delta blijft over
  });

  test('classificatiewaarschuwing verschijnt boven de limiet', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
    await page.goto('/');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-useClassLimit').check();
    await page.getByTestId('settings-save').click();

    await page.getByTestId('nav-roster').click();
    for (let i = 0; i < 5; i += 1) {
      await page.getByTestId('roster-add').click();
    }
    const names = page.locator('[data-testid^="roster-naam-"]');
    for (let i = 0; i < 5; i += 1) {
      await names.nth(i).fill(`Speler ${i + 1}`);
    }
    // Hoge classificatiewaarden zetten zodat de vaste basislimiet (14.5) ruim overschreden wordt.
    const klInputs = page.locator('[data-testid^="roster-kl-"]');
    for (let i = 0; i < 5; i += 1) {
      await klInputs.nth(i).fill('4.5');
    }
    await page.getByTestId('roster-save').click();
    await page.reload();

    await page.getByTestId('nav-game').click();
    await page.getByTestId('game-start-btn').click();

    await expect(page.getByTestId('class-warning')).toBeVisible();
    await expect(page.getByTestId('class-badge')).toHaveClass(/class-badge--over/);
  });
});
