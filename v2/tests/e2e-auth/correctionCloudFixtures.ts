// Gedeelde hulpen voor de PR 7.6c tweede-apparaat-e2e van de cloudcorrectie
// (docs/pr-7.6-plan.md §E 7.6c). Hergebruikt de bestaande fixtures voor
// inloggen, contextkeuze en afronden; voegt alleen toe wat de correctie-e2e
// nodig heeft: een correctie via de echte UI, statuswachters, een
// teamlid met een gekozen rol, Admin-leesacties en de CSV-download.
// Uitsluitend fictieve data en uitsluitend de Emulator Suite.
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { adminDb, lookupUidByEmail } from './adminFixtures';
import { answerTrustedDevice, selectContext, signUp, uniqueTestEmail } from './helpers';
import type { PilotTeam } from './twoDeviceFixtures';

export const MEMBER_PASSWORD = 'Correction123!';

export type CorrectionStatus =
  | 'lokaal-beschikbaar'
  | 'wacht-op-synchronisatie'
  | 'gesynchroniseerd'
  | 'actie-nodig'
  | 'conflict';

export function syncStatus(page: Page, gameId: string) {
  return page.getByTestId(`history-sync-status-${gameId}`);
}

export async function expectSyncStatus(
  page: Page,
  gameId: string,
  status: CorrectionStatus,
  timeout = 30_000,
): Promise<void> {
  await expect(syncStatus(page, gameId)).toHaveAttribute('data-status', status, { timeout });
}

/** Opent Historie en daarin de detailweergave van `gameId` (wacht op het item). */
export async function openHistoryGame(page: Page, gameId: string): Promise<void> {
  if ((await page.getByTestId('history-back-btn').count()) > 0) {
    await page.getByTestId('history-back-btn').click();
  }
  await page.getByTestId('nav-history').click();
  const item = page.getByTestId(`history-item-${gameId}`);
  await expect(item).toBeVisible({ timeout: 30_000 });
  await item.click();
  await expect(page.getByTestId('history-back-btn')).toBeVisible();
}

/** Het (enige) segment van de detailweergave. */
export function firstSegment(page: Page) {
  return page.locator('.segment-list .segment-item').first();
}

export interface SegmentPatch {
  pf?: number;
  pa?: number;
  tov?: number;
}

/**
 * Corrigeert het eerste segment via de echte UI (aantikken, velden, controleren,
 * bevestigen). De wedstrijd staat al open in de detailweergave.
 */
export async function correctFirstSegment(page: Page, patch: SegmentPatch): Promise<void> {
  await firstSegment(page).click();
  const dialog = page.getByTestId('correct-segment-modal');
  await expect(dialog).toBeVisible();
  if (patch.pf !== undefined) await page.getByTestId('correct-pf').fill(String(patch.pf));
  if (patch.pa !== undefined) await page.getByTestId('correct-pa').fill(String(patch.pa));
  if (patch.tov !== undefined) await page.getByTestId('correct-tov').fill(String(patch.tov));
  await page.getByTestId('correct-segment-review').click();
  await expect(page.getByTestId('correct-segment-summary')).toBeVisible();
  await page.getByTestId('correct-segment-confirm').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('history-correction-saved')).toBeVisible();
}

/** Assert de waarden van het (enige) segment en het turnovertotaal in de detailweergave. */
export async function expectSegmentValues(
  page: Page,
  values: { plusMinus: number; turnovers: number },
): Promise<void> {
  const pm = `${values.plusMinus >= 0 ? '+' : ''}${values.plusMinus}`;
  await expect(firstSegment(page)).toContainText(pm);
  await expect(page.getByTestId('history-turnovers-total')).toContainText(`: ${values.turnovers}`);
}

/** Aantal logregels in het correctielogboek van de open wedstrijd (opent het blok). */
export async function correctionLogCount(page: Page): Promise<number> {
  const log = page.getByTestId('history-corrections');
  if ((await log.count()) === 0) return 0;
  return log.locator('li').count();
}

/**
 * Registreert een tweede MEDEWERKER (ander account dan de eigenaar van het
 * team) met een gekozen teamrol in een eigen browsercontext en kiest de context.
 */
export async function joinTeamAs(
  browser: Browser,
  team: PilotTeam,
  role: 'coach' | 'scorer' | 'viewer',
  label: string,
): Promise<{
  context: BrowserContext;
  page: Page;
  email: string;
  password: string;
  uid: string;
}> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = uniqueTestEmail(label);
  await signUp(page, email, MEMBER_PASSWORD);
  await answerTrustedDevice(page, true);
  const uid = await lookupUidByEmail(email, MEMBER_PASSWORD);
  await adminDb()
    .doc(`organizations/${team.orgId}/teams/${team.teamId}/teamMembers/${uid}`)
    .set({ role, email, uid, addedAt: new Date() });
  await page.reload();
  await selectContext(page, team.orgId, team.teamId);
  await page.getByTestId('nav-history').click();
  return { context, page, email, password: MEMBER_PASSWORD, uid };
}

export function completedGameRef(team: PilotTeam, gameId: string) {
  return adminDb().doc(`organizations/${team.orgId}/teams/${team.teamId}/completedGames/${gameId}`);
}

/** Serverkant (Admin SDK, buiten Rules om): revisie, tombstone en correctielog. */
export async function readServerGame(
  team: PilotTeam,
  gameId: string,
): Promise<{
  revision: number;
  deletedAt: unknown;
  corrections: Array<{ id: string; by: string | null }>;
  scoreFor: number;
  scoreAgainst: number;
}> {
  const snapshot = await completedGameRef(team, gameId).get();
  const data = snapshot.data();
  if (!data) throw new Error('afgeronde wedstrijd ontbreekt op de server');
  return {
    revision: Number(data.revision ?? 0),
    deletedAt: data.deletedAt ?? null,
    corrections: (data.corrections ?? []) as Array<{ id: string; by: string | null }>,
    scoreFor: Number(data.scoreFor),
    scoreAgainst: Number(data.scoreAgainst),
  };
}

/** Klikt op export in de detailweergave en geeft de CSV-tekst terug. */
export async function downloadCsv(page: Page): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('history-export-btn').click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

/** Velden van de eerste segmentrij (na het aanhalingsteken van "Opstelling"). */
export function firstCsvSegmentFields(csv: string): string[] {
  const row = csv.split('\n').find((line) => line.startsWith('"'));
  if (!row) throw new Error('geen segmentrij in de CSV');
  return row.slice(row.lastIndexOf('"') + 2).split(',');
}

/**
 * Legt elke wijziging van `data-status` op de statusindicator vast, inclusief
 * tussenstanden die binnen één taak weer verdwijnen (oudeWaarde per mutatie).
 */
export async function recordStatusTransitions(page: Page, gameId: string): Promise<void> {
  await page.evaluate((testId) => {
    const w = window as unknown as { __statusLog?: string[] };
    w.__statusLog = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.attributeName !== 'data-status') continue;
        const target = r.target as Element;
        if (target.getAttribute('data-testid') !== testId) continue;
        if (r.oldValue) w.__statusLog!.push(r.oldValue);
        const now = target.getAttribute('data-status');
        if (now) w.__statusLog!.push(now);
      }
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-status'],
      attributeOldValue: true,
    });
  }, `history-sync-status-${gameId}`);
}

export async function readRecordedStatuses(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __statusLog?: string[] }).__statusLog ?? []);
}
