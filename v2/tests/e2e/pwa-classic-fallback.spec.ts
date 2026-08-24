import { expect } from '@playwright/test';
import { test } from './fixtures';

// 8.1c (docs/pr-8.1-plan.md §C 8.1c werk 1/acceptatie): dekt de classic-
// (niet-module-)SW-fallbackregistratie zelf — een Chromium-gebaseerde e2e
// kan deze registratie-tak al valideren, ook zonder echte Safari/iPadOS-
// hardware (de echte-apparaat-validatie zelf blijft item 3, expliciet open,
// zie `docs/pr-8.1-plan.md`'s 8.1c-"Geïmplementeerd"-sectie).
//
// Forceert de `PwaUpdateAdapter`-capability-check
// (`detectModuleServiceWorkerSupport()`, `src/infrastructure/pwa/
// PwaUpdateAdapter.ts`) naar "geen module-ondersteuning" via
// `page.addInitScript()` — dus VÓÓR enige app-/adaptercode draait — door de
// globale `Worker`-constructor te vervangen door een fake die de
// `type`-optie-getter nooit uitleest (exact het capability-detectiesignaal
// dat de adapter zelf gebruikt). Geen netwerkinterceptie van de
// service-worker-registratie zelf (zie `pwa-update.spec.ts`'s eigen
// moduledocstring voor waarom dat in deze CI niet betrouwbaar werkt) — hier
// is de gemockte laag bewust ver weg van de servicewerker-machinery zelf,
// puur de JS-level capability-probe die de adapter aanroept vóórdat 'ie
// ooit `navigator.serviceWorker.register()` aanroept.
//
// LET OP (zie sessieopdracht): deze e2e-suite kon in de ontwikkelsandbox
// NIET worden uitgevoerd (Playwright/Chromium is hier netwerkgeblokkeerd,
// `npx playwright install chromium` geeft 403, zelfde beperking als
// 7.3c/7.4c/8.1a se restpunten). Echte verificatie loopt via de bestaande
// v2-e2e-CI-job (GitHub Actions, met voorgeïnstalleerde Chromium).
test.describe('v2 PWA — classic (niet-module) fallbackregistratie', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      class FakeLegacyWorker {
        constructor() {
          // Een UA zonder module-Workerondersteuning leest onbekende
          // workeropties niet uit — de `type`-getter in
          // `detectModuleServiceWorkerSupport()`'s probe wordt dus nooit
          // aangeroepen, exact zoals deze fake het nabootst.
        }
        terminate(): void {}
        postMessage(): void {}
        addEventListener(): void {}
        removeEventListener(): void {}
      }
      // @ts-expect-error — bewuste testfake, geen volledige Worker-typing.
      window.Worker = FakeLegacyWorker;
    });
  });

  test('registreert de classic-bundel (sw-classic.js) i.p.v. de module-bundel, en kan de app-shell offline serveren', async ({
    page,
    context,
  }) => {
    await page.goto('/');

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

    // Het kernbewijs: de geregistreerde worker is de classic-fallbackbundel,
    // niet de standaard module-bundel — bewijst dat de capability-check
    // daadwerkelijk `type: 'classic'`/`sw-classic.js` koos i.p.v. het
    // standaardpad.
    const scriptUrl = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return (reg?.active ?? reg?.waiting ?? reg?.installing)?.scriptURL ?? null;
    });
    expect(scriptUrl).toContain('/sw-classic.js');

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

    // Zelfde offline-bewijs als `pwa.spec.ts`'s bestaande module-scenario —
    // de classic-fallback moet exact hetzelfde offline-gedrag leveren.
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('h1')).toHaveText(/.+/);
    await context.setOffline(false);
  });
});
