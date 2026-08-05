// Bewijst item 6 (browser-variant) uit PR 4.4:
// 1. kevin logt in als coach (schrijf-rechten) en subscribet op settings (cache populeren);
// 2. offline gaan, settings schrijven (lokaal in IndexedDB gequeuede write);
// 3. waarde leesbaar vanuit cache terwijl offline;
// 4. kevin's teamMembers-doc wordt verwijderd via Node.js fetch naar emulator REST API (intrekking);
// 5. reconnect → write-promise wordt geweigerd door Firestore (membership ingetrokken);
// 6. syncState = 'actie-nodig', herstelpayload bewaard in pendingActionNodig (ADR-002);
// 7. server-verificatie via alice: waarde MOET de originele zijn (write was geweigerd).
//
// Noot: de "reload terwijl offline"-stap uit de planning is niet testbaar in deze dev-server-setup
// (Vite vereist netwerkverbinding voor reload; een productie-PWA met service worker zou dit
// ondersteunen). Intrekking-DELETE wordt via Node.js fetch gedaan (niet via de browser,
// die offline is) zodat de emulator de wijziging kan verwerken terwijl de browser offline is.
//
// Vereist: Firebase Emulator draait op 127.0.0.1:8080 (Firestore) en 9099 (Auth),
// en de seed is al gerund (kevin bestaat als coach in team-u23 van org-rotterdam).

import { test, expect } from '@playwright/test';

const ORG_A   = 'org-rotterdam';
const TEAM_A1 = 'team-u23';
const KEVIN = { email: 'kevin@example.test', password: 'Spike123!' };
// Alice is org-owner in org-rotterdam — ze kan kevin's teamMembers-doc verwijderen.
const ALICE = { email: 'alice@example.test', password: 'Spike123!' };

type W = Window & {
  harness: {
    signIn(email: string, password: string, orgId: string, teamId: string): Promise<void>;
    subscribeSettings(): void;
    readSettings(): Promise<{ teamName: string }>;
    writeSettings(patch: { teamName: string }): Promise<{ ok: boolean; syncState: { status: string } }>;
    getLastSyncState(): { status: string };
    getPendingActionNodig(): Array<{ type: string; payload: Record<string, unknown>; timestamp: number }>;
  };
};

async function waitForSyncStatus(
  page: import('@playwright/test').Page,
  target: string,
  { timeout = 15_000 } = {},
) {
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as W).harness.getLastSyncState().status),
      { timeout, intervals: [300, 500, 1000] },
    )
    .toBe(target);
}

