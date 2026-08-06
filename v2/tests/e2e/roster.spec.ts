import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const ROSTER_KEY = 'lineup-tracker-roster';
const SETTINGS_KEY = 'lineup-tracker-settings';
const V1_KEYS_THAT_MUST_NOT_BE_TOUCHED = [
  'lineup-tracker-v1',
  'lineup-tracker-games',
  'lineup-tracker-schema-version',
];

async function readRoster(page: Page): Promise<unknown> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), ROSTER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { __corrupt: raw };
  }
}

async function goToTeamTab(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('nav-roster').click();
}

async function acceptNextDialog(page: Page): Promise<void> {
  page.once('dialog', (dialog) => dialog.accept());
}

async function dismissNextDialog(page: Page): Promise<void> {
  page.once('dialog', (dialog) => dialog.dismiss());
}

test.describe('v2 roster', () => {
  test('toevoegen en opslaan persisteert een nieuwe speler na reload', async ({ page }) => {
    await goToTeamTab(page);
    await page.getByTestId('roster-add').click();

    const rows = page.locator('[data-testid^="roster-naam-"]');
    await expect(rows).toHaveCount(1);
    await rows.first().fill('Jan Janssen');
    await page.getByTestId('roster-save').click();

    const stored = await readRoster(page);
    expect(stored).toEqual([
      { id: 1, nr: '1', naam: 'Jan Janssen', kl: '3.0', vrouw: false, jeugd: false },
    ]);

    await page.reload();
    await page.getByTestId('nav-roster').click();
    await expect(page.locator('[data-testid^="roster-naam-"]')).toHaveValue('Jan Janssen');
  });

  test('veldwijzigingen persisteren pas na een expliciete save', async ({ page }) => {
    await goToTeamTab(page);
    await page.getByTestId('roster-add').click();
    await page.locator('[data-testid^="roster-naam-"]').first().fill('Niet opgeslagen');

    expect(await readRoster(page)).toBeNull();

    await page.getByTestId('roster-save').click();
    const stored = (await readRoster(page)) as Array<{ naam: string }>;
    expect(stored[0]?.naam).toBe('Niet opgeslagen');
  });

  test('sorteert automatisch op rugnummer na opslaan', async ({ page }) => {
    await goToTeamTab(page);
    await page.getByTestId('roster-add').click();
    await page.locator('[data-testid^="roster-naam-"]').first().fill('Eerste');
    await page.getByTestId('roster-save').click();

    await page.getByTestId('roster-add').click();
    const names = page.locator('[data-testid^="roster-naam-"]');
    await expect(names).toHaveCount(2);
    await names.nth(1).fill('Tweede');

    // Tweede speler krijgt automatisch nr "2"; wijzig naar "0" zodat hij vóór "Eerste" (nr "1") komt.
    const nrInputs = page.locator('[data-testid^="roster-nr-"]');
    await nrInputs.nth(1).fill('0');
    await page.getByTestId('roster-save').click();

    const stored = (await readRoster(page)) as Array<{ naam: string; nr: string }>;
    expect(stored.map((p) => p.naam)).toEqual(['Tweede', 'Eerste']);
  });

  test('toont een waarschuwing bij dubbele rugnummers en verbergt die weer', async ({ page }) => {
    await goToTeamTab(page);
    await page.getByTestId('roster-add').click();
    await page.locator('[data-testid^="roster-naam-"]').first().fill('Speler A');
    await page.getByTestId('roster-add').click();

    const names = page.locator('[data-testid^="roster-naam-"]');
    await names.nth(1).fill('Speler B');
    const nrInputs = page.locator('[data-testid^="roster-nr-"]');
    // .blur() na .fill(): de wijziging committeert pas bij het verliezen van focus
    // (zelfde patroon als de quarterCount-clamp-test in settings.spec.ts).
    await nrInputs.nth(1).fill('1');
    await nrInputs.nth(1).blur();

    await expect(page.getByTestId('roster-dup-warning')).toBeVisible();

    await nrInputs.nth(1).fill('2');
    await nrInputs.nth(1).blur();
    await expect(page.getByTestId('roster-dup-warning')).toHaveCount(0);
  });

  test('verwijderen vraagt bevestiging en verwijdert pas na accepteren', async ({ page }) => {
    await goToTeamTab(page);
    await page.getByTestId('roster-add').click();
    await page.locator('[data-testid^="roster-naam-"]').first().fill('Te verwijderen');
    await page.getByTestId('roster-save').click();

    const removeBtn = page.locator('[data-testid^="roster-remove-"]').first();

    await dismissNextDialog(page);
    await removeBtn.click();
    await expect(page.locator('[data-testid^="roster-naam-"]')).toHaveCount(1);

    await acceptNextDialog(page);
    await removeBtn.click();
    await expect(page.locator('[data-testid^="roster-naam-"]')).toHaveCount(0);

    await page.getByTestId('roster-save').click();
    expect(await readRoster(page)).toEqual([]);
  });

  test('classificatievelden zijn verborgen tenzij het classificatiesysteem aanstaat', async ({
    page,
  }) => {
    await goToTeamTab(page);
    await page.getByTestId('roster-add').click();
    await expect(page.locator('[data-testid^="roster-kl-"]')).toHaveCount(0);

    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-useClassLimit').check();
    await page.getByTestId('settings-save').click();

    await page.getByTestId('nav-roster').click();
    await expect(page.locator('[data-testid^="roster-kl-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="roster-vrouw-"]')).toHaveCount(1);
  });

  test('v1-roster met onbekende velden blijft leesbaar; save schrijft alleen bekende velden weg', async ({
    page,
    context,
  }) => {
    await context.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
      key: ROSTER_KEY,
      value: JSON.stringify([
        { id: 1, nr: '4', naam: 'Legacy', kl: '2.5', vrouw: true, jeugd: false, legacyFlag: 'x' },
      ]),
    });

    await goToTeamTab(page);
    await expect(page.locator('[data-testid^="roster-naam-"]')).toHaveValue('Legacy');

    await page.getByTestId('roster-save').click();
    const stored = (await readRoster(page)) as Array<Record<string, unknown>>;
    expect(stored[0]).toEqual({
      id: 1,
      nr: '4',
      naam: 'Legacy',
      kl: '2.5',
      vrouw: true,
      jeugd: false,
    });
    expect(stored[0]?.legacyFlag).toBeUndefined();
  });

  test('gebruik van het Team-tabblad raakt geen instellingen- of v1-keys aan', async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('lineup-tracker-v1', JSON.stringify({ players: [] }));
      window.localStorage.setItem('lineup-tracker-games', '[]');
      window.localStorage.setItem('lineup-tracker-schema-version', '1');
    });

    await goToTeamTab(page);
    await page.getByTestId('roster-add').click();
    await page.locator('[data-testid^="roster-naam-"]').first().fill('Solo');
    await page.getByTestId('roster-save').click();

    const settingsValue = await page.evaluate((k) => window.localStorage.getItem(k), SETTINGS_KEY);
    expect(settingsValue).toBeNull();

    for (const key of V1_KEYS_THAT_MUST_NOT_BE_TOUCHED) {
      const value = await page.evaluate((k) => window.localStorage.getItem(k), key);
      expect(value, `v2 heeft onverwacht v1-key "${key}" aangeraakt`).not.toBeNull();
    }
  });

  test('NL/EN-switch toont de juiste teamlabels', async ({ page, context }) => {
    await context.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
      key: 'lineup-tracker-lang',
      value: 'nl',
    });
    await goToTeamTab(page);
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
    await expect(page.getByText('+ Speler toevoegen', { exact: true })).toBeVisible();

    await page.getByTestId('lang-switch').click();
    await expect(page.getByText('+ Add player', { exact: true })).toBeVisible();
  });
});
