// Herreview PR #52 (aug. 2026): §G eist een e2e-bewijs van een ECHTE
// cloud-serverafwijzing + rollback, niet alleen de unit-genneste
// simulatie in tests/unit/BackupCoordinator.spec.ts. Deze test draait
// tegen de echte Firestore-emulator en Security Rules
// (firebase/firestore.rules `canManageTeamData()`), niet tegen een fake.
//
// Mechanisme: `canWrite` in de UI wordt éénmalig berekend bij
// contextselectie (AuthGate.tsx) en is GEEN live-geabonneerde waarde — een
// rolwijziging die daarna gebeurt, wordt pas zichtbaar na een reload/nieuwe
// contextselectie. Door de organisatierol van de ingelogde gebruiker via de
// Admin SDK te downgraden NA het tonen van de preview maar VÓÓR het klikken
// op "bevestigen", blijft de knop dus actief terwijl de daadwerkelijke
// Firestore-write straks wél door de Security Rules geweigerd wordt — exact
// het scenario dat `BackupCoordinator.ts`'s `settled`-afhandeling moet
// opvangen (zie `writeSettingsSection`/`writeRosterSection`): lokale
// acceptatie via latency compensation, gevolgd door een ASYNCHRONE
// serverafwijzing.
import { expect, test } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adminDb, lookupUidByEmail } from './adminFixtures';
import { signUp, answerTrustedDevice, uniqueTestEmail } from './helpers';

async function writeTempJson(content: unknown): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'backup-cloud-reject-'));
  const path = join(dir, 'backup.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
}

function rejectedBackup() {
  return {
    type: 'lineup-tracker-backup',
    version: 2,
    exportedAt: '2026-01-01T00:00:00.000Z',
    data: {
      settings: {
        teamName: 'Should Never Land',
        logoUri: '',
        primaryColor: '#2563eb',
        accentColor: '#f97316',
        quarterCount: 4,
        periodLabel: '',
        useClassLimit: false,
        tag1Label: '',
        tag2Label: '',
        classBaseLimit: 14.5,
        maxBonus: 2.5,
        bonusTag1Only: 1.5,
        bonusTag2Only: 1.0,
        bonusBoth: 2.0,
      },
    },
  };
}

test.describe('PR 6.6: cloud-serverreject + rollback (herreview PR #52, aug. 2026)', () => {
  test('een backup-import die pas na de preview de schrijfrechten verliest, meldt failed/rollbackFailed — nooit succes, en schrijft niets naar Firestore', async ({
    page,
  }) => {
    const email = uniqueTestEmail('backup-reject');
    const password = 'BackupReject123!';
    await signUp(page, email, password);
    await answerTrustedDevice(page, true);

    await page.waitForSelector('[data-testid="onboarding-org-name"]', { timeout: 10_000 });
    await page.getByTestId('onboarding-org-name').fill('Reject Test Club');
    await page.getByTestId('onboarding-team-name').fill('Reject Test Team');
    await page.getByTestId('onboarding-submit').click();

    await page.waitForSelector('[data-testid^="context-org-"]', { timeout: 10_000 });
    const orgId = (await page
      .locator('[data-testid^="context-org-"]')
      .first()
      .getAttribute('data-testid'))!.replace('context-org-', '');
    await page.getByTestId(`context-org-${orgId}`).click();
    await page.waitForSelector('[data-testid^="context-team-"]', { timeout: 10_000 });
    const teamId = (await page
      .locator('[data-testid^="context-team-"]')
      .first()
      .getAttribute('data-testid'))!.replace('context-team-', '');
    await page.getByTestId(`context-team-${teamId}`).click();
    await page.waitForSelector('[data-testid="nav-settings"]', { timeout: 10_000 });

    const uid = await lookupUidByEmail(email, password);
    const db = adminDb();
    const settingsRef = db.doc(`organizations/${orgId}/teams/${teamId}/settings/current`);

    // Baseline: wat er (eventueel) al in Firestore staat vóórdat we iets doen.
    const before = await settingsRef.get();
    const beforeTeamName = before.exists
      ? (before.data()?.teamName as string | undefined)
      : undefined;

    const path = await writeTempJson(rejectedBackup());
    await page.getByTestId('backup-file-input').setInputFiles(path);
    await expect(page.getByTestId('backup-preview')).toBeVisible();
    await expect(page.getByTestId('backup-preview-settings')).toContainText('Should Never Land');

    // Hier verliest de gebruiker canManageTeamData — de UI weet dit nog
    // niet (canWrite is een snapshot van vóór dit moment), maar Firestore
    // Security Rules zullen de zo dadelijk volgende write weigeren.
    await db
      .collection('organizations')
      .doc(orgId)
      .collection('organizationMembers')
      .doc(uid)
      .set({ role: 'viewer' }, { merge: true });

    // Nog steeds actief (bewijst dat canWrite niet live is bijgewerkt).
    await expect(page.getByTestId('backup-confirm-btn')).toBeEnabled();
    await page.getByTestId('backup-confirm-btn').click();

    // Nooit succes — de coordinator wacht op `settled` en moet de
    // serverafwijzing als `failed` zien, gevolgd door een rollbackpoging
    // die (dezelfde geweigerde rechten) ook eerlijk als `rollbackFailed`
    // moet melden, nooit stilzwijgend als `rolledBack`.
    await expect(page.getByTestId('backup-success')).toHaveCount(0);
    await expect(page.getByTestId('backup-failed')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('backup-journal-settings-failed')).toBeVisible();

    // Firestore zelf bewijst dat er daadwerkelijk niets is weggeschreven:
    // de waarde is niet de geïmporteerde 'Should Never Land'.
    await expect
      .poll(
        async () => {
          const snap = await settingsRef.get();
          return snap.exists ? (snap.data()?.teamName as string | undefined) : undefined;
        },
        { timeout: 10_000, intervals: [250, 500, 1000] },
      )
      .not.toBe('Should Never Land');
    const after = await settingsRef.get();
    const afterTeamName = after.exists ? (after.data()?.teamName as string | undefined) : undefined;
    expect(afterTeamName).toBe(beforeTeamName);
  });
});
