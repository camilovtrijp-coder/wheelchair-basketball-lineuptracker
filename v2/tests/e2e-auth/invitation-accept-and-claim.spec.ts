import { test, expect } from '@playwright/test';
import { signInInPlace } from './helpers';

// Dekt de volledige uitnodigingsmatrix uit firebase/scripts/seed.ts' vier
// randgevallen in org-rotterdam (org-rotterdam/inv-grace, inv-henry, inv-irene,
// inv-jack), elk uitsluitend gebruikt door precies één test hieronder.
test.describe('uitnodiging accepteren/claimen — link-gebaseerd', () => {
  test('grace (geverifieerd, pending) accepteert en claimt haar uitnodiging', async ({ page }) => {
    await page.goto('/?orgId=org-rotterdam&invitationId=inv-grace');
    await signInInPlace(page, 'grace@example.test', 'Spike123!');
    await page.waitForSelector('[data-testid="trusted-device-yes"]', { timeout: 10_000 });
    await page.getByTestId('trusted-device-yes').click();

    await page.waitForSelector('[data-testid="invitation-pending-body"]', { timeout: 10_000 });
    await expect(page.getByTestId('invitation-pending-body')).toContainText('viewer');
    await page.getByTestId('invitation-accept').click();

    await page.waitForSelector('[data-testid="invitation-claim"]', { timeout: 10_000 });
    await page.getByTestId('invitation-claim').click();

    // Membership erbij: terug in de normale flow, nieuwe org zichtbaar in de contextwisselaar.
    await page.waitForSelector('[data-testid="context-org-org-rotterdam"]', { timeout: 10_000 });
    // De uitnodigingsparameters zijn uit de URL verwijderd — geen heropening bij reload.
    expect(page.url()).not.toContain('invitationId');
  });

  test('henry (ingetrokken uitnodiging) kan niet accepteren of claimen', async ({ page }) => {
    await page.goto('/?orgId=org-rotterdam&invitationId=inv-henry');
    await signInInPlace(page, 'henry@example.test', 'Spike123!');
    await page.waitForSelector('[data-testid="trusted-device-yes"]', { timeout: 10_000 });
    await page.getByTestId('trusted-device-yes').click();

    await page.waitForSelector('[data-testid="invitation-revoked-body"]', { timeout: 10_000 });
    await expect(page.getByTestId('invitation-accept')).toHaveCount(0);
    await expect(page.getByTestId('invitation-claim')).toHaveCount(0);
  });

  test('irene (al geaccepteerd) hoeft alleen nog te claimen', async ({ page }) => {
    await page.goto('/?orgId=org-rotterdam&invitationId=inv-irene');
    await signInInPlace(page, 'irene@example.test', 'Spike123!');
    await page.waitForSelector('[data-testid="trusted-device-yes"]', { timeout: 10_000 });
    await page.getByTestId('trusted-device-yes').click();

    // Geen accept-stap meer nodig — direct het claim-scherm.
    await page.waitForSelector('[data-testid="invitation-claim"]', { timeout: 10_000 });
    await expect(page.getByTestId('invitation-accept')).toHaveCount(0);
    await page.getByTestId('invitation-claim').click();

    await page.waitForSelector('[data-testid="context-org-org-rotterdam"]', { timeout: 10_000 });
  });

  test('jack (niet-geverifieerd e-mailadres) moet eerst verifiëren', async ({ page }) => {
    await page.goto('/?orgId=org-rotterdam&invitationId=inv-jack');
    await signInInPlace(page, 'jack@example.test', 'Spike123!');
    await page.waitForSelector('[data-testid="trusted-device-yes"]', { timeout: 10_000 });
    await page.getByTestId('trusted-device-yes').click();

    await page.waitForSelector('[data-testid="invitation-verify-email-body"]', { timeout: 10_000 });
    await expect(page.getByTestId('invitation-resend-verification')).toBeVisible();
    await expect(page.getByTestId('invitation-accept')).toHaveCount(0);
  });
});
