// PR 8.3c-1c-ii (docs/pr-8.3-plan.md §C 8.3c, §D): e2e voor het owner-geïnitieerde
// verwijderverzoek tegen de ECHTE Firebase Auth-/Firestore-emulator met de ECHTE Security
// Rules — geen fakes. De beslissingen zelf (blokkades, overgangen, bewijs) zijn al bewezen
// in `DeletionRequestCoordinator.spec.ts`/`deletionAssessment.spec.ts` (vitest) en
// `firebase/tests/rules/deletion-*.spec.ts` (Rules); dit bestand bewijst dat de
// UI-wiring met een echte Auth-sessie, echte Rules en echte serverreadback dezelfde
// uitkomsten geeft, en dat de dialoog in een echte browser toegankelijk is.
//
// Dekking (plan §D): owner/admin/coach/scorer/viewer, cross-org, serverreadback via
// Admin (niet alleen een succesmelding in de UI), rolverlies TIJDENS de uitvoering
// (faalt gesloten), axe op het paneel en de dialoog in NL én EN, en Tab/Shift+Tab/
// Escape/focusherstel met alleen het toetsenbord.
//
// Elke test seedt een eigen, unieke organisatie (fictieve data) en is onafhankelijk van
// de andere; de suite draait serieel (zie playwright.auth.config.ts).
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page, type Browser } from '@playwright/test';
import { lookupUidByEmail } from './adminFixtures';
import { signUp, answerTrustedDevice, selectContext, uniqueTestEmail } from './helpers';
import {
  DAY,
  HOUR,
  readDeletionRequest,
  seedBareOrg,
  seedCompletedGame,
  seedInvitation,
  seedMigrationRun,
  seedOrgMember,
  seedTeamMember,
  seedUnfinishedGame,
  type SeededOrg,
} from './deletionFixtures';

const PASSWORD = 'DeletionFlow123!';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

type Role = 'organizationOwner' | 'organizationAdmin' | 'coach' | 'scorer' | 'viewer';

interface Member {
  page: Page;
  uid: string;
  email: string;
}

/** Registreert een gebruiker via de UI, geeft hem een rol in `org` en kiest de context. */
async function joinOrg(
  page: Page,
  label: string,
  org: SeededOrg,
  role: Role | 'team-only-coach',
  lang: 'nl' | 'en' = 'nl',
): Promise<Member> {
  await page.addInitScript(
    (value) => window.localStorage.setItem('lineup-tracker-lang', value),
    lang,
  );
  const email = uniqueTestEmail(label);
  await signUp(page, email, PASSWORD);
  await answerTrustedDevice(page, true);
  const uid = await lookupUidByEmail(email, PASSWORD);
  if (role === 'team-only-coach') {
    await seedTeamMember(org.orgId, org.teamId, uid, email, 'coach');
  } else if (role === 'coach' || role === 'scorer' || role === 'viewer') {
    // De contextwisselaar toont alleen teams waarvan de gebruiker lid is: naast de
    // organisatierol krijgt hij dus ook een teamMembers-rij met dezelfde rol.
    await seedOrgMember(org.orgId, uid, email, role);
    await seedTeamMember(org.orgId, org.teamId, uid, email, role);
  } else {
    await seedOrgMember(org.orgId, uid, email, role);
  }
  await page.reload();
  await selectContext(page, org.orgId, org.teamId);
  return { page, uid, email };
}

/** Na een reload herstelt de app de laatst gekozen context; vraagt hij er toch om, kies die dan. */
async function reselectContextIfAsked(page: Page, org: SeededOrg): Promise<void> {
  const settings = page.getByTestId('nav-settings');
  const picker = page.getByTestId(`context-org-${org.orgId}`);
  await expect(settings.or(picker)).toBeVisible({ timeout: 15_000 });
  if (await picker.isVisible()) await selectContext(page, org.orgId, org.teamId);
}

async function openAssessed(page: Page): Promise<void> {
  await page.getByTestId('deletion-start-btn').click();
  await expect(page.getByTestId('deletion-assessed')).toBeVisible({ timeout: 15_000 });
}

