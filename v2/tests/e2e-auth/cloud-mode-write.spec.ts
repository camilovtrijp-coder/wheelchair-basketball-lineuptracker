// PR 5.3c-1: bewijst dat een settings-save in een cloud-team (authUser +
// selectedContext + trustedDevice, zie selectRepositories()) daadwerkelijk
// bij Firestore terechtkomt, niet stilzwijgend bij de v1-localStorage-key.
// Vóór deze PR schreef App altijd naar `lineup-tracker-settings`, ook na het
// kiezen van een cloud-context — zie de reality-check in
// docs/pr-5.3-plan.md §C/5.3c.
//
// Gebruikt een verse, eigen registratie + eigen organisatie/team (net als
// bootstrap-first-org.spec.ts) i.p.v. de gedeelde seed-data van bob/carol,
// zodat deze test niets van andere e2e-auth-specs kan raken of erdoor
// geraakt kan worden.
import { test, expect } from '@playwright/test';
import { signUp, answerTrustedDevice, uniqueTestEmail } from './helpers';
import { adminDb } from './adminFixtures';

test.describe('PR 5.3c-1: cloud-modus schrijft daadwerkelijk naar Firestore', () => {
  test('settings-save in een cloud-team landt in Firestore, niet in de v1-localStorage-key', async ({
    page,
  }) => {
    const email = uniqueTestEmail('cloud-write');
    await signUp(page, email, 'CloudWrite123!');
    await answerTrustedDevice(page, true);

    await page.waitForSelector('[data-testid="onboarding-org-name"]', { timeout: 10_000 });
    await page.getByTestId('onboarding-org-name').fill('Cloud Write Club');
    await page.getByTestId('onboarding-team-name').fill('Cloud Write Team');
    await page.getByTestId('onboarding-submit').click();

    await page.waitForSelector('[data-testid^="context-org-"]', { timeout: 10_000 });
    const orgButton = page.locator('[data-testid^="context-org-"]').first();
    const orgTestId = await orgButton.getAttribute('data-testid');
    const orgId = orgTestId!.replace('context-org-', '');
    await orgButton.click();

    await page.waitForSelector('[data-testid^="context-team-"]', { timeout: 10_000 });
    const teamButton = page.locator('[data-testid^="context-team-"]').first();
    const teamTestId = await teamButton.getAttribute('data-testid');
    const teamId = teamTestId!.replace('context-team-', '');
    await teamButton.click();

    await page.waitForSelector('[data-testid="nav-settings"]', { timeout: 10_000 });

    const teamName = `Cloud Save ${Date.now()}`;
    await page.getByTestId('settings-teamName').fill(teamName);
    await page.getByTestId('settings-save').click();

    await expect
      .poll(
        async () => {
          const snap = await adminDb()
            .doc(`organizations/${orgId}/teams/${teamId}/settings/current`)
            .get();
          return snap.exists ? (snap.data()?.teamName as string | undefined) : undefined;
        },
        { timeout: 10_000, intervals: [250, 500, 1000] },
      )
      .toBe(teamName);

    const v1Raw = await page.evaluate(() => window.localStorage.getItem('lineup-tracker-settings'));
    expect(v1Raw).toBeNull();
  });
});