test.describe('revoked-while-offline', () => {
  test('write geweigerd na intrekking tijdens offline-write → actie-nodig, cache bewaard', async ({
    browser,
  }) => {
    // ------------------------------------------------------------------ context K (kevin / coach)
    const ctxK = await browser.newContext({ storageState: undefined });
    const pageK = await ctxK.newPage();
    await pageK.goto('/');
    await pageK.waitForFunction(() => typeof (window as unknown as Record<string, unknown>).harness !== 'undefined');

    // Kevin inloggen en settings subscriben (cache populeren vanuit server).
    await pageK.evaluate(
      ({ email, password, org, team }: { email: string; password: string; org: string; team: string }) =>
        (window as unknown as W).harness.signIn(email, password, org, team),
      { email: KEVIN.email, password: KEVIN.password, org: ORG_A, team: TEAM_A1 },
    );
    await pageK.evaluate(() => (window as unknown as W).harness.subscribeSettings());
    await waitForSyncStatus(pageK, 'gesynchroniseerd');

    // Noteer de huidige waarde zodat we later kunnen verifiëren dat de server ongewijzigd blijft.
    const originalName = await pageK.evaluate(() =>
      (window as unknown as W).harness.readSettings().then((s) => s.teamName),
    );

    // ---- Ga offline.
    await ctxK.setOffline(true);

    // Schrijf een wijziging terwijl offline — lokaal geaccepteerd, in IndexedDB gequeuede write.
    // Gebruik void (geen await): de promise resolvet pas bij reconnect.
    const revokedName = 'Ingetrokken Write ' + Date.now();
    void pageK.evaluate(
      ({ name }: { name: string }) =>
        (window as unknown as W).harness.writeSettings({ teamName: name }),
      { name: revokedName },
    );

    // Wacht zodat de lokale cache de gequeuede write kan verwerken.
    await pageK.waitForTimeout(800);

    // Offline: IndexedDB-cache moet de gequeuede write-waarde tonen.
    const cachedNameOffline = await pageK.evaluate(() =>
      (window as unknown as W).harness.readSettings().then((s) => s.teamName),
    );
    expect(cachedNameOffline).toBe(revokedName);

    // ---- Verwijder kevin's teamMembers-doc via Node.js fetch naar de emulator REST API.
    // Dit is een Node.js-aanroep (niet vanuit de browser) — niet geblokkeerd door de offline browsercontext.
    // We authenticeren als alice (organizationOwner) via de Auth-emulator om de Security Rules te doorstaan.
    const authRes = await fetch(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ALICE.email, password: ALICE.password, returnSecureToken: true }),
      },
    );
    if (!authRes.ok) {
      throw new Error(`Auth emulator signIn mislukt: ${authRes.status} ${await authRes.text()}`);
    }
    const { idToken } = await authRes.json() as { idToken: string };

    const deleteRes = await fetch(
      `http://127.0.0.1:8080/v1/projects/demo-lineup-tracker-spike/databases/(default)/documents/organizations/${ORG_A}/teams/${TEAM_A1}/teamMembers/uid-kevin`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${idToken}` } },
    );
    if (!deleteRes.ok) {
      throw new Error(`DELETE mislukt: ${deleteRes.status} ${await deleteRes.text()}`);
    }

    // ---- Kevin: reconnect met ingetrokken membership.
    // Geen nieuwe subscribeSettings() — voorkomt syncState-race met de afwijzing van de write.
    await ctxK.setOffline(false);

    // Wacht tot de gequeuede write is afgewezen: Firestore rejectet de setDoc
    // na reconnect omdat kevins membership is verwijderd.
    // De harness vangt de rejection op en schrijft de payload naar pendingActionNodig.
    await expect
      .poll(
        () => pageK.evaluate(() => (window as unknown as W).harness.getPendingActionNodig().length),
        { timeout: 20_000, intervals: [500, 1000] },
      )
      .toBeGreaterThan(0);

    // Controleer dat de herstelpayload de ingetrokken write bevat (ADR-002: "nooit stil verloren").
    const pendingActions = await pageK.evaluate(
      () => (window as unknown as W).harness.getPendingActionNodig(),
    );
    const firstAction = pendingActions[0];
    if (!firstAction) throw new Error('pendingActionNodig is leeg ondanks poll > 0');
    expect(firstAction.payload['teamName']).toBe(revokedName);

    // ---- Verifieer server-waarde via een tweede context (alice).
    const ctxVerify = await browser.newContext({ storageState: undefined });
    const pageVerify = await ctxVerify.newPage();
    await pageVerify.goto('/');
    await pageVerify.waitForFunction(() => typeof (window as unknown as Record<string, unknown>).harness !== 'undefined');

    await pageVerify.evaluate(
      ({ email, password, org, team }: { email: string; password: string; org: string; team: string }) =>
        (window as unknown as W).harness.signIn(email, password, org, team),
      { email: ALICE.email, password: ALICE.password, org: ORG_A, team: TEAM_A1 },
    );
    const serverName = await pageVerify.evaluate(() =>
      (window as unknown as W).harness.readSettings().then((s) => s.teamName),
    );

    // Server MOET de originele waarde tonen — de write was geweigerd.
    console.log(`[test] serverName="${serverName}" | origineel="${originalName}" | ingetrokken="${revokedName}"`);
    expect(serverName).toBe(originalName);

    // Opruimen.
    await ctxK.close();
    await ctxVerify.close();
  });
});