async function typeOrgNameAndConfirm(page: Page, orgName: string): Promise<void> {
  await page.getByTestId('deletion-request-btn').click();
  await expect(page.getByTestId('deletion-request-dialog')).toBeVisible();
  await page.getByTestId('deletion-request-dialog-input').fill(orgName);
  await page.getByTestId('deletion-request-dialog-confirm').click();
}

async function newMemberPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test.describe('8.3c-1c-ii — rolgating: alleen de owner ziet het verwijderpaneel', () => {
  test('organizationOwner ziet het paneel en de startknop', async ({ page }) => {
    const org = await seedBareOrg('Del-Rol-Owner-Org', 'Del-Rol-Owner-Team');
    await joinOrg(page, 'del-owner', org, 'organizationOwner');
    await expect(page.getByTestId('deletion-panel')).toBeVisible();
    await expect(page.getByTestId('deletion-start-btn')).toBeVisible();
  });

  for (const role of ['organizationAdmin', 'coach', 'scorer', 'viewer'] as const) {
    test(`${role} krijgt het paneel NOOIT te zien`, async ({ page }) => {
      const org = await seedBareOrg(`Del-Rol-${role}-Org`, `Del-Rol-${role}-Team`);
      await joinOrg(page, `del-${role}`, org, role);
      await expect(page.getByTestId('nav-settings')).toBeVisible();
      await expect(page.getByTestId('deletion-panel')).toHaveCount(0);
    });
  }

  test('een team-only coach (alleen een teamMembers-rij) krijgt het paneel NOOIT te zien', async ({
    page,
  }) => {
    const org = await seedBareOrg('Del-Rol-TeamOnly-Org', 'Del-Rol-TeamOnly-Team');
    await joinOrg(page, 'del-teamonly', org, 'team-only-coach');
    await expect(page.getByTestId('nav-settings')).toBeVisible();
    await expect(page.getByTestId('deletion-panel')).toHaveCount(0);
  });
});

