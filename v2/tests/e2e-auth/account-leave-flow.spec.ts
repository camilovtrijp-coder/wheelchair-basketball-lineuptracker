// PR 8.3c-2d (docs/pr-8.3c-2b-plan.md §D, docs/pr-8.3c-2c-plan.md §2/§3/§5): e2e voor
// "organisatie verlaten" tegen de ECHTE Firebase Auth-/Firestore-emulator met de ECHTE
// Security Rules. De beslissingen zelf zijn bewezen in vitest (coördinator, classificatie,
// mapping) en in de Rules-suite; dit bestand bewijst dat de UI-wiring in een echte browser,
// met een echte sessie en serverreadback via Admin, hetzelfde doet:
//
//   - elke niet-owner-rol (admin, coach, scorer, viewer) en een team-only lid kan vertrekken:
//     eigen teamMembers, eigen OPEN uitnodigingen (pending/accepted) en het eigen membership
//     zijn weg, al het andere in de organisatie is byte-identiek (inhoud + updateTime), en
//     een tweede organisatie (eigen lidmaatschap én een omstander-organisatie) ook;
//   - daarna het juiste scherm (contextwisselaar zonder de organisatie, of het
//     geen-organisaties-scherm) en ook na herladen geen toegang meer;
//   - owner: geen verlaatknop, wel de uitleg en de overdrachtsingang;
//   - weigeringen (maker zonder owner, enige owner, open verwijderverzoek, onbevestigd
//     lokaal wedstrijdwerk) tonen de juiste tekst en schrijven NIETS.
//
// Elke test seedt eigen organisaties en gebruikers (unieke ID's); de suite draait serieel.
import { test, expect, type Page } from '@playwright/test';
import {
  createUser,
  readOwnDocuments,
  seedBystanderOrg,
  seedDeletionRequest,
  seedInvitation,
  seedMember,
  seedOrg,
  seedTeamMember,
  snapshotOrganization,
  type Org,
  type OrgRole,
  type TestUser,
} from './accountFlowFixtures';
import { dialog, openAccountPanel, signInAndSelect, text } from './accountFlowPage';

const LEAVE_ROLES = ['organizationAdmin', 'coach', 'scorer', 'viewer'] as const;

function omit(snapshot: Record<string, unknown>, paths: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(snapshot).filter(([path]) => !paths.includes(path)));
}

async function openLeaveDialog(page: Page, orgName: string): Promise<void> {
  await openAccountPanel(page);
  // Een niet-owner ziet de overdrachtsknoppen nooit.
  await expect(page.getByTestId('transfer-start-btn')).toHaveCount(0);
  await expect(page.getByTestId('transfer-remove-owner-start-btn')).toHaveCount(0);
  await page.getByTestId('leave-org-start-btn').click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toHaveAttribute(
    'aria-label',
    text('nl', 'leaveOrgConfirmTitle', { org: orgName }),
  );
  await expect(page.getByTestId('leave-org-confirm-btn')).toBeVisible();
}

/** Org A met twee teams, een andere owner en een ander teamlid (die moeten blijven). */
async function seedLeaveOrg(label: string): Promise<{ org: Org; other: TestUser }> {
  const org = await seedOrg(`${label} Vertrek-Org`, { teamCount: 2 });
  const other = await createUser(`${label}-ander`);
  await seedMember(org, other, 'organizationOwner');
  await seedTeamMember(org, org.teamIds[0] ?? '', other, 'coach');
  await seedInvitation(org, `iemand-anders-${org.orgId}@example.test`, 'pending');
  return { org, other };
}

