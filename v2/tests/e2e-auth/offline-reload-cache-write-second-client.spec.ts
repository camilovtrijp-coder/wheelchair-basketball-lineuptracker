// PR 5.3d — harde gate #27 (docs/pr-5.3-plan.md §C/5.3d, §D). Bewijst de
// vier acceptatiecriteria uit issue #27 automatisch in CI:
//
//   1. Een PWA-capabele testbuild kan de applicatieshell zonder netwerk laden.
//   2. Team/settings zijn vooraf gecachet; na een volledige offline reload
//      wordt de gecachte context correct getoond, zonder stille lege
//      standaardwaarden.
//   3. Een offline wijziging blijft lokaal beschikbaar en synchroniseert na
//      reconnect exact eenmaal (het "exact één keer"-bewijs zelf levert de
//      setDoc-spy uit tests/unit/FirestoreSettingsRepository.spec.ts — hier
//      bewijzen we alleen dat de eindwaarde op het tweede apparaat landt).
//      Test 3 dekt bewust NIET de combinatie "offline schrijven + herladen
//      terwijl nog offline" — een handmatig geverifieerd Playwright/CDP-
//      specifiek testartefact, zie docs/pr-5.3d-onderzoeksrapport.md §H;
//      test 1/2 bewijzen losstaand al dat een offline reload van gecachte
//      (niet-pending) data werkt.
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
import { signIn, signUp, answerTrustedDevice, selectContext, uniqueTestEmail } from './helpers';
import { adminDb } from './adminFixtures';

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

  // GESCHIEDENIS (7-8 aug. 2026, volledig logboek in
  // docs/pr-5.3d-onderzoeksrapport.md): de oorspronkelijke versie van deze
  // test klikte save en herlaadde meteen terwijl nog offline, zonder ooit te
  // bevestigen dat de write al lokaal was toegepast. Dat gaf een
  // reproduceerbare, onbeperkte hang op LoadingScreen. Root-cause-onderzoek
  // (§A van het rapport) wees uit dat na een offline setDoc() zowel
  // getDocFromCache() als de onSnapshot-listener voor PRECIES dat document
  // permanent stoppen met reageren — getrianguleerd als onafhankelijk van
  // Playwright/CDP-mechanisme, cachepersistentie en long-polling-modus.
  //
  // Het schrijfcontract is herzien (write() wacht niet meer op setDoc()'s
  // eigen promise, zie domain/syncState.ts) en useSyncStatus is herzien om
  // de indicator rechtstreeks vanuit write()'s eigen resultaat bij te werken
  // i.p.v. uitsluitend via de (gebleken onbetrouwbare) listener (zie
  // useSyncStatus.ts). Dat lost de indicator-assertie hieronder betrouwbaar
  // op.
  //
  // De "schrijf offline, herlaad terwijl nog offline"-stap zelf is BEWUST
  // uit deze test verwijderd (§H van het rapport): een handmatig protocol op
  // een echt apparaat (Windows, genuine OS-netwerkonderbreking via
  // vliegtuigmodus, 2/2 schone runs) toonde geen enkele hang bij exact dat
  // scenario — de hang treedt alleen op via Playwright/CDP's manier van
  // offline simuleren tegen de Firestore-emulator, niet bij een reële
  // netwerkonderbreking. Die combinatie testen we hier dus niet langer
  // geautomatiseerd; test 1/2 bewijzen al afzonderlijk dat een offline
  // reload van gecachte (niet-pending) data werkt. Mocht dit patroon ooit
  // toch zichtbaar worden tijdens handmatig/productiegebruik van de app, dan
  // pakken we het alsnog op — zie het rapport voor het protocol om het te
  // reproduceren en te onderzoeken.
  test('test 3 — offline write + reconnect + tweede client ziet serverwaarde', async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(45_000);
    await loginAndCacheTeamU23(page);

    // Stap 1: gecontroleerd offline.
    await context.setOffline(true);

    // Stap 2: voer de write uit.
    const newTeamName = `Offline Gewijzigd ${Date.now()}`;
    await page.getByTestId('settings-teamName').fill(newTeamName);
    await page.getByTestId('settings-save').click();

    // Stap 3: de optimistische lokale waarde is meteen zichtbaar, en de
    // indicator moet — dankzij useSyncStatus's write()-gedreven update,
    // zonder op de listener te hoeven wachten — direct naar
    // wacht-op-synchronisatie springen.
    await expect(page.getByTestId('settings-teamName')).toHaveValue(newTeamName, {
      timeout: 10_000,
    });
    await expect(page.getByTestId('sync-status-indicator')).toHaveAttribute(
      'data-status',
      'wacht-op-synchronisatie',
      { timeout: 10_000 },
    );

    // Stap 4: reconnect.
    await context.setOffline(false);

    // Stap 5: wacht op serverbevestiging.
    await expect(page.getByTestId('sync-status-indicator')).toHaveAttribute(
      'data-status',
      'gesynchroniseerd',
      { timeout: 20_000 },
    );

    // Stap 6: controleer de waarde met een onafhankelijke tweede client
    // (bob, organizationAdmin van org-rotterdam) — bewijst dat de write
    // daadwerkelijk de server heeft bereikt, niet alleen lokaal is gebleven.
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

// Criterium 4 uit issue #27 (niet expliciet in de §D-tabel, wel in de
// oorspronkelijke §C/5.3d-taakomschrijving): een werkelijk nooit-gecachete
// teamcontext mag offline nooit als een leeg team getoond worden. Bewust
// GEEN onderdeel van het serial-blok hierboven — dit scenario gebruikt een
// eigen, verse gebruiker/organisatie (net als cloud-mode-write.spec.ts) en
// raakt org-rotterdam/team-u23 niet.
//
// Afbakening t.o.v. de bestaande test in offline-and-trusted-device-
// states.spec.ts ("vraagt expliciet om netwerk als memberships nog nooit
// opgehaald zijn"): die dekt het geval waarin de MEMBERSHIPS-lijst zelf nog
// nooit is opgehaald (AuthGate-niveau, deriveAppState's `memberships===null`
// tak). Dit hier is een ANDER geval: memberships/organisatie/team-bestaan
// zijn al bekend en gevalideerd (de gebruiker heeft al een actieve context
// gehad), maar het specifieke tweede team heeft zijn eigen settings/roster-document
// is nog nooit gelezen. `validateSelectedTeam()` faalt bewust "open" bij een
// exception (zie FirestoreOrganizationGateway.validateSelectedTeam's eigen
// documentatie) — een nooit-gecachete, offline teamcontext bereikt dus wél
// AuthGate's 'active'-state en dus `<App/>`; het is daarom specifiek App.tsx's
// nieuwe `uncachedOffline`-afhandeling (niet AuthGate's eigen
// 'uncached-offline'-tak) die hier op de proef wordt gesteld. Beide tonen
// toevallig hetzelfde scherm/dezelfde testid (OfflineUncachedScreen), dus de
// assertie hieronder is niet gevoelig voor welke van de twee 'm toont.
test.describe('PR 5.3d criterium 4: nooit-gecachete teamcontext offline', () => {
  test('een tweede, nooit geopend team wordt offline niet als leeg team getoond', async ({
    page,
    context,
  }) => {
    test.setTimeout(45_000);
    const email = uniqueTestEmail('never-cached');
    const password = 'NeverCached123!';
    await signUp(page, email, password);
    await answerTrustedDevice(page, true);

    await page.waitForSelector('[data-testid="onboarding-org-name"]', { timeout: 10_000 });
    await page.getByTestId('onboarding-org-name').fill('Never Cached Club');
    await page.getByTestId('onboarding-team-name').fill('Team A');
    await page.getByTestId('onboarding-submit').click();

    await page.waitForSelector('[data-testid^="context-org-"]', { timeout: 10_000 });
    const orgId = (await page
      .locator('[data-testid^="context-org-"]')
      .first()
      .getAttribute('data-testid'))!.replace('context-org-', '');

    // Tweede team via de Admin SDK — nooit via de UI geopend, dus settings/
    // roster zijn nooit lokaal gecachet. Geen settings/roster-document
    // aangemaakt: dat is precies het "nooit gecacht" scenario.
    const team2Ref = adminDb().collection('organizations').doc(orgId).collection('teams').doc();
    await team2Ref.set({
      name: 'Nooit Geopend Team',
      orgName: 'Never Cached Club',
      createdBy: 'test-admin-sdk',
      createdAt: new Date(),
    });

    // Org expanderen (listTeams()) gebeurt hier bewust nog ONLINE, zodat het
    // tweede team zichtbaar wordt vóór we offline gaan — anders zou deze
    // stap zelf al offline-listTeams()-gedrag testen (niet het doel hier).
    await page.getByTestId(`context-org-${orgId}`).click();
    await page.waitForSelector(`[data-testid="context-team-${team2Ref.id}"]`, { timeout: 10_000 });

    await context.setOffline(true);

    await page.getByTestId(`context-team-${team2Ref.id}`).click();

    // Nooit stilzwijgend een leeg team: expliciete "geen verbinding"-melding
    // i.p.v. een lege of DEFAULT_SETTINGS-gevulde SettingsPanel/RosterPanel.
    await expect(page.getByTestId('uncached-offline-body')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('nav-settings')).toHaveCount(0);
    await expect(page.getByTestId('settings-teamName')).toHaveCount(0);

    await context.setOffline(false);
  });
});
