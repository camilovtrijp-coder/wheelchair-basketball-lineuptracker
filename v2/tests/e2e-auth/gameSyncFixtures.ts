// Gedeelde fixtures voor de PR 7.1c game-sync-e2e-specs. Spiegelt het patroon
// van twoDeviceFixtures.ts/adminFixtures.ts: Firebase Admin voor het seeden/
// direct verifiëren van serverdata (buiten de UI om, buiten Security Rules
// om), de UI zelf voor de daadwerkelijke sync-cyclus via GameSyncCoordinator.
import type { Page } from '@playwright/test';
import { adminDb } from './adminFixtures';
import type { PilotTeam } from './twoDeviceFixtures';
import { activeGameStorageKey } from '../../src/infrastructure/game/LocalStorageGameRepository';
import { gameSyncCheckpointStorageKey } from '../../src/infrastructure/game/LocalStorageGameSyncCheckpointRepository';

/** Minimale, geldige 5-spelersroster — genoeg om canStart()/startGame() te halen. */
export function fivePlayerRoster() {
  return [1, 2, 3, 4, 5].map((n) => ({
    id: n,
    nr: String(n),
    naam: `Speler ${n}`,
    kl: '3.0',
    vrouw: false,
    jeugd: false,
  }));
}

export async function seedPilotRoster(team: PilotTeam): Promise<void> {
  await adminDb()
    .doc(`organizations/${team.orgId}/teams/${team.teamId}/roster/current`)
    .set({ players: fivePlayerRoster(), updatedAt: new Date() });
}

export function gameDoc(team: PilotTeam, gameId: string) {
  return adminDb().doc(`organizations/${team.orgId}/teams/${team.teamId}/games/${gameId}`);
}

export function gameActionsCollection(team: PilotTeam, gameId: string) {
  return adminDb().collection(
    `organizations/${team.orgId}/teams/${team.teamId}/games/${gameId}/actions`,
  );
}

/**
 * Leest het lokaal opgeslagen ActiveGame.id rechtstreeks uit localStorage —
 * de gameId is clientgegenereerd (`crypto.randomUUID()`, zie
 * domain/game/setup.ts), dus niet vooraf voorspelbaar vanuit de test.
 */
export async function readLocalGameId(page: Page, team: PilotTeam): Promise<string> {
  const key = activeGameStorageKey(team.orgId, team.teamId);
  const raw = await page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
  if (!raw) throw new Error('geen actieve wedstrijd gevonden in localStorage');
  return (JSON.parse(raw) as { id: string }).id;
}

/**
 * Navigeert naar het wedstrijdtabblad en start de opzet — met de
 * `fivePlayerRoster()` hierboven kiest `startGame()` automatisch de 5 laagste
 * rugnummers (geen losse start/participate-toggles nodig, zie
 * `domain/game/setup.ts` `startBlockReason()`/`startGame()`).
 */
export async function startTrackedGame(page: Page): Promise<void> {
  await page.getByTestId('nav-game').click();
  await page.waitForSelector('[data-testid="game-start-btn"]', { timeout: 10_000 });
  await page.getByTestId('game-start-btn').click();
  await page.waitForSelector('[data-testid="score-plus1-for"]', { timeout: 10_000 });
}

export async function readGameSyncStatus(page: Page): Promise<string | null> {
  const el = page.getByTestId('game-sync-status-indicator');
  if ((await el.count()) === 0) return null;
  return el.getAttribute('data-status');
}

/**
 * Wist alleen het lokale synccheckpoint (niet de ActiveGame zelf) — laat de
 * coordinator "vergeten" dat een al server-bevestigde actie bevestigd was,
 * zodat de eerstvolgende sync 'm opnieuw probeert te uploaden. Dat dwingt
 * `FirestoreGameCloudGateway.uploadActions()`'s echte readback-/
 * alreadyConfirmed-pad af (create-only-afwijzing op een reeds bestaand
 * document), i.p.v. dat het lokale checkpoint de actie al filtert vóórdat
 * er ook maar een Firestore-aanroep gebeurt.
 */
export async function forgetLocalSyncCheckpoint(page: Page, gameId: string): Promise<void> {
  await page.evaluate((key) => localStorage.removeItem(key), gameSyncCheckpointStorageKey(gameId));
}

/** Leest het lokale synccheckpoint rechtstreeks uit localStorage (JSON, geen typegarantie hier nodig). */
export async function readLocalCheckpoint(
  page: Page,
  gameId: string,
): Promise<{ confirmedActionIds: string[]; status: string } | null> {
  const raw = await page.evaluate(
    (key) => localStorage.getItem(key),
    gameSyncCheckpointStorageKey(gameId),
  );
  if (!raw) return null;
  return JSON.parse(raw) as { confirmedActionIds: string[]; status: string };
}

/** Leest de lokale ActiveGame.actions-array (client-ID's) rechtstreeks uit localStorage. */
export async function readLocalActionIds(page: Page, team: PilotTeam): Promise<string[]> {
  const key = activeGameStorageKey(team.orgId, team.teamId);
  const raw = await page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
  if (!raw) throw new Error('geen actieve wedstrijd gevonden in localStorage');
  const game = JSON.parse(raw) as { actions: Array<{ id: string }> };
  return game.actions.map((a) => a.id);
}

export async function waitForGameSyncStatus(
  page: Page,
  status: string,
  timeoutMs = 20_000,
): Promise<void> {
  await page.waitForFunction(
    ({ testId, expected }) => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      return el?.getAttribute('data-status') === expected;
    },
    { testId: 'game-sync-status-indicator', expected: status },
    { timeout: timeoutMs },
  );
}
