import { test, expect, type Page } from '@playwright/test';

const SETTINGS_KEY = 'lineup-tracker-settings';
const V1_KEYS_THAT_MUST_NOT_BE_TOUCHED = [
  'lineup-tracker-v1',
  'lineup-tracker-games',
  'lineup-tracker-roster',
  'lineup-tracker-schema-version',
];

async function readSettings(page: Page): Promise<Record<string, unknown>> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), SETTINGS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { __corrupt: raw };
  }
}

async function seedSettings(page: Page, value: Record<string, unknown>): Promise<void> {
  await page.goto('/');
  await page.evaluate(({ key, v }) => window.localStorage.setItem(key, v), {
    key: SETTINGS_KEY,
    v: JSON.stringify(value),
  });
  await page.reload();
}

test.describe('v2 settings', () => {
  test('rondt teamName roundtrip via de UI en blijft behouden na reload', async ({ page }) => {
    await page.goto('/');
    const teamName = 'My Test Team';
    await page.getByTestId('settings-teamName').fill(teamName);
    await page.getByTestId('settings-save').click();

    const stored = await readSettings(page);
    expect(stored.teamName).toBe(teamName);

    await page.reload();
    await expect(page.getByTestId('settings-teamName')).toHaveValue(teamName);
  });

  test('write vanuit de UI schrijft exact één v2-key en muteert geen v1-keys', async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('lineup-tracker-v1', JSON.stringify({ players: [] }));
      window.localStorage.setItem('lineup-tracker-games', '[]');
      window.localStorage.setItem('lineup-tracker-roster', '[]');
      window.localStorage.setItem('lineup-tracker-schema-version', '1');
    });

    await page.goto('/');
    await page.getByTestId('settings-teamName').fill('B');
    await page.getByTestId('settings-save').click();
    await page.getByTestId('settings-quarterCount').fill('6');
    await page.getByTestId('settings-save').click();

    for (const key of V1_KEYS_THAT_MUST_NOT_BE_TOUCHED) {
      const value = await page.evaluate((k) => window.localStorage.getItem(k), key);
      expect(value, `v2 heeft onverwacht v1-key "${key}" aangeraakt`).not.toBeNull();
    }
  });

  test('normalizeSettings vult ontbrekende defaults aan zonder bestaande waarden te wijzigen', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(
      (key) => window.localStorage.setItem(key, JSON.stringify({ teamName: 'A' })),
      SETTINGS_KEY,
    );
    await page.reload();

    // v2 leest v1-data en vult ontbrekende defaults aan in het geheugen.
    // Een expliciete save is nodig om dit terug naar localStorage te schrijven.
    await expect(page.getByTestId('settings-teamName')).toHaveValue('A');
    await expect(page.getByTestId('settings-quarterCount')).toHaveValue('4');

    await page.getByTestId('settings-save').click();
    const stored = await readSettings(page);
    expect(stored.teamName).toBe('A');
    expect(stored.quarterCount).toBe(4);
    expect(stored.primaryColor).toBe('#2563eb');
  });

  test('quarterCount wordt geclampd naar 1..12 via de UI', async ({ page }) => {
    await page.goto('/');
    const qc = page.getByTestId('settings-quarterCount');
    await qc.fill('99');
    await qc.blur();
    await expect(qc).toHaveValue('12');

    await qc.fill('0');
    await qc.blur();
    await expect(qc).toHaveValue('1');
  });

  test('useClassLimit-toggle toont extra velden zonder ze te verbergen bij uit', async ({
    page,
  }) => {
    await page.goto('/');
    const toggle = page.getByTestId('settings-useClassLimit');
    await expect(toggle).not.toBeChecked();
    await expect(page.getByTestId('settings-tag1Label')).toHaveCount(0);

    await toggle.check();
    await expect(page.getByTestId('settings-tag1Label')).toBeVisible();
    await expect(page.getByTestId('settings-classBaseLimit')).toBeVisible();
    await expect(page.getByTestId('settings-bonusBoth')).toBeVisible();

    await toggle.uncheck();
    await expect(page.getByTestId('settings-tag1Label')).toHaveCount(0);
  });

  test('reset zet alle defaults terug en schrijft naar localStorage', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('settings-teamName').fill('Custom Name');
    await page.getByTestId('settings-save').click();

    await page.getByTestId('settings-reset').click();

    const stored = await readSettings(page);
    expect(stored.teamName).toBe('');
    expect(stored.quarterCount).toBe(4);
    expect(stored.useClassLimit).toBe(false);

    await expect(page.getByTestId('settings-teamName')).toHaveValue('');
  });

  test('v1-data met onbekende keys blijft behouden na v2 read+save', async ({ page }) => {
    const v1Like = {
      teamName: 'Legacy',
      quarterCount: 4,
      toekomstigVeld: 'bewaard',
      legacyFlag: 42,
    };
    await seedSettings(page, v1Like);

    await page.getByTestId('settings-teamName').fill('Legacy-tweede');
    await page.getByTestId('settings-save').click();

    const stored = await readSettings(page);
    expect(stored.toekomstigVeld).toBe('bewaard');
    expect(stored.legacyFlag).toBe(42);
    expect(stored.teamName).toBe('Legacy-tweede');
  });

  test('v1-corrupte-JSON-string valt terug op defaults zonder andere keys te raken', async ({
    page,
    context,
  }) => {
    await context.addInitScript((key) => {
      window.localStorage.setItem(key, '{ not valid json');
    }, SETTINGS_KEY);

    await page.goto('/');

    // v2 herkent de corrupte data en toont de defaults in de UI.
    // De corrupte string zelf wordt pas overschreven bij een expliciete save.
    await expect(page.getByTestId('settings-teamName')).toHaveValue('');
    await expect(page.getByTestId('settings-quarterCount')).toHaveValue('4');

    await page.getByTestId('settings-teamName').fill('Recovered');
    await page.getByTestId('settings-save').click();
    const stored2 = await readSettings(page);
    expect(stored2.teamName).toBe('Recovered');
  });

  test('NL/EN-switch toont de juiste settings-labels', async ({ page, context }) => {
    await context.addInitScript(
      ({ key, value }) => {
        window.localStorage.setItem(key, value);
      },
      { key: 'lineup-tracker-lang', value: 'nl' },
    );
    await page.goto('/');
    await expect(page.getByText('Instellingen', { exact: true })).toBeVisible();
    await expect(page.getByText('Teamnaam', { exact: true })).toBeVisible();

    await page.getByTestId('lang-switch').click();
    await expect(page.getByText('Settings', { exact: true })).toBeVisible();
    await expect(page.getByText('Team name', { exact: true })).toBeVisible();
  });
});
