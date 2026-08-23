// PR 7.4c (docs/pr-7.4-plan.md §C 7.4c werk 4): e2e-matrix voor de
// bulkmigratie-UI, bovenop 7.4a/7.4b's al-geteste engine
// (`migrationFingerprint`/`migrationCapability`/`migrationInventory`/
// `migrationPreview`/`migrationRun`/`migrationCoordinator`.spec.ts, allemaal
// vitest-unit). Dit bestand bewijst de ECHTE UI-wiring tegen echte
// Firestore-/Auth-emulators — geen fakes. Hergebruikt bewust de bestaande
// e2e-fixtures/-helpers (`helpers.ts`/`adminFixtures.ts`) i.p.v. een eigen
// login-/seedmechanisme (zelfde precedent als `role-matrix-ui.spec.ts`/
// `game-sync-*.spec.ts`).
//
// Dekking (werk 4, in volgorde van de plan-tekst):
// 1. rolgating: organizationOwner ziet het paneel + startknop; scorer niet.
// 2. lokale modus zonder netwerkcall: MigrationPanel wordt in lokale modus
//    (geen selectedContext-team, `repositories.mode === 'local'`) niet eens
//    gerenderd — structureel geen netwerkcall, zie `app/App.tsx`'s
//    voorwaarde. Dit spiegelt exact hoe 7.1c/7.3a hun eigen "geen
//    netwerkcall in lokale modus"-garantie bewijzen (afwezigheid van UI, niet
//    een intercepted-request-teller — Firestore-SDK-calls zijn met Playwright
//    niet betrouwbaar als losse HTTP-requests te onderscheiden van de
//    lange-lived listener-stream, zie die PR's eigen toelichting).
// 3. volledige stroom (preview → herstelback-up → bevestiging → voortgang →
//    resultaat) met een echte cloud-doelcontext, eindigend in `completed`.
// 4. crash/reload halverwege: een reload ná bevestiging (dus ná
//    `prepareRun()`) verliest de React-UI-state (verwacht — dit is geen
//    volledige page-refresh-resume-UI, dat is niet in de plan-tekst geëist),
//    maar de LOKALE run zelf overleeft (`MigrationRunRepository`,
//    localStorage) — een hernieuwde "Migratie voorbereiden" hervat exact
//    dezelfde run (zelfde `manifestHash`) i.p.v. een duplicaat te starten.
// 5. serverreject/bestaand-afwijkend-item: een cloud-settings-document met
//    AFWIJKENDE inhoud onder dezelfde doel-ID levert een zichtbaar conflict
//    op, nooit een overwrite — en een retry blijft idempotent (geen tweede
//    schrijfpoging, het Firestore-document blijft ongewijzigd).
// 6. herstelback-up-inhoud: de daadwerkelijk gedownloade JSON bevat de
//    lokale bron, niet een leeg of afwijkend bestand.
//
// Kon dit NIET lokaal draaien: `npx playwright install chromium` faalt in
// deze sandbox met 403 op de geblokkeerde CDN — zelfde bekende beperking als
// elke eerdere PR in deze reeks (7.2c/7.3a/7.3b/7.3c/7.4a/7.4b). Dit bestand
// is wél `tsc -b`/`eslint`/`prettier`-schoon geverifieerd en zorgvuldig
// tegen de daadwerkelijke `MigrationPanel`/`MigrationCoordinator`-code
// nagelopen (testId's/stapvolgorde 1:1 overgenomen uit `MigrationPanel.tsx`).

import { test, expect } from '@playwright/test';
import { adminDb, lookupUidByEmail } from './adminFixtures';
import { signUp, answerTrustedDevice, selectContext, uniqueTestEmail } from './helpers';
import type { OrganizationRole } from '../../src/domain/organizations/types';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';

const PASSWORD = 'MigrationFlow123!';
const SETTINGS_KEY = 'lineup-tracker-settings';
const ROSTER_KEY = 'lineup-tracker-roster';

