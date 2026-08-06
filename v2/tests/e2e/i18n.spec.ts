import { expect, type Page, type BrowserContext } from '@playwright/test';
import { test } from './fixtures';

const LANG_KEY = 'lineup-tracker-lang';
const V1_KEYS_THAT_MUST_NOT_BE_TOUCHED = [
  'lineup-tracker-v1',
  'lineup-tracker-games',
  'lineup-tracker-schema-version',
];

async function readAllLocalStorage(page: Page): Promise<Record<string, string>> {
  return await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key !== null) {
        const value = window.localStorage.getItem(key);
        if (value !== null) out[key] = value;
      }
    }
    return out;
  });
}

async function seedLang(context: BrowserContext, lang: 'nl' | 'en' | 'fr' | null): Promise<void> {
  if (lang === null) return;
  await context.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: LANG_KEY, value: lang },
  );
}

test.describe('v2 i18n', () => {
  test('toont NL wanneer localStorage "nl" bevat', async ({ page, context }) => {
    await seedLang(context, 'nl');
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
    await expect(page.getByTestId('lang-switch')).toBeVisible();
  });

  test('wisselt zonder reload van NL naar EN en terug', async ({ page, context }) => {
    await seedLang(context, 'nl');
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl');

    await page.getByTestId('lang-switch').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.getByTestId('lang-switch').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
  });

  test('taalkeuze blijft behouden na reload via lineup-tracker-lang', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((key) => window.localStorage.setItem(key, 'nl'), LANG_KEY);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl');

    await page.getByTestId('lang-switch').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    const stored = await page.evaluate((key) => window.localStorage.getItem(key), LANG_KEY);
    expect(stored).toBe('en');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('ongeldige opgeslagen taal wordt genegeerd', async ({ page, context }) => {
    await seedLang(context, 'nl');
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl');

    await page.evaluate((key) => window.localStorage.setItem(key, 'fr'), LANG_KEY);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), LANG_KEY);
    expect(stored).toBe('nl');
  });

  test('detectie gebruikt navigator.language wanneer localStorage leeg is', async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      Object.defineProperty(window.navigator, 'language', {
        configurable: true,
        get: () => 'en-GB',
      });
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), LANG_KEY);
    expect(stored).toBe('en');
  });

  test('raakt geen andere v1-localStorage-keys aan', async ({ page, context }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('lineup-tracker-v1', JSON.stringify({ players: [] }));
      window.localStorage.setItem('lineup-tracker-games', '[]');
      window.localStorage.setItem('lineup-tracker-roster', '[]');
      window.localStorage.setItem('lineup-tracker-schema-version', '1');
    });
    await page.goto('/');
    await page.getByTestId('lang-switch').click();
    await page.getByTestId('lang-switch').click();

    const all = await readAllLocalStorage(page);
    const keys = Object.keys(all);
    expect(keys).toContain(LANG_KEY);
    // settings wordt pas geschreven bij save/reset; alleen-lezen mount laat
    // de key nog ongemoeid. v2-keys (lang + settings) mogen niet stiekem
    // andere v1-keys meeschrijven of overschrijven.

    for (const protectedKey of V1_KEYS_THAT_MUST_NOT_BE_TOUCHED) {
      const current = await page.evaluate((k) => window.localStorage.getItem(k), protectedKey);
      expect(current, `v2 heeft onverwacht key "${protectedKey}" gewijzigd`).not.toBeNull();
    }
  });
});
