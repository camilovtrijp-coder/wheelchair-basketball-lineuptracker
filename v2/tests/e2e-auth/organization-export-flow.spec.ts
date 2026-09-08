// PR 8.3b deel 2/2 (docs/pr-8.3-plan.md §C 8.3b werk 4/5): e2e-matrix voor de
// owner-only organisatie-exportUI, bovenop deel 1/2's al-geteste engine
// (`organizationExportBuild`/`organizationExportCoordinator`/
// `organizationExportRoundtrip`.spec.ts, allemaal vitest-unit, en
// `firebase/tests/rules/organization-export-listing.spec.ts` voor de
// Rules-kant). Dit bestand bewijst de ECHTE UI-wiring tegen echte
// Firestore-/Auth-emulators met echte Rules — geen fakes. Hergebruikt de
// bestaande e2e-fixtures/-helpers (`helpers.ts`/`adminFixtures.ts`) en de
// nieuwe `organizationExportFixtures.ts` (dit PR-deel), zelfde precedent als
// `migration-flow.spec.ts`.
//
// Dekking (in volgorde van de plan-tekst):
// 1. rolgating (werk 4, plan §B "alleen organizationOwner"): een
//    organizationOwner ziet het exportpaneel + startknop; een
//    organizationAdmin/coach/scorer/viewer NOOIT (strenger dan
//    `MigrationPanel`, die ook admin/coach toelaat).
// 2. lokale modus zonder netwerkcall: het exportpaneel bestaat structureel
//    niet vóór inloggen (`app/App.tsx` rendert het alleen bij
//    `repositories.mode === 'cloud'`).
// 3. volledige stroom met TWEE volledige organisaties (werk 5): organisatie
//    B heeft een gelijknamig team als organisatie A — de export van A bewijst
//    dat geen enkel gegeven van B meelekt. Organisatie A zelf bevat alle
//    §A-gegevensfamilies (organizationMembers, invitations met claimed/
//    revoked-status, teamMembers, settings, roster, een actieve game +
//    actie, een gewone én een getombstonede completedGame, en een
//    migrationRun) — de preview-aantallen en de daadwerkelijk gedownloade
//    JSON worden allebei tegen de seed geverifieerd.
//
// Kon dit NIET lokaal draaien: deze sandbox blokkeert uitgaand verkeer naar
// `firebase-public.firebaseio.com` (nodig om de Firestore-/Auth-emulator-jars
// te downloaden), dus `firebase emulators:exec`/`playwright test
// --config=playwright.auth.config.ts` konden hier niet worden uitgevoerd —
// zelfde bekende sandboxbeperking als elke eerdere PR in deze reeks (zie
// `migration-flow.spec.ts`'s eigen toelichting, dat exact hetzelfde
// rapporteert voor de Chromium-download). Dit bestand is wél
// `tsc -b`/`eslint`/`prettier`-schoon geverifieerd en zorgvuldig tegen de
// daadwerkelijke `ExportPanel`/`OrganizationExportCoordinator`/document-
// convertercode nagelopen (testId's/stapvolgorde 1:1 overgenomen uit
// `ExportPanel.tsx`, documentvormen 1:1 uit `firebase/src/documents/*.ts`).

import { test, expect } from '@playwright/test';
import { adminDb, lookupUidByEmail } from './adminFixtures';
import { seedFullOrganization } from './organizationExportFixtures';
import { signUp, answerTrustedDevice, selectContext, uniqueTestEmail } from './helpers';
import type { OrganizationRole } from '../../src/domain/organizations/types';

const PASSWORD = 'ExportFlow123!';

async function applyOrgRole(
  orgId: string,
  uid: string,
  email: string,
  role: OrganizationRole,
): Promise<void> {
  await adminDb()
    .collection('organizations')
    .doc(orgId)
    .collection('organizationMembers')
    .doc(uid)
    .set({ role, email, uid, joinedAt: new Date() });
}

async function seedBareTeam(
  orgName: string,
  teamName: string,
): Promise<{ orgId: string; teamId: string }> {
  const db = adminDb();
  const orgRef = db.collection('organizations').doc();
  const teamRef = orgRef.collection('teams').doc();
  await orgRef.set({ name: orgName, createdBy: 'seed', createdAt: new Date() });
  await teamRef.set({ name: teamName, orgName, createdBy: 'seed', createdAt: new Date() });
  return { orgId: orgRef.id, teamId: teamRef.id };
}

