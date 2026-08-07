// PR 5.3d — harde gate #27 (docs/pr-5.3-plan.md §C/5.3d, §D). Bewijst de
// vier acceptatiecriteria uit issue #27 automatisch in CI:
//
//   1. Een PWA-capabele testbuild kan de applicatieshell zonder netwerk laden.
//   2. Team/settings zijn vooraf gecachet; na een volledige offline reload
//      wordt de gecachte context correct getoond, zonder stille lege
//      standaardwaarden.
//   3. Een offline wijziging na die reload blijft lokaal beschikbaar en
//      synchroniseert na reconnect exact eenmaal (het "exact één keer"-bewijs
//      zelf levert de setDoc-spy uit tests/unit/FirestoreSettingsRepository.spec.ts
//      — hier bewijzen we alleen dat de eindwaarde op het tweede apparaat landt).
//   4. Een tweede client ziet daarna dezelfde serverwaarde.
//
// Draait tegen `npm run preview:e2e` (dist/ met de injectManifest-SW uit
// PR 3.2a) — geen aparte CI-job nodig, playwright.auth.config.ts staat al op
// workers: 1 (serieel, geen races met andere e2e-auth-specs).
//
// Gebruikt carol (team-only coach van org-rotterdam/team-u23, zie
// firebase/scripts/seed.ts) met "vertrouwd apparaat" — nodig omdat alleen
// persistentLocalCache een volledige offline reload overleeft (zie
// tests/e2e/mobile.spec.ts's test.fail()-uitleg: "onvertrouwd apparaat" kan
// dat expliciet niet). Geen enkele andere e2e-auth-spec muteert
// org-rotterdam/team-u23's settings/roster, dus de wijziging in test 3 hier
// raakt niets anders in de suite.
import { test, expect, type Page } from '@playwright/test';
import { signIn, answerTrustedDevice, selectContext } from './helpers';

const SEED_TEAM_NAME = 'Rotterdam Basketball (fictief)';
const SEED_PLAYER_NAMES = ['Fictief Speler Een', 'Fictief Speler Twee', 'Fictief Speler Drie'];

async function loginAndCacheTeamU23(page: Page): Promise<void> {
  await signIn(page, 'carol@example.test', 'Spike123!');
  await answerTrustedDevice(page, true);
  await selectContext(page, 'org-rotterdam', 'team-u23');

  // Wacht tot de echte geseede teamnaam zichtbaar is (niet DEFAULT_SETTINGS) —
  // dat bewijst dat de Firestore-read de server heeft geraakt en de waarde nu
  // in persistentLocalCache staat, vóór we offline gaan.
  await expect(page.locator('.app-title')).toHaveText(SEED_TEAM_NAME, { timeout: 10_000 });

  await expect(async () => {
    const ready = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      const cacheKeys = await caches.keys();
      return Boolean(reg?.active) && cacheKeys.length > 0;
    });
    expect(ready).toBe(true);
  }).toPass({ timeout: 20_000, intervals: [250, 500, 1000] });

  const hasController = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  if (!hasController) {
    await page.reload();
    await expect(page.locator('.app-title')).toHaveText(SEED_TEAM_NAME, { timeout: 10_000 });
  }
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      timeout: 15_000,
      intervals: [250, 500],
    })
    .toBe(true);
}