async function seedTeam(): Promise<{ orgId: string; teamId: string }> {
  const db = adminDb();
  const orgRef = db.collection('organizations').doc();
  const teamRef = orgRef.collection('teams').doc();
  await orgRef.set({ name: 'Migratie-Org', createdBy: 'seed', createdAt: new Date() });
  await teamRef.set({
    name: 'Migratie-Team',
    orgName: 'Migratie-Org',
    createdBy: 'seed',
    createdAt: new Date(),
  });
  return { orgId: orgRef.id, teamId: teamRef.id };
}

async function applyRole(
  orgId: string,
  teamId: string,
  uid: string,
  email: string,
  role: OrganizationRole,
): Promise<void> {
  const db = adminDb();
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

/** Zet de lokale-migratiebron in `localStorage`, VOORDAT de app de doel-org/
 * team-context selecteert — spiegelt een "bestaande lokale gebruiker" die nu
 * voor het eerst inlogt op een cloudteam terwijl er nog v2-localStorage-data
 * op dit apparaat staat (plan §A). */
async function seedLocalMigrationSource(page: import('@playwright/test').Page): Promise<void> {
  // `validateSettingsSection()` (domain/backup/validate.ts, hergebruikt door
  // `domain/migration/inventory.ts`) is fail-closed en eist ALLE `Settings`-
  // sleutels (zie `SETTINGS_KEYS`) — een gedeeltelijk object levert
  // `status: 'corrupt'` op, wat `buildCloudMigrationPreview()` vóór elke
  // itemlijst laat afwijzen (`step: 'denied'`, nooit `migration-preview`).
  // Spiegel daarom de unit-testfixtures (`migrationInventory.spec.ts` e.a.):
  // begin bij `DEFAULT_SETTINGS` en override alleen wat dit scenario nodig
  // heeft, i.p.v. een eigen, onvolledige settings-vorm te verzinnen.
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    teamName: 'Migratie-Team',
    quarterCount: 4,
    periodLabel: 'Kwart',
    useClassLimit: false,
    primaryColor: '#123456',
    accentColor: '#654321',
  };
  await page.evaluate(
    ({ settingsKey, rosterKey, settings }) => {
      window.localStorage.setItem(settingsKey, JSON.stringify(settings));
      window.localStorage.setItem(
        rosterKey,
        JSON.stringify([
          { id: 1, nr: '4', naam: 'Migratie Speler Een', kl: '3.0', vrouw: false, jeugd: false },
        ]),
      );
    },
    { settingsKey: SETTINGS_KEY, rosterKey: ROSTER_KEY, settings },
  );
}

test.describe('PR 7.4c werk 4.1 — rolgating', () => {
  test('organizationOwner ziet het migratiepaneel + startknop', async ({ page }) => {
    const email = uniqueTestEmail('migration-owner');
    await signUp(page, email, PASSWORD);
    await answerTrustedDevice(page, true);
    const uid = await lookupUidByEmail(email, PASSWORD);
    const { orgId, teamId } = await seedTeam();
    await applyRole(orgId, teamId, uid, email, 'organizationOwner');
    await page.reload();
    await seedLocalMigrationSource(page);
    await selectContext(page, orgId, teamId);

    await expect(page.getByTestId('migration-panel')).toBeVisible();
    await expect(page.getByTestId('migration-start-btn')).toBeVisible();
  });

  test('scorer krijgt het migratiepaneel NOOIT te zien (geen bulkactie, §B)', async ({ page }) => {
    const email = uniqueTestEmail('migration-scorer');
    await signUp(page, email, PASSWORD);
    await answerTrustedDevice(page, true);
    const uid = await lookupUidByEmail(email, PASSWORD);
    const { orgId, teamId } = await seedTeam();
    await applyRole(orgId, teamId, uid, email, 'scorer');
    await page.reload();
    await selectContext(page, orgId, teamId);

    await expect(page.getByTestId('migration-panel')).toHaveCount(0);
  });

  test('viewer krijgt het migratiepaneel NOOIT te zien', async ({ page }) => {
    const email = uniqueTestEmail('migration-viewer');
    await signUp(page, email, PASSWORD);
    await answerTrustedDevice(page, true);
    const uid = await lookupUidByEmail(email, PASSWORD);
    const { orgId, teamId } = await seedTeam();
    await applyRole(orgId, teamId, uid, email, 'viewer');
    await page.reload();
    await selectContext(page, orgId, teamId);

    await expect(page.getByTestId('migration-panel')).toHaveCount(0);
  });
});

