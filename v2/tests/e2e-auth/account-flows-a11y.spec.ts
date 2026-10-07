// PR 8.3c-2d (docs/pr-8.3c-2c-plan.md §5/§8): toegankelijkheid van het accountdialoog in een
// echte browser, tegen de echte emulators:
//
//   - axe (WCAG 2 A/AA, zelfde tags en reduced-motion-aanpak als
//     `deletion-request-flow.spec.ts`) op elke stabiele dialoogstap van de drie flows, in NL
//     én EN: verlaten (bevestigen, geslaagd, geweigerd), verwijderen (plan klaar, plan
//     geblokkeerd, wachtwoord, wachtwoordfout, "account bestaat nog", verwijderd), overdragen
//     (keuzelijst, bevestigen, resultaat) en andere eigenaar verwijderen (keuzelijst,
//     getypte bevestiging leeg/afwijkend, resultaat). De doorgangsstappen "bezig met
//     controleren/lezen" zijn niet apart gemeten: ze duren een fractie van een seconde;
//   - alleen het toetsenbord: Tab/Shift+Tab blijven in het dialoog, Escape sluit (niet
//     tijdens een lopende aanroep), focus terug naar de openende knop, en wat er met de
//     focus gebeurt als die knop na een vertrek niet meer bestaat.
import { test, expect, type Page, type Route } from '@playwright/test';
import type { Lang } from '../../src/i18n/strings';
import {
  createUser,
  seedMember,
  seedOrg,
  seedTeamMember,
  type TestUser,
} from './accountFlowFixtures';
import {
  dialog,
  expectNoDialogViolations,
  openAccountPanel,
  signInAndSelect,
  text,
} from './accountFlowPage';
import { selectContext } from './helpers';

async function abortDeleteUser(route: Route): Promise<void> {
  await route.abort('internetdisconnected');
}

