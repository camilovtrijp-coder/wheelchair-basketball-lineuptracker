import { test, expect } from '@playwright/test';
import { signIn, answerTrustedDevice, selectContext } from './helpers';

// De letterlijke PR-acceptatiecriteria uit docs/IMPLEMENTATION_PLAN.md §10:
// "één account wisselt tussen Rotterdam Basketball en de Nederlandse Basketball
// Bond zonder opnieuw in te loggen" + "verschillende rollen per team worden
// correct toegepast". Alice is in firebase/scripts/seed.ts precies hiervoor
// opgezet: organizationOwner in org-rotterdam, viewer in org-nbb.
test.describe('contextwisselaar met twee organisaties', () => {
  test('alice wisselt tussen org-rotterdam en org-nbb zonder opnieuw in te loggen, met correcte rollen', async ({
    page,
  }) => {
    await signIn(page, 'alice@example.test', 'Spike123!');
    await answerTrustedDevice(page, true);

    await page.waitForSelector('[data-testid="context-org-org-rotterdam"]', { timeout: 10_000 });
    await expect(page.getByTestId('context-org-org-nbb')).toBeVisible();

    // Eén klik op de org expandeert de teamlijst; een tweede klik op dezelfde
    // org zou 'm weer inklappen (zie ContextSwitcher.handleExpand()) — dus na
    // deze controle direct op het team klikken, niet via selectContext (die
    // zou de org opnieuw aanklikken en zo de zojuist geopende lijst sluiten).
    await page.getByTestId('context-org-org-rotterdam').click();
    await page.waitForSelector('[data-testid="context-team-team-u23"]', { timeout: 10_000 });
    await expect(page.getByTestId('context-team-team-u23')).toContainText('organizationOwner');
    await page.getByTestId('context-team-team-u23').click();
    await expect(page.getByTestId('nav-settings')).toBeVisible();

    // Wissel — via de sessiebalk, zonder uit te loggen — naar org-nbb.
    await page.getByTestId('switch-context').click();
    await page.waitForSelector('[data-testid="context-org-org-nbb"]', { timeout: 10_000 });
    await page.getByTestId('context-org-org-nbb').click();
    await page.waitForSelector('[data-testid="context-team-team-selectie"]', { timeout: 10_000 });
    await expect(page.getByTestId('context-team-team-selectie')).toContainText('viewer');
    await page.getByTestId('context-team-team-selectie').click();
    await expect(page.getByTestId('nav-settings')).toBeVisible();

    // En weer terug naar org-rotterdam — nog altijd zonder re-authenticatie.
    await page.getByTestId('switch-context').click();
    await selectContext(page, 'org-rotterdam', 'team-u23');
    await expect(page.getByTestId('nav-settings')).toBeVisible();
    // Geen login-scherm is op enig moment in dit scenario voorbijgekomen.
    await expect(page.getByTestId('auth-email')).toHaveCount(0);
  });
});