test.describe('8.3c-1c-ii — volledige stroom met serverreadback', () => {
  test('beoordelen, aanvragen, downloaden, herladen, annuleren en opnieuw aanvragen', async ({
    page,
  }) => {
    const org = await seedBareOrg('Del-Flow-Org', 'Del-Flow-Team');
    // Opruimoverzicht met met de hand na te rekenen aantallen:
    await seedCompletedGame(org, { tombstonedAgoMs: 100 * DAY }); // verlopen tombstone
    await seedCompletedGame(org, { tombstonedAgoMs: 10 * DAY }); // nog niet verlopen
    await seedInvitation(org.orgId, {
      status: 'pending',
      email: 'p@example.test',
      invitedAgoMs: 35 * DAY,
    });
    await seedInvitation(org.orgId, {
      status: 'pending',
      email: 'q@example.test',
      invitedAgoMs: 2 * DAY,
    });
    await seedInvitation(org.orgId, {
      status: 'revoked',
      email: 'r@example.test',
      invitedAgoMs: 60 * DAY,
      statusAgoMs: 40 * DAY,
    });
    await seedInvitation(org.orgId, {
      status: 'claimed',
      email: 'c@example.test',
      invitedAgoMs: 60 * DAY,
      statusAgoMs: 2 * DAY,
    });
    const owner = await joinOrg(page, 'del-flow', org, 'organizationOwner');

    await openAssessed(page);
    await expect(page.getByTestId('deletion-cleanup-tombstones')).toContainText(': 1');
    await expect(page.getByTestId('deletion-cleanup-invitations-pending')).toContainText(': 1');
    await expect(page.getByTestId('deletion-cleanup-invitations-accepted')).toContainText(': 0');
    await expect(page.getByTestId('deletion-cleanup-invitations-claimed')).toContainText(': 0');
    await expect(page.getByTestId('deletion-cleanup-invitations-revoked')).toContainText(': 1');
    await expect(page.getByTestId('deletion-cleanup-abandoned-games')).toContainText(': 0');
    await expect(page.getByTestId('deletion-blockers')).toHaveCount(0);

    // Geen verzoek vóór de bevestiging, en een verkeerde naam laat de knop uit.
    expect(await readDeletionRequest(org.orgId)).toBeUndefined();
    await page.getByTestId('deletion-request-btn').click();
    await page.getByTestId('deletion-request-dialog-input').fill('Verkeerde Naam');
    await expect(page.getByTestId('deletion-request-dialog-confirm')).toBeDisabled();
    await page.getByTestId('deletion-request-dialog-input').fill(org.orgName);
    await page.getByTestId('deletion-request-dialog-confirm').click();

    await expect(page.getByTestId('deletion-submitted')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('deletion-status')).toContainText('handmatig');
    await expect(page.getByTestId('deletion-banner')).toBeVisible();

    // Serverreadback via Admin: niet alleen een succesmelding in de UI.
    const first = await readDeletionRequest(org.orgId);
    expect(first).toBeDefined();
    expect(first).toMatchObject({
      organizationId: org.orgId,
      status: 'requested',
      attempt: 1,
      requestedBy: owner.uid,
      cancelledAt: null,
      revision: 0,
    });
    expect(first?.requestedAt.toMillis()).toBeGreaterThan(Date.now() - 60_000);
    expect(first?.exportProof.contentHash.length).toBeGreaterThan(0);
    expect(Object.keys(first?.exportProof.counts ?? {}).sort()).toEqual(
      [
        'completedGames',
        'gameActions',
        'games',
        'invitations',
        'migrationRuns',
        'organizationMembers',
        'rosterPlayers',
        'settingsDocuments',
        'teamMembers',
        'teams',
      ].sort(),
    );
    expect(first?.exportProof.counts).toMatchObject({
      organizationMembers: 1,
      invitations: 4,
      teams: 1,
      completedGames: 2,
      games: 0,
      migrationRuns: 0,
    });

    // De export is alleen via een expliciete klik te downloaden, en hoort bij het bewijs.
    await expect(page.getByTestId('deletion-export-only-now')).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('deletion-download-btn').click();
    const download = await downloadPromise;
    await expect(page.getByTestId('deletion-downloaded')).toBeVisible();
    await expect(page.getByTestId('deletion-export-only-now')).toHaveCount(0);
    const fs = await import('node:fs/promises');
    const parsed = JSON.parse(await fs.readFile((await download.path()) as string, 'utf8')) as {
      contentHash: string;
      sourceContext: { organizationId: string };
    };
    expect(parsed.contentHash).toBe(first?.exportProof.contentHash);
    expect(parsed.sourceContext.organizationId).toBe(org.orgId);

    // Herladen: de melding en de status komen uit de server, niet uit de UI-state.
    await page.reload();
    await reselectContextIfAsked(page, org);
    await expect(page.getByTestId('deletion-banner')).toBeVisible({ timeout: 15_000 });
    await openAssessed(page);
    await expect(page.getByTestId('deletion-status')).toContainText('handmatig');
    await expect(page.getByTestId('deletion-request-btn')).toHaveCount(0);
    await expect(page.getByTestId('deletion-cancel-request-btn')).toBeVisible();

    // Annuleren.
    await page.getByTestId('deletion-cancel-request-btn').click();
    await page.getByTestId('deletion-cancel-dialog-confirm').click();
    await expect(page.getByTestId('deletion-notice')).toContainText('geannuleerd', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('deletion-banner')).toHaveCount(0);
    const cancelled = await readDeletionRequest(org.orgId);
    expect(cancelled).toMatchObject({ status: 'cancelled', attempt: 1, revision: 1 });
    expect(cancelled?.cancelledAt).not.toBeNull();

    // Opnieuw aanvragen (herstart): attempt + 1, nieuw bewijs, cancelledAt weer leeg.
    await typeOrgNameAndConfirm(page, org.orgName);
    await expect(page.getByTestId('deletion-submitted')).toBeVisible({ timeout: 15_000 });
    const restarted = await readDeletionRequest(org.orgId);
    expect(restarted).toMatchObject({
      status: 'requested',
      attempt: 2,
      revision: 2,
      cancelledAt: null,
    });
    expect((restarted?.exportProof.exportedAt ?? '') > (first?.exportProof.exportedAt ?? '')).toBe(
      true,
    );
  });

  test('een harde blokkade (recente wedstrijd) laat geen verzoek toe en schrijft niets', async ({
    page,
  }) => {
    const org = await seedBareOrg('Del-Block-Org', 'Del-Block-Team');
    await seedUnfinishedGame(org, { lastActivityAgoMs: HOUR, createdAgoMs: 2 * DAY });
    await joinOrg(page, 'del-block', org, 'organizationOwner');
    await openAssessed(page);
    await expect(page.getByTestId('deletion-blocker-recent-active-game')).toBeVisible();
    await expect(page.getByTestId('deletion-request-btn')).toBeDisabled();
    expect(await readDeletionRequest(org.orgId)).toBeUndefined();
  });

  test('een net aangemaakte, nog niet geclaimde wedstrijd (lastWriterActivityAt null) blokkeert ook', async ({
    page,
  }) => {
    const org = await seedBareOrg('Del-NullAct-Org', 'Del-NullAct-Team');
    await seedUnfinishedGame(org, { lastActivityAgoMs: null, createdAgoMs: 5 * 60 * 1000 });
    await joinOrg(page, 'del-nullact', org, 'organizationOwner');
    await openAssessed(page);
    await expect(page.getByTestId('deletion-blocker-recent-active-game')).toBeVisible();
    await expect(page.getByTestId('deletion-request-btn')).toBeDisabled();
  });

  test('een niet-afgeronde migratierun blokkeert hard', async ({ page }) => {
    const org = await seedBareOrg('Del-Mig-Org', 'Del-Mig-Team');
    await seedMigrationRun(org, 'paused');
    await joinOrg(page, 'del-mig', org, 'organizationOwner');
    await openAssessed(page);
    await expect(page.getByTestId('deletion-blocker-migration-run-not-terminal')).toBeVisible();
    await expect(page.getByTestId('deletion-request-btn')).toBeDisabled();
  });

  test('een verlaten wedstrijd (oud) vraagt om een bevestiging en kan daarna worden aangevraagd', async ({
    page,
  }) => {
    const org = await seedBareOrg('Del-Stale-Org', 'Del-Stale-Team');
    await seedUnfinishedGame(org, {
      lastActivityAgoMs: 30 * DAY,
      createdAgoMs: 30 * DAY,
      updatedAgoMs: 30 * DAY,
    });
    await joinOrg(page, 'del-stale', org, 'organizationOwner');
    await openAssessed(page);
    await expect(page.getByTestId('deletion-blockers')).toHaveCount(0);
    await expect(page.getByTestId('deletion-stale')).toBeVisible();
    await expect(page.getByTestId('deletion-request-btn')).toBeDisabled();
    await page.getByTestId('deletion-stale-ack').check();
    await expect(page.getByTestId('deletion-request-btn')).toBeEnabled();
    await typeOrgNameAndConfirm(page, org.orgName);
    await expect(page.getByTestId('deletion-submitted')).toBeVisible({ timeout: 15_000 });
    expect((await readDeletionRequest(org.orgId))?.status).toBe('requested');
  });

  test('rolverlies TIJDENS de uitvoering faalt gesloten: er wordt niets aangemaakt', async ({
    page,
  }) => {
    const org = await seedBareOrg('Del-RoleLoss-Org', 'Del-RoleLoss-Team');
    const owner = await joinOrg(page, 'del-roleloss', org, 'organizationOwner');
    await openAssessed(page);
    await page.getByTestId('deletion-request-btn').click();
    await page.getByTestId('deletion-request-dialog-input').fill(org.orgName);

    // De rol wordt ingetrokken terwijl de dialoog open staat.
    await seedOrgMember(org.orgId, owner.uid, owner.email, 'coach');

    await page.getByTestId('deletion-request-dialog-confirm').click();
    await expect(page.getByTestId('deletion-error')).toBeVisible({ timeout: 15_000 });
    // De weigering moet om de rol gaan, niet een willekeurige (bijv. generieke) fout.
    await expect(page.getByTestId('deletion-error')).toContainText(
      'Alleen de eigenaar van de organisatie kan verwijdering aanvragen.',
    );
    expect(await readDeletionRequest(org.orgId)).toBeUndefined();
  });
});

