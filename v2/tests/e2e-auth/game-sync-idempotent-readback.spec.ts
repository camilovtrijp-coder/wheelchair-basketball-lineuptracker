// PR 7.1c emulator-e2e: dekt precies de twee paden van
// FirestoreGameCloudGateway.uploadActions()'s create-only-readback die de
// bestaande specs nog niet raakten (externe review op PR #56 — de
// offline/reconnect-spec test alleen dat het LOKALE checkpoint een actie
// filtert, nooit dat de gateway zelf een reeds-bestaand server-document
// correct herkent). Beide tests "vergeten" via `forgetLocalSyncCheckpoint()`
// een al bevestigde actie lokaal, zodat de eerstvolgende sync 'm opnieuw
// probeert te uploaden en zo tegen een document botst dat al bestaat.
//
// De tweede test hieronder is TEGELIJK het "gedeeltelijke uploadfout"-
// acceptatiescenario uit docs/pr-7.1-plan.md §C 7.1c werk 5: X en Y worden
// in ÉÉN uploadActions()-aanroep meegegeven (unconfirmed = [X, Y]) en X
// faalt terwijl Y slaagt — mechanisch dus al een echte gedeeltelijke
// batchfout. De tamper-truc is uitsluitend het deterministische middel om
// die situatie reproduceerbaar te forceren (in de praktijk is dit
// onbereikbaar via de client — create-only laat een update nooit toe); wat
// getest wordt is of GameSyncCoordinator na zo'n gedeeltelijke fout de
// geslaagde actie bevestigd houdt, de gefaalde actie lokaal behoudt (nooit
// verwijdert) en dit zichtbaar als 'actie-nodig' meldt.
import { test, expect } from '@playwright/test';
import { openPilotTeam, registerPilotCoach, seedPilotTeam } from './twoDeviceFixtures';
import {
  forgetLocalSyncCheckpoint,
  gameActionsCollection,
  gameDoc,
  readLocalActionIds,
  readLocalCheckpoint,
  readLocalGameId,
  seedPilotRoster,
  startTrackedGame,
  waitForGameSyncStatus,
} from './gameSyncFixtures';

test('identieke payload op een "vergeten" bevestigde actie: alreadyConfirmed, nooit een dubbel document', async ({
  page,
}) => {
  const identity = await registerPilotCoach(page, 'game-sync-idempotent');
  const team = await seedPilotTeam(identity, 'game-sync-idempotent');
  await seedPilotRoster(team);

  await openPilotTeam(page, team);
  await startTrackedGame(page);
  await waitForGameSyncStatus(page, 'gesynchroniseerd');
  const gameId = await readLocalGameId(page, team);

  // Actie X: bevestigd en server-zichtbaar.
  await page.getByTestId('score-plus1-for').click();
  await waitForGameSyncStatus(page, 'gesynchroniseerd');
  const afterFirst = await gameActionsCollection(team, gameId).get();
  expect(afterFirst.size).toBe(1);
  const actionXId = afterFirst.docs[0]!.id;
  const actionXPayload = afterFirst.docs[0]!.data();

  // Lokaal "vergeten" dat X al bevestigd is, dan een nieuwe actie Y scoren —
  // dat triggert een sync die BEIDE als onbevestigd beschouwt.
  await forgetLocalSyncCheckpoint(page, gameId);
  await page.getByTestId('score-plus1-against').click();
  await waitForGameSyncStatus(page, 'gesynchroniseerd');

  // Precies 2 documenten: X (ongewijzigd, niet dubbel) en de nieuwe Y.
  const finalActions = await gameActionsCollection(team, gameId).get();
  expect(finalActions.size).toBe(2);
  const finalXDoc = finalActions.docs.find((d) => d.id === actionXId);
  expect(finalXDoc).toBeDefined();
  expect(finalXDoc!.data()).toEqual(actionXPayload);

  const finalGame = await gameDoc(team, gameId).get();
  expect(finalGame.data()?.scoreFor).toBe(1);
  expect(finalGame.data()?.scoreAgainst).toBe(1);
});

test('gedeeltelijke uploadfout (afwijkende payload op één van twee acties in dezelfde batch): de geslaagde actie blijft bevestigd, de gefaalde actie blijft lokaal bestaan, actie-nodig zichtbaar, serverdocument van de gefaalde actie blijft ongewijzigd', async ({
  page,
}) => {
  const identity = await registerPilotCoach(page, 'game-sync-conflict-payload');
  const team = await seedPilotTeam(identity, 'game-sync-conflict-payload');
  await seedPilotRoster(team);

  await openPilotTeam(page, team);
  await startTrackedGame(page);
  await waitForGameSyncStatus(page, 'gesynchroniseerd');
  const gameId = await readLocalGameId(page, team);

  await page.getByTestId('score-plus2-for').click();
  await waitForGameSyncStatus(page, 'gesynchroniseerd');
  const afterFirst = await gameActionsCollection(team, gameId).get();
  expect(afterFirst.size).toBe(1);
  const actionXId = afterFirst.docs[0]!.id;

  // Simuleert een corrupte/gemanipuleerde server-payload op exact dezelfde
  // actionId (Admin SDK omzeilt bewust Rules — dit pad is vanuit de client
  // niet bereikbaar, create-only laat een update nooit toe; dit test alleen
  // GameSyncCoordinator/FirestoreGameCloudGateway's eigen conflictdetectie
  // via de echte readback-vergelijking).
  await gameDoc(team, gameId).collection('actions').doc(actionXId).update({ 'action.delta': 999 });

  // X "vergeten" + Y scoren: de eerstvolgende sync stuurt [X, Y] in ÉÉN
  // uploadActions()-aanroep — X faalt (conflict), Y slaagt. Een echte
  // gedeeltelijke batchfout, geen twee losse sync-cycli.
  await forgetLocalSyncCheckpoint(page, gameId);
  await page.getByTestId('score-plus1-against').click();
  await waitForGameSyncStatus(page, 'actie-nodig', 20_000);

  // X blijft ongewijzigd (de afgewezen create-poging heeft de gemanipuleerde
  // waarde niet overschreven); Y is wél gewoon doorgekomen (onafhankelijk
  // van X's conflict) — precies 2 documenten, X met delta 999.
  const finalActions = await gameActionsCollection(team, gameId).get();
  expect(finalActions.size).toBe(2);
  const finalXDoc = finalActions.docs.find((d) => d.id === actionXId);
  expect(finalXDoc?.data().action).toEqual({ type: 'score-delta', team: 'for', delta: 999 });

  // Lokaal checkpoint: Y is bevestigd, X (het conflict) NIET — dus bij een
  // volgende sync wordt X terecht opnieuw geprobeerd, nooit stilzwijgend
  // als "klaar" beschouwd.
  const checkpoint = await readLocalCheckpoint(page, gameId);
  expect(checkpoint?.status).toBe('actie-nodig');
  expect(checkpoint?.confirmedActionIds).not.toContain(actionXId);
  expect(checkpoint?.confirmedActionIds.length).toBe(1);

  // De lokale ActiveGame.actions-array verliest NOOIT een actie door een
  // mislukte upload — X en Y staan beide nog gewoon lokaal, ongeacht hun
  // server-uitkomst (ADR-002: de lokale actielog blijft de bron van
  // waarheid, een gefaalde sync mag 'm nooit inkorten).
  const localActionIds = await readLocalActionIds(page, team);
  expect(localActionIds).toContain(actionXId);
  expect(localActionIds.length).toBe(2);
});