test.describe('PR 7.4c werk 4.2 — lokale modus', () => {
  test('vóór inloggen (lokale modus) bestaat het migratiepaneel structureel niet', async ({
    page,
  }) => {
    await page.goto('/');
    // Geen auth-flow doorlopen — dit blijft de v1/lokale-modus-app.
    // `app/App.tsx` rendert `MigrationPanel` uitsluitend wanneer
    // `repositories.mode === 'cloud'` — in lokale modus is er domweg geen
    // enkele migratie-gateway geïnstantieerd (zie
    // `infrastructure/repositories/resolveAppRepositories.ts`), dus geen
    // enkele Firestore-aanroep is zelfs maar MOGELIJK vanuit dit paneel.
    await expect(page.getByTestId('migration-panel')).toHaveCount(0);
  });
});

test.describe('PR 7.4c werk 4.3/4.4 — volledige stroom + crash/reload', () => {
  test('preview → herstelback-up → bevestiging → voortgang → completed, met hervatten na reload', async ({
    page,
  }) => {
    const email = uniqueTestEmail('migration-flow');
    await signUp(page, email, PASSWORD);
    await answerTrustedDevice(page, true);
    const uid = await lookupUidByEmail(email, PASSWORD);
    const { orgId, teamId } = await seedTeam();
    await applyRole(orgId, teamId, uid, email, 'organizationOwner');
    await page.reload();
    await seedLocalMigrationSource(page);
    await selectContext(page, orgId, teamId);

    await page.getByTestId('migration-start-btn').click();
    await expect(page.getByTestId('migration-preview')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('migration-preview-settings')).toContainText('wordt aangemaakt');
    await expect(page.getByTestId('migration-preview-roster')).toContainText('wordt aangemaakt');

    await page.getByTestId('migration-preview-next-btn').click();
    await expect(page.getByTestId('migration-backup')).toBeVisible();
    await expect(page.getByTestId('migration-backup-next-btn')).toBeDisabled();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('migration-backup-download-btn').click();
    const download = await downloadPromise;
    const backupPath = await download.path();
    expect(backupPath).toBeTruthy();
    // Werk 4 "echte inhoud van herstelback-up": lees het bestand terug en
    // controleer dat het de lokale bron draagt, niet een leeg/afwijkend
    // bestand.
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(backupPath as string, 'utf8');
    const parsed = JSON.parse(raw) as {
      data: { settings?: { teamName?: string }; roster?: unknown[] };
    };
    expect(parsed.data.settings?.teamName).toBe('Migratie-Team');
    expect(parsed.data.roster).toHaveLength(1);

    await expect(page.getByTestId('migration-backup-done')).toBeVisible();
    await expect(page.getByTestId('migration-backup-next-btn')).toBeEnabled();
    await page.getByTestId('migration-backup-next-btn').click();

    await expect(page.getByTestId('migration-confirm')).toBeVisible();
    await page.getByTestId('migration-confirm-btn').click();

    // Werk 4 "crash/reload per stap": herlaad DIRECT na bevestiging, terwijl
    // de run mogelijk nog loopt/net gestart is. De React-UI-state gaat
    // verloren (verwacht), maar de lokale run (localStorage) niet — een
    // hernieuwde start hervat 'm.
    await page.waitForTimeout(200);
    await page.reload();
    await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('migration-panel')).toBeVisible();

    await page.getByTestId('migration-start-btn').click();
    await expect(page.getByTestId('migration-preview')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('migration-preview-next-btn').click();
    const downloadPromise2 = page.waitForEvent('download');
    await page.getByTestId('migration-backup-download-btn').click();
    await downloadPromise2;
    await page.getByTestId('migration-backup-next-btn').click();
    await page.getByTestId('migration-confirm-btn').click();

    await expect(page.getByTestId('migration-result')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('migration-result')).toContainText('voltooid');
    await expect(page.getByTestId('migration-retry-btn')).toHaveCount(0);

    // Server-readback: settings/roster staan écht in Firestore, met de
    // lokale inhoud — dit is de "clouddata is na readback gelijk"-acceptatie.
    const db = adminDb();
    const settingsDoc = await db
      .collection('organizations')
      .doc(orgId)
      .collection('teams')
      .doc(teamId)
      .collection('settings')
      .doc('current')
      .get();
    expect(settingsDoc.exists).toBe(true);
    expect(settingsDoc.data()?.teamName).toBe('Migratie-Team');
  });
});

