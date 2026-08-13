// PR 5.4a: UI-rolgrens in SettingsPanel en RosterPanel. Uitgebreid in de
// PR 6.1-review (aug. 2026) met GameSetupPanel: een `scorer` heeft geen
// canManageTeamData (mag geen roster/instellingen bewerken), maar wél de
// aparte, ruimere `canWriteGameData` (mag wedstrijdacties uitvoeren) — zie
// domain/organizations/teamAccess.ts. Vóór die toevoeging deelde de
// wedstrijd-UI dezelfde bevoegdheid als roster/instellingen, waardoor een
// scorer nergens kon scoren.
//
// Bewijst dat alleen rollen met canManageTeamData === true (owner, admin,
// coach) de schrijfknoppen in Settings/Roster enabled zien, en alleen rollen
// met canWriteGameData === true (owner, admin, coach, scorer) die in Game
// enabled zien; rollen zonder zien ze disabled en de read-only-indicator.
// De 5-rollen × 3-panels-matrix is de 5.4a/PR-6.1-review-acceptatie
// "rolgrenzen in UI" (IMPLEMENTATION_PLAN §10/§11).
//
// Patroon per testcase: registreer een unieke gebruiker, seedt via
// adminDb() een org + team + membership met de gewenste rol (+ een kleine
// roster zodat GameSetupPanel zijn echte formulier toont i.p.v. het
// "geen spelers"-scherm), log in, kies de context, assert de UI-state. Eén
// test per (rol, panel)-paar — totaal 15 tests in één describe.

import { test, expect } from '@playwright/test';
import { adminDb, lookupUidByEmail } from './adminFixtures';
import { signUp, answerTrustedDevice, selectContext, uniqueTestEmail } from './helpers';
import type { OrganizationRole } from '../../src/domain/organizations/types';

const PASSWORD = 'RoleMatrix123!';

type UiRole = Extract<
  OrganizationRole,
  'organizationOwner' | 'organizationAdmin' | 'coach' | 'scorer' | 'viewer'
>;
const UI_ROLES: ReadonlyArray<UiRole> = [
  'organizationOwner',
  'organizationAdmin',
  'coach',
  'scorer',
  'viewer',
];

async function seedTeamWithRole(role: UiRole): Promise<{ orgId: string; teamId: string }> {
  // Eén verse, willekeurige orgId+teamId per test — adminDb() omzeilt Rules,
  // dus we kunnen direct de gewenste membership-structuur neerzetten zonder
  // de bootstrap-flow (createOrganizationWithOwner) te doorlopen.
  const db = adminDb();
  const orgRef = db.collection('organizations').doc();
  const teamRef = orgRef.collection('teams').doc();
  await orgRef.set({ name: `RoleMatrix-${role}`, createdBy: 'seed', createdAt: new Date() });
  await teamRef.set({
    name: 'Team',
    orgName: `RoleMatrix-${role}`,
    createdBy: 'seed',
    createdAt: new Date(),
  });
  // Kleine roster nodig zodat GameSetupPanel zijn echte formulier toont
  // i.p.v. het "geen spelers"-scherm (vp.length === 0) — anders is er niets
  // om de canWriteGame-rolgrens op te testen.
  await teamRef
    .collection('roster')
    .doc('current')
    .set({
      players: [
        { id: 1, nr: '4', naam: 'RoleMatrix Speler Een', kl: '3.0', vrouw: false, jeugd: false },
        { id: 2, nr: '7', naam: 'RoleMatrix Speler Twee', kl: '1.5', vrouw: false, jeugd: false },
      ],
      updatedAt: new Date(),
    });
  return { orgId: orgRef.id, teamId: teamRef.id };
}

async function applyRole(
  orgId: string,
  teamId: string,
  uid: string,
  email: string,
  role: UiRole,
): Promise<void> {
  const db = adminDb();
  // Owner/admin zitten op organizationMembers; coach/scorer/viewer op
  // teamMembers — behalve coach, die mag ook op organizationMembers staan
  // met die rol. Voor de UI-test is het patroon niet relevant (de UI kijkt
  // alleen naar canManageTeamData); we plaatsen owner/admin op org-niveau
  // en de overige drie op team-niveau, conform de bestaande conventie.
  if (role === 'organizationOwner' || role === 'organizationAdmin') {
    await db
      .collection('organizations')
      .doc(orgId)
      .collection('organizationMembers')
      .doc(uid)
      .set({ role, email, uid, joinedAt: new Date() });
  } else {
    await db
      .collection('organizations')
      .doc(orgId)
      .collection('teams')
      .doc(teamId)
      .collection('teamMembers')
      .doc(uid)
      .set({ role, email, uid, addedAt: new Date() });
  }
}

