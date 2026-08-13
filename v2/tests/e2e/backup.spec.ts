import { expect, test as base, type Page } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from './fixtures';

async function writeTempJson(content: unknown): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'backup-e2e-'));
  const path = join(dir, 'backup.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
}

function v2Backup(overrides: Record<string, unknown> = {}) {
  return {
    type: 'lineup-tracker-backup',
    version: 2,
    exportedAt: '2026-01-01T00:00:00.000Z',
    data: {
      settings: {
        teamName: 'Geïmporteerd Team',
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
      roster: [
        { id: 1, nr: '9', naam: 'Geïmporteerde Speler', kl: '3.0', vrouw: false, jeugd: false },
      ],
      ...overrides,
    },
  };
}

async function gotoSettings(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
}

test.describe('v2 Back-up-sectie (PR 6.6)', () => {
  test('export downloadt een geldige v2-back-up van het huidige team', async ({ page }) => {
    await gotoSettings(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('backup-export-btn').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/-backup-\d{8}\.json$/);
  });

  test('import toont een preview met doelteam en effecten, en schrijft pas na bevestiging', async ({
    page,
  }) => {
    await gotoSettings(page);
    const path = await writeTempJson(v2Backup());
    await page.getByTestId('backup-file-input').setInputFiles(path);

    await expect(page.getByTestId('backup-preview')).toBeVisible();
    await expect(page.getByTestId('backup-preview-target')).toBeVisible();
    await expect(page.getByTestId('backup-preview-settings')).toContainText('Geïmporteerd Team');
    await expect(page.getByTestId('backup-preview-roster')).toContainText('1');

    // Nog niets geschreven vóór bevestiging.
    await expect(page.getByTestId('settings-teamName')).not.toHaveValue('Geïmporteerd Team');

    const [restoreDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('backup-confirm-btn').click(),
    ]);
    expect(restoreDownload.suggestedFilename()).toMatch(/-backup-\d{8}\.json$/);

    await expect(page.getByTestId('backup-success')).toBeVisible();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-teamName')).toHaveValue('Geïmporteerd Team');
    await page.getByTestId('nav-roster').click();
    // De rosterplayer-ID uit de back-up (1) blijft het canonieke ID na
    // import — geen nieuwe ID's gegenereerd voor rosterentries.
    await expect(page.getByTestId('roster-naam-1')).toHaveValue('Geïmporteerde Speler');
  });

  test('annuleren op het previewscherm schrijft niets', async ({ page }) => {
    await gotoSettings(page);
    const path = await writeTempJson(v2Backup());
    await page.getByTestId('backup-file-input').setInputFiles(path);
    await expect(page.getByTestId('backup-preview')).toBeVisible();
    await page.getByTestId('backup-cancel-btn').click();
    await expect(page.getByTestId('backup-preview')).toHaveCount(0);
    await expect(page.getByTestId('settings-teamName')).not.toHaveValue('Geïmporteerd Team');
  });

  test('een niet-JSON-bestand wordt geweigerd zonder de bestaande data aan te passen', async ({
    page,
  }) => {
    await gotoSettings(page);
    const dir = mkdtempSync(join(tmpdir(), 'backup-e2e-'));
    const path = join(dir, 'not-json.json');
    writeFileSync(path, 'dit is geen geldige JSON {{{');
    await page.getByTestId('backup-file-input').setInputFiles(path);
    await expect(page.getByTestId('backup-error')).toBeVisible();
    await expect(page.getByTestId('backup-preview')).toHaveCount(0);
  });

  test('een back-up zonder herkenbare data wordt geweigerd', async ({ page }) => {
    await gotoSettings(page);
    const path = await writeTempJson({
      type: 'lineup-tracker-backup',
      version: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      data: {},
    });
    await page.getByTestId('backup-file-input').setInputFiles(path);
    await expect(page.getByTestId('backup-error')).toBeVisible();
    await expect(page.getByTestId('backup-preview')).toHaveCount(0);
  });

  test('een back-up met een onbekende lineup-referentie wordt geweigerd', async ({ page }) => {
    await gotoSettings(page);
    const path = await writeTempJson(
      v2Backup({
        completedGames: [
          {
            id: 'g1',
            organizationId: 'org-rotterdam',
            teamId: 'team-u23',
            sourceGameId: 'src-1',
            opponent: 'A',
            competition: '',
            date: '2026-01-01T10:00:00.000Z',
            players: [
              {
                id: 'p1',
                rosterId: 1,
                nr: '1',
                naam: 'A',
                kl: '3.0',
                vrouw: false,
                jeugd: false,
                participate: true,
                start: true,
              },
            ],
            segments: [
              {
                id: 's1',
                quarter: 1,
                beginSec: 0,
                endSec: 100,
                durSec: 100,
                lineup: ['p1', 'unknown', 'x', 'y', 'z'],
                pf: 1,
                pa: 0,
                classSum: 0,
                allowed: 0,
                over: false,
              },
            ],
            scoreFor: 1,
            scoreAgainst: 0,
            quarterCount: 4,
            periodLabel: '',
            useClassLimit: false,
          },
        ],
      }),
    );
    await page.getByTestId('backup-file-input').setInputFiles(path);
    await expect(page.getByTestId('backup-error')).toBeVisible();
  });

  test('het hersteljournaal toont een uitkomst per sectie na een geslaagde import', async ({
    page,
  }) => {
    await gotoSettings(page);
    const path = await writeTempJson(v2Backup());
    await page.getByTestId('backup-file-input').setInputFiles(path);
    await expect(page.getByTestId('backup-preview')).toBeVisible();
    await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('backup-confirm-btn').click(),
    ]);
    await expect(page.getByTestId('backup-success')).toBeVisible();
    await expect(page.getByTestId('backup-journal-settings-written')).toBeVisible();
    await expect(page.getByTestId('backup-journal-roster-written')).toBeVisible();
  });

  test('een herhaalde import van dezelfde back-up is idempotent (geen dubbele historie)', async ({
    page,
  }) => {
    await gotoSettings(page);
    const backup = v2Backup({
      completedGames: [
        {
          id: 'g1',
          organizationId: 'org-rotterdam',
          teamId: 'team-u23',
          sourceGameId: 'src-1',
          opponent: 'Herhaalde Tegenstander',
          competition: '',
          date: '2026-01-01T10:00:00.000Z',
          players: [1, 2, 3, 4, 5].map((n) => ({
            id: `p${n}`,
            rosterId: n,
            nr: String(n),
            naam: `Speler ${n}`,
            kl: '3.0',
            vrouw: false,
            jeugd: false,
            participate: true,
            start: true,
          })),
          segments: [],
          scoreFor: 0,
          scoreAgainst: 0,
          quarterCount: 4,
          periodLabel: '',
          useClassLimit: false,
        },
      ],
    });
    const path = await writeTempJson(backup);

    for (let i = 0; i < 2; i += 1) {
      await page.getByTestId('backup-file-input').setInputFiles(path);
      await expect(page.getByTestId('backup-preview')).toBeVisible();
      await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('backup-confirm-btn').click(),
      ]);
      await expect(page.getByTestId('backup-success')).toBeVisible();
    }

    await page.getByTestId('nav-history').click();
    const rows = page.getByText('Herhaalde Tegenstander');
    await expect(rows).toHaveCount(1);
  });
});

