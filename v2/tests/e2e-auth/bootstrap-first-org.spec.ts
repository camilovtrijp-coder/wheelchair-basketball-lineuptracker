import { test, expect } from '@playwright/test';
import { signUp, answerTrustedDevice, uniqueTestEmail } from './helpers';

test.describe('verse registratie: eerste organisatie/team aanmaken', () => {
  test('een nieuw account zonder organisaties krijgt de bootstrap-flow, geen intrekkingsframing', async ({
    page,
  }) => {
    const email = uniqueTestEmail('bootstrap');
    await signUp(page, email, 'Bootstrap123!');
    await answerTrustedDevice(page, true);

    await page.waitForSelector('[data-testid="onboarding-org-name"]', { timeout: 10_000 });
    // Verse registratie krijgt welkomst-framing, niet de "toegang kwijt"-variant
    // van hetzelfde scherm (zie domain/organizations/deriveAppState.ts' reason-onderscheid).
    await expect(page.locator('.app-title')).toContainText('Welcome');

    // PR 5.5c-bugfixes bug 9: een net aangemaakte organisatie liet de contextwisselaar
    // soms kort de "toegang ingetrokken"-melding tonen (het momentje tussen contextkeuze en
    // een verse listMyMemberships()-call). Bewaakt hier expliciet dat dat scherm nooit
    // verschijnt — het live subscribeMyMemberships()-abonnement moet het net aangemaakte
    // membership via Firestores lokale-schrijf-echo direct doorgeven. Een MutationObserver
    // (i.p.v. een losse isVisible()-check) is nodig omdat een eventuele flash te kort kan
    // zijn om met een enkele, na-de-klik uitgevoerde check betrouwbaar te vangen.
    await page.evaluate(() => {
      (window as unknown as { __revokedScreenSeen: boolean }).__revokedScreenSeen = false;
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-testid="context-revoked-body"]')) {
          (window as unknown as { __revokedScreenSeen: boolean }).__revokedScreenSeen = true;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });

    await page.getByTestId('onboarding-org-name').fill('E2E Test Club');
    await page.getByTestId('onboarding-team-name').fill('Eerste team');
    await page.getByTestId('onboarding-submit').click();

    // Precies één organisatie tot nu toe: de contextwisselaar toont 'm, maar vraagt
    // nog altijd een expliciete keuze (ook bij één optie — zie stap 7).
    await page.waitForSelector('[data-testid^="context-org-"]', { timeout: 10_000 });
    expect(
      await page.evaluate(
        () => (window as unknown as { __revokedScreenSeen: boolean }).__revokedScreenSeen,
      ),
    ).toBe(false);
    const orgButtons = await page.locator('[data-testid^="context-org-"]').all();
    expect(orgButtons).toHaveLength(1);

    await orgButtons[0]!.click();
    await page.waitForSelector('[data-testid^="context-team-"]', { timeout: 10_000 });
    await expect(page.locator('[data-testid^="context-team-"]').first()).toContainText(
      'organizationOwner',
    );
    await page.locator('[data-testid^="context-team-"]').first().click();
    await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 10_000 });
  });
});