for (const role of UI_ROLES) {
  const canWrite = role === 'organizationOwner' || role === 'organizationAdmin' || role === 'coach';
  // canWriteGameData (PR 6.1-review): ruimer dan canWrite — ook scorer mag
  // wedstrijdacties uitvoeren, ondanks geen roster/instellingen-toegang.
  const canWriteGame = canWrite || role === 'scorer';

  test.describe(`rolgrens in UI — ${role} (canWrite=${canWrite}, canWriteGame=${canWriteGame})`, () => {
    test(`settings: ${canWrite ? 'save enabled' : 'save disabled + read-only-indicator'}`, async ({
      page,
    }) => {
      const email = uniqueTestEmail(`role-${role}`);
      await signUp(page, email, PASSWORD);
      await answerTrustedDevice(page, true);

      const uid = await lookupUidByEmail(email, PASSWORD);
      const { orgId, teamId } = await seedTeamWithRole(role);
      await applyRole(orgId, teamId, uid, email, role);

      // De UI-context-switcher wordt automatisch geopend bij het eerste bezoek
      // aan een verse gebruiker zonder selectedContext. We hoeven alleen te
      // herladen zodat de net-gesignupte memberships worden opgehaald.
      await page.reload();
      await selectContext(page, orgId, teamId);

      const save = page.getByTestId('settings-save');
      if (canWrite) {
        await expect(save).toBeEnabled();
        await expect(page.getByTestId('settings-read-only')).toHaveCount(0);
      } else {
        await expect(save).toBeDisabled();
        await expect(page.getByTestId('settings-read-only')).toBeVisible();
      }
    });

    test(`roster: ${canWrite ? 'save/add enabled' : 'save/add disabled + read-only-indicator'}`, async ({
      page,
    }) => {
      const email = uniqueTestEmail(`role-${role}-r`);
      await signUp(page, email, PASSWORD);
      await answerTrustedDevice(page, true);

      const uid = await lookupUidByEmail(email, PASSWORD);
      const { orgId, teamId } = await seedTeamWithRole(role);
      await applyRole(orgId, teamId, uid, email, role);

      await page.reload();
      await selectContext(page, orgId, teamId);
      await page.getByTestId('nav-roster').click();

      const save = page.getByTestId('roster-save');
      const add = page.getByTestId('roster-add');
      if (canWrite) {
        await expect(save).toBeEnabled();
        await expect(add).toBeEnabled();
        await expect(page.getByTestId('roster-read-only')).toHaveCount(0);
      } else {
        await expect(save).toBeDisabled();
        await expect(add).toBeDisabled();
        await expect(page.getByTestId('roster-read-only')).toBeVisible();
      }
    });

    test(`game: ${canWriteGame ? 'opzet-velden enabled' : 'opzet-velden disabled + read-only-indicator'}`, async ({
      page,
    }) => {
      const email = uniqueTestEmail(`role-${role}-g`);
      await signUp(page, email, PASSWORD);
      await answerTrustedDevice(page, true);

      const uid = await lookupUidByEmail(email, PASSWORD);
      const { orgId, teamId } = await seedTeamWithRole(role);
      await applyRole(orgId, teamId, uid, email, role);

      await page.reload();
      await selectContext(page, orgId, teamId);
      await page.getByTestId('nav-game').click();

      const opponent = page.getByTestId('game-opponent');
      const clockDown = page.getByTestId('game-clock-down');
      if (canWriteGame) {
        await expect(opponent).toBeEditable();
        await expect(clockDown).toBeEnabled();
        await expect(page.getByTestId('game-read-only')).toHaveCount(0);
      } else {
        await expect(opponent).not.toBeEditable();
        await expect(clockDown).toBeDisabled();
        await expect(page.getByTestId('game-read-only')).toBeVisible();
      }
    });
  });
}