for (const lang of ['nl', 'en'] as const satisfies readonly Lang[]) {
  test.describe(`8.3c-2d — axe op het accountdialoog (${lang})`, () => {
    test(`verlaten (bevestigen, geslaagd) en verwijderen (plan, wachtwoord, fout, account bestaat nog, verwijderd) — ${lang}`, async ({
      page,
    }) => {
      const org = await seedOrg(`a11y-${lang} Vertrek-Org`);
      const orgB = await seedOrg(`a11y-${lang} Tweede-Org`);
      const owner = await createUser(`a11y-${lang}-owner`);
      const user = await createUser(`a11y-${lang}-leave`);
      await seedMember(org, owner, 'organizationOwner');
      await seedMember(org, user, 'coach');
      await seedTeamMember(org, org.teamIds[0] ?? '', user, 'coach');
      await seedMember(orgB, owner, 'organizationOwner');
      await seedTeamMember(orgB, orgB.teamIds[0] ?? '', user, 'viewer'); // team-only

      await signInAndSelect(page, user, org.orgId, org.teamIds[0] ?? '', lang);
      await openAccountPanel(page);
      await page.getByTestId('leave-org-start-btn').click();
      await expectNoDialogViolations(page); // verlaten: bevestigen
      await expect(dialog(page)).toContainText(text(lang, 'leaveOrgConfirmDesc'));
      await page.getByTestId('leave-org-confirm-btn').click();
      await expect(page.getByTestId('leave-org-result')).toContainText(
        text(lang, 'leaveOrgOk', { org: org.orgName }),
        { timeout: 20_000 },
      );
      await expectNoDialogViolations(page); // verlaten: geslaagd
      await page.getByTestId('leave-org-close-btn').click();

      await selectContext(page, orgB.orgId, orgB.teamIds[0] ?? '');
      await openAccountPanel(page);
      await page.getByTestId('account-delete-start-btn').click();
      await expect(page.getByTestId('account-delete-ready')).toHaveText(
        text(lang, 'accountDeleteReadyIntro'),
        { timeout: 20_000 },
      );
      await expectNoDialogViolations(page); // verwijderen: plan klaar
      await page.getByTestId('account-delete-continue-btn').click();
      await expectNoDialogViolations(page); // verwijderen: wachtwoord
      await page.getByTestId('account-delete-password-input').fill('Fout-Wachtwoord-1!');
      await page.getByTestId('account-delete-confirm-btn').click();
      await expect(page.getByTestId('account-delete-password-error')).toHaveText(
        text(lang, 'accountDeleteWrongPassword'),
        { timeout: 20_000 },
      );
      await expectNoDialogViolations(page); // verwijderen: wachtwoordfout

      await page.route(/accounts:delete/, abortDeleteUser);
      await page.getByTestId('account-delete-password-input').fill(user.password);
      await page.getByTestId('account-delete-confirm-btn').click();
      await expect(page.getByTestId('account-delete-result')).toContainText(
        text(lang, 'accountDeleteClearedAuthPresent'),
        { timeout: 30_000 },
      );
      await expectNoDialogViolations(page); // verwijderen: account bestaat nog
      await page.unroute(/accounts:delete/, abortDeleteUser);
      await page.getByTestId('account-delete-retry-btn').click();
      await page.getByTestId('account-delete-password-input').fill(user.password);
      await page.getByTestId('account-delete-confirm-btn').click();
      await expect(page.getByTestId('account-delete-deleted')).toHaveText(
        text(lang, 'accountDeleteDeleted'),
        { timeout: 30_000 },
      );
      await expectNoDialogViolations(page); // verwijderen: verwijderd
    });

    test(`verlaten geweigerd (enige owner), overdragen (lijst, bevestigen, resultaat) en geblokkeerd verwijderplan — ${lang}`, async ({
      page,
    }) => {
      const org = await seedOrg(`a11y-${lang} Overdracht-Org`);
      const user = await createUser(`a11y-${lang}-sole`);
      const member = await createUser(`a11y-${lang}-lid`);
      await seedMember(org, user, 'organizationAdmin');
      await seedMember(org, member, 'scorer');
      await signInAndSelect(page, user, org.orgId, org.teamIds[0] ?? '', lang);
      await openAccountPanel(page);
      // De server maakt hem nu de enige owner (de UI kende nog admin): verlaten geweigerd.
      await seedMember(org, user, 'organizationOwner');
      await page.getByTestId('leave-org-start-btn').click();
      await page.getByTestId('leave-org-confirm-btn').click();
      await expect(page.getByTestId('leave-org-result')).toContainText(
        text(lang, 'leaveOrgDeniedOwnerSole'),
        { timeout: 20_000 },
      );
      await expectNoDialogViolations(page); // verlaten: geweigerd

      await page.getByTestId('leave-org-transfer-btn').click();
      await expect(page.getByTestId('transfer-member-0')).toBeVisible({ timeout: 20_000 });
      await expectNoDialogViolations(page); // overdragen: keuzelijst
      await page.getByTestId('transfer-member-0').click();
      await expect(page.getByTestId('transfer-promote-desc')).toBeVisible();
      await expectNoDialogViolations(page); // overdragen: bevestigen
      await page.getByTestId('transfer-confirm-btn').click();
      await expect(page.getByTestId('transfer-result')).toContainText(
        text(lang, 'transferPromoteOk', { member: member.email, org: org.orgName }),
        { timeout: 20_000 },
      );
      await expectNoDialogViolations(page); // overdragen: resultaat
      await page.getByTestId('transfer-close-btn').click();

      // Twee owners nu; maak hem weer de enige voor het geblokkeerde plan.
      await seedMember(org, member, 'scorer');
      await page.getByTestId('account-delete-start-btn').click();
      await expect(page.getByTestId('account-delete-blocked')).toHaveText(
        text(lang, 'accountDeleteBlockedTitle'),
        { timeout: 20_000 },
      );
      await expectNoDialogViolations(page); // verwijderen: plan geblokkeerd
    });

    test(`andere eigenaar verwijderen (lijst, getypte bevestiging, resultaat) — ${lang}`, async ({
      page,
    }) => {
      const org = await seedOrg(`a11y-${lang} Verwijder-Owner-Org`);
      const user = await createUser(`a11y-${lang}-b`);
      const other = await createUser(`a11y-${lang}-a`);
      await seedMember(org, user, 'organizationOwner');
      await seedMember(org, other, 'organizationOwner');
      await signInAndSelect(page, user, org.orgId, org.teamIds[0] ?? '', lang);
      await openAccountPanel(page);
      await page.getByTestId('transfer-remove-owner-start-btn').click();
      await expect(page.getByTestId('transfer-member-0')).toContainText(other.email, {
        timeout: 20_000,
      });
      await expectNoDialogViolations(page); // keuzelijst
      await page.getByTestId('transfer-member-0').click();
      await expect(page.getByTestId('transfer-remove-owner-form')).toBeVisible();
      await expectNoDialogViolations(page); // getypte bevestiging, leeg
      await page.getByTestId('transfer-remove-owner-input').fill('niet-dit-adres@example.test');
      await expect(page.getByTestId('transfer-remove-owner-mismatch')).toHaveText(
        text(lang, 'transferRemoveOwnerMismatch'),
      );
      await expectNoDialogViolations(page); // getypte bevestiging, afwijkend
      await page.getByTestId('transfer-remove-owner-input').fill(other.email);
      await page.getByTestId('transfer-confirm-btn').click();
      await expect(page.getByTestId('transfer-result')).toContainText(
        text(lang, 'transferCompleteOk', { member: other.email, org: org.orgName }),
        { timeout: 30_000 },
      );
      await expectNoDialogViolations(page); // resultaat
    });
  });
}

