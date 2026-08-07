import { test as base, type Page } from '@playwright/test';

// Sinds PR 5.2 zit App achter AuthGate (login → vertrouwd-apparaat →
// contextwisselaar). Deze bestaande e2e-suite test Settings/Roster zelf via
// de v1-localStorage-keys en hoeft niets van auth te weten — dus wordt
// `page.goto` hier eenmalig per test "getransparanteerd": bij navigatie naar
// de root en een zichtbaar login-scherm loggen we automatisch in als bob
// (organizationAdmin, org-rotterdam/team-u23 — zie firebase/scripts/seed.ts)
// en kiezen we die context, zodat elke bestaande test ongewijzigd blijft en
// gewoon in App terechtkomt. Vereist de Firebase Auth-/Firestore-emulator +
// seed-data (zie de v2-e2e-CI-job); zonder emulator faalt de login-stap.
//
// Bewuste keuze sinds PR 5.3c-1: "onvertrouwd apparaat" (trusted-device-no),
// NIET "vertrouwd". selectRepositories() (5.3a) kiest de cloud-adapter enkel
// wanneer authUser + selectedContext + trustedDevice alle drie waar zijn —
// "onvertrouwd" houdt App dus in lokale modus (LocalAsyncSettingsRepository/
// LocalAsyncRosterRepository over de bestaande v1-localStorage-keys), precies
// wat deze suite al die tijd al testte. Zou dit "vertrouwd" zijn, dan zouden
// settings-save/roster-save naar Firestore gaan en zouden alle
// localStorage-asserties hieronder stilzwijgend niets meer meten. Het
// cloud-pad zelf heeft een eigen, gerichte test (cloud-mode-write.spec.ts).
const EXISTING_SUITE_EMAIL = 'bob@example.test';
const EXISTING_SUITE_PASSWORD = 'Spike123!';

/** `locator.isVisible()` wacht NIET (directe snapshot-check) — voor een
 * optionele, asynchroon verschijnende stap is `waitFor()` nodig, dat wél polt. */
async function waitVisible(page: Page, testId: string, timeout: number): Promise<boolean> {
  return page
    .getByTestId(testId)
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
}

async function ensureInApp(page: Page): Promise<void> {
  const onLoginScreen = await waitVisible(page, 'auth-email', 3_000);
  if (!onLoginScreen) return;

  await page.getByTestId('auth-email').fill(EXISTING_SUITE_EMAIL);
  await page.getByTestId('auth-password').fill(EXISTING_SUITE_PASSWORD);
  await page.getByTestId('auth-submit').click();

  if (await waitVisible(page, 'trusted-device-no', 10_000)) {
    await page.getByTestId('trusted-device-no').click();
  }

  if (await waitVisible(page, 'context-org-org-rotterdam', 10_000)) {
    await page.getByTestId('context-org-org-rotterdam').click();
    // De teamlijst verschijnt pas na een asynchrone listTeams()/getMyTeamAccess()-call
    // (zie ui/context/ContextSwitcher.tsx) — expliciet wachten vóór het klikken.
    await page.waitForSelector('[data-testid="context-team-team-u23"]', { timeout: 10_000 });
    await page.getByTestId('context-team-team-u23').click();
  }

  await page.waitForSelector('[data-testid="nav-settings"]', { timeout: 10_000 });
}

export const test = base.extend<object>({
  // Playwright's fixture-callback heet conventioneel `use`, maar dat botst met
  // eslint-plugin-react-hooks' naamdetectie voor React Hooks — hernoemd naar
  // `provideFixture` om die false positive te vermijden.
  page: async ({ page }, provideFixture) => {
    const originalGoto = page.goto.bind(page);
    page.goto = (async (url, options) => {
      const response = await originalGoto(url, options);
      if (url === '/' || url === '') {
        await ensureInApp(page);
      }
      return response;
    }) as typeof page.goto;
    await provideFixture(page);
  },
});