test.describe('8.3c-1c-ii — melding aan andere leden en cross-org', () => {
  test('een viewer van dezelfde organisatie ziet de melding, maar geen paneel', async ({
    page,
    browser,
  }) => {
    const org = await seedBareOrg('Del-Banner-Org', 'Del-Banner-Team');
    await joinOrg(page, 'del-banner-owner', org, 'organizationOwner');
    await openAssessed(page);
    await typeOrgNameAndConfirm(page, org.orgName);
    await expect(page.getByTestId('deletion-submitted')).toBeVisible({ timeout: 15_000 });

    const viewerPage = await newMemberPage(browser);
    await joinOrg(viewerPage, 'del-banner-viewer', org, 'viewer');
    await expect(viewerPage.getByTestId('deletion-banner')).toBeVisible({ timeout: 15_000 });
    await expect(viewerPage.getByTestId('deletion-panel')).toHaveCount(0);
  });

  test('een team-only lid ziet de melding NIET en merkt geen fout (geaccepteerd restrisico, §8.3)', async ({
    page,
    browser,
  }) => {
    const org = await seedBareOrg('Del-TeamOnlyBanner-Org', 'Del-TeamOnlyBanner-Team');
    await joinOrg(page, 'del-tob-owner', org, 'organizationOwner');
    await openAssessed(page);
    await typeOrgNameAndConfirm(page, org.orgName);
    await expect(page.getByTestId('deletion-submitted')).toBeVisible({ timeout: 15_000 });

    const teamPage = await newMemberPage(browser);
    await joinOrg(teamPage, 'del-tob-team', org, 'team-only-coach');
    await expect(teamPage.getByTestId('nav-settings')).toBeVisible();
    await expect(teamPage.getByTestId('deletion-banner')).toHaveCount(0);
  });

  test('de owner van een ANDERE organisatie ziet de melding van deze organisatie nooit', async ({
    page,
    browser,
  }) => {
    const orgA = await seedBareOrg('Del-CrossA-Org', 'Del-Cross-Team');
    const orgB = await seedBareOrg('Del-CrossB-Org', 'Del-Cross-Team'); // gelijknamig team
    await joinOrg(page, 'del-cross-a', orgA, 'organizationOwner');
    await openAssessed(page);
    await typeOrgNameAndConfirm(page, orgA.orgName);
    await expect(page.getByTestId('deletion-submitted')).toBeVisible({ timeout: 15_000 });

    const pageB = await newMemberPage(browser);
    await joinOrg(pageB, 'del-cross-b', orgB, 'organizationOwner');
    await expect(pageB.getByTestId('deletion-panel')).toBeVisible();
    await expect(pageB.getByTestId('deletion-banner')).toHaveCount(0);
    await openAssessed(pageB);
    await expect(pageB.getByTestId('deletion-status')).toHaveCount(0);
    expect(await readDeletionRequest(orgB.orgId)).toBeUndefined();
  });
});

