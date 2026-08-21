// PR 7.2b emulator-e2e, tweede reviewronde op PR #64: de eerdere
// "offline gecachte historie"/"ongecachete context"-dekking bestond alleen
// uit unit-tests met een FakeCloudSource (CompositeCompletedGameRepository
// .spec.ts) — die bewijzen de merge-/dedupe-logica, maar NIET het echte
// gedrag van Firestore's `persistentLocalCache` bij een volledige offline
// reload of een nooit-eerder-bevraagde query. Dit bestand vult dat gat met
// twee scenario's tegen de échte Firestore-/Auth-emulator, in dezelfde
// stijl als `offline-reload-cache-write-second-client.spec.ts` (PR 5.3d
// harde gate #27) — vertrouwd apparaat (nodig, alleen persistentLocalCache
// overleeft een volledige offline reload), en een expliciete
// service-worker-gereedheidscheck vóór offline te gaan (anders kan de
// browser de app-shell zelf al niet meer laden na een reload).
import { expect, test, type Page } from '@playwright/test';
import { openPilotTeam, registerPilotCoach, seedPilotTeam } from './twoDeviceFixtures';
import {
  finishGameWithOneSegment,
  readCompletedGameId,
  seedPilotRoster,
  startTrackedGame,
} from './gameSyncFixtures';
import { adminDb } from './adminFixtures';
import type { CompletedGameDocument } from 'firebase-base/documents';

/**
 * Zelfde service-worker-gereedheidspoll als
 * `offline-reload-cache-write-second-client.spec.ts`'s
 * `loginAndCacheTeamU23()` — hier losgetrokken van een specifieke
 * teamnaam/-context, zodat elk pilotteam 'm kan hergebruiken. Zonder deze
 * wacht kan een `context.setOffline(true)` gevolgd door `page.reload()` de
 * app-shell zelf al niet meer laden (geen netwerk, nog geen SW-controller),
 * wat deze tests zou laten falen op iets heel anders dan waar ze voor
 * bedoeld zijn.
 */
async function waitForServiceWorkerReady(page: Page): Promise<void> {
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
  }
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      timeout: 15_000,
      intervals: [250, 500],
    })
    .toBe(true);
}

