import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const SETTINGS_KEY = 'lineup-tracker-settings';
const V1_KEYS_THAT_MUST_NOT_BE_TOUCHED = [
  'lineup-tracker-v1',
  'lineup-tracker-games',
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

  test('veldwijzigingen persisteren pas na een expliciete save, niet per toetsaanslag', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('settings-teamName')).toBeVisible();

    // Nog geen save geklikt: er mag nog geen v2-settings-key in localStorage staan.
    expect(await readSettings(page)).toEqual({});

    await page.getByTestId('settings-teamName').fill('Niet opgeslagen');
    await page.getByTestId('settings-quarterCount').fill('7');
    expect(await readSettings(page)).toEqual({});

    await page.getByTestId('settings-save').click();
    const stored = await readSettings(page);
    expect(stored.teamName).toBe('Niet opgeslagen');
    expect(stored.quarterCount).toBe(7);
  });

  test('aangepaste kleur is bereikbaar via een knop gekoppeld aan de native color-input', async ({
    page,
  }) => {
    await page.goto('/');
    const customBtn = page.getByTestId('primaryColor-custom');
    await expect(customBtn).toBeVisible();

    const nativeInput = page.getByTestId('primaryColor-native');
    await nativeInput.evaluate((el: HTMLInputElement) => {
      el.value = '#112233';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await page.getByTestId('settings-save').click();
    const stored = await readSettings(page);
    expect(stored.primaryColor).toBe('#112233');
  });

  test('een te groot logo toont een foutmelding en wordt niet toegepast', async ({ page }) => {
    await page.goto('/');
    const tooLarge = Buffer.alloc(600 * 1024, 1);
    await page.getByTestId('settings-logo-input').setInputFiles({
      name: 'big-logo.png',
      mimeType: 'image/png',
      buffer: tooLarge,
    });

    await expect(page.getByTestId('settings-error')).toBeVisible();
    await expect(page.getByTestId('settings-logo-preview')).toHaveCount(0);
  });

  test('NL/EN-switch toont de juiste settings-labels', async ({ page, context }) => {
    await context.addInitScript(
      ({ key, value }) => {
        window.localStorage.setItem(key, value);
      },
      { key: 'lineup-tracker-lang', value: 'nl' },
    );
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Instellingen', exact: true })).toBeVisible();
    await expect(page.getByText('Teamnaam', { exact: true })).toBeVisible();

    await page.getByTestId('lang-switch').click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByText('Team name', { exact: true })).toBeVisible();
  });

  // PR 8.2b (bug 10, docs/pr-5.5c-bugfixes.md #10, docs/pr-8.2-plan.md §C
  // 8.2b werk 3): vóór deze PR hadden primaryColor/accentColor geen enkel
  // zichtbaar effect. Deze test bewijst niet alleen dat de CSS custom
  // property gezet wordt, maar dat 'm daadwerkelijk gerenderd wordt op een
  // zichtbaar-merkbaar element (`.btn-primary`-achtergrond, `.app-title`-
  // tekstkleur) — precies het onderscheid dat §B punt 4 vereist.
  test('primaryColor/accentColor worden toegepast als CSS custom property én daadwerkelijk gerenderd (bug 10)', async ({
    page,
  }) => {
    await page.goto('/');
    const appRoot = page.locator('.app');

    await expect(appRoot).toHaveCSS('--team-primary', '#2563eb');
    await expect(appRoot).toHaveCSS('--team-accent', '#c2410c');

    await page.getByTestId('primaryColor-8b5cf6').click();
    await page.getByTestId('accentColor-ef4444').click();

    await expect(appRoot).toHaveCSS('--team-primary', '#8b5cf6');
    await expect(appRoot).toHaveCSS('--team-accent', '#ef4444');

    await expect(page.getByTestId('settings-save')).toHaveCSS(
      'background-color',
      'rgb(139, 92, 246)',
    );
    await expect(page.locator('.app-title')).toHaveCSS('color', 'rgb(239, 68, 68)');
  });

  test('primaire-kleur-contrastwaarschuwing verschijnt bij onvoldoende contrast, maar blokkeert opslaan niet', async ({
    page,
  }) => {
    await page.goto('/');

    // DEFAULT_SETTINGS.primaryColor (#2563eb) haalt de AA-tekstdrempel
    // (4.5:1) tegen de witte knoptekst — geen waarschuwing bij het laden.
    await expect(page.getByTestId('primaryColor-contrast-warning')).toHaveCount(0);

    // #f59e0b (~2.15:1 tegen wit) haalt de drempel niet.
    await page.getByTestId('primaryColor-f59e0b').click();
    await expect(page.getByTestId('primaryColor-contrast-warning')).toBeVisible();

    // Opslaan blijft mogelijk ondanks de waarschuwing (niet-blokkerend).
    await page.getByTestId('settings-save').click();
    const stored = await readSettings(page);
    expect(stored.primaryColor).toBe('#f59e0b');

    // Een aangepaste, voldoende donkere kleur laat de waarschuwing weer verdwijnen.
    const nativeInput = page.getByTestId('primaryColor-native');
    await nativeInput.evaluate((el: HTMLInputElement) => {
      el.value = '#1e3a8a';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.getByTestId('primaryColor-contrast-warning')).toHaveCount(0);
  });

  test('accentkleur-contrastwaarschuwing verschijnt bij onvoldoende contrast, maar blokkeert opslaan niet', async ({
    page,
  }) => {
    await page.goto('/');

    // DEFAULT_SETTINGS.accentColor (#c2410c, ~4.96:1 tegen #f9fafb) haalt de
    // AA-tekstdrempel — geen waarschuwing bij het laden.
    await expect(page.getByTestId('accentColor-contrast-warning')).toHaveCount(0);

    // Geen enkele preset in COLOR_PRESETS haalt de 4.5:1-drempel tegen de
    // headerachtergrond (het beste preset, #8b5cf6, geeft slechts ~4.05:1)
    // — elke preset toont dus de waarschuwing; #f97316 (~2.68:1) is de
    // vroegere, inmiddels vervangen default.
    await page.getByTestId('accentColor-f97316').click();
    await expect(page.getByTestId('accentColor-contrast-warning')).toBeVisible();

    // Opslaan blijft mogelijk ondanks de waarschuwing (niet-blokkerend).
    await page.getByTestId('settings-save').click();
    const stored = await readSettings(page);
    expect(stored.accentColor).toBe('#f97316');

    // Een aangepaste, voldoende donkere kleur laat de waarschuwing weer verdwijnen.
    const nativeInput = page.getByTestId('accentColor-native');
    await nativeInput.evaluate((el: HTMLInputElement) => {
      el.value = '#7c2d12';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.getByTestId('accentColor-contrast-warning')).toHaveCount(0);
  });
});
