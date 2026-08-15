// PR 7.1c emulator-e2e: een ECHTE Security Rules-afwijzing (niet via Admin
// SDK gesimuleerd — dit gaat via de echte clientaanroepen van
// GameSyncCoordinator tegen de echte PR 7.1b-Rules). Externe review op PR
// #56 wees erop dat `game-sync-claim-conflict.spec.ts` de writer via de
// Admin SDK forceert en de coordinator dus vóór een echte write al stopt;
// dit scenario downgradet in plaats daarvan de rol van de actieve schrijver
// zelf naar 'viewer' terwijl de wedstrijd loopt — `canWriteGame` in de UI is
// een ééndelig bij contextselectie berekende waarde (AuthGate.tsx, niet
// live-geabonneerd op rolwijzigingen), dus de scoreknop blijft klikbaar en
// de daadwerkelijke `uploadActions()`/`patchSnapshot()`-calls lopen
// vervolgens tegen een echte, live Rules-afwijzing (`canWriteGameData` faalt
// nu voor deze rol) aan.
import { test, expect } from '@playwright/test';
import { adminDb } from './adminFixtures';
import { openPilotTeam, registerPilotCoach, seedPilotTeam } from './twoDeviceFixtures';
import {
  gameActionsCollection,
  gameDoc,
  readLocalGameId,
  seedPilotRoster,
  startTrackedGame,
  waitForGameSyncStatus,
} from './gameSyncFixtures';

test('een live rolverlaging naar viewer levert een echte Rules-afwijzing op (actie-nodig, niets serverzijdig gewijzigd)', async ({
  page,
}) => {
  const identity = await registerPilotCoach(page, 'game-sync-rules-reject');
  const team = await seedPilotTeam(identity, 'game-sync-rules-reject');
  await seedPilotRoster(team);

  await openPilotTeam(page, team);
  await startTrackedGame(page);
  await waitForGameSyncStatus(page, 'gesynchroniseerd');
  const gameId = await readLocalGameId(page, team);

  const beforeDowngrade = await gameDoc(team, gameId).get();
  expect(beforeDowngrade.data()?.scoreFor).toBe(0);

  // Rolverlaging buiten de UI om — coach mag na deze update volgens
  // firestore.rules' canWriteGameData() geen wedstrijddata meer schrijven,
  // maar blijft wel teamlid (canReadTeam blijft dus gewoon toegestaan).
  await adminDb()
    .doc(`organizations/${team.orgId}/teams/${team.teamId}/teamMembers/${identity.uid}`)
    .update({ role: 'viewer' });

  // `canWriteGame` is bij contextselectie ééndelig berekend (AuthGate.tsx) —
  // niet live geabonneerd — dus de knop is nog gewoon klikbaar; de daaropvolgende
  // sync-poging loopt tegen de echte, actuele Rules aan.
  await page.getByTestId('score-plus2-for').click();
  await expect(page.getByTestId('score-select-for')).toHaveValue('2');
  await waitForGameSyncStatus(page, 'actie-nodig', 20_000);

  // Zowel de actie als de snapshotpatch zijn door Rules geweigerd — geen van
  // beide is serverzijdig doorgekomen.
  const actionsAfterReject = await gameActionsCollection(team, gameId).get();
  expect(actionsAfterReject.size).toBe(0);
  const afterReject = await gameDoc(team, gameId).get();
  expect(afterReject.data()?.scoreFor).toBe(0);
});