test('gecachte completedGames-historie blijft zichtbaar na een volledige offline reload', async ({
  page,
  context,
}) => {
  test.setTimeout(45_000);
  const identity = await registerPilotCoach(page, 'offline-cache');
  const team = await seedPilotTeam(identity, 'offline-cache');
  await seedPilotRoster(team);

  await openPilotTeam(page, team);
  await startTrackedGame(page);
  await finishGameWithOneSegment(page);
  const completedId = await readCompletedGameId(page, team.orgId, team.teamId);

  // Server-bevestiging afwachten vóórdat we offline gaan — anders testen we
  // "een offline pending write overleeft een reload" (een ANDER, elders al
  // bewust NIET geautomatiseerd scenario, zie
  // offline-reload-cache-write-second-client.spec.ts's uitleg bij test 3),
  // niet "gecachte, server-bevestigde historie overleeft een reload".
  await expect(page.getByTestId(`history-sync-status-${completedId}`)).toHaveAttribute(
    'data-status',
    'gesynchroniseerd',
    { timeout: 20_000 },
  );
  // Terug naar de lijstweergave: de lijstbrede cloud-syncindicator staat
  // alleen daar (niet op de detailweergave, zie HistoryPanel.tsx).
  await page.getByTestId('history-back-btn').click();
  await expect(page.getByTestId('history-cloud-sync-status')).toHaveAttribute(
    'data-status',
    'gesynchroniseerd',
    { timeout: 20_000 },
  );

  await waitForServiceWorkerReady(page);

  await context.setOffline(true);
  await page.reload();

  // App-shell laadt zonder netwerk (dezelfde basisgarantie als gate #27's
  // test 1) — nodig voordat de rest van deze test betekenis heeft.
  await expect(page.locator('.app-title')).toHaveText(team.teamName, { timeout: 10_000 });

  await page.getByTestId('nav-history').click();

  // De kern van dit scenario: de wedstrijd komt uit `persistentLocalCache`,
  // niet van de server (die is onbereikbaar) — en verschijnt zonder enige
  // vertraging of foutmelding.
  await expect(page.getByTestId(`history-item-${completedId}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('history-cloud-read-error')).toHaveCount(0);

  // Cache-actualiteit moet EERLIJK 'lokaal-beschikbaar' tonen (fromCache),
  // NIET het misleidende 'gesynchroniseerd' van vóór het offline gaan —
  // Firestore's onSnapshot-metadata reflecteert dat de listener nu op
  // cache-only draait.
  await expect(page.getByTestId('history-cloud-sync-status')).toHaveAttribute(
    'data-status',
    'lokaal-beschikbaar',
    { timeout: 10_000 },
  );
  expect(await page.getByTestId('history-cloud-sync-status').getAttribute('data-status')).not.toBe(
    'actie-nodig',
  );

  await context.setOffline(false);
});

/**
 * Zet een `completedGames`-document rechtstreeks via de Admin SDK — simuleert
 * een wedstrijd die op een ANDER apparaat is afgerond en al server-bevestigd
 * is, buiten deze browser om.
 */
async function seedCompletedGameViaAdmin(
  team: { orgId: string; teamId: string },
  opponent: string,
): Promise<string> {
  const completedRef = adminDb()
    .collection(`organizations/${team.orgId}/teams/${team.teamId}/completedGames`)
    .doc();
  const doc: Omit<CompletedGameDocument, 'syncedAt'> = {
    organizationId: team.orgId,
    teamId: team.teamId,
    sourceGameId: `admin-seeded-${completedRef.id}`,
    opponent,
    competition: '',
    date: '2026-01-01T12:00:00.000Z',
    players: [],
    segments: [],
    scoreFor: 5,
    scoreAgainst: 4,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
  };
  await completedRef.set({ ...doc, syncedAt: new Date() });
  return completedRef.id;
}

// Oorspronkelijk scenario zoals de reviewer 'm beschreef ("settings/roster
// gecachet, Historie-tab nog nooit bezocht, offline"): bleek bij het
// schrijven van deze test NIET reproduceerbaar te zijn — en dat is zelf het
// bewijs, geen tekortkoming. `app/App.tsx` abonneert `completedGameRepo`
// (de `CompositeCompletedGameRepository`, incl. de cloudquery) in een
// `useEffect` die uitsluitend afhangt van de organisatie/teamcontext, NIET
// van welk tabblad open staat (zie App.tsx, vlak na de settings-/
// rostersubscribe-effects) — exact hetzelfde moment als settings/roster.
// Er bestaat dus GEEN bereikbare toestand waarin settings/roster wél
// gecachet zijn maar de completedGames-query nooit is uitgevoerd: beide
// starten altijd samen bij het openen van een team. Deze test bewijst die
// garantie positief — een wedstrijd die al vóór het eerste bezoek op de
// server staat, is na een simpel team-bezoek (zonder ooit de Historie-tab
// aan te klikken) al offline beschikbaar.
test('completedGames van vóór het eerste bezoek wordt proactief gecachet zodra het team online geopend wordt, ook zonder de Historie-tab te bezoeken', async ({
  page,
  context,
}) => {
  test.setTimeout(45_000);
  const identity = await registerPilotCoach(page, 'proactive-cache');
  const team = await seedPilotTeam(identity, 'proactive-cache');
  await seedPilotRoster(team);
  const completedId = await seedCompletedGameViaAdmin(team, 'Server-only tegenstander');

  // Bewust NIET naar Historie navigeren — alleen settings openen
  // (`openPilotTeam`), zodat dit scenario écht "team geopend, Historie-tab
  // nooit bezocht" test.
  await openPilotTeam(page, team);
  await waitForServiceWorkerReady(page);

  await context.setOffline(true);
  await page.getByTestId('nav-history').click();

  await expect(page.getByTestId(`history-item-${completedId}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('history-cloud-read-error')).toHaveCount(0);

  await context.setOffline(false);
});

// Het ECHTE bereikbare "nooit-gecachete-context"-scenario voor
// completedGames: het team is nog NOOIT geopend (settings/roster dus ook
// niet gecachet — zie de eigen docstring van de vorige test: die twee starten altijd
// samen). Dit spiegelt gate #27 criterium 4
// (offline-reload-cache-write-second-client.spec.ts), hier expliciet
// bevestigd vanuit de completedGames-hoek: de Historie-tab mag NOOIT
// bereikbaar zijn/nooit een (misleidend) leeg overzicht tonen vóór
// OfflineUncachedScreen — er bestaat immers een echte serverwedstrijd
// (Admin-geseed) die deze client alleen online had kunnen zien.
test('een team dat nog nooit geopend is toont offline de OfflineUncachedScreen, nooit een leeg completedGames-overzicht', async ({
  page,
  context,
}) => {
  test.setTimeout(45_000);
  const identity = await registerPilotCoach(page, 'never-opened-history');
  const team = await seedPilotTeam(identity, 'never-opened-history');
  await seedPilotRoster(team);
  const completedId = await seedCompletedGameViaAdmin(team, 'Nooit geziene tegenstander');

  // `page` is al ingelogd (via `registerPilotCoach`); `seedPilotTeam` heeft
  // het team pas ÁCHTERAF via de Admin SDK aangemaakt, dus een reload is
  // nodig om het in de contextwisselaar te zien — zelfde eerste stap als
  // `openPilotTeam`, maar bewust ZONDER de teamknop zelf te klikken (dat zou
  // het team openen en settings/roster/completedGames alsnog cachen).
  await page.reload();
  await page.waitForSelector(`[data-testid="context-org-${team.orgId}"]`, { timeout: 10_000 });
  await page.getByTestId(`context-org-${team.orgId}`).click();
  await page.waitForSelector(`[data-testid="context-team-${team.teamId}"]`, { timeout: 10_000 });

  await waitForServiceWorkerReady(page);
  await context.setOffline(true);

  await page.getByTestId(`context-team-${team.teamId}`).click();

  await expect(page.getByTestId('uncached-offline-body')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('nav-history')).toHaveCount(0);
  await expect(page.getByTestId(`history-item-${completedId}`)).toHaveCount(0);

  await context.setOffline(false);
});
