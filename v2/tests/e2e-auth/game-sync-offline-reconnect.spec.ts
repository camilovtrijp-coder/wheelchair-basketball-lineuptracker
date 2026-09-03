// PR 7.1c emulator-e2e: offline acties, reconnect en idempotente retry
// (docs/pr-7.1-plan.md §C 7.1c werk 5/acceptatie 1). Bewijst dat een actie die
// tijdens offline wordt gescoord lokaal blijft bestaan (nooit verwijderd),
// pas na reconnect in Firestore verschijnt, en na een retry nooit dubbel in
// de actions-subcollectie belandt.
import { test, expect } from '@playwright/test';
import { openPilotTeam, registerPilotCoach, seedPilotTeam } from './twoDeviceFixtures';
import {
  SYNC_WAIT_TIMEOUT_MS,
  gameActionsCollection,
  gameDoc,
  readLocalGameId,
  seedPilotRoster,
  startTrackedGame,
  waitForGameSyncStatus,
} from './gameSyncFixtures';

// Twee van de vier waitForGameSyncStatus()-aanroepen hieronder (de eerste
// online sync, en de wait op 'actie-nodig' na het offline gaan) krijgen
// expliciet SYNC_WAIT_TIMEOUT_MS (45s) — het zijn genuine tijdgebrek-gevallen
// (een sequentieel gatewaypad dat op een trage runner méér tijd nodig kan
// hebben, maar wél voltooit). De reconnect-wait (hieronder bij de eigen
// docstring) krijgt dat bewust NIET: herreview op PR #88 (P1) toont dat die
// wacht op een statusovergang wacht waarvoor na een mislukte poging geen
// verdere trigger meer bestaat (zie die docstring) — langer wachten verhult
// dat probleem alleen, het lost het niet op.
test.setTimeout(240_000);

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
  await waitForGameSyncStatus(page, 'gesynchroniseerd', SYNC_WAIT_TIMEOUT_MS);
  const gameId = await readLocalGameId(page, team);

  await page.context().setOffline(true);
  await page.getByTestId('score-plus3-for').click();

  // Lokaal blijft de score meteen zichtbaar (optimistisch, ongeacht sync).
  await expect(page.getByTestId('score-select-for')).toHaveValue('3');
  // De sync-poging loopt vast (timeout op de gateway, ADR-002 "Actie nodig").
  await waitForGameSyncStatus(page, 'actie-nodig', SYNC_WAIT_TIMEOUT_MS);

  // De actie bestaat nog niet op de server terwijl we offline zijn.
  const whileOffline = await gameActionsCollection(team, gameId).get();
  expect(whileOffline.size).toBe(0);

  await page.context().setOffline(false);
  // Reconnect-trigger (window 'online' in App.tsx's runGameSync-effect) is
  // een EENMALIGE, niet-herhaalde poging: als díe ene sync() faalt (bijv.
  // omdat de Firestore SDK's eigen interne reconnect/backoff op dat moment
  // nog niet hersteld is), zet de promise-handler de status op 'actie-nodig'
  // en bestaat er — zonder een nieuwe gebruikersactie, een nieuw 'online'-
  // event, of een expliciete retry — geen mechanisme meer dat 'm alsnog naar
  // 'gesynchroniseerd' brengt (herreview PR #88, P1). Deze wait test dus
  // bewust NIET op een ruimer tijdsbudget (blijft op het oorspronkelijke
  // 20s-default staan, geen SYNC_WAIT_TIMEOUT_MS): een langere timeout
  // verhult een terminale status-conditie, het lost 'm niet op. Zolang er
  // geen begrensde/cancelbare productie-retry (of een aangepast
  // acceptatiecontract met een zichtbare herstelactie) is, blijft deze
  // specifieke aanroep een bekende, op het product teruggevoerde flake —
  // zie de PR-beschrijving voor de twee door de review voorgestelde opties.
  await waitForGameSyncStatus(page, 'gesynchroniseerd');

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
