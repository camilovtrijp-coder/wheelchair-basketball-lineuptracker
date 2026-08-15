// PR 7.1c emulator-e2e: acceptatiecriterium "lokale modus veroorzaakt nul
// Firestore/Auth-netwerkrequests" (docs/pr-7.1-plan.md §C 7.1c acceptatie 5).
// Draait bewust in de PLAIN e2e-suite (fixtures.ts), niet e2e-auth: die
// fixture logt al in maar beantwoordt "onvertrouwd apparaat"
// (`trusted-device-no`), waardoor `selectRepositories()` altijd `kind:'local'`
// kiest (authUser && selectedContext && trustedDevice — trustedDevice is hier
// bewust false) — precies de modus waarin `repositories.gameSync` `null` is
// (resolveAppRepositories.ts) en `App.tsx`'s `runGameSync()` dus nooit een
// `GameCloudGateway`-aanroep kan doen.
//
// De roster wordt vooraf via `addInitScript` in localStorage gezet (i.p.v.
// via de UI + een reload, zoals game-setup.spec.ts) zodat het netwerkverkeer
// vanaf het EERSTE zichtbare scherm gevolgd kan worden, zonder een
// tussentijdse reload die legitiem (en irrelevant voor dit criterium)
// membership-/contextverkeer zou opleveren.
import { expect } from '@playwright/test';
import { test } from './fixtures';
import { ROSTER_STORAGE_KEY } from '../../src/domain/roster/types';

const FIRESTORE_OR_AUTH_HOST = /127\.0\.0\.1:8080|127\.0\.0\.1:9099|googleapis\.com/;

function fivePlayerRosterJson(): string {
  return JSON.stringify(
    [1, 2, 3, 4, 5].map((n) => ({
      id: n,
      nr: String(n),
      naam: `Speler ${n}`,
      kl: '3.0',
      vrouw: false,
      jeugd: false,
    })),
  );
}

test.describe('PR 7.1c: lokale modus veroorzaakt nul Firestore/Auth-netwerkrequests', () => {
  test('een volledige lokale wedstrijdflow (opzet, starten, scoren, segment, afronden) doet geen enkele Firestore-/Auth-aanroep', async ({
    page,
  }) => {
    await page.addInitScript((args) => window.localStorage.setItem(args.key, args.value), {
      key: ROSTER_STORAGE_KEY,
      value: fivePlayerRosterJson(),
    });
    await page.goto('/');
    await expect(page.getByTestId('nav-settings')).toBeVisible();

    // Pas NA het bereiken van de app beginnen met meten — de inlogstap zelf
    // (ensureInApp() in fixtures.ts) gebruikt legitiem Auth/Firestore om de
    // sessie/contextlijst op te halen; dát is niet waar dit criterium over
    // gaat. Vanaf hier hoort de datalaag voor déze sessie (trustedDevice
    // bewust false) uitsluitend lokaal te zijn.
    const offendingRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (FIRESTORE_OR_AUTH_HOST.test(url)) offendingRequests.push(url);
    });

    await page.getByTestId('nav-game').click();
    await expect(page.locator('[data-testid^="game-participate-"]')).toHaveCount(5);
    const startBtn = page.getByTestId('game-start-btn');
    await expect(startBtn).toBeEnabled();
    await startBtn.click();
    await page.waitForSelector('[data-testid="score-plus1-for"]', { timeout: 10_000 });

    await page.getByTestId('score-plus3-for').click();
    await page.getByTestId('score-plus2-against').click();
    await page.getByTestId('score-minus1-for').click();

    // Klok telt af vanaf 10:00; eind op 5:00 → geldig segment, nodig om
    // daarna te kunnen afronden (zie "Afronden is uitgeschakeld zonder
    // segmenten", game-history.spec.ts).
    await page.getByTestId('end-min').selectOption('5');
    await page.getByTestId('save-segment-btn').click();
    await expect(page.locator('[data-testid^="segment-item-"]')).toHaveCount(1);

    // Kort wachten: GameSyncCoordinator.sync() zou hier — als 'ie ooit
    // aangeroepen zou worden — een `fetch`/WebChannel-verbinding naar de
    // Firestore-emulator openen; die zou in dit venster al zichtbaar zijn.
    await page.waitForTimeout(1_500);

    await page.getByTestId('finish-game-btn').click();
    await page.waitForSelector('[data-testid="nav-history"]', { timeout: 10_000 });
    await page.waitForTimeout(500);

    expect(offendingRequests).toEqual([]);
  });
});
