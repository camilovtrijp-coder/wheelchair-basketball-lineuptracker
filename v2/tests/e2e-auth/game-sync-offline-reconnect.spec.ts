// PR 7.1c emulator-e2e: offline acties, reconnect en idempotente retry
// (docs/pr-7.1-plan.md §C 7.1c werk 5/acceptatie 1). Bewijst dat een actie die
// tijdens offline wordt gescoord lokaal blijft bestaan (nooit verwijderd),
// pas na reconnect in Firestore verschijnt, en na een retry nooit dubbel in
// de actions-subcollectie belandt.
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

test.setTimeout(90_000);

test('een offline actie blijft lokaal, komt pas na reconnect door en nooit dubbel', async ({
  page,
}) => {
  const identity = await registerPilotCoach(page, 'game-sync-offline');
  const team = await seedPilotTeam(identity, 'game-sync-offline');
  await seedPilotRoster(team);

  await openPilotTeam(page, team);
  await startTrackedGame(page);
  // Eerste sync (claim + lege snapshotpatch) moet nog online lukken vóórdat
  // we offline gaan — anders is er nog geen writer-claim om acties op te
  // kunnen uploaden.
  await waitForGameSyncStatus(page, 'gesynchroniseerd');
  const gameId = await readLocalGameId(page, team);

  await page.context().setOffline(true);
  await page.getByTestId('score-plus3-for').click();

  // Lokaal blijft de score meteen zichtbaar (optimistisch, ongeacht sync).
  await expect(page.getByTestId('score-select-for')).toHaveValue('3');
  // De sync-poging loopt vast (timeout op de gateway, ADR-002 "Actie nodig").
  await waitForGameSyncStatus(page, 'actie-nodig', 20_000);

  // De actie bestaat nog niet op de server terwijl we offline zijn.
  const whileOffline = await gameActionsCollection(team, gameId).get();
  expect(whileOffline.size).toBe(0);

  await page.context().setOffline(false);
  // Reconnect-trigger (window 'online') moet vanzelf een nieuwe poging starten.
  await waitForGameSyncStatus(page, 'gesynchroniseerd', 20_000);

  const afterReconnect = await gameActionsCollection(team, gameId).get();
  expect(afterReconnect.size).toBe(1);
  expect(afterReconnect.docs[0]?.data().action).toEqual({
    type: 'score-delta',
    team: 'for',
    delta: 3,
  });

  const gameAfterReconnect = await gameDoc(team, gameId).get();
  expect(gameAfterReconnect.data()?.scoreFor).toBe(3);

  // Idempotente retry: nog een online actie triggert een nieuwe sync-cyclus
  // die de al bevestigde actie NOOIT opnieuw uploadt (checkpoint filtert 'm
  // eruit) — de subcollectie blijft op precies 2 documenten staan.
  await page.getByTestId('score-plus1-against').click();
  await waitForGameSyncStatus(page, 'gesynchroniseerd');
  const finalActions = await gameActionsCollection(team, gameId).get();
  expect(finalActions.size).toBe(2);
});
