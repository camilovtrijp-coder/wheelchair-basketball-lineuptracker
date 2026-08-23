import { readFileSync, writeFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { test } from './fixtures';

// 8.1a (docs/pr-8.1-plan.md §C 8.1a werk 5): dekt de volledige
// update-detectie-/gecontroleerde-refresh-flow. Bouwt bewust voort op
// `pwa.spec.ts`'s bestaande "wordt actief"-scenario (eerste installatie
// blijft ongewijzigd) i.p.v. die te vervangen.
//
// Er is geen tweede echte build beschikbaar in deze suite — een "tweede
// build" wordt hier gesimuleerd met een echte test-only SW-versiebump: het
// al gebouwde `dist/sw.js`-bestand wordt op DISK gewijzigd (via node:fs, in
// het Playwright-testproces zelf), niet via `page.route()`/
// `browserContext.route()`. Een eerdere versie van deze test probeerde de
// gewijzigde bytes via netwerkinterceptie (eerst `page.route`, daarna
// `browserContext.route`) te leveren, maar de browser-interne
// update-checkfetch die `registration.update()` triggert bleek in CI in
// beide gevallen niet interceptbaar — de banner verscheen nooit. Door de
// echte statische file te wijzigen die de preview-server (`vite preview`,
// zie `playwright.config.ts`) rechtstreeks vanaf schijf serveert, ziet de
// browser een daadwerkelijk andere HTTP-response, precies zoals bij een
// echte tweede build — geen mock van het updatemechanisme zelf. Het
// bestand wordt in een `finally` teruggezet naar de originele inhoud zodat
// latere tests in dezelfde CI-run (zelfde langlopende preview-server-
// proces) een ongewijzigde `sw.js` blijven zien.
//
// LET OP (zie sessieopdracht): deze e2e-suite kon in de ontwikkelsandbox
// NIET worden uitgevoerd (Playwright/Chromium is hier netwerkgeblokkeerd,
// `npx playwright install chromium` geeft 403). Echte verificatie loopt via
// GitHub Actions CI, die wél een voorgeïnstalleerde Chromium heeft.
const DIST_SW_PATH = 'dist/sw.js';

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

    // "Tweede build": het echte, op disk gebouwde `dist/sw.js` krijgt een
    // testcomment toegevoegd, zodat de preview-server een daadwerkelijk
    // gewijzigde byte-inhoud serveert (zie de moduledocstring hierboven voor
    // waarom dit op disk gebeurt i.p.v. via netwerkinterceptie).
    const originalSwSource = readFileSync(DIST_SW_PATH, 'utf8');
    try {
      writeFileSync(DIST_SW_PATH, `${originalSwSource}\n// pr-8.1a-test-version-bump\n`, 'utf8');

      // Forceert een update-check i.p.v. te wachten op Workbox's eigen
      // periodieke check (default: elke navigatie, maar niet gegarandeerd
      // binnen de testtimeout).
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.update();
      });

      // De banner verschijnt zodra `registration.waiting` gezet is — dit
      // bewijst tegelijk dat de nieuwe worker NIET zichzelf heeft
      // geactiveerd (geen `skipWaiting()` zonder bevestiging, stopregel §D).
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

      // Oude pagina blijft op haar eigen, consistente asset-set draaien:
      // geen impliciete reload heeft plaatsgevonden, de marker staat er nog.
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { __pr81aNoReloadMarker?: boolean }).__pr81aNoReloadMarker,
          ),
        )
        .toBe(true);
      await expect(page.getByTestId('nav-settings')).toBeVisible();

      // Bevestiging → SKIP_WAITING → controllerchange → exact één
      // gecontroleerde reload (werk 4). `waitForEvent('load')` resolvet op
      // de eerstvolgende navigatie ná de klik — samen met de verdwenen
      // marker hieronder bewijst dat precies één reload de nieuwe assets
      // ophaalde.
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

      // De nieuwe worker is nu de controller, en er is geen wachtende
      // worker meer over (bevestigd + geactiveerd, geen tweede reload nodig).
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
    } finally {
      // Altijd terugzetten, ook bij een gefaalde assertie hierboven — een
      // permanent gewijzigde `dist/sw.js` zou latere tests in dezelfde
      // langlopende preview-serverrun (o.a. `pwa.spec.ts`) kunnen laten
      // falen op een onverwachte tweede-worker-status.
      writeFileSync(DIST_SW_PATH, originalSwSource, 'utf8');
    }
  });
});