test.describe('8.3c-2d — organisatie verlaten: elke niet-owner-rol', () => {
  for (const role of LEAVE_ROLES) {
    test(`${role}: bevestigen, geslaagd, serverreadback, terug naar de wisselaar zonder deze organisatie`, async ({
      page,
    }) => {
      const { org } = await seedLeaveOrg(`leave-${role}`);
      const orgB = await seedOrg(`leave-${role} Tweede-Org`);
      const bystander = await seedBystanderOrg(`leave-${role}`);
      const user = await createUser(`leave-${role}`);
      const [teamA1 = '', teamA2 = ''] = org.teamIds;
      const teamB = orgB.teamIds[0] ?? '';

      await seedMember(org, user, role as OrgRole);
      const teamRole = role === 'organizationAdmin' ? 'coach' : role;
      await seedTeamMember(org, teamA1, user, teamRole);
      await seedTeamMember(org, teamA2, user, teamRole);
      const pending = await seedInvitation(org, user.email, 'pending', 'coach');
      const accepted = await seedInvitation(org, user.email, 'accepted', 'organizationAdmin');
      await seedInvitation(org, user.email, 'claimed');
      await seedInvitation(org, user.email, 'revoked');
      // Een tweede organisatie waar de gebruiker lid blijft, met een eigen open uitnodiging.
      await seedMember(orgB, user, 'viewer');
      await seedTeamMember(orgB, teamB, user, 'viewer');
      await seedInvitation(orgB, user.email, 'pending');

      const beforeA = await snapshotOrganization(org);
      const beforeB = await snapshotOrganization(orgB);
      const beforeBystander = await snapshotOrganization(bystander);

      await signInAndSelect(page, user, org.orgId, teamA1);
      await openLeaveDialog(page, org.orgName);
      await expect(dialog(page)).toContainText(text('nl', 'leaveOrgConfirmDesc'));
      await page.getByTestId('leave-org-confirm-btn').click();

      const result = page.getByTestId('leave-org-result');
      await expect(result).toContainText(text('nl', 'leaveOrgOk', { org: org.orgName }), {
        timeout: 20_000,
      });
      await expect(result).not.toContainText(text('nl', 'leaveOrgOkInvitationsUnchecked'));
      await expect(page.getByTestId('leave-org-retry-btn')).toHaveCount(0);

      // Serverreadback: exact de eigen documenten in A zijn weg, de rest is byte-identiek.
      const removed = [
        `organizations/${org.orgId}/organizationMembers/${user.uid}`,
        `organizations/${org.orgId}/teams/${teamA1}/teamMembers/${user.uid}`,
        `organizations/${org.orgId}/teams/${teamA2}/teamMembers/${user.uid}`,
        pending,
        accepted,
      ];
      expect(await snapshotOrganization(org)).toEqual(omit(beforeA, removed));
      expect(await snapshotOrganization(orgB)).toEqual(beforeB);
      expect(await snapshotOrganization(bystander)).toEqual(beforeBystander);
      const own = await readOwnDocuments(user.uid, user.email);
      expect(own.organizationMembers).toEqual([
        `organizations/${orgB.orgId}/organizationMembers/${user.uid}`,
      ]);
      expect(own.teamMembers).toEqual([
        `organizations/${orgB.orgId}/teams/${teamB}/teamMembers/${user.uid}`,
      ]);
      expect(
        own.invitations.filter((i) => i.includes(org.orgId)).map((i) => i.split('#')[1]),
      ).toEqual(expect.arrayContaining(['claimed', 'revoked']));
      expect(own.invitations.filter((i) => i.includes(org.orgId))).toHaveLength(2);

      // Sluiten: de contextwisselaar zonder A, met B.
      await page.getByTestId('leave-org-close-btn').click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.getByTestId(`context-org-${orgB.orgId}`)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId(`context-org-${org.orgId}`)).toHaveCount(0);

      // Ook na herladen: A bestaat voor deze gebruiker niet meer, B wel.
      await page.reload();
      await expect(page.getByTestId(`context-org-${orgB.orgId}`)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId(`context-org-${org.orgId}`)).toHaveCount(0);
    });
  }

  test('team-only lid (alleen teamMembers-rijen): vertrek, daarna het geen-organisaties-scherm', async ({
    page,
  }) => {
    const { org } = await seedLeaveOrg('leave-teamonly');
    const bystander = await seedBystanderOrg('leave-teamonly');
    const user = await createUser('leave-teamonly');
    const [teamA1 = '', teamA2 = ''] = org.teamIds;
    await seedTeamMember(org, teamA1, user, 'coach');
    await seedTeamMember(org, teamA2, user, 'scorer');
    const pending = await seedInvitation(org, user.email, 'pending', 'coach');
    const beforeA = await snapshotOrganization(org);
    const beforeBystander = await snapshotOrganization(bystander);

    await signInAndSelect(page, user, org.orgId, teamA1);
    await openLeaveDialog(page, org.orgName);
    await page.getByTestId('leave-org-confirm-btn').click();
    await expect(page.getByTestId('leave-org-result')).toContainText(
      text('nl', 'leaveOrgOk', { org: org.orgName }),
      { timeout: 20_000 },
    );

    expect(await snapshotOrganization(org)).toEqual(
      omit(beforeA, [
        `organizations/${org.orgId}/teams/${teamA1}/teamMembers/${user.uid}`,
        `organizations/${org.orgId}/teams/${teamA2}/teamMembers/${user.uid}`,
        pending,
      ]),
    );
    expect(await snapshotOrganization(bystander)).toEqual(beforeBystander);
    expect(await readOwnDocuments(user.uid, user.email)).toEqual({
      organizationMembers: [],
      teamMembers: [],
      invitations: [],
    });

    await page.getByTestId('leave-org-close-btn').click();
    await expect(page.getByTestId('no-organizations-body')).toHaveText(
      text('nl', 'onboardingLostMembershipsBody'),
      { timeout: 15_000 },
    );
    await page.reload();
    await expect(page.getByTestId('no-organizations-body')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`context-org-${org.orgId}`)).toHaveCount(0);
  });
});