test.describe('8.3c-1c-ii — toegankelijkheid (axe, toetsenbord, taal)', () => {
  async function expectNoPanelViolations(page: Page): Promise<void> {
    // De modal heeft een intrede-animatie (opacity 0.85 → 1): axe die midden daarin meet
    // ziet een gemengde kleur (#717785 i.p.v. de token #6b7280) en meldt vals contrast.
    // De app respecteert prefers-reduced-motion, dus meet de eindtoestand.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const results = await new AxeBuilder({ page })
      .include('[data-testid="deletion-panel"]')
      .withTags(WCAG_TAGS)
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  }

  for (const lang of ['nl', 'en'] as const) {
    test(`axe: geen schendingen op het paneel en de dialogen (${lang})`, async ({ page }) => {
      const org = await seedBareOrg(`Del-Axe-${lang}-Org`, `Del-Axe-${lang}-Team`);
      await seedUnfinishedGame(org, {
        lastActivityAgoMs: 30 * DAY,
        createdAgoMs: 30 * DAY,
        updatedAgoMs: 30 * DAY,
      });
      await joinOrg(page, `del-axe-${lang}`, org, 'organizationOwner', lang);
      await expectNoPanelViolations(page); // idle
      await openAssessed(page);
      await expectNoPanelViolations(page); // beoordeeld, met waarschuwing en overzicht

      await page.getByTestId('deletion-stale-ack').check();
      await page.getByTestId('deletion-request-btn').click();
      await expect(page.getByTestId('deletion-request-dialog')).toBeVisible();
      await expectNoPanelViolations(page); // aanvraagdialoog

      await page.getByTestId('deletion-request-dialog-input').fill(org.orgName);
      await page.getByTestId('deletion-request-dialog-confirm').click();
      await expect(page.getByTestId('deletion-submitted')).toBeVisible({ timeout: 15_000 });
      await expectNoPanelViolations(page); // ingediend

      await page.getByRole('button', { name: lang === 'nl' ? 'Sluiten' : 'Close' }).click();
      await expect(page.getByTestId('deletion-cancel-request-btn')).toBeVisible({
        timeout: 15_000,
      });
      await page.getByTestId('deletion-cancel-request-btn').click();
      await expect(page.getByTestId('deletion-cancel-dialog')).toBeVisible();
      await expectNoPanelViolations(page); // annuleerdialoog
    });
  }

  test('de teksten volgen de gekozen taal (EN)', async ({ page }) => {
    const org = await seedBareOrg('Del-En-Org', 'Del-En-Team');
    await joinOrg(page, 'del-en', org, 'organizationOwner', 'en');
    await expect(page.getByTestId('deletion-panel')).toContainText('Delete organization');
    await openAssessed(page);
    await expect(page.getByTestId('deletion-cleanup')).toContainText(
      'Deleted matches older than 90 days',
    );
  });

  test('alleen het toetsenbord: Tab/Shift+Tab blijft in de dialoog, Escape sluit en herstelt de focus, na afloop staat de focus op het paneel', async ({
    page,
  }) => {
    const org = await seedBareOrg('Del-Kbd-Org', 'Del-Kbd-Team');
    await joinOrg(page, 'del-kbd', org, 'organizationOwner');
    await openAssessed(page);

    const opener = page.getByTestId('deletion-request-btn');
    await opener.focus();
    await expect(opener).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByTestId('deletion-request-dialog');
    await expect(dialog).toBeVisible();

    // Eerste focusbare element: het tekstveld. De bevestigknop is uitgeschakeld en valt af
    // in de tabvolgorde, dus de cyclus is tekstveld -> terugknop -> tekstveld.
    const input = page.getByTestId('deletion-request-dialog-input');
    const back = page.getByTestId('deletion-request-dialog-back');
    await expect(input).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(back).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(input).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(back).toBeFocused();

    // Escape sluit en geeft de focus terug aan de knop die de dialoog opende.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect(await readDeletionRequest(org.orgId)).toBeUndefined();

    // Opnieuw openen, typen en met het toetsenbord bevestigen.
    await page.keyboard.press('Enter');
    await expect(input).toBeFocused();
    await page.keyboard.type(org.orgName);
    await expect(page.getByTestId('deletion-request-dialog-confirm')).toBeEnabled();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('deletion-request-dialog-confirm')).toBeFocused();
    await page.keyboard.press('Enter');

    // De knop die de dialoog opende bestaat na een geslaagde aanvraag niet meer: de focus
    // hoort dan op het paneel te staan, niet op <body>.
    await expect(page.getByTestId('deletion-submitted')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('deletion-panel')).toBeFocused();
  });
});
