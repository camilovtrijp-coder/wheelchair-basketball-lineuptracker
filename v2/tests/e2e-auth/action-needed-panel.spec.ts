// PR 5.3c-2: bewijst de syncstatus-indicator en het "Actie nodig"-paneel
// end-to-end op een mobiele viewport (patroon PR 3.2a), met een echte
// Security-Rules-weigering — geen gemockte write — als trigger. Zelfde
// intrekkingsaanpak als revoke-access-isolation.spec.ts: het
// organizationMembers-document verwijderen via de Admin SDK terwijl de
// gebruiker nog actief in de context zit, zodat de eerstvolgende write door
// firestore.rules wordt geweigerd (canManageTeamData faalt), zonder dat de
// UI zelf al naar het "toegang ingetrokken"-scherm is gesprongen (dat
// gebeurt pas bij een reload/membership-herlezing, niet bij een write).
import { test, expect } from '@playwright/test';
import { adminDb, lookupUidByEmail } from './adminFixtures';
import { signUp, answerTrustedDevice, uniqueTestEmail } from './helpers';

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.describe('PR 5.3c-2: syncstatus-indicator en Actie-nodig-paneel', () => {
  test('geweigerde settings-save toont de indicator + het paneel, en negeren ruimt het weer op', async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);

    const email = uniqueTestEmail('action-needed');
    await signUp(page, email, 'ActionNeeded123!');
    await answerTrustedDevice(page, true);

    await page.waitForSelector('[data-testid="onboarding-org-name"]', { timeout: 10_000 });
    await page.getByTestId('onboarding-org-name').fill('Action Needed Club');
    await page.getByTestId('onboarding-team-name').fill('Action Needed Team');
    await page.getByTestId('onboarding-submit').click();

    await page.waitForSelector('[data-testid^="context-org-"]', { timeout: 10_000 });
    const orgId = (await page
      .locator('[data-testid^="context-org-"]')
      .first()
      .getAttribute('data-testid'))!.replace('context-org-', '');
    await page.locator('[data-testid^="context-org-"]').first().click();

    await page.waitForSelector('[data-testid^="context-team-"]', { timeout: 10_000 });
    await page.locator('[data-testid^="context-team-"]').first().click();
    await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 10_000 });

    // Vóór intrekking: cloud-modus toont de indicator, geen paneel (nog geen pending item).
    await expect(page.getByTestId('sync-status-indicator')).toBeVisible();
    await expect(page.getByTestId('action-needed-panel')).toHaveCount(0);

    // PR 5.5c-bugfixes bug 7: het ingelogde account moet zichtbaar zijn.
    await expect(page.getByTestId('session-account-email')).toHaveText(email);

    // PR 5.5c-bugfixes bug 8: de syncstatus-badge mag niet worden afgesneden/overlapt
    // door de knoppen op een mobiele breedte — het abonnement-blok wrapt i.p.v. te clippen.
    const sessionBarOverflow = await page.evaluate(() => {
      const bar = document.querySelector('.session-bar');
      return bar ? bar.scrollWidth - bar.clientWidth : 0;
    });
    expect(
      sessionBarOverflow,
      'session-bar heeft horizontale overflow op mobiele viewport',
    ).toBeLessThanOrEqual(1);

    // Membership intrekken terwijl de gebruiker nog actief in de context zit
    // (geen reload — dat zou naar het aparte "toegang ingetrokken"-scherm
    // springen, wat een ander scenario is dan een geweigerde write).
    const uid = await lookupUidByEmail(email, 'ActionNeeded123!');
    await adminDb()
      .collection('organizations')
      .doc(orgId)
      .collection('organizationMembers')
      .doc(uid)
      .delete();

    const teamName = `Geweigerd ${Date.now()}`;
    await page.getByTestId('settings-teamName').fill(teamName);
    await page.getByTestId('settings-save').click();

    await expect(page.getByTestId('action-needed-panel')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('action-needed-settings')).toBeVisible();
    await expect(page.getByTestId('sync-status-indicator')).toHaveAttribute(
      'data-status',
      'actie-nodig',
    );

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(
      overflow,
      'Actie-nodig-paneel heeft horizontale overflow op mobiele viewport',
    ).toBeLessThanOrEqual(1);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('action-needed-export-settings').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^settings-actie-nodig-\d+\.json$/);

    await page.getByTestId('action-needed-dismiss-settings').click();
    await expect(page.getByTestId('action-needed-panel')).toHaveCount(0);
  });
});
