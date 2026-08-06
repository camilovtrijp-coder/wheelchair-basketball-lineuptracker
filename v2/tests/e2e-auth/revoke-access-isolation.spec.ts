import { test, expect } from '@playwright/test';
import { adminDb, lookupUidByEmail } from './adminFixtures';
import { signUp, answerTrustedDevice, selectContext, uniqueTestEmail } from './helpers';

// Zelfstandig scenario (eigen org-paar via de Admin SDK, niet de gedeelde
// firebase/scripts/seed.ts-data) zodat intrekking hier geen andere tests raakt.
// Dekt de PR-acceptatiecriteria: "intrekking bij organisatie A verandert
// toegang tot organisatie B niet" — inclusief het geval waarin A de actief
// geselecteerde context was.
test.describe('intrekking van toegang isoleert per organisatie', () => {
  test('intrekking van org A terwijl actief laat org B volledig intact', async ({ page }) => {
    const email = uniqueTestEmail('revoke');
    await signUp(page, email, 'Revoke123!');
    await answerTrustedDevice(page, true);

    await page.waitForSelector('[data-testid="onboarding-org-name"]', { timeout: 10_000 });
    await page.getByTestId('onboarding-org-name').fill('Org A');
    await page.getByTestId('onboarding-team-name').fill('Team A');
    await page.getByTestId('onboarding-submit').click();

    await page.waitForSelector('[data-testid^="context-org-"]', { timeout: 10_000 });
    const orgAId = (await page
      .locator('[data-testid^="context-org-"]')
      .first()
      .getAttribute('data-testid'))!.replace('context-org-', '');

    // Org B buiten de UI om toevoegen (Admin SDK, zoals firebase/scripts/seed.ts).
    const uid = await lookupUidByEmail(email, 'Revoke123!');
    const db = adminDb();
    const orgBRef = db.collection('organizations').doc();
    await orgBRef.set({ name: 'Org B', createdBy: uid, createdAt: new Date() });
    await orgBRef.collection('organizationMembers').doc(uid).set({
      role: 'viewer',
      email,
      uid,
      joinedAt: new Date(),
    });
    const teamBRef = orgBRef.collection('teams').doc();
    await teamBRef.set({ name: 'Team B', createdBy: uid, createdAt: new Date() });
    // Org-brede rollen (owner/admin uitgezonderd) geven sinds de PR 5.2-review geen impliciete
    // teamtoegang meer — een expliciet teamMembers-document is nodig om Team B zichtbaar/
    // selecteerbaar te maken voor deze org-viewer.
    await teamBRef.collection('teamMembers').doc(uid).set({
      role: 'viewer',
      email,
      addedAt: new Date(),
    });

    // Ga actief org A in. Eén klik expandeert de teamlijst; een tweede klik op
    // dezelfde org zou 'm weer inklappen (zie ContextSwitcher.handleExpand()) —
    // dus na het aflezen van teamAId direct op het team klikken, niet via
    // selectContext (die zou de org opnieuw aanklikken en de lijst sluiten).
    await page.locator(`[data-testid="context-org-${orgAId}"]`).click();
    await page.waitForSelector('[data-testid^="context-team-"]', { timeout: 10_000 });
    const teamAId = (await page
      .locator('[data-testid^="context-team-"]')
      .first()
      .getAttribute('data-testid'))!.replace('context-team-', '');
    await page.getByTestId(`context-team-${teamAId}`).click();
    await expect(page.getByTestId('nav-settings')).toBeVisible();

    // Trek org A in terwijl de gebruiker er nog actief in zit.
    await db
      .collection('organizations')
      .doc(orgAId)
      .collection('organizationMembers')
      .doc(uid)
      .delete();

    await page.reload();
    await page.waitForSelector('[data-testid="context-revoked-body"]', { timeout: 10_000 });

    await page.getByTestId('context-revoked-back').click();
    await page.waitForSelector(`[data-testid="context-org-${orgBRef.id}"]`, { timeout: 10_000 });
    // Org A is verdwenen, org B blijft volledig bruikbaar.
    await expect(page.getByTestId(`context-org-${orgAId}`)).toHaveCount(0);
    await selectContext(page, orgBRef.id, teamBRef.id);
    await expect(page.getByTestId('nav-settings')).toBeVisible();
  });
});