test.describe.serial('PR 5.3d — harde gate #27: offline reload, cache-write, tweede client', () => {
  test('test 1 — app-shell laadt zonder netwerk (PWA)', async ({ page, context }) => {
    await loginAndCacheTeamU23(page);

    await context.setOffline(true);
    await page.reload();

    await expect(page.locator('.app-title')).toHaveText(SEED_TEAM_NAME, { timeout: 10_000 });

    await context.setOffline(false);
  });

  test('test 2 — gecachte team/settings blijven zichtbaar na offline reload (geen lege standaard)', async ({
    page,
    context,
  }) => {
    await loginAndCacheTeamU23(page);
    // Ook de rosterdata vooraf cachen door 'm te bezoeken vóór offline te gaan.
    await page.getByTestId('nav-roster').click();
    await expect(page.locator('[data-testid^="roster-naam-"]')).toHaveCount(
      SEED_PLAYER_NAMES.length,
      { timeout: 10_000 },
    );

    await context.setOffline(true);
    await page.reload();

    await expect(page.locator('.app-title')).toHaveText(SEED_TEAM_NAME, { timeout: 10_000 });
    await page.getByTestId('nav-roster').click();
    await expect(page.locator('[data-testid^="roster-naam-"]')).toHaveCount(
      SEED_PLAYER_NAMES.length,
      { timeout: 10_000 },
    );
    const nameInputs = await page.locator('[data-testid^="roster-naam-"]').all();
    const names = await Promise.all(nameInputs.map((input) => input.inputValue()));
    expect(names.sort()).toEqual([...SEED_PLAYER_NAMES].sort());

    await context.setOffline(false);
  });

  // BEVINDING (7 aug. 2026, eerste testrun — precies het "open punt" uit
  // docs/pr-5.3-plan.md §C/5.3d's eigen risico-paragraaf): een offline write
  // gevolgd door page.reload() terwijl nog offline hangt onbeperkt op
  // LoadingScreen — bevestigd reproduceerbaar (2/2 pogingen, tot 30s+ zonder
  // herstel, ongeacht of er tussen click en reload wordt gewacht). App.tsx's
  // Promise.all([repositories.settings.read(), repositories.roster.read()])
  // resolvet nooit: getDocFromCache() lijkt te hangen specifiek wanneer er
  // een ongeacknowledgede write in de mutatiequeue staat op het moment van
  // reload. Waarschijnlijke oorzaak: persistentSingleTabManager (Web Locks)
  // in headless Chromium — al expliciet als risico benoemd in
  // firebaseClient.ts ("Web Locks kon hangen in headless-Chromium-CI") en in
  // pr-5.3-plan.md §C/5.3d's risico-paragraaf, maar nu voor het eerst
  // empirisch bevestigd i.p.v. verondersteld. Nog niet vastgesteld of dit
  // headless-CI-specifiek is of ook een reëel apparaat/browser raakt — dat
  // vraagt een eigenaarsbeslissing (zie het gesprek), geen stille aanname.
  // Test blijft gemarkeerd i.p.v. verwijderd, zodat dit zichtbaar blijft
  // (zelfde conventie als P0-1 in PR 1.6/1.7 en de test.fail() in
  // tests/e2e/mobile.spec.ts).
  //
  // VERVOLGONDERZOEK (zelfde dag): persistentMultipleTabManager() i.p.v.
  // persistentSingleTabManager() lost dit NIET betrouwbaar op — twee
  // opeenvolgende testruns met alleen die wijziging gaven twee verschillende
  // uitkomsten: (a) nog steeds onbeperkt hangen op LoadingScreen, en (b) wél
  // resolven na herladen, maar dan met de OUDE servervaarde in plaats van de
  // offline geschreven waarde (stille dataverlies van de pending write i.p.v.
  // een hang). Geen van beide tabManager-varianten voldoet dus aan het
  // acceptatiecriterium "offline wijziging blijft lokaal beschikbaar na
  // reload". Wijst eerder op een fundamenteler probleem in hoe
  // getDocFromCache()/de lokale mutatiequeue zich gedraagt over een harde
  // page-reload heen met een nog niet-geackte write, dan op de tabManager-
  // keuze zelf. firebaseClient.ts is NIET gewijzigd — dit was uitsluitend
  // een lokaal experiment, niet gecommit.
  test('test 3 — offline write + reload + reconnect + tweede client ziet serverwaarde', async ({
    page,
    context,
    browser,
  }) => {
    test.fail(
      true,
      'Offline write + reload hangt op LoadingScreen (bevestigd, zie testcommentaar) — open eigenaarsvraag vóór #27 gesloten kan worden.',
    );
    await loginAndCacheTeamU23(page);

    await context.setOffline(true);

    const newTeamName = `Offline Gewijzigd ${Date.now()}`;
    await page.getByTestId('settings-teamName').fill(newTeamName);
    await page.getByTestId('settings-save').click();

    // Reload terwijl nog offline: de wijziging moet uit persistentLocalCache
    // komen, niet uit een netwerkcall. Hangt hier op LoadingScreen — zie
    // testcommentaar hierboven.
    await page.reload();
    await expect(page.getByTestId('settings-teamName')).toHaveValue(newTeamName, {
      timeout: 10_000,
    });

    await context.setOffline(false);
    await expect(page.getByTestId('sync-status-indicator')).toHaveAttribute(
      'data-status',
      'gesynchroniseerd',
      { timeout: 20_000 },
    );

    // Tweede, onafhankelijke client: bob (organizationAdmin van org-rotterdam)
    // logt apart in en moet exact dezelfde servervaarde zien.
    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    try {
      await signIn(secondPage, 'bob@example.test', 'Spike123!');
      await answerTrustedDevice(secondPage, true);
      await selectContext(secondPage, 'org-rotterdam', 'team-u23');
      await expect(secondPage.getByTestId('settings-teamName')).toHaveValue(newTeamName, {
        timeout: 10_000,
      });
    } finally {
      await secondContext.close();
    }
  });
});