test.describe('PR 7.4c werk 4.5 — bestaand-afwijkend-item (conflict) + dubbele retry', () => {
  test('een afwijkend cloud-settings-document blijft een zichtbaar conflict, nooit een overwrite; retry is idempotent', async ({
    page,
  }) => {
    const email = uniqueTestEmail('migration-conflict');
    await signUp(page, email, PASSWORD);
    await answerTrustedDevice(page, true);
    const uid = await lookupUidByEmail(email, PASSWORD);
    const { orgId, teamId } = await seedTeam();
    await applyRole(orgId, teamId, uid, email, 'organizationOwner');

    // Bestaand, AFWIJKEND cloud-settings-document — geseed via adminDb() (dus
    // buiten de UI om), zodat de preview 'm als `conflict` classificeert.
    // Moet een volledig `SettingsDocument` zijn (spiegelt het precedent in
    // `completed-history-same-named-teams-switch.spec.ts`'s `seedNamedTeam()`):
    // een gedeeltelijk document laat `settingsConverter.fromFirestore()` (de
    // ECHTE Firestore-documentconverter, gebruikt door zowel de normale
    // Settings-listener in `App.tsx` als deze migratie-preview) gooien zodra
    // de app de doelcontext opent — dat brak eerder de hele app-load (nooit
    // `nav-settings`), ver vóórdat de migratie-UI ook maar in beeld kwam.
    const db = adminDb();
    await db
      .collection('organizations')
      .doc(orgId)
      .collection('teams')
      .doc(teamId)
      .collection('settings')
      .doc('current')
      .set({
        ...DEFAULT_SETTINGS,
        teamName: 'Al-een-andere-naam-in-de-cloud',
        quarterCount: 4,
        updatedAt: new Date(),
      });

    await page.reload();
    await seedLocalMigrationSource(page);
    await selectContext(page, orgId, teamId);

    await page.getByTestId('migration-start-btn').click();
    await expect(page.getByTestId('migration-preview')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('migration-preview-settings')).toContainText('conflict');

    await page.getByTestId('migration-preview-next-btn').click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('migration-backup-download-btn').click();
    await downloadPromise;
    await page.getByTestId('migration-backup-next-btn').click();
    await page.getByTestId('migration-confirm-btn').click();

    await expect(page.getByTestId('migration-result')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('migration-result')).toContainText('Actie nodig');
    await expect(page.getByTestId('migration-retry-btn')).toBeVisible();
    await expect(page.getByTestId('migration-export-btn')).toBeVisible();

    const before = (
      await db
        .collection('organizations')
        .doc(orgId)
        .collection('teams')
        .doc(teamId)
        .collection('settings')
        .doc('current')
        .get()
    ).data();
    expect(before?.teamName).toBe('Al-een-andere-naam-in-de-cloud');

    // Dubbele retry — werk 4 "dubbele retry moet idempotent zijn, geen
    // dubbele clulditems": een aanhoudend conflict schrijft NOOIT, dus het
    // cloud-document blijft exact hetzelfde.
    await page.getByTestId('migration-retry-btn').click();
    await expect(page.getByTestId('migration-result')).toContainText('Actie nodig');
    await page.getByTestId('migration-retry-btn').click();
    await expect(page.getByTestId('migration-result')).toContainText('Actie nodig');

    const after = (
      await db
        .collection('organizations')
        .doc(orgId)
        .collection('teams')
        .doc(teamId)
        .collection('settings')
        .doc('current')
        .get()
    ).data();
    expect(after?.teamName).toBe('Al-een-andere-naam-in-de-cloud');

    // Export van het vastzittende item (werk 1 "retry/export").
    const exportDownloadPromise = page.waitForEvent('download');
    await page.getByTestId('migration-export-btn').click();
    const exportDownload = await exportDownloadPromise;
    expect(await exportDownload.path()).toBeTruthy();
  });
});
