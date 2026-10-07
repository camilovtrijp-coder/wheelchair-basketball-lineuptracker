// PR 8.3c-2d: de browseraannames die in eerdere reviews als "niet geverifieerd" stonden
// (docs/pr-8.3c-2b-plan.md §J), nu in een echte browser tegen de echte emulators:
//
//   - A3/R5: Firebase Auth zet het e-mailadres in kleine letters in het token, ook als het
//     account met hoofdletters is aangemaakt en zo wordt ingelogd. Verlaten, verwijderen en
//     overdragen werken dan gewoon; een uitnodiging die buiten de app met hoofdletters is
//     aangemaakt blijft (R5, bevestigd) staan. Let op: dit bewijst het gedrag van de
//     Auth-EMULATOR, niet van productie-Auth.
//   - A4: `getDocsFromServer` met `persistentLocalCache` (vertrouwd apparaat) terwijl
//     Firestore onbereikbaar is: verlaten/verwijderen faalt met de offline-tekst en schrijft
//     niets — zowel met de hele browser offline (dan faalt al de tokenverversing) als met
//     alleen Firestore onbereikbaar en Auth bereikbaar (dan faalt echt `getDocsFromServer`,
//     `unavailable`). Weer online lukt het. Lokaal een wedstrijd spelen blijft offline kunnen.
//   - R6: hervatten van een half aangemaakte organisatie vanaf het geen-organisaties-scherm
//     (`bootstrapOrgId` in localStorage): binnen 7 dagen hervat het dezelfde organisatie;
//     na 7 dagen geeft de hervatting `permission-denied` → de sleutel gaat weg, de melding
//     verschijnt en de volgende klik maakt een nieuwe organisatie; een netwerkonderbreking
//     wist de sleutel niet.
import { test, expect, type Page } from '@playwright/test';
import { adminDb } from './adminFixtures';
import {
  authAccountExists,
  createUser,
  readOwnDocuments,
  readInvitationStatus,
  readMemberRole,
  seedInvitation,
  seedMember,
  seedOrg,
  seedTeamMember,
  snapshotOrganization,
  tokenEmailClaim,
} from './accountFlowFixtures';
import { dialog, openAccountPanel, signInAndSelect, signInUser, text } from './accountFlowPage';
import { fivePlayerRoster, startTrackedGame, waitForGameSyncStatus } from './gameSyncFixtures';
import { selectContext } from './helpers';

const DAY = 24 * 60 * 60 * 1000;
const BOOTSTRAP_KEY = 'lineup-tracker-bootstrap-org-id';
const FIRESTORE_HOST = /127\.0\.0\.1:8080/;

async function readBootstrapKey(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), BOOTSTRAP_KEY);
}

