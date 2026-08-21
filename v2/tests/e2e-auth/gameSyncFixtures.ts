// Gedeelde fixtures voor de PR 7.1c game-sync-e2e-specs. Spiegelt het patroon
// van twoDeviceFixtures.ts/adminFixtures.ts: Firebase Admin voor het seeden/
// direct verifiëren van serverdata (buiten de UI om, buiten Security Rules
// om), de UI zelf voor de daadwerkelijke sync-cyclus via GameSyncCoordinator.
import { expect, type Page } from '@playwright/test';
import { adminDb } from './adminFixtures';
import type { PilotTeam } from './twoDeviceFixtures';
import { activeGameStorageKey } from '../../src/infrastructure/game/LocalStorageGameRepository';
import { completedGamesStorageKey } from '../../src/infrastructure/game/LocalStorageCompletedGameRepository';
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

/**
 * Scoort één segment en rondt de wedstrijd af (v1-/PR-6.3-pariteit:
 * 'Afronden' blijft uitgeschakeld zonder minstens één opgeslagen segment).
 * Geëxtraheerd uit `game-sync-second-client-completed-history.spec.ts`
 * (PR 7.2b) zodat andere completedGames-e2e-specs 'm kunnen hergebruiken.
 *
 * Wacht bewust na de score-acties en na het segment op 'gesynchroniseerd'
 * (net als `game-sync-second-client-readback.spec.ts`) vóórdat 'Afronden'
 * geklikt wordt: `GameSyncCoordinator.finalize()` roept intern zelf óók
 * `sync()` aan (zie de docstring bij `finalize()`), volledig los van
 * `app/App.tsx`'s eigen `gameSyncInFlightRef`-serialisatie voor de LIVE
 * trackingsync. Een 'Afronden'-klik terwijl de vorige live-sync-cyclus voor
 * dezelfde wedstrijd nog in-flight is, laat zo twee gelijktijdige
 * `patchSnapshot()`-aanroepen op dezelfde verwachte `revision` racen — de
 * verliezer wordt door firestore.rules' optimistische-concurrencycheck
 * afgewezen (`request.resource.data.revision == resource.data.revision + 1`)
 * en zet het checkpoint op `actie-nodig`. Dat is een bestaande
 * coordinator-brede racevoorwaarde (PR 7.1c/7.2a-scope, geen 7.2b-scope) —
 * de completedGames-e2e-specs ontwijken 'm hier door dezelfde
 * wacht-tussen-acties-conventie als de rest van de suite te volgen i.p.v.
 * 'm te fixen.
 */
export async function finishGameWithOneSegment(page: Page): Promise<void> {
  await page.getByTestId('score-plus3-for').click();
  await page.getByTestId('score-plus1-against').click();
  await waitForGameSyncStatus(page, 'gesynchroniseerd');

  await page.getByTestId('end-min').selectOption('5');
  await page.getByTestId('save-segment-btn').click();
  await expect(page.locator('[data-testid^="segment-item-"]')).toHaveCount(1);
  await waitForGameSyncStatus(page, 'gesynchroniseerd');

  await expect(page.getByTestId('finish-game-btn')).toBeEnabled();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('finish-game-btn').click();
  // 'Afronden' schakelt automatisch naar Historie met het net afgeronde item open.
  await expect(page.getByTestId('history-back-btn')).toBeVisible();
}

/**
 * Leest het lokaal opgeslagen `CompletedGame.id` van het eerst opgeslagen
 * item (nieuwste eerst, v1-pariteit) rechtstreeks uit localStorage — het ID
 * is clientgegenereerd, dus niet vooraf voorspelbaar vanuit de test.
 */
export async function readCompletedGameId(
  page: Page,
  orgId: string,
  teamId: string,
): Promise<string> {
  const key = completedGamesStorageKey(orgId, teamId);
  const raw = await page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
  if (!raw) throw new Error('geen afgeronde wedstrijd gevonden in localStorage');
  const games = JSON.parse(raw) as Array<{ id: string }>;
  if (games.length === 0) throw new Error('completedGames-array is leeg');
  return games[0]!.id;
}

/**
 * PR 7.2c: alle lokaal opgeslagen `CompletedGame.id`'s voor dit org/team
 * (leeg als er nog niets/niet meer staat) — i.t.t. `readCompletedGameId()`
 * hierboven (die het NIEUWSTE item pakt en gooit bij een lege array) faalt
 * dit niet op een lege lijst: nuttig om te bewijzen dat een ID NIET (meer)
 * lokaal aanwezig is, bijv. na een tombstone die dit apparaat leerde.
 */
export async function readLocalCompletedGameIds(
  page: Page,
  orgId: string,
  teamId: string,
): Promise<string[]> {
  const key = completedGamesStorageKey(orgId, teamId);
  const raw = await page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
  if (!raw) return [];
  return (JSON.parse(raw) as Array<{ id: string }>).map((g) => g.id);
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

/**
 * Wacht tot de sync-statusindicator `status` toont — maar NIET via één kale
 * gelijkheidscheck. `App.tsx`'s `runGameSync()` zet de indicator pas op
 * 'wacht-op-synchronisatie' zodra het `useEffect` ná de React-commit vuurt —
 * er zit dus een (doorgaans submilliseconde) venster tussen een klik en die
 * overgang. Een test die precies in dát venster samplet ziet nog de vorige
 * cyclus' 'gesynchroniseerd' en concludeert dan ten onrechte dat de NIEUWE
 * actie al klaar is, terwijl de upload nog moet beginnen — reproduceerbaar
 * geworden onder belasting (binnen de volledige e2e-auth-suite, niet
 * geïsoleerd). Fase 1 vangt daarom eerst (best-effort, kort) de
 * overgangstoestand 'wacht-op-synchronisatie' af — bewijst dat er
 * daadwerkelijk een NIEUWE cyclus gestart is — vóórdat op het einddoel
 * gewacht wordt.
 */
export async function waitForGameSyncStatus(
  page: Page,
  status: string,
  timeoutMs = 20_000,
): Promise<void> {
  if (status !== 'wacht-op-synchronisatie') {
    await page
      .waitForFunction(
        ({ testId }) => {
          const el = document.querySelector(`[data-testid="${testId}"]`);
          return el?.getAttribute('data-status') === 'wacht-op-synchronisatie';
        },
        { testId: 'game-sync-status-indicator' },
        { timeout: 2_000 },
      )
      .catch(() => {
        /* kan al voorbij zijn vóór deze aanroep begon (zeer snelle emulator-
         * roundtrip) — geen probleem, fase 2 hieronder dekt het einddoel
         * hoe dan ook af. */
      });
  }

  await page.waitForFunction(
    ({ testId, expected }) => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      return el?.getAttribute('data-status') === expected;
    },
    { testId: 'game-sync-status-indicator', expected: status },
    { timeout: timeoutMs },
  );
}