test.describe('PR 8.3b deel 2/2 — rolgating (§B "alleen organizationOwner")', () => {
  test('organizationOwner ziet het exportpaneel + startknop', async ({ page }) => {
    const email = uniqueTestEmail('export-owner');
    await signUp(page, email, PASSWORD);
    await answerTrustedDevice(page, true);
    const uid = await lookupUidByEmail(email, PASSWORD);
    const { orgId, teamId } = await seedBareTeam('Export-Rolgating-Org', 'Export-Rolgating-Team');
    await applyOrgRole(orgId, uid, email, 'organizationOwner');
    await page.reload();
    await selectContext(page, orgId, teamId);

    await expect(page.getByTestId('export-panel')).toBeVisible();
    await expect(page.getByTestId('export-start-btn')).toBeVisible();
  });

  test('organizationAdmin krijgt het exportpaneel NOOIT te zien (strenger dan bulkmigratie)', async ({
    page,
  }) => {
    const email = uniqueTestEmail('export-admin');
    await signUp(page, email, PASSWORD);
    await answerTrustedDevice(page, true);
    const uid = await lookupUidByEmail(email, PASSWORD);
    const { orgId, teamId } = await seedBareTeam('Export-Rolgating-Org-Admin', 'Export-Team-Admin');
    await applyOrgRole(orgId, uid, email, 'organizationAdmin');
    await page.reload();
    await selectContext(page, orgId, teamId);

    await expect(page.getByTestId('export-panel')).toHaveCount(0);
  });

  test('coach krijgt het exportpaneel NOOIT te zien', async ({ page }) => {
    const email = uniqueTestEmail('export-coach');
    await signUp(page, email, PASSWORD);
    await answerTrustedDevice(page, true);
    const uid = await lookupUidByEmail(email, PASSWORD);
    const { orgId, teamId } = await seedBareTeam('Export-Rolgating-Org-Coach', 'Export-Team-Coach');
    await adminDb()
      .collection('organizations')
      .doc(orgId)
      .collection('teams')
      .doc(teamId)
      .collection('teamMembers')
      .doc(uid)
      .set({ role: 'coach', email, uid, addedAt: new Date() });
    await page.reload();
    await selectContext(page, orgId, teamId);

    await expect(page.getByTestId('export-panel')).toHaveCount(0);
  });

  test('viewer krijgt het exportpaneel NOOIT te zien', async ({ page }) => {
    const email = uniqueTestEmail('export-viewer');
    await signUp(page, email, PASSWORD);
    await answerTrustedDevice(page, true);
    const uid = await lookupUidByEmail(email, PASSWORD);
    const { orgId, teamId } = await seedBareTeam(
      'Export-Rolgating-Org-Viewer',
      'Export-Team-Viewer',
    );
    await adminDb()
      .collection('organizations')
      .doc(orgId)
      .collection('teams')
      .doc(teamId)
      .collection('teamMembers')
      .doc(uid)
      .set({ role: 'viewer', email, uid, addedAt: new Date() });
    await page.reload();
    await selectContext(page, orgId, teamId);

    await expect(page.getByTestId('export-panel')).toHaveCount(0);
  });
});

test.describe('PR 8.3b deel 2/2 — lokale modus', () => {
  test('vóór inloggen bestaat het exportpaneel structureel niet', async ({ page }) => {
    await page.goto('/');
    // Geen auth-flow doorlopen — `app/App.tsx` rendert `ExportPanel`
    // uitsluitend wanneer `repositories.mode === 'cloud'` (zie
    // `infrastructure/repositories/resolveAppRepositories.ts`:
    // `exportCoordinator` is `null` in lokale modus), dus geen enkele
    // Firestore-aanroep is zelfs maar MOGELIJK vanuit dit paneel.
    await expect(page.getByTestId('export-panel')).toHaveCount(0);
  });
});

