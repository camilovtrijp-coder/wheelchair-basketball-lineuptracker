// PR 8.3c-2d (docs/pr-8.3c-2b-plan.md §B.8/§C.3, docs/pr-8.3c-2c-plan.md §8, besluit B9):
// e2e voor de tweestaps-overdracht met TWEE echte gebruikers in twee browsercontexten, tegen
// de ECHTE Firebase Auth-/Firestore-emulator en de ECHTE Security Rules:
//
//   1. owner A maakt B mede-eigenaar ("Eigendom overdragen…") — serverreadback: B owner;
//   2. B ziet na herladen de ownerknoppen, kiest "Andere eigenaar verwijderen…", typt A's
//      e-mailadres (knop uit tot het klopt; getrimd, zonder hoofdlettergevoeligheid) en
//      verwijdert A — serverreadback: A's membership en teamMembers weg, A's open
//      uitnodigingen `revoked`, claimed ongemoeid, B owner, andere leden en andere
//      organisaties byte-identiek;
//   3. A's UI na het verwijderen (herladen: de organisatie is weg);
//   4. een niet-owner ziet de knoppen nooit;
//   5. twee owners die elkaar TEGELIJK verwijderen: precies één slaagt, er blijft een owner.
import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  createUser,
  readInvitationStatus,
  readMemberRole,
  readOwnDocuments,
  seedBystanderOrg,
  seedInvitation,
  seedMember,
  seedOrg,
  seedTeamMember,
  snapshotOrganization,
  type TestUser,
} from './accountFlowFixtures';
import { dialog, openAccountPanel, signInAndSelect, text } from './accountFlowPage';

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

function omit(snapshot: Record<string, unknown>, paths: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(snapshot).filter(([path]) => !paths.includes(path)));
}

/** Kies in de keuzelijst het lid met dit e-mailadres (testid's staan op index). */
async function chooseMember(page: Page, email: string): Promise<void> {
  const list = page.getByTestId('transfer-member-list');
  await expect(list).toBeVisible({ timeout: 20_000 });
  await list.getByRole('button').filter({ hasText: email }).click();
}

async function openRemoveOwner(page: Page, target: TestUser): Promise<void> {
  await openAccountPanel(page);
  await page.getByTestId('transfer-remove-owner-start-btn').click();
  await chooseMember(page, target.email);
  await expect(page.getByTestId('transfer-remove-owner-form')).toBeVisible();
}