/** Houdt de geforceerde tokenverversing vast, zodat een aanroep zichtbaar "loopt". */
async function holdTokenRefresh(page: Page): Promise<() => void> {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /securetoken\.googleapis\.com\/v1\/token/,
    async (route) => {
      await released;
      await route.continue();
    },
    { times: 1 },
  );
  return release;
}

async function leaveSetup(page: Page, label: string): Promise<{ user: TestUser }> {
  const org = await seedOrg(`${label} Org`);
  const owner = await createUser(`${label}-owner`);
  const user = await createUser(label);
  await seedMember(org, owner, 'organizationOwner');
  await seedMember(org, user, 'viewer');
  await seedTeamMember(org, org.teamIds[0] ?? '', user, 'viewer');
  await signInAndSelect(page, user, org.orgId, org.teamIds[0] ?? '');
  await openAccountPanel(page);
  return { user };
}

test.describe('8.3c-2d — alleen het toetsenbord', () => {
  test('verlaten: focustrap, Escape sluit en herstelt de focus, niet tijdens de aanroep; na vertrek', async ({
    page,
  }) => {
    await leaveSetup(page, 'kbd-leave');
    const opener = page.getByTestId('leave-org-start-btn');
    const confirm = page.getByTestId('leave-org-confirm-btn');
    const back = page.getByTestId('leave-org-back-btn');

    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(back).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(confirm).toBeFocused(); // cyclet binnen het dialoog
    await page.keyboard.press('Shift+Tab');
    await expect(back).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(opener).toBeFocused();

    // Tijdens de aanroep sluit Escape niets (de tokenverversing van de preflight hangt).
    await page.keyboard.press('Enter');
    await expect(confirm).toBeFocused();
    const release = await holdTokenRefresh(page);
    await page.keyboard.press('Enter');
    await expect(confirm).toBeDisabled();
    await expect(confirm).toHaveText(text('nl', 'leaveOrgInProgress'));
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeVisible();
    release();

    // Resultaat: de focus staat op het eerste focusbare element van de nieuwe stap.
    await expect(page.getByTestId('leave-org-result')).toBeVisible({ timeout: 20_000 });
    const close = page.getByTestId('leave-org-close-btn');
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused(); // enige knop: Tab blijft erop

    // Sluiten na een geslaagd vertrek: het hele scherm (App met de openende knop) is
    // vervangen door het geen-organisaties-scherm. Er is dan niets om naar terug te keren;
    // de focus staat op <body>, zoals na elke schermwissel in deze app (contextwissel,
    // inloggen). Vastgelegd als huidig gedrag, niet als fout: een vaste focusplek per nieuw
    // scherm is een aparte ontwerpkeuze (zie docs/IMPLEMENTATION_PLAN.md, rij 8.3c-2d).
    // Wél een fout en gefixt: focusherstel naar een openende knop die nog bestaat (Escape
    // hierboven) — die knop staat disabled tijdens de flow en Chromium gaf de focus dan aan
    // <body>.
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByTestId('no-organizations-body')).toBeVisible({ timeout: 15_000 });
    await expect(opener).toHaveCount(0);
    const focused = await page.evaluate(() => document.activeElement?.tagName ?? null);
    expect(focused).toBe('BODY');
  });

  test('account verwijderen: wachtwoordstap met Enter, Escape sluit en herstelt de focus', async ({
    page,
  }) => {
    await leaveSetup(page, 'kbd-delete');
    const opener = page.getByTestId('account-delete-start-btn');
    await opener.focus();
    await page.keyboard.press('Enter');
    const continueBtn = page.getByTestId('account-delete-continue-btn');
    await expect(continueBtn).toBeVisible({ timeout: 20_000 });
    await expect(continueBtn).toBeFocused();
    await page.keyboard.press('Enter');
    const input = page.getByTestId('account-delete-password-input');
    await expect(input).toBeFocused();
    // De bevestigknop is uit zolang het veld leeg is: Tab gaat naar Terug en weer terug.
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('account-delete-cancel-btn')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(input).toBeFocused();
    await page.keyboard.type('Fout-Wachtwoord-1!');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('account-delete-password-error')).toBeVisible({
      timeout: 20_000,
    });
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});