test.describe('8.3c-2d — organisatie verlaten: owner en weigeringen schrijven niets', () => {
  test('owner: geen verlaatknop, wel de uitleg en de ingang naar de overdracht', async ({
    page,
  }) => {
    const org = await seedOrg('leave-owner Org');
    const user = await createUser('leave-owner');
    await seedMember(org, user, 'organizationOwner');
    await signInAndSelect(page, user, org.orgId, org.teamIds[0] ?? '');
    await openAccountPanel(page);
    await expect(page.getByTestId('leave-org-start-btn')).toHaveCount(0);
    await expect(page.getByTestId('leave-org-owner-note')).toHaveText(
      text('nl', 'leaveOrgOwnerNote', { org: org.orgName }),
    );
    await expect(page.getByTestId('transfer-start-btn')).toBeVisible();
    await expect(page.getByTestId('transfer-remove-owner-start-btn')).toBeVisible();
    await expect(page.getByTestId('account-delete-start-btn')).toBeVisible();
  });

  test('gedemoveerde maker (admin): creator-needs-owner, niets gewijzigd', async ({ page }) => {
    const user = await createUser('leave-creator');
    const org = await seedOrg('leave-creator Org', { createdBy: user.uid });
    const owner = await createUser('leave-creator-owner');
    await seedMember(org, owner, 'organizationOwner');
    await seedMember(org, user, 'organizationAdmin');
    await seedTeamMember(org, org.teamIds[0] ?? '', user, 'coach');
    await seedInvitation(org, user.email, 'pending');
    const before = await snapshotOrganization(org);

    await signInAndSelect(page, user, org.orgId, org.teamIds[0] ?? '');
    await openLeaveDialog(page, org.orgName);
    await page.getByTestId('leave-org-confirm-btn').click();
    const result = page.getByTestId('leave-org-result');
    await expect(result).toContainText(text('nl', 'leaveOrgDeniedCreatorNeedsOwner'), {
      timeout: 20_000,
    });
    await expect(result).toContainText(text('nl', 'accountNothingChanged'));
    await expect(page.getByTestId('leave-org-retry-btn')).toHaveCount(0);
    // Ook geen teamMembers- of uitnodigingsdelete vóór de weigering (D.3).
    expect(await snapshotOrganization(org)).toEqual(before);
  });

  test('rol intussen owner geworden: owner-sole met overdrachtsknop, daarna open verwijderverzoek; niets gewijzigd', async ({
    page,
  }) => {
    const org = await seedOrg('leave-ownersole Org');
    const user = await createUser('leave-ownersole');
    const member = await createUser('leave-ownersole-lid');
    await seedMember(org, user, 'organizationAdmin');
    await seedMember(org, member, 'coach');
    await signInAndSelect(page, user, org.orgId, org.teamIds[0] ?? '');
    await openAccountPanel(page);

    // De UI kent de rol van het moment van kiezen (admin: verlaatknop zichtbaar); de server
    // maakt hem nu de enige owner. De coördinator leest dat zelf van de server.
    await seedMember(org, user, 'organizationOwner');
    const before = await snapshotOrganization(org);
    await page.getByTestId('leave-org-start-btn').click();
    await page.getByTestId('leave-org-confirm-btn').click();
    const result = page.getByTestId('leave-org-result');
    await expect(result).toContainText(text('nl', 'leaveOrgDeniedOwnerSole'), { timeout: 20_000 });
    await expect(result).toContainText(text('nl', 'accountNothingChanged'));
    expect(await snapshotOrganization(org)).toEqual(before);

    // De knop bij owner-sole vervangt de flow door "Eigendom overdragen" voor deze organisatie.
    await page.getByTestId('leave-org-transfer-btn').click();
    await expect(dialog(page)).toHaveAttribute(
      'aria-label',
      text('nl', 'transferPromoteTitle', { org: org.orgName }),
    );
    await expect(page.getByTestId('transfer-member-0')).toContainText(member.email, {
      timeout: 20_000,
    });
    await page.getByTestId('transfer-close-btn').click();
    await expect(dialog(page)).toHaveCount(0);

    // Een open verwijderverzoek: awaiting-organization-deletion, nog steeds niets gewijzigd.
    await seedDeletionRequest(org, user.uid);
    const beforeRequest = await snapshotOrganization(org);
    await page.getByTestId('leave-org-start-btn').click();
    await page.getByTestId('leave-org-confirm-btn').click();
    await expect(result).toContainText(text('nl', 'leaveOrgDeniedAwaitingDeletion'), {
      timeout: 20_000,
    });
    expect(await snapshotOrganization(org)).toEqual(beforeRequest);
  });

  test('onbevestigd lokaal wedstrijdwerk voor deze organisatie blokkeert; niets gewijzigd', async ({
    page,
  }) => {
    const org = await seedOrg('leave-localwork Org', { teamCount: 2 });
    const owner = await createUser('leave-localwork-owner');
    const user = await createUser('leave-localwork');
    await seedMember(org, owner, 'organizationOwner');
    await seedMember(org, user, 'coach');
    await seedTeamMember(org, org.teamIds[0] ?? '', user, 'coach');
    const before = await snapshotOrganization(org);

    await signInAndSelect(page, user, org.orgId, org.teamIds[0] ?? '');
    // Een gestarte wedstrijd van het tweede team van deze organisatie op dit apparaat
    // (bestaande sleutel, bestaand formaat; de probe leest alleen `phase`).
    await page.evaluate(
      (key) => {
        window.localStorage.setItem(key, JSON.stringify({ phase: 'tracking' }));
      },
      `lineup-tracker-v2-active-game:${org.orgId}:${org.teamIds[1] ?? ''}`,
    );
    await openLeaveDialog(page, org.orgName);
    await page.getByTestId('leave-org-confirm-btn').click();
    const result = page.getByTestId('leave-org-result');
    await expect(result).toContainText(text('nl', 'leaveOrgBlockedLocalWork', { count: 1 }), {
      timeout: 20_000,
    });
    await expect(result).toContainText(text('nl', 'accountNothingChanged'));
    expect(await snapshotOrganization(org)).toEqual(before);
  });

  test('dubbelklik op bevestigen: één vertrek, geen tweede aanroep-uitkomst', async ({ page }) => {
    const { org } = await seedLeaveOrg('leave-dblclick');
    const user = await createUser('leave-dblclick');
    await seedMember(org, user, 'scorer');
    await seedTeamMember(org, org.teamIds[0] ?? '', user, 'scorer');
    const before = await snapshotOrganization(org);
    await signInAndSelect(page, user, org.orgId, org.teamIds[0] ?? '');
    await openLeaveDialog(page, org.orgName);
    await page.getByTestId('leave-org-confirm-btn').dblclick();
    const result = page.getByTestId('leave-org-result');
    await expect(result).toContainText(text('nl', 'leaveOrgOk', { org: org.orgName }), {
      timeout: 20_000,
    });
    // Niet "al bezig" en niet "geen lid meer": de tweede klik viel op een uitgeschakelde knop.
    await expect(result).not.toContainText(text('nl', 'accountActionBusy'));
    await expect(result).not.toContainText(text('nl', 'leaveOrgNotAMember'));
    expect(await snapshotOrganization(org)).toEqual(
      omit(before, [
        `organizations/${org.orgId}/organizationMembers/${user.uid}`,
        `organizations/${org.orgId}/teams/${org.teamIds[0] ?? ''}/teamMembers/${user.uid}`,
      ]),
    );
  });
});
