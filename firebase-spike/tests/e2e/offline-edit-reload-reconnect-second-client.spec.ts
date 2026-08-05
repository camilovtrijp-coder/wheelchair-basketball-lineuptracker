// Bewijst item 3 en item 1 uit PR 4.4:
// 1. settings lezen via Firestore-adapter (populeer IndexedDB-cache);
// 2. offline gaan, schrijven (lokaal in IndexedDB gequeuede write);
// 3. waarde nog steeds leesbaar vanuit lokale IndexedDB-cache terwijl offline;
// 4. reconnect → syncState wordt 'gesynchroniseerd';
// 5. tweede browsercontext (andere "cliënt") leest dezelfde waarden — echte round-trip bewezen.
//
// Noot: de "reload terwijl offline"-stap uit de plannin is niet testbaar in deze dev-server-setup
// (Vite vereist netwerkverbinding voor een reload; een productie-PWA met service worker zou dit
// wél ondersteunen). De IndexedDB-persistentie wordt hier bewezen binnen dezelfde paginasessie.
//
// Vereist: Firebase Emulator draait op 127.0.0.1:8080 (Firestore) en 9099 (Auth),
// en de seed is al gerund (gebruikers carol/bob bestaan in de emulator).

import { test, expect } from '@playwright/test';

const ORG_A   = 'org-rotterdam';
const TEAM_A1 = 'team-u23';
const CAROL = { email: 'carol@example.test', password: 'Spike123!' };
const BOB   = { email: 'bob@example.test',   password: 'Spike123!' };

// Lokale type voor window.harness — direct property access voorkomt noUncheckedIndexedAccess-fouten.
type W = Window & {
  harness: {
    signIn(email: string, password: string, orgId: string, teamId: string): Promise<void>;
    subscribeSettings(): void;
    readSettings(): Promise<{ teamName: string }>;
    writeSettings(patch: { teamName: string }): Promise<{ ok: boolean; syncState: { status: string } }>;
    getLastSyncState(): { status: string };
  };
};

// Helper: wacht tot harness.getLastSyncState().status de doelwaarde heeft.
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

test.describe('offline-edit-reload-reconnect-second-client', () => {
  test('wijziging offline → cache leesbaar offline → reconnect → tweede cliënt ziet dezelfde waarde', async ({
    browser,
  }) => {
    // ------------------------------------------------------------------ context A (carol / coach)
    const ctxA = await browser.newContext({
      // Elk context-object heeft zijn eigen IndexedDB-opslaggebied — nodig voor single-tab mgr.
      storageState: undefined,
    });
    const pageA = await ctxA.newPage();
    await pageA.goto('/');

    // Wacht tot harnas gereed is.
    await pageA.waitForFunction(() => typeof (window as unknown as Record<string, unknown>).harness !== 'undefined');

    // Inloggen als carol en subscriben op settings (vult cache).
    await pageA.evaluate(
      ({ email, password, org, team }: { email: string; password: string; org: string; team: string }) =>
        (window as unknown as W).harness.signIn(email, password, org, team),
      { email: CAROL.email, password: CAROL.password, org: ORG_A, team: TEAM_A1 },
    );
    await pageA.evaluate(() => (window as unknown as W).harness.subscribeSettings());

    // Wacht op eerste sync (vanuit server of cache).
    await waitForSyncStatus(pageA, 'gesynchroniseerd');

    // Lees huidige settings.
    const originalName = await pageA.evaluate(() =>
      (window as unknown as W).harness.readSettings().then((s) => s.teamName),
    );

    // ---- Ga offline.
    await ctxA.setOffline(true);

    // Schrijf een wijziging — Firestore queut dit lokaal in IndexedDB, resolvet pas bij reconnect.
    // Gebruik void (geen await): de promise resolvet pas bij reconnect.
    const newTeamName = 'Offline Gewijzigd ' + Date.now();
    void pageA.evaluate(
      ({ name }: { name: string }) =>
        (window as unknown as W).harness.writeSettings({ teamName: name }),
      { name: newTeamName },
    );

    // Wacht even zodat de lokale cache de gequeuede write kan verwerken.
    await pageA.waitForTimeout(800);

    // Offline: IndexedDB-cache moet de gequeuede write-waarde tonen.
    const cachedName = await pageA.evaluate(() =>
      (window as unknown as W).harness.readSettings().then((s) => s.teamName),
    );
    expect(cachedName).toBe(newTeamName);

    // ---- Reconnect.
    await ctxA.setOffline(false);
    await pageA.evaluate(() => (window as unknown as W).harness.subscribeSettings());
    await waitForSyncStatus(pageA, 'gesynchroniseerd', { timeout: 20_000 });

    // ---- Context B (bob / admin) — tweede "cliënt".
    const ctxB = await browser.newContext({ storageState: undefined });
    const pageB = await ctxB.newPage();
    await pageB.goto('/');
    await pageB.waitForFunction(() => typeof (window as unknown as Record<string, unknown>).harness !== 'undefined');

    await pageB.evaluate(
      ({ email, password, org, team }: { email: string; password: string; org: string; team: string }) =>
        (window as unknown as W).harness.signIn(email, password, org, team),
      { email: BOB.email, password: BOB.password, org: ORG_A, team: TEAM_A1 },
    );

    // Bob leest settings van de server — moet de door carol geschreven waarde tonen.
    const bobName = await pageB.evaluate(() =>
      (window as unknown as W).harness.readSettings().then((s) => s.teamName),
    );
    expect(bobName).toBe(newTeamName);

    // Opruimen.
    await ctxA.close();
    await ctxB.close();

    // Herstel: schrijf de originele naam terug zodat volgende tests niet vuile data zien.
    console.log(`[test] Originele naam: "${originalName}" → gewijzigd naar: "${newTeamName}"`);
  });
});
