// PR 7.2b emulator-e2e, tweede reviewronde op PR #64: bewijst tegen de
// échte Firestore-emulator dat het wisselen tussen twee gelijknamige teams
// (verschillende org-/teamId's, identieke teamnaam) op ÉÉN apparaat nooit de
// completedGames-historie van het andere team laat lekken — ook niet
// kortstondig tijdens de wissel. `selectRepositories.spec.ts`'s unit-test
// bewijst alleen dat de repository-INSTANTIES verschillen; dit bestand
// bewijst het daadwerkelijke, door de gebruiker waargenomen gedrag via de
// echte App-UI, `CompositeCompletedGameRepository` en Firestore Security
// Rules — een naamcollisie zou hier zichtbaar worden als team B's Historie
// team A's wedstrijd toont (of andersom), wat bij een op-teamNAAM-gebaseerde
// (i.p.v. op-orgId/teamId-gebaseerde) fout zou kunnen gebeuren.
import { expect, test, type Page } from '@playwright/test';
import { answerTrustedDevice, selectContext, signUp, uniqueTestEmail } from './helpers';
import { adminDb, lookupUidByEmail } from './adminFixtures';
import { DEFAULT_SETTINGS } from '../../src/domain/settings/types';
import {
  finishGameWithOneSegment,
  fivePlayerRoster,
  readCompletedGameId,
  startTrackedGame,
} from './gameSyncFixtures';

const SHARED_TEAM_NAME = 'U23 (fictief)';
const PASSWORD = 'SameNamedTeams123!';

interface SeededTeam {
  orgId: string;
  teamId: string;
  teamName: string;
}

/**
 * Zet een org+team rechtstreeks via de Admin SDK — spiegelt
 * `twoDeviceFixtures.ts`'s `seedPilotTeam()`, maar met een EXPLICIET
 * meegegeven (hier: identieke) teamnaam i.p.v. een uit `label` afgeleide
 * unieke naam, en zonder classificatiesysteem-instellingen (niet relevant
 * voor dit scenario).
 */
async function seedNamedTeam(uid: string, email: string, teamName: string): Promise<SeededTeam> {
  const db = adminDb();
  const orgRef = db.collection('organizations').doc();
  const teamRef = orgRef.collection('teams').doc();
  const orgName = `Org ${orgRef.id}`;

  await orgRef.set({ name: orgName, createdBy: 'pilot-seed', createdAt: new Date() });
  await teamRef.set({ name: teamName, orgName, createdBy: 'pilot-seed', createdAt: new Date() });
  await teamRef.collection('teamMembers').doc(uid).set({
    role: 'coach',
    email,
    uid,
    addedAt: new Date(),
  });
  await teamRef
    .collection('settings')
    .doc('current')
    .set({ ...DEFAULT_SETTINGS, teamName, updatedAt: new Date('2000-01-01T00:00:00.000Z') });
  await teamRef
    .collection('roster')
    .doc('current')
    .set({ players: fivePlayerRoster(), updatedAt: new Date('2000-01-01T00:00:00.000Z') });

  return { orgId: orgRef.id, teamId: teamRef.id, teamName };
}

async function switchTo(page: Page, team: SeededTeam): Promise<void> {
  await page.getByTestId('switch-context').click();
  await selectContext(page, team.orgId, team.teamId);
  await expect(page.getByTestId('nav-settings')).toBeVisible();
}

test('wisselen tussen twee gelijknamige teams toont per team alleen de eigen completedGames-historie, geen stale data van het andere team', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const email = uniqueTestEmail('same-named-teams');
  await signUp(page, email, PASSWORD);
  await answerTrustedDevice(page, true);
  const uid = await lookupUidByEmail(email, PASSWORD);

  // Twee VOLLEDIG gescheiden organisaties/teams, met precies dezelfde
  // teamnaam — een op-naam-gebaseerde fout zou team A en team B door elkaar
  // kunnen halen; een op-orgId/teamId-gebaseerde implementatie (zoals de
  // Firestore-padstructuur en `CompositeCompletedGameRepository` hier)
  // hoort dat niet te doen.
  const teamA = await seedNamedTeam(uid, email, SHARED_TEAM_NAME);
  const teamB = await seedNamedTeam(uid, email, SHARED_TEAM_NAME);

  await page.reload();
  await selectContext(page, teamA.orgId, teamA.teamId);

  // Team A: rond één wedstrijd af.
  await startTrackedGame(page);
  await finishGameWithOneSegment(page);
  const completedIdA = await readCompletedGameId(page, teamA.orgId, teamA.teamId);
  await expect(page.getByTestId(`history-sync-status-${completedIdA}`)).toHaveAttribute(
    'data-status',
    'gesynchroniseerd',
    { timeout: 20_000 },
  );

  // Wissel naar team B — nog GEEN wedstrijden hier. Team A's wedstrijd mag
  // hier op geen enkel moment verschijnen, ook niet kortstondig tijdens de
  // wissel (de oude cloud-subscribe moet zijn opgeruimd vóór de nieuwe
  // begint, zie `CompositeCompletedGameRepository.subscribe()`'s
  // unsubscribe-discipline).
  await switchTo(page, teamB);
  await page.getByTestId('nav-history').click();
  await expect(page.getByTestId('history-empty')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`history-item-${completedIdA}`)).toHaveCount(0);

  // Rond nu ook in team B een wedstrijd af — de assertions hieronder zijn
  // ID-gebaseerd (niet score-gebaseerd), dus hetzelfde 3-1-scenario als team
  // A volstaat.
  await startTrackedGame(page);
  await finishGameWithOneSegment(page);
  const completedIdB = await readCompletedGameId(page, teamB.orgId, teamB.teamId);
  await expect(page.getByTestId(`history-sync-status-${completedIdB}`)).toHaveAttribute(
    'data-status',
    'gesynchroniseerd',
    { timeout: 20_000 },
  );
  await expect(completedIdB).not.toBe(completedIdA);

  // Terug naar team A: uitsluitend team A's wedstrijd, nooit team B's.
  await switchTo(page, teamA);
  await page.getByTestId('nav-history').click();
  await expect(page.getByTestId(`history-item-${completedIdA}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`history-item-${completedIdB}`)).toHaveCount(0);
  await expect(page.locator('[data-testid^="history-item-"]')).toHaveCount(1);

  // En weer naar team B: uitsluitend team B's wedstrijd, nooit team A's.
  await switchTo(page, teamB);
  await page.getByTestId('nav-history').click();
  await expect(page.getByTestId(`history-item-${completedIdB}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`history-item-${completedIdA}`)).toHaveCount(0);
  await expect(page.locator('[data-testid^="history-item-"]')).toHaveCount(1);
});