test.describe('PR 8.3b deel 2/2 werk 5 — volledige stroom met twee organisaties', () => {
  test('preview + download bevat alle §A-families van organisatie A, niets van gelijknamige organisatie B', async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
    const db = adminDb();

    const ownerEmail = uniqueTestEmail('export-flow-owner');
    await signUp(page, ownerEmail, PASSWORD);
    await answerTrustedDevice(page, true);
    const ownerUid = await lookupUidByEmail(ownerEmail, PASSWORD);
    const coachUid = `coach-${Date.now()}`;

    const seededA = await seedFullOrganization(db, {
      orgName: 'Export-Flow-Org-A',
      teamName: 'De Adelaars',
      ownerUid,
      ownerEmail,
      coachUid,
      coachEmail: 'coach-a@example.test',
    });

    // Organisatie B: een ANDER team met exact dezelfde naam ("De Adelaars"),
    // de eigenaar van A is hier GEEN lid van — bewijst dat de export nooit
    // over een orgId-grens heen leest, ook niet bij een naamsbotsing.
    const otherOwnerUid = `other-owner-${Date.now()}`;
    await seedFullOrganization(db, {
      orgName: 'Export-Flow-Org-B',
      teamName: 'De Adelaars',
      ownerUid: otherOwnerUid,
      ownerEmail: 'other-owner@example.test',
      coachUid: `other-coach-${Date.now()}`,
      coachEmail: 'other-coach@example.test',
    });

    await page.reload();
    await selectContext(page, seededA.orgId, seededA.teamId);

    await page.getByTestId('export-start-btn').click();
    await expect(page.getByTestId('export-preview')).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId('export-preview-target')).toContainText('Export-Flow-Org-A');
    await expect(page.getByTestId('export-preview-target')).toContainText(seededA.orgId);
    await expect(page.getByTestId(`export-preview-team-${seededA.teamId}`)).toHaveText(
      'De Adelaars',
    );
    // Precies één team in de preview — organisatie B's gelijknamige team
    // verschijnt hier NOOIT, ook al heet het letterlijk hetzelfde.
    await expect(page.getByTestId('export-preview-teams').locator('li')).toHaveCount(1);

    await expect(page.getByTestId('export-preview-count-organizationMembers')).toContainText('1');
    await expect(page.getByTestId('export-preview-count-invitations')).toContainText('2');
    await expect(page.getByTestId('export-preview-count-teams')).toContainText('1');
    await expect(page.getByTestId('export-preview-count-teamMembers')).toContainText('1');
    await expect(page.getByTestId('export-preview-count-settingsDocuments')).toContainText('1');
    await expect(page.getByTestId('export-preview-count-rosterPlayers')).toContainText('1');
    await expect(page.getByTestId('export-preview-count-games')).toContainText('1');
    await expect(page.getByTestId('export-preview-count-gameActions')).toContainText('1');
    await expect(page.getByTestId('export-preview-count-completedGames')).toContainText('2');
    await expect(page.getByTestId('export-preview-count-migrationRuns')).toContainText('1');
    await expect(page.getByTestId('export-sensitive-warning')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-download-btn').click();
    const download = await downloadPromise;
    await expect(page.getByTestId('export-downloaded')).toBeVisible();

    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(path as string, 'utf8');
    const parsed = JSON.parse(raw) as {
      type: string;
      schemaVersion: number;
      sourceContext: { organizationId: string; organizationName: string };
      organizationMembers: unknown[];
      invitations: { status: string }[];
      teams: {
        teamId: string;
        name: string;
        teamMembers: unknown[];
        completedGames: { deletedAt: string | null }[];
        games: { actions: unknown[] }[];
        migrationRuns: unknown[];
      }[];
      contentHash: string;
    };

    expect(parsed.type).toBe('organization-export');
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.sourceContext.organizationId).toBe(seededA.orgId);
    expect(parsed.sourceContext.organizationName).toBe('Export-Flow-Org-A');
    expect(parsed.organizationMembers).toHaveLength(1);
    expect(parsed.invitations.map((i) => i.status).sort()).toEqual(['claimed', 'revoked']);
    expect(parsed.teams).toHaveLength(1);
    const teamA = parsed.teams[0];
    expect(teamA).toBeDefined();
    expect(teamA?.teamId).toBe(seededA.teamId);
    expect(teamA?.teamMembers).toHaveLength(1);
    expect(teamA?.completedGames).toHaveLength(2);
    expect(teamA?.completedGames.some((g) => g.deletedAt !== null)).toBe(true);
    expect(teamA?.completedGames.some((g) => g.deletedAt === null)).toBe(true);
    expect(teamA?.games).toHaveLength(1);
    expect(teamA?.games[0]?.actions).toHaveLength(1);
    expect(teamA?.migrationRuns).toHaveLength(1);
    expect(typeof parsed.contentHash).toBe('string');
    expect(parsed.contentHash.length).toBeGreaterThan(0);

    // Cross-orgisolatie op bestandsniveau: geen enkel spoor van organisatie B
    // (haar orgId/naam) mag ergens in het gedownloade bestand voorkomen.
    expect(raw).not.toContain('Export-Flow-Org-B');
  });
});