test.describe('v2 Back-up-sectie — bevoegdheid per rol (eigenaarsbesluit §E.4, externe PR-6.6-review)', () => {
  // Deze tests loggen bewust NIET via de `./fixtures`-auto-login in (die is
  // vast verankerd op bob/organizationAdmin) — scorer/viewer bestaan al in de
  // seed (firebase/scripts/seed.ts: dave=scorer, erin=viewer, beiden op
  // team-u23) en zijn nodig om te bewijzen dat de back-upknoppen ook
  // daadwerkelijk uitgeschakeld zijn onder de canManageTeamData-grens, niet
  // alleen bij de organizationAdmin die de rest van deze suite gebruikt.
  async function waitVisible(page: Page, testId: string, timeout: number): Promise<boolean> {
    return page
      .getByTestId(testId)
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
  }

  async function loginAndOpenSettings(page: Page, email: string, password: string): Promise<void> {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
    await page.goto('/');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(password);
    await page.getByTestId('auth-submit').click();
    if (await waitVisible(page, 'trusted-device-no', 10_000)) {
      await page.getByTestId('trusted-device-no').click();
    }
    if (await waitVisible(page, 'context-org-org-rotterdam', 10_000)) {
      await page.getByTestId('context-org-org-rotterdam').click();
      await page.waitForSelector('[data-testid="context-team-team-u23"]', { timeout: 10_000 });
      await page.getByTestId('context-team-team-u23').click();
    }
    await page.waitForSelector('[data-testid="nav-settings"]', { timeout: 10_000 });
    await page.getByTestId('nav-settings').click();
  }

  base('scorer (dave) ziet uitgeschakelde export-/importknoppen', async ({ page }) => {
    await loginAndOpenSettings(page, 'dave@example.test', 'Spike123!');
    await expect(page.getByTestId('backup-export-btn')).toBeDisabled();
    await expect(page.getByTestId('backup-import-btn')).toBeDisabled();
    await expect(page.getByTestId('backup-file-input')).toBeDisabled();
  });

  base('viewer (erin) ziet uitgeschakelde export-/importknoppen', async ({ page }) => {
    await loginAndOpenSettings(page, 'erin@example.test', 'Spike123!');
    await expect(page.getByTestId('backup-export-btn')).toBeDisabled();
    await expect(page.getByTestId('backup-import-btn')).toBeDisabled();
    await expect(page.getByTestId('backup-file-input')).toBeDisabled();
  });
});
