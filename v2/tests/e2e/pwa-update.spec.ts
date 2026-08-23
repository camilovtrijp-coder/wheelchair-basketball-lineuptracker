import { expect } from '@playwright/test';
import { test } from './fixtures';

// 8.1a (docs/pr-8.1-plan.md §C 8.1a werk 5): dekt de volledige
// update-detectie-/gecontroleerde-refresh-flow. Bouwt bewust voort op
// `pwa.spec.ts`'s bestaande "wordt actief"-scenario (eerste installatie
// blijft ongewijzigd) i.p.v. die te vervangen.
//
// Er is geen tweede echte build beschikbaar in deze suite — een "tweede
// build" wordt hier gesimuleerd door de al gebouwde `sw.js` op byte-niveau
// te wijzigen (een testcomment toevoegen) via `page.route()`, ZODRA de
// eerste worker al actief is. De browser detecteert een gewijzigde
// servicewerker-byte-inhoud exact zoals hij dat bij een echte nieuwe build
// zou doen (dezelfde revisie-vergelijking als `registration.update()` altijd
// gebruikt) — dit is dus geen mock van het updatemechanisme zelf, alleen van
// de bron van de "nieuwe" bytes.
//
// LET OP (zie sessieopdracht): deze e2e-suite kon in de ontwikkelsandbox
// NIET worden uitgevoerd (Playwright/Chromium is hier netwerkgeblokkeerd,
// `npx playwright install chromium` geeft 403). Echte verificatie loopt via
// GitHub Actions CI, die wél een voorgeïnstalleerde Chromium heeft.
test.describe('v2 PWA — update-detectie en gecontroleerde refresh', () => {
  test('banner verschijnt bij een simulatie van een tweede build; oude pagina blijft consistent draaien tot bevestiging; daarna exact één reload met de nieuwe assets', async ({
    page,
  }) => {
    await page.goto('/');

    // Wacht tot de EERSTE installatie actief is (zelfde poll-patroon als
    // pwa.spec.ts).
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

    // Een markering die alleen overleeft zolang deze pagina NIET herlaadt —
    // bewijst hieronder dat de oude pagina op haar eigen, consistente
    // asset-set blijft draaien tot de gebruiker bevestigt (§C 8.1a werk 5).
    await page.evaluate(() => {
      (window as unknown as { __pr81aNoReloadMarker?: boolean }).__pr81aNoReloadMarker = true;
    });

    // "Tweede build": dezelfde sw.js-bytes + een testcomment, zodat de
    // browser 'm bij de eerstvolgende update-check als gewijzigd herkent.
    // `page.route()` intercepteert alleen requests die vanuit deze pagina's
    // frames komen; de update-checkfetch die de browser zelf voor een
    // geregistreerde service worker doet, loopt op browsercontext-niveau
    // (niet aan één pagina gebonden) en wordt dus alleen via
    // `browserContext.route()` bereikt — vandaar `page.context().route(...)`
    // i.p.v. `page.route(...)` hier.
    const swResponse = await page.request.get('/sw.js');
    const originalBody = await swResponse.text();
    await page.context().route('**/sw.js', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: `${originalBody}\n// pr-8.1a-test-version-bump\n`,
      });
    });

    // Forceert een update-check i.p.v. te wachten op Workbox's eigen
    // periodieke check (default: elke navigatie, maar niet gegarandeerd
    // binnen de testtimeout).
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
    });

    // De banner verschijnt zodra `registration.waiting` gezet is — dit
    // bewijst tegelijk dat de nieuwe worker NIET zichzelf heeft geactiveerd
    // (geen `skipWaiting()` zonder bevestiging, stopregel §D).
    await expect(page.getByTestId('pwa-update-banner')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            return Boolean(reg?.waiting);
          }),
        { timeout: 5_000 },
      )
      .toBe(true);

    // Oude pagina blijft op haar eigen, consistente asset-set draaien: geen
    // impliciete reload heeft plaatsgevonden, de marker staat er nog.
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __pr81aNoReloadMarker?: boolean }).__pr81aNoReloadMarker,
        ),
      )
      .toBe(true);
    await expect(page.getByTestId('nav-settings')).toBeVisible();

    // Bevestiging → SKIP_WAITING → controllerchange → exact één
    // gecontroleerde reload (werk 4). `waitForEvent('load')` resolvet op de
    // eerstvolgende navigatie ná de klik — samen met de verdwenen marker
    // hieronder bewijst dat precies één reload de nieuwe assets ophaalde.
    await Promise.all([
      page.waitForEvent('load', { timeout: 20_000 }),
      page.getByTestId('pwa-update-confirm').click(),
    ]);
    // Marker is weg: de pagina is daadwerkelijk herladen (nieuwe assets),
    // niet slechts client-side van staat gewisseld.
    const markerAfterReload = await page.evaluate(
      () => (window as unknown as { __pr81aNoReloadMarker?: boolean }).__pr81aNoReloadMarker,
    );
    expect(markerAfterReload).toBeUndefined();

    // De nieuwe worker is nu de controller, en er is geen wachtende worker
    // meer over (bevestigd + geactiveerd, geen tweede reload nodig).
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            return Boolean(reg?.active) && !reg?.waiting;
          }),
        { timeout: 20_000, intervals: [250, 500, 1000] },
      )
      .toBe(true);
  });
});