test.describe('8.3c-2d — overdracht met twee echte gebruikers', () => {
  test('A maakt B mede-eigenaar, B verwijdert A met getypte bevestiging; serverreadback en A na afloop', async ({
    page,
    browser,
  }) => {
    const ownerA = await createUser('transfer-a');
    const userB = await createUser('transfer-b');
    const viewer = await createUser('transfer-viewer');
    const org = await seedOrg('transfer Org', { teamCount: 2, createdBy: ownerA.uid });
    const elsewhere = await seedOrg('transfer Elders-Org'); // A blijft daar lid
    const bystander = await seedBystanderOrg('transfer');
    const [t1 = '', t2 = ''] = org.teamIds;
    await seedMember(org, ownerA, 'organizationOwner');
    await seedTeamMember(org, t1, ownerA, 'coach');
    await seedTeamMember(org, t2, ownerA, 'coach');
    await seedMember(org, userB, 'coach');
    await seedTeamMember(org, t1, userB, 'coach');
    await seedMember(org, viewer, 'viewer');
    await seedTeamMember(org, t1, viewer, 'viewer');
    const invPending = await seedInvitation(org, ownerA.email, 'pending', 'coach');
    const invAccepted = await seedInvitation(org, ownerA.email, 'accepted', 'organizationAdmin');
    const invClaimed = await seedInvitation(org, ownerA.email, 'claimed');
    await seedMember(elsewhere, ownerA, 'viewer');
    await seedTeamMember(elsewhere, elsewhere.teamIds[0] ?? '', ownerA, 'viewer');
    const beforeElsewhere = await snapshotOrganization(elsewhere);
    const beforeBystander = await snapshotOrganization(bystander);

    // --- Stap 1: owner A promoveert B.
    await signInAndSelect(page, ownerA, org.orgId, t1);
    await openAccountPanel(page);
    await page.getByTestId('transfer-start-btn').click();
    await expect(dialog(page)).toHaveAttribute(
      'aria-label',
      text('nl', 'transferPromoteTitle', { org: org.orgName }),
    );
    // Kandidaten: alleen niet-owners (B en de viewer), nooit A zelf.
    await expect(page.getByTestId('transfer-member-list').getByRole('button')).toHaveCount(2, {
      timeout: 20_000,
    });
    await expect(page.getByTestId('transfer-member-list')).not.toContainText(ownerA.email);
    await chooseMember(page, userB.email);
    await expect(page.getByTestId('transfer-promote-desc')).toHaveText(
      text('nl', 'transferPromoteConfirmDesc', { member: userB.email, org: org.orgName }),
    );
    await page.getByTestId('transfer-confirm-btn').click();
    const resultA = page.getByTestId('transfer-result');
    await expect(resultA).toContainText(
      text('nl', 'transferPromoteOk', { member: userB.email, org: org.orgName }),
      { timeout: 20_000 },
    );
    await expect(resultA).toContainText(
      text('nl', 'transferPromoteAwaiting', { member: userB.email, org: org.orgName }),
    );
    expect(await readMemberRole(org, userB.uid)).toBe('organizationOwner');
    expect(await readMemberRole(org, ownerA.uid)).toBe('organizationOwner');
    await page.getByTestId('transfer-close-btn').click();

    // --- Een niet-owner ziet de overdrachtsknoppen nooit (wel "verlaten").
    const viewerPage = await newPage(browser);
    await signInAndSelect(viewerPage, viewer, org.orgId, t1);
    await openAccountPanel(viewerPage);
    await expect(viewerPage.getByTestId('leave-org-start-btn')).toBeVisible();
    await expect(viewerPage.getByTestId('transfer-start-btn')).toHaveCount(0);
    await expect(viewerPage.getByTestId('transfer-remove-owner-start-btn')).toHaveCount(0);
    await viewerPage.context().close();

    // --- Stap 2: B (nu owner) verwijdert A.
    const beforeRemoval = await snapshotOrganization(org);
    const pageB = await newPage(browser);
    await signInAndSelect(pageB, userB, org.orgId, t1);
    await openAccountPanel(pageB);
    await expect(pageB.getByTestId('leave-org-start-btn')).toHaveCount(0);
    await expect(pageB.getByTestId('leave-org-owner-note')).toBeVisible();
    await pageB.getByTestId('transfer-remove-owner-start-btn').click();
    await expect(pageB.getByTestId('transfer-member-list').getByRole('button')).toHaveCount(1, {
      timeout: 20_000,
    });
    await chooseMember(pageB, ownerA.email);

    const input = pageB.getByTestId('transfer-remove-owner-input');
    const confirm = pageB.getByTestId('transfer-confirm-btn');
    await expect(confirm).toBeDisabled();
    await input.fill(userB.email); // het verkeerde adres
    await expect(pageB.getByTestId('transfer-remove-owner-mismatch')).toHaveText(
      text('nl', 'transferRemoveOwnerMismatch'),
    );
    await expect(confirm).toBeDisabled();
    await input.fill(ownerA.email.slice(0, -1)); // bijna goed
    await expect(confirm).toBeDisabled();
    // Getrimd en zonder hoofdlettergevoeligheid.
    await input.fill(`  ${ownerA.email.toUpperCase()}  `);
    await expect(pageB.getByTestId('transfer-remove-owner-mismatch')).toHaveCount(0);
    await expect(confirm).toBeEnabled();
    // Nog niets geschreven zolang er niet is bevestigd.
    expect(await snapshotOrganization(org)).toEqual(beforeRemoval);
    await confirm.click();

    const resultB = pageB.getByTestId('transfer-result');
    await expect(resultB).toContainText(
      text('nl', 'transferCompleteOk', { member: ownerA.email, org: org.orgName }),
      { timeout: 30_000 },
    );
    await expect(resultB).toContainText(
      text('nl', 'transferCompleteCounts', { invitations: 2, teams: 2 }),
    );

    // Serverreadback.
    expect(await readMemberRole(org, ownerA.uid)).toBeUndefined();
    expect(await readMemberRole(org, userB.uid)).toBe('organizationOwner');
    expect(await readMemberRole(org, viewer.uid)).toBe('viewer');
    expect(await readInvitationStatus(invPending)).toBe('revoked');
    expect(await readInvitationStatus(invAccepted)).toBe('revoked');
    expect(await readInvitationStatus(invClaimed)).toBe('claimed');
    const ownA = await readOwnDocuments(ownerA.uid, ownerA.email);
    expect(ownA.organizationMembers).toEqual([
      `organizations/${elsewhere.orgId}/organizationMembers/${ownerA.uid}`,
    ]);
    expect(ownA.teamMembers.filter((path) => path.includes(org.orgId))).toEqual([]);
    const changed = [
      `organizations/${org.orgId}/organizationMembers/${ownerA.uid}`,
      `organizations/${org.orgId}/teams/${t1}/teamMembers/${ownerA.uid}`,
      `organizations/${org.orgId}/teams/${t2}/teamMembers/${ownerA.uid}`,
      invPending,
      invAccepted,
    ];
    expect(omit(await snapshotOrganization(org), changed)).toEqual(omit(beforeRemoval, changed));
    expect(await snapshotOrganization(elsewhere)).toEqual(beforeElsewhere);
    expect(await snapshotOrganization(bystander)).toEqual(beforeBystander);

    // --- A na afloop: herladen herstelt A's gekozen context, die de server nu weigert →
    // "Geen toegang meer" (het bestaande intrekkingsscherm); terug naar het overzicht toont
    // alleen nog de andere organisatie.
    await page.reload();
    await expect(page.getByTestId('context-revoked-body')).toHaveText(
      text('nl', 'stateContextRevokedBody'),
      { timeout: 15_000 },
    );
    await page.getByTestId('context-revoked-back').click();
    await expect(page.getByTestId(`context-org-${elsewhere.orgId}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId(`context-org-${org.orgId}`)).toHaveCount(0);
    await pageB.context().close();
  });

  test('twee owners verwijderen elkaar tegelijk: precies één slaagt, er blijft een owner', async ({
    page,
    browser,
  }) => {
    const ownerP = await createUser('transfer-race-p');
    const ownerQ = await createUser('transfer-race-q');
    const org = await seedOrg('transfer-race Org');
    const bystander = await seedBystanderOrg('transfer-race');
    const beforeBystander = await snapshotOrganization(bystander);
    const team = org.teamIds[0] ?? '';
    await seedMember(org, ownerP, 'organizationOwner');
    await seedMember(org, ownerQ, 'organizationOwner');

    const pageQ = await newPage(browser);
    await signInAndSelect(page, ownerP, org.orgId, team);
    await signInAndSelect(pageQ, ownerQ, org.orgId, team);
    await openRemoveOwner(page, ownerQ);
    await openRemoveOwner(pageQ, ownerP);
    await page.getByTestId('transfer-remove-owner-input').fill(ownerQ.email);
    await pageQ.getByTestId('transfer-remove-owner-input').fill(ownerP.email);

    await Promise.all([
      page.getByTestId('transfer-confirm-btn').click(),
      pageQ.getByTestId('transfer-confirm-btn').click(),
    ]);
    const results = [page.getByTestId('transfer-result'), pageQ.getByTestId('transfer-result')];
    for (const result of results) await expect(result).toBeVisible({ timeout: 30_000 });
    const texts = await Promise.all(results.map((result) => result.innerText()));
    const succeeded = [
      (texts[0] ?? '').includes(
        text('nl', 'transferCompleteOk', { member: ownerQ.email, org: org.orgName }),
      ),
      (texts[1] ?? '').includes(
        text('nl', 'transferCompleteOk', { member: ownerP.email, org: org.orgName }),
      ),
    ];
    expect(succeeded.filter(Boolean), texts.join('\n---\n')).toHaveLength(1);

    const roles = [await readMemberRole(org, ownerP.uid), await readMemberRole(org, ownerQ.uid)];
    expect(roles.filter((role) => role === 'organizationOwner')).toHaveLength(1);
    expect(roles.filter((role) => role === undefined)).toHaveLength(1);
    expect(await snapshotOrganization(bystander)).toEqual(beforeBystander);
    await pageQ.context().close();
  });

  test('rolverlies tijdens de flow: B is geen owner meer bij het bevestigen → geweigerd, A ongemoeid', async ({
    page,
  }) => {
    const ownerA = await createUser('transfer-roleloss-a');
    const userB = await createUser('transfer-roleloss-b');
    const org = await seedOrg('transfer-roleloss Org');
    const team = org.teamIds[0] ?? '';
    await seedMember(org, ownerA, 'organizationOwner');
    await seedMember(org, userB, 'organizationOwner');
    await seedInvitation(org, ownerA.email, 'pending');
    await signInAndSelect(page, userB, org.orgId, team);
    await openRemoveOwner(page, ownerA);
    await page.getByTestId('transfer-remove-owner-input').fill(ownerA.email);

    // A trekt B's ownerrol in terwijl het dialoog open staat.
    await seedMember(org, userB, 'organizationAdmin');
    const before = await snapshotOrganization(org);
    await page.getByTestId('transfer-confirm-btn').click();
    const result = page.getByTestId('transfer-result');
    await expect(result).toContainText(text('nl', 'transferDeniedNotOwner'), { timeout: 20_000 });
    await expect(result).toContainText(text('nl', 'accountNothingChanged'));
    expect(await snapshotOrganization(org)).toEqual(before);
    expect(await readMemberRole(org, ownerA.uid)).toBe('organizationOwner');
  });
});
