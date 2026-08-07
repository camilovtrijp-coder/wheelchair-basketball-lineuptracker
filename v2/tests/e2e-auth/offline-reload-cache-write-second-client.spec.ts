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

  // GESCHIEDENIS (7 aug. 2026): de oorspronkelijke versie van deze test
  // klikte save en herlaadde meteen (of na een vaste wachttijd), zonder ooit
  // te bevestigen dat de write daadwerkelijk lokaal was toegepast vóór de
  // reload. Dat gaf een onbeperkte hang op LoadingScreen (2/2 pogingen),
  // ook niet verholpen door persistentMultipleTabManager() te proberen (die
  // gaf op zijn beurt wisselend óf dezelfde hang, óf stille dataverlies van
  // de offline write na reload — zie de PR-geschiedenis/#36 voor het volledige
  // logboek). Root-cause-onderzoek wees uit dat `FirestoreSettingsRepository
  // .write()`/de roster-tegenhanger op setDoc()'s eigen Promise wachtten —
  // die resolvet pas na serverbevestiging en blijft offline onbeperkt
  // pending, terwijl de write lokaal al is toegepast (latency compensation).
  // Dat schrijfcontract is herzien (zie domain/syncState.ts — write()
  // retourneert nu meteen het lokale resultaat + een apart, nooit-rejectend
  // `settled`-Promise). Deze testversie volgt daarna het herziene 8-staps-
  // protocol: pas herladen NADAT een listener de write met
  // hasPendingWrites=true heeft waargenomen (stap 3), niet meteen na de
  // save-klik — dat sluit de race uit waarbij de mutatie nog niet eens
  // lokaal geregistreerd was op het moment van reload.
  test('test 3 — offline write + reload + reconnect + tweede client ziet serverwaarde', async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(60_000);
    await loginAndCacheTeamU23(page);

    // Stap 1: gecontroleerd offline.
    await context.setOffline(true);

    // Stap 2: voer de write uit.
    const newTeamName = `Offline Gewijzigd ${Date.now()}`;
    await page.getByTestId('settings-teamName').fill(newTeamName);
    await page.getByTestId('settings-save').click();

    // Stap 3: wacht tot een listener de nieuwe waarde MET hasPendingWrites=
    // true heeft waargenomen — niet de React-state-update van het typen zelf
    // (die is al waar zodra je stopt met typen), maar de daadwerkelijke
    // onSnapshot-metadata-emissie die useSyncStatus.onSettingsSync doorzet
    // naar de sync-status-indicator. Dit is het punt waarop de mutatie
    // aantoonbaar in Firestore's lokale mutatiequeue staat.
    //
    // BEKENDE, GEVERIFIEERDE RODE STAP (PR 5.3d-onderzoeksrapport, aug. 2026):
    // deze assertie faalt momenteel consistent — de sync-status-indicator
    // blijft op 'lokaal-beschikbaar' staan. Directe instrumentatie op
    // FirestoreSettingsRepository (setDoc/getDocFromCache/onSnapshot, zie
    // git-geschiedenis van dit bestand voor het volledige logboek) toonde aan
    // dat na een offline setDoc() op dit document zowel latere
    // getDocFromCache()-aanroepen als de onSnapshot-listener voor PRECIES dat
    // document nooit meer reageren (getest tot 25s), terwijl een gelijktijdige
    // lezing van een ANDER document (roster) op dezelfde Firestore-client
    // gewoon normaal resolvet. Reproduceerbaar via zowel context.setOffline()
    // als een expliciete route.abort() op de emulatorpoort, en onafhankelijk
    // van persistentLocalCache vs. memoryLocalCache en
    // experimentalForceLongPolling vs. auto-detect — dus geen Playwright/CDP-
    // artefact, geen Web-Locks-kwestie en geen client-brede AsyncQueue-
    // blokkade. Bewust GEEN test.fail(): issue #27 blijft een harde open gate
    // totdat dit is opgelost of op een echt apparaat weerlegd (zie het
    // 5.3d-onderzoeksrapport voor de volledige triangulatie en het
    // handmatige mobiele-apparaatprotocol).
    await expect(page.getByTestId('settings-teamName')).toHaveValue(newTeamName, {
      timeout: 10_000,
    });
    await expect(page.getByTestId('sync-status-indicator')).toHaveAttribute(
      'data-status',
      'wacht-op-synchronisatie',
      { timeout: 10_000 },
    );

    // Stap 4: pas nu de volledige offline reload.
    await page.reload();

    // Stap 5: bewijs dat de nieuwe waarde lokaal terugkomt. Bij een hang
    // rapporteert LoadingScreen's begrensde-timeout-diagnostiek (App.tsx)
    // na 8s per stap welke van settings-read/roster-read/settings-listener/
    // roster-listener nog niet is afgerond — dat voorkomt dat een eventuele
    // hang hier zonder onderscheid aan "Promise.all()" wordt toegeschreven.
    try {
      await expect(page.getByTestId('settings-teamName')).toHaveValue(newTeamName, {
        timeout: 15_000,
      });
    } catch (error) {
      const stalled = await page
        .getByTestId('loading-stalled')
        .getAttribute('data-steps')
        .catch(() => null);
      if (stalled) {
        throw new Error(
          `Vastgelopen stap(pen) volgens App.tsx's bounded-timeout-diagnostiek: ${stalled}. ` +
            `Oorspronkelijke fout: ${String(error)}`,
        );
      }
      throw error;
    }

    // Stap 6: reconnect.
    await context.setOffline(false);

    // Stap 7: wacht op serverbevestiging.
    await expect(page.getByTestId('sync-status-indicator')).toHaveAttribute(
      'data-status',
      'gesynchroniseerd',
      { timeout: 20_000 },
    );

    // Stap 8: controleer de waarde met een onafhankelijke tweede client
    // (bob, organizationAdmin van org-rotterdam).
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
