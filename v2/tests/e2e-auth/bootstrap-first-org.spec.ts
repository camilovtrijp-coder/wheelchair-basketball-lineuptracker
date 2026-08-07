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

    await page.getByTestId('onboarding-org-name').fill('E2E Test Club');
    await page.getByTestId('onboarding-team-name').fill('Eerste team');
    await page.getByTestId('onboarding-submit').click();

    // Precies één organisatie tot nu toe: de contextwisselaar toont 'm, maar vraagt
    // nog altijd een expliciete keuze (ook bij één optie — zie stap 7).
    await page.waitForSelector('[data-testid^="context-org-"]', { timeout: 10_000 });
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
