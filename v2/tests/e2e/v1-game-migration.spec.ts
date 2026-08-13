import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const V1_ACTIVE_GAME_KEY = 'lineup-tracker-v1';
const V1_MIGRATED_FLAG_KEY = 'lineup-tracker-v2-v1-game-migrated';
const ACTIVE_GAME_KEY = 'lineup-tracker-v2-active-game:org-rotterdam:team-u23';

const V1_BLOB = {
  phase: 'tracking',
  players: [
    {
      id: 1,
      nr: '4',
      naam: 'Anna',
      kl: '3.0',
      vrouw: false,
      jeugd: false,
      participate: true,
      start: true,
    },
    {
      id: 2,
      nr: '7',
      naam: 'Bo',
      kl: '1.5',
      vrouw: false,
      jeugd: false,
      participate: true,
      start: true,
    },
    {
      id: 3,
      nr: '9',
      naam: 'Cas',
      kl: '4.5',
      vrouw: false,
      jeugd: false,
      participate: true,
      start: true,
    },
    {
      id: 4,
      nr: '11',
      naam: 'Dee',
      kl: '2.0',
      vrouw: false,
      jeugd: false,
      participate: true,
      start: true,
    },
    {
      id: 5,
      nr: '15',
      naam: 'Eef',
      kl: '3.5',
      vrouw: false,
      jeugd: false,
      participate: true,
      start: true,
    },
  ],
  onCourt: [1, 2, 3, 4, 5],
  curQuarter: 1,
  opponent: 'V1 tegenstander',
  competition: '',
  clockDown: true,
  limitStr: '14.5',
  beginMin: 10,
  beginSec: 0,
  endMin: 10,
  endSec: 0,
  segments: [],
  scoreFor: 6,
  scoreAgainst: 4,
  segStartFor: 0,
  segStartAgainst: 0,
  savedAt: 1700000000000,
};

async function seedV1GameAndOpenGameTab(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, value, langKey]) => {
      window.localStorage.setItem(key, JSON.stringify(value));
      window.localStorage.setItem(langKey as string, 'nl');
    },
    [V1_ACTIVE_GAME_KEY, V1_BLOB, 'lineup-tracker-lang'] as const,
  );
  await page.goto('/');
  await page.getByTestId('nav-game').click();
}

async function readLocalStorage(page: Page, key: string): Promise<unknown> {
  const raw = await page.evaluate((k) => window.localStorage.getItem(k), key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

test.describe('v2 v1-wedstrijdmigratie (PR 6.1-review, aug. 2026)', () => {
  test('toont een bevestigingsvoorstel i.p.v. de wedstrijd automatisch te adopteren', async ({
    page,
  }) => {
    await seedV1GameAndOpenGameTab(page);

    await expect(page.getByTestId('v1-migration-opponent')).toHaveText('V1 tegenstander');
    await expect(page.getByTestId('v1-migration-target')).toBeVisible();
    await expect(page.getByTestId('v1-migration-score')).toHaveText('6 – 4');
    // Nog niets geschreven zolang niet bevestigd is.
    expect(await readLocalStorage(page, ACTIVE_GAME_KEY)).toBeNull();
    expect(await readLocalStorage(page, V1_MIGRATED_FLAG_KEY)).toBeNull();
    // De live-tracker/opzetscherm mogen nog niet zichtbaar zijn.
    await expect(page.getByTestId('score-row-for')).not.toBeVisible();
    await expect(page.getByTestId('game-opponent')).not.toBeVisible();
  });

  test('blijft het voorstel tonen (schrijft niets) zolang niet bevestigd, ook na een reload', async ({
    page,
  }) => {
    await seedV1GameAndOpenGameTab(page);
    await page.reload();
    await page.getByTestId('nav-game').click();

    await expect(page.getByTestId('v1-migration-opponent')).toHaveText('V1 tegenstander');
    expect(await readLocalStorage(page, ACTIVE_GAME_KEY)).toBeNull();
  });

  test('bevestigen persisteert de wedstrijd onder de v2-sleutel en toont het live-scherm', async ({
    page,
  }) => {
    await seedV1GameAndOpenGameTab(page);

    await page.getByTestId('v1-migration-confirm').click();

    await expect(page.getByTestId('score-row-for')).toBeVisible();
    await expect(page.getByTestId('v1-migration-confirm')).not.toBeVisible();

    const stored = (await readLocalStorage(page, ACTIVE_GAME_KEY)) as {
      phase: string;
      organizationId: string;
      teamId: string;
      opponent: string;
    };
    expect(stored.phase).toBe('tracking');
    expect(stored.organizationId).toBe('org-rotterdam');
    expect(stored.teamId).toBe('team-u23');
    expect(stored.opponent).toBe('V1 tegenstander');
    expect(await readLocalStorage(page, V1_MIGRATED_FLAG_KEY)).not.toBeNull();

    // Blijft na reload in het live-scherm staan, niet opnieuw het voorstel.
    await page.reload();
    await page.getByTestId('nav-game').click();
    await expect(page.getByTestId('score-row-for')).toBeVisible();
  });
});
