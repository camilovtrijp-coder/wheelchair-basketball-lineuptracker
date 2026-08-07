import { test, expect } from '@playwright/test';
import { signIn, answerTrustedDevice, selectContext } from './helpers';

// Gebruikt bob (organizationAdmin, uitsluitend org-rotterdam) uit firebase/scripts/seed.ts —
// bewust een gebruiker met precies één organisatie, om deze test onafhankelijk te houden
// van context-switch-two-orgs.spec.ts (dat alice's twee organisaties gebruikt).
test.describe('inloggen en sessieherstel', () => {
  test('bob logt in, kiest zijn team, en blijft ingelogd na reload', async ({ page }) => {
    await signIn(page, 'bob@example.test', 'Spike123!');
    await answerTrustedDevice(page, true);
    await selectContext(page, 'org-rotterdam', 'team-u23');
    await expect(page.getByTestId('nav-settings')).toBeVisible();
    await expect(page.getByTestId('sign-out')).toBeVisible();

    await page.reload();
    // Sessieherstel (Firebase Auth) én de laatst-gekozen context (lokaal onthouden)
    // blijven staan: direct terug in App, geen login- of contextwisselaar-scherm.
    await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 10_000 });
  });

  test('verkeerd wachtwoord toont een foutmelding en logt niet in', async ({ page }) => {
    await signIn(page, 'bob@example.test', 'WrongPassword1');
    await expect(page.getByTestId('auth-error')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('auth-email')).toBeVisible();
  });
});
