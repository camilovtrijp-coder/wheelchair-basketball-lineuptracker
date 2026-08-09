import type { Browser, BrowserContext, Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/domain/settings/types';
import { adminDb, lookupUidByEmail } from './adminFixtures';
import { answerTrustedDevice, selectContext, signIn, signUp, uniqueTestEmail } from './helpers';

export const PILOT_PASSWORD = 'TwoDevices123!';

export interface PilotIdentity {
  email: string;
  password: string;
  uid: string;
}

export interface PilotTeam {
  orgId: string;
  teamId: string;
  teamName: string;
}

export async function registerPilotCoach(page: Page, label: string): Promise<PilotIdentity> {
  const email = uniqueTestEmail(label);
  await signUp(page, email, PILOT_PASSWORD);
  await answerTrustedDevice(page, true);
  return {
    email,
    password: PILOT_PASSWORD,
    uid: await lookupUidByEmail(email, PILOT_PASSWORD),
  };
}

export async function seedPilotTeam(identity: PilotIdentity, label: string): Promise<PilotTeam> {
  const db = adminDb();
  const orgRef = db.collection('organizations').doc();
  const teamRef = orgRef.collection('teams').doc();
  const orgName = `Pilotorganisatie ${label}`;
  const teamName = `Pilotteam ${label}`;

  await orgRef.set({ name: orgName, createdBy: 'pilot-seed', createdAt: new Date() });
  await teamRef.set({
    name: teamName,
    orgName,
    createdBy: 'pilot-seed',
    createdAt: new Date(),
  });
  await teamRef.collection('teamMembers').doc(identity.uid).set({
    role: 'coach',
    email: identity.email,
    uid: identity.uid,
    addedAt: new Date(),
  });
  await teamRef
    .collection('settings')
    .doc('current')
    .set({
      ...DEFAULT_SETTINGS,
      teamName,
      useClassLimit: true,
      tag1Label: 'Categorie A',
      tag2Label: 'Categorie B',
      updatedAt: new Date(),
    });
  await teamRef.collection('roster').doc('current').set({ players: [], updatedAt: new Date() });

  return { orgId: orgRef.id, teamId: teamRef.id, teamName };
}

export async function openPilotTeam(page: Page, team: PilotTeam): Promise<void> {
  await page.reload();
  await selectContext(page, team.orgId, team.teamId);
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-teamName').waitFor();
}

export async function openSecondDevice(
  browser: Browser,
  identity: PilotIdentity,
  team: PilotTeam,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, identity.email, identity.password);
  await answerTrustedDevice(page, true);
  await selectContext(page, team.orgId, team.teamId);
  await page.getByTestId('nav-settings').click();
  return { context, page };
}

export function settingsDoc(team: PilotTeam) {
  return adminDb().doc(`organizations/${team.orgId}/teams/${team.teamId}/settings/current`);
}
