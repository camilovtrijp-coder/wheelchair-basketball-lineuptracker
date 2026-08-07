import { test, expect } from '@playwright/test';
import { signIn, signUp, uniqueTestEmail } from './helpers';

test.describe('niet-ingelogd (standaardstatus)', () => {
  test('toont het login-scherm zonder enige actie', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('auth-email')).toBeVisible();
    await expect(page.getByTestId('nav-settings')).toHaveCount(0);
  });
});

// "eerste login of ongecachete context vraagt duidelijk om netwerk" —
// bewust NIET het volledige offline-reload-bewijs uit issue #27 (dat blijft
// open en blokkeert expliciet PR 5.3, niet deze PR): hier alleen het geval
// waarin memberships nog nooit gecachet zijn en er geen netwerk is.
test.describe('ongecachete context zonder netwerk', () => {
  test('vraagt expliciet om netwerk als memberships nog nooit opgehaald zijn', async ({ page }) => {
    await signIn(page, 'frank@example.test', 'Spike123!');
    await page.waitForSelector('[data-testid="trusted-device-yes"]', { timeout: 10_000 });
    // Offline vóórdat de eerste membership-fetch start (die start pas ná dit antwoord).
    await page.context().setOffline(true);
    await page.getByTestId('trusted-device-yes').click();

    await page.waitForSelector('[data-testid="uncached-offline-body"]', { timeout: 10_000 });
    await page.context().setOffline(false);
  });
});

test.describe('vertrouwd-apparaatkeuze en wissen bij uitloggen', () => {
  test('gedeeld apparaat: uitloggen wist lokale Firebase-data en herinloggen werkt daarna gewoon', async ({
    page,
  }) => {
    const email = uniqueTestEmail('shared-device');
    await signUp(page, email, 'Shared123!');
    await page.waitForSelector('[data-testid="trusted-device-no"]', { timeout: 10_000 });
    await page.getByTestId('trusted-device-no').click();

    await page.waitForSelector('[data-testid="onboarding-org-name"]', { timeout: 10_000 });
    await page.getByTestId('onboarding-org-name').fill('Shared Device Org');
    await page.getByTestId('onboarding-team-name').fill('Team');
    await page.getByTestId('onboarding-submit').click();
    await page.waitForSelector('[data-testid^="context-org-"]', { timeout: 10_000 });
    await page.locator('[data-testid^="context-org-"]').first().click();
    await page.waitForSelector('[data-testid^="context-team-"]', { timeout: 10_000 });
    await page.locator('[data-testid^="context-team-"]').first().click();
    await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('sign-out').click();
    await page.waitForSelector('[data-testid="auth-email"]', { timeout: 10_000 });

    // Direct opnieuw inloggen moet gewoon werken — Firestore is na de wissing
    // weer bruikbaar (zie AuthGate.handleSignOut()) en de "niet vertrouwd"-keuze
    // blijft onthouden (geen nieuwe prompt). De eerder gekozen context is een
    // apparaatvoorkeur (blijft in localStorage staan, wordt niet gewist bij
    // uitloggen) — na herinloggen komt de gebruiker dus direct weer in de app,
    // niet terug bij de contextwisselaar.
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill('Shared123!');
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('trusted-device-no')).toHaveCount(0, { timeout: 5_000 });
    await page.waitForSelector('[data-testid="nav-settings"]', { timeout: 10_000 });
  });
});
