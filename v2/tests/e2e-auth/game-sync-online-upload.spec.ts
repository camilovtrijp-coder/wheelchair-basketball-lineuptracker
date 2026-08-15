// PR 7.1c emulator-e2e: online upload + reload (docs/pr-7.1-plan.md §C 7.1c
// werk 5). Bewijst end-to-end (echte Firestore-emulator, echte Rules uit
// PR 7.1b, geen mocks) dat GameSyncCoordinator een lopende wedstrijd claimt,
// acties uploadt en de snapshot patcht — en dat een reload op hetzelfde
// apparaat de bestaande claim herkent (geen nieuwe/foutieve claimpoging).
import { test, expect } from '@playwright/test';
import { openPilotTeam, registerPilotCoach, seedPilotTeam } from './twoDeviceFixtures';
import {
  gameActionsCollection,
  gameDoc,
  readLocalGameId,
  seedPilotRoster,
  startTrackedGame,
  waitForGameSyncStatus,
} from './gameSyncFixtures';

test('claimt de wedstrijd, uploadt acties, patcht de snapshot en overleeft een reload', async ({
  page,
}) => {
  const identity = await registerPilotCoach(page, 'game-sync-online');
  const team = await seedPilotTeam(identity, 'game-sync-online');
  await seedPilotRoster(team);

  await openPilotTeam(page, team);
  await startTrackedGame(page);

  // Sync na het starten (0 acties, alleen claim + snapshot) moet zonder enige
  // score al naar 'gesynchroniseerd' gaan.
  await waitForGameSyncStatus(page, 'gesynchroniseerd');

  const gameId = await readLocalGameId(page, team);

  const afterClaim = await gameDoc(team, gameId).get();
  expect(afterClaim.exists).toBe(true);
  expect(afterClaim.data()?.writerUid).toBe(identity.uid);
  expect(afterClaim.data()?.deviceId).toEqual(expect.any(String));
  expect(afterClaim.data()?.revision).toBe(2); // create (rev 0) -> claim (1) -> veldpatch (2)

  // Twee losse acties: +2 voor, +1 tegen.
  await page.getByTestId('score-plus2-for').click();
  await page.getByTestId('score-plus1-against').click();
  await waitForGameSyncStatus(page, 'gesynchroniseerd');

  const actionsSnap = await gameActionsCollection(team, gameId).get();
  expect(actionsSnap.size).toBe(2);
  const actionTypes = actionsSnap.docs.map((d) => d.data().action.type).sort();
  expect(actionTypes).toEqual(['score-delta', 'score-delta']);
  for (const doc of actionsSnap.docs) {
    expect(doc.data().authorUid).toBe(identity.uid);
    expect(doc.data().gameId).toBe(gameId);
  }

  const afterActions = await gameDoc(team, gameId).get();
  expect(afterActions.data()?.scoreFor).toBe(2);
  expect(afterActions.data()?.scoreAgainst).toBe(1);
  const revisionAfterActions = afterActions.data()?.revision as number;
  expect(revisionAfterActions).toBeGreaterThan(2);

  // Reload op hetzelfde apparaat: hetzelfde deviceId (localStorage overleeft
  // een reload) moet de bestaande claim gewoon herkennen — geen 'actie-nodig'.
  await page.reload();
  await page.waitForSelector('[data-testid="nav-game"]', { timeout: 10_000 });
  await page.getByTestId('nav-game').click();
  await page.waitForSelector('[data-testid="score-plus1-for"]', { timeout: 10_000 });

  await page.getByTestId('score-plus1-for').click();
  await waitForGameSyncStatus(page, 'gesynchroniseerd');

  const afterReload = await gameDoc(team, gameId).get();
  expect(afterReload.data()?.writerUid).toBe(identity.uid);
  expect(afterReload.data()?.scoreFor).toBe(3);
  expect((afterReload.data()?.revision as number) > revisionAfterActions).toBe(true);

  const actionsAfterReload = await gameActionsCollection(team, gameId).get();
  expect(actionsAfterReload.size).toBe(3);
});