test.describe('8.3c-2d — A3/R5: e-mailadres met hoofdletters', () => {
  test('token-adres in kleine letters; verlaten en daarna account verwijderen werken; een hoofdletteruitnodiging blijft (R5)', async ({
    page,
  }) => {
    const user = await createUser('a3-leave', { mixedCase: true });
    expect(user.typedEmail).not.toBe(user.typedEmail.toLowerCase());
    expect(user.email).toBe(user.typedEmail.toLowerCase());
    expect(await tokenEmailClaim(user.typedEmail, user.password)).toBe(user.email);

    const org = await seedOrg('a3 Vertrek-Org');
    const orgB = await seedOrg('a3 Tweede-Org');
    const owner = await createUser('a3-owner');
    await seedMember(org, owner, 'organizationOwner');
    await seedMember(org, user, 'coach');
    await seedTeamMember(org, org.teamIds[0] ?? '', user, 'coach');
    await seedTeamMember(orgB, orgB.teamIds[0] ?? '', user, 'viewer');
    const lower = await seedInvitation(org, user.email, 'pending');
    const mixed = await seedInvitation(org, user.typedEmail, 'pending'); // buiten de app gespeld

    // Inloggen met het adres zoals het getypt is (hoofdletters).
    await signInAndSelect(page, user, org.orgId, org.teamIds[0] ?? '');
    await expect(page.getByTestId('session-account-email')).toHaveText(user.email);
    await openAccountPanel(page);
    await page.getByTestId('leave-org-start-btn').click();
    await page.getByTestId('leave-org-confirm-btn').click();
    await expect(page.getByTestId('leave-org-result')).toContainText(
      text('nl', 'leaveOrgOk', { org: org.orgName }),
      { timeout: 20_000 },
    );
    expect(await readMemberRole(org, user.uid)).toBeUndefined();
    expect(await readInvitationStatus(lower)).toBeUndefined();
    expect(await readInvitationStatus(mixed)).toBe('pending'); // R5: niet te vinden, blijft
    await page.getByTestId('leave-org-close-btn').click();

    await selectContext(page, orgB.orgId, orgB.teamIds[0] ?? '');
    await openAccountPanel(page);
    await page.getByTestId('account-delete-start-btn').click();
    await expect(page.getByTestId('account-delete-ready')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('account-delete-continue-btn').click();
    await page.getByTestId('account-delete-password-input').fill(user.password);
    await page.getByTestId('account-delete-confirm-btn').click();
    await expect(page.getByTestId('account-delete-deleted')).toBeVisible({ timeout: 30_000 });
    expect(await authAccountExists(user.uid)).toBe(false);
    expect(await readOwnDocuments(user.uid, user.email)).toEqual({
      organizationMembers: [],
      teamMembers: [],
      invitations: [],
    });
    // R5 bevestigd: de afwijkend gespelde uitnodiging blijft na accountverwijdering staan.
    expect(await readInvitationStatus(mixed)).toBe('pending');
  });

  test('overdracht met een owner met hoofdletters: B bevestigt met het getypte adres in andere hoofdletters', async ({
    page,
    browser,
  }) => {
    const ownerA = await createUser('a3-owner-a', { mixedCase: true });
    const userB = await createUser('a3-owner-b', { mixedCase: true });
    const org = await seedOrg('a3 Overdracht-Org');
    const team = org.teamIds[0] ?? '';
    await seedMember(org, ownerA, 'organizationOwner');
    await seedMember(org, userB, 'scorer');
    await seedTeamMember(org, team, userB, 'scorer');
    const invA = await seedInvitation(org, ownerA.email, 'pending');

    await signInAndSelect(page, ownerA, org.orgId, team);
    await openAccountPanel(page);
    await page.getByTestId('transfer-start-btn').click();
    await expect(page.getByTestId('transfer-member-0')).toContainText(userB.email, {
      timeout: 20_000,
    });
    await page.getByTestId('transfer-member-0').click();
    await page.getByTestId('transfer-confirm-btn').click();
    await expect(page.getByTestId('transfer-result')).toContainText(
      text('nl', 'transferPromoteOk', { member: userB.email, org: org.orgName }),
      { timeout: 20_000 },
    );

    const pageB = await (await browser.newContext()).newPage();
    await signInAndSelect(pageB, userB, org.orgId, team);
    await openAccountPanel(pageB);
    await pageB.getByTestId('transfer-remove-owner-start-btn').click();
    await expect(pageB.getByTestId('transfer-member-0')).toContainText(ownerA.email, {
      timeout: 20_000,
    });
    await pageB.getByTestId('transfer-member-0').click();
    // Het adres zoals A het zelf typte (hoofdletters), met spaties eromheen.
    await pageB.getByTestId('transfer-remove-owner-input').fill(` ${ownerA.typedEmail} `);
    await expect(pageB.getByTestId('transfer-confirm-btn')).toBeEnabled();
    await pageB.getByTestId('transfer-confirm-btn').click();
    await expect(pageB.getByTestId('transfer-result')).toContainText(
      text('nl', 'transferCompleteOk', { member: ownerA.email, org: org.orgName }),
      { timeout: 30_000 },
    );
    expect(await readMemberRole(org, ownerA.uid)).toBeUndefined();
    expect(await readMemberRole(org, userB.uid)).toBe('organizationOwner');
    expect(await readInvitationStatus(invA)).toBe('revoked');
    await pageB.context().close();
  });
});

test.describe('8.3c-2d — A4: getDocsFromServer met persistente cache zonder verbinding', () => {
  test('verlaten: browser offline → offline-tekst, niets geschreven; wedstrijd spelen kan offline; online blokkeert het onbevestigde werk', async ({
    page,
  }) => {
    const org = await seedOrg('a4-leave Org');
    const owner = await createUser('a4-leave-owner');
    const user = await createUser('a4-leave');
    const team = org.teamIds[0] ?? '';
    await seedMember(org, owner, 'organizationOwner');
    await seedMember(org, user, 'coach');
    await seedTeamMember(org, team, user, 'coach');
    await adminDb()
      .doc(`organizations/${org.orgId}/teams/${team}/roster/current`)
      .set({ players: fivePlayerRoster(), updatedAt: new Date() });
    await signInAndSelect(page, user, org.orgId, team);
    // Een cloudwedstrijd start online (writer-claim, 7.x); daarna gaat het spelen offline door.
    await startTrackedGame(page);
    await waitForGameSyncStatus(page, 'gesynchroniseerd');
    const ownBefore = await readOwnDocuments(user.uid, user.email);

    await page.context().setOffline(true);
    await openAccountPanel(page);
    await page.getByTestId('leave-org-start-btn').click();
    await page.getByTestId('leave-org-confirm-btn').click();
    const result = page.getByTestId('leave-org-result');
    await expect(result).toContainText(text('nl', 'leaveOrgOffline'), { timeout: 20_000 });
    await expect(result).toContainText(text('nl', 'accountNothingChanged'));
    await page.getByTestId('leave-org-retry-btn').click();
    await expect(result).toContainText(text('nl', 'leaveOrgOffline'), { timeout: 20_000 });
    await page.getByTestId('leave-org-close-btn').click();
    await expect(dialog(page)).toHaveCount(0);

    // Offline verder scoren: gewoon mogelijk, het dialoog hield niets tegen.
    await page.getByTestId('nav-game').click();
    await page.getByTestId('score-plus3-for').click();
    await expect(page.getByTestId('score-select-for')).toHaveValue('3');
    expect(await readMemberRole(org, user.uid)).toBe('coach');

    await page.context().setOffline(false);
    // Niets van het lidmaatschap is geschreven (de wedstrijd zelf synchroniseert los daarvan).
    expect(await readOwnDocuments(user.uid, user.email)).toEqual(ownBefore);
    // Online: de gestarte wedstrijd is onbevestigd lokaal werk voor deze organisatie.
    await openAccountPanel(page);
    await page.getByTestId('leave-org-start-btn').click();
    await page.getByTestId('leave-org-confirm-btn').click();
    await expect(result).toContainText(text('nl', 'leaveOrgBlockedLocalWork', { count: 1 }), {
      timeout: 20_000,
    });
    expect(await readMemberRole(org, user.uid)).toBe('coach');
  });

  test('alleen Firestore onbereikbaar (Auth wel): verlaten en verwijderen falen met de offline-tekst, weer bereikbaar lukt verlaten', async ({
    page,
  }) => {
    const org = await seedOrg('a4-fs Org');
    const owner = await createUser('a4-fs-owner');
    const user = await createUser('a4-fs');
    const team = org.teamIds[0] ?? '';
    await seedMember(org, owner, 'organizationOwner');
    await seedMember(org, user, 'viewer');
    await seedTeamMember(org, team, user, 'viewer');
    const before = await snapshotOrganization(org);
    await signInAndSelect(page, user, org.orgId, team);
    await openAccountPanel(page);

    // De tokenverversing (Auth-emulator) lukt; elke Firestore-request faalt als zonder netwerk.
    await page.route(FIRESTORE_HOST, (route) => route.abort('internetdisconnected'));
    await page.getByTestId('account-delete-start-btn').click();
    await expect(page.getByTestId('account-delete-result')).toContainText(
      text('nl', 'accountDeleteOffline'),
      { timeout: 20_000 },
    );
    await page.getByTestId('account-delete-close-btn').click();
    await page.getByTestId('leave-org-start-btn').click();
    await page.getByTestId('leave-org-confirm-btn').click();
    const result = page.getByTestId('leave-org-result');
    await expect(result).toContainText(text('nl', 'leaveOrgOffline'), { timeout: 20_000 });
    expect(await snapshotOrganization(org)).toEqual(before);
    expect(await authAccountExists(user.uid)).toBe(true);

    await page.unroute(FIRESTORE_HOST);
    // De browser was nooit offline, dus vuurt hij zelf geen 'online'; zonder dat wacht de
    // SDK zijn eigen backoff af. Het event is wat de browser doet als de verbinding terugkomt.
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    // "Opnieuw proberen" tot de SDK weer verbonden is (zoals een gebruiker zou doen); elke
    // mislukte poging is weer `offline` zonder write.
    const retry = page.getByTestId('leave-org-retry-btn');
    await expect(async () => {
      if (await retry.isVisible()) await retry.click();
      await expect(result).toContainText(text('nl', 'leaveOrgOk', { org: org.orgName }), {
        timeout: 5_000,
      });
    }).toPass({ timeout: 30_000 });
    expect(await readMemberRole(org, user.uid)).toBeUndefined();
  });

  test('verwijderen: offline na het plan → bevestigen geeft de offline-tekst, niets geschreven; online lukt het', async ({
    page,
  }) => {
    const org = await seedOrg('a4-del Org');
    const owner = await createUser('a4-del-owner');
    const user = await createUser('a4-del');
    await seedMember(org, owner, 'organizationOwner');
    await seedTeamMember(org, org.teamIds[0] ?? '', user, 'scorer');
    const before = await snapshotOrganization(org);
    await signInAndSelect(page, user, org.orgId, org.teamIds[0] ?? '');
    await openAccountPanel(page);
    await page.getByTestId('account-delete-start-btn').click();
    await expect(page.getByTestId('account-delete-ready')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('account-delete-continue-btn').click();

    await page.context().setOffline(true);
    await page.getByTestId('account-delete-password-input').fill(user.password);
    await page.getByTestId('account-delete-confirm-btn').click();
    // Offline faalt al de preflight (tokenverversing) → "geen verbinding".
    await expect(page.getByTestId('account-delete-result')).toContainText(
      text('nl', 'accountDeleteOffline'),
      { timeout: 30_000 },
    );
    expect(await snapshotOrganization(org)).toEqual(before);
    expect(await authAccountExists(user.uid)).toBe(true);

    await page.context().setOffline(false);
    await page.getByTestId('account-delete-retry-btn').click();
    await expect(page.getByTestId('account-delete-ready')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('account-delete-continue-btn').click();
    await page.getByTestId('account-delete-password-input').fill(user.password);
    await page.getByTestId('account-delete-confirm-btn').click();
    await expect(page.getByTestId('account-delete-deleted')).toBeVisible({ timeout: 30_000 });
    expect(await authAccountExists(user.uid)).toBe(false);
  });
});

test.describe('8.3c-2d — R6: half aangemaakte organisatie hervatten', () => {
  async function seedOrphan(createdBy: string, ageMs: number) {
    const ref = adminDb().collection('organizations').doc();
    await ref.set({
      name: 'R6 Wees-Org',
      createdBy,
      createdAt: new Date(Date.now() - ageMs),
    });
    return ref;
  }

  async function onNoOrganizationsScreenWithKey(page: Page, orgId: string): Promise<void> {
    await expect(page.getByTestId('no-organizations-body')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [
      BOOTSTRAP_KEY,
      orgId,
    ] as const);
    await page.reload();
    await expect(page.getByTestId('onboarding-submit')).toBeVisible({ timeout: 15_000 });
  }

  async function submitOnboarding(page: Page, orgName: string, teamName: string) {
    await page.getByTestId('onboarding-org-name').fill(orgName);
    await page.getByTestId('onboarding-team-name').fill(teamName);
    await page.getByTestId('onboarding-submit').click();
  }

  test('ouder dan 7 dagen: permission-denied wist de sleutel en meldt het; de volgende klik maakt een nieuwe organisatie', async ({
    page,
  }) => {
    const user = await createUser('r6-expired');
    const orphan = await seedOrphan(user.uid, 8 * DAY);
    await signInUser(page, user);
    await onNoOrganizationsScreenWithKey(page, orphan.id);

    await submitOnboarding(page, 'R6 Nieuwe Org', 'R6 Team');
    await expect(page.getByTestId('onboarding-error')).toHaveText(
      text('nl', 'onboardingResumeExpired'),
      { timeout: 20_000 },
    );
    expect(await readBootstrapKey(page)).toBeNull();
    expect((await orphan.collection('organizationMembers').get()).size).toBe(0);

    await page.getByTestId('onboarding-submit').click();
    const own = () => readOwnDocuments(user.uid, user.email);
    await expect
      .poll(async () => (await own()).organizationMembers.length, {
        timeout: 20_000,
      })
      .toBe(1);
    const [memberPath = ''] = (await own()).organizationMembers;
    const newOrgId = memberPath.split('/')[1] ?? '';
    expect(newOrgId).not.toBe(orphan.id);
    await expect(page.getByTestId(`context-org-${newOrgId}`)).toBeVisible({ timeout: 20_000 });
    expect(await readBootstrapKey(page)).toBeNull();
    expect((await orphan.collection('organizationMembers').get()).size).toBe(0);
  });

  test('binnen 7 dagen: de hervatting maakt de gebruiker owner van DEZELFDE organisatie', async ({
    page,
  }) => {
    const user = await createUser('r6-resume');
    const orphan = await seedOrphan(user.uid, 60 * 60 * 1000);
    await signInUser(page, user);
    await onNoOrganizationsScreenWithKey(page, orphan.id);
    await submitOnboarding(page, 'R6 Wees-Org', 'R6 Team');
    await expect(page.getByTestId(`context-org-${orphan.id}`)).toBeVisible({ timeout: 20_000 });
    expect(await readBootstrapKey(page)).toBeNull();
    expect((await readOwnDocuments(user.uid, user.email)).organizationMembers).toEqual([
      `organizations/${orphan.id}/organizationMembers/${user.uid}`,
    ]);
  });

  test('netwerkonderbreking tijdens de hervatting wist de sleutel niet; weer online wordt hij afgerond', async ({
    page,
  }) => {
    const user = await createUser('r6-offline');
    const orphan = await seedOrphan(user.uid, 60 * 60 * 1000);
    await signInUser(page, user);
    await onNoOrganizationsScreenWithKey(page, orphan.id);

    await page.context().setOffline(true);
    await submitOnboarding(page, 'R6 Wees-Org', 'R6 Team');
    // De membership-write staat in de offline-wachtrij van Firestore (de SDK verwerpt een
    // write zonder verbinding niet met `unavailable`, hij wacht): de knop blijft bezig en de
    // sleutel blijft staan.
    await expect(page.getByTestId('onboarding-submit')).toBeDisabled();
    expect(await readBootstrapKey(page)).toBe(orphan.id);
    await expect(page.getByTestId('onboarding-error')).toHaveCount(0);

    await page.context().setOffline(false);
    await expect(page.getByTestId(`context-org-${orphan.id}`)).toBeVisible({ timeout: 30_000 });
    expect(await readBootstrapKey(page)).toBeNull();
  });
});
