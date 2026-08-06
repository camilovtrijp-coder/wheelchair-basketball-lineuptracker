import { expect } from '@playwright/test';
import { test } from './fixtures';

test.describe('v2 PWA', () => {
  test('manifest is bereikbaar en geldig', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/manifest+json');

    const manifest = (await response.json()) as Record<string, unknown>;
    expect(manifest.name).toBe('Lineup Tracker v2');
    expect(manifest.short_name).toBe('Lineup v2');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBeTruthy();
    const icons = manifest.icons as Array<Record<string, string>>;
    expect(icons.length).toBeGreaterThanOrEqual(2);
    expect(icons.some((i) => i.sizes === '192x192' && i.src === '/icons/icon-192.png')).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
  });

  test('pagina linkt manifest, theme-color en icons', async ({ page }) => {
    await page.goto('/');
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBe('/manifest.webmanifest');
    const themeColor = await page.locator('meta[name="theme-color"]').getAttribute('content');
    expect(themeColor).toBeTruthy();
    const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
    expect(appleIcon).toBe('/icons/icon-192.png');
  });

  test('service worker wordt actief en kan app-shell offline serveren', async ({
    page,
    context,
  }) => {
    await page.goto('/');

    await expect(async () => {
      const regCount = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return -1;
        const reg = await navigator.serviceWorker.getRegistration();
        return reg ? 1 : 0;
      });
      expect(regCount).toBe(1);
    }).toPass({ timeout: 20_000, intervals: [250, 500, 1000] });

    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            if (!reg) return 'no-registration';
            if (reg.active) return 'active';
            if (reg.waiting) return 'waiting';
            if (reg.installing) return 'installing';
            return 'unknown';
          }),
        { timeout: 20_000, intervals: [250, 500, 1000] },
      )
      .toMatch(/active|waiting/);

    const hasController = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    if (!hasController) {
      await page.reload();
    }

    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
        timeout: 15_000,
        intervals: [250, 500],
      })
      .toBe(true);

    await context.setOffline(true);

    await page.reload();
    await expect(page.locator('h1')).toHaveText(/.+/);

    await context.setOffline(false);
  });
});
