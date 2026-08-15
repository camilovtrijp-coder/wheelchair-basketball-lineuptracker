// PR 7.1c emulator-e2e: server-afwijzing bij een writerclaim-conflict
// (docs/pr-7.1-plan.md §C 7.1c werk 5 "serverreject"). Een writer-overname is
// bewust PR 7.3-scope (ADR-002 §"Verduidelijkingen voor fase 7" punt 3) — dit
// bewijst dat GameSyncCoordinator een onverwachte `writerUid` op het
// serverdocument (hier via Admin SDK gesimuleerd, zoals een echte overname er
// straks serverzijde uit zou zien) zichtbaar als 'actie-nodig' meldt, zonder
// de lokale wedstrijd/actie te verliezen of de app te laten crashen.
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

test('een onverwachte writerUid op de server levert zichtbaar actie-nodig op, zonder dataverlies', async ({
  page,
}) => {
  const identity = await registerPilotCoach(page, 'game-sync-conflict');
  const team = await seedPilotTeam(identity, 'game-sync-conflict');
  await seedPilotRoster(team);

  await openPilotTeam(page, team);
  await startTrackedGame(page);
  await waitForGameSyncStatus(page, 'gesynchroniseerd');
  const gameId = await readLocalGameId(page, team);

  const before = await gameDoc(team, gameId).get();
  expect(before.data()?.writerUid).toBe(identity.uid);

  // Simuleert serverzijdig dat een ander apparaat/andere gebruiker de
  // wedstrijd inmiddels claimt (Admin SDK omzeilt bewust Security Rules —
  // vanuit de client is dit pad vandaag niet bereikbaar, zie PR 7.1b punt
  // 10a/10b; het testresultaat hangt dus uitsluitend af van
  // GameSyncCoordinator's eigen writerUid-vergelijking, niet van Rules).
  await gameDoc(team, gameId).update({ writerUid: 'uid-ander-apparaat', deviceId: 'ander-device' });

  await page.getByTestId('score-plus1-for').click();
  // Lokaal blijft de score gewoon zichtbaar — het conflict blokkeert nooit de
  // live scorebediening zelf, alleen de cloud-sync.
  await expect(page.getByTestId('score-select-for')).toHaveValue('1');
  await waitForGameSyncStatus(page, 'actie-nodig', 20_000);

  // Geen enkele actie is als "van deze schrijver" op de server terechtgekomen
  // ondanks de conflicterende claim — GameSyncCoordinator stopt vóór
  // uploadActions() zodra het schrijverschap niet meer klopt.
  const actionsAfterConflict = await gameActionsCollection(team, gameId).get();
  expect(actionsAfterConflict.size).toBe(0);

  // De server-writerUid blijft ongewijzigd (het conflict is gemeld, niet
  // stilzwijgend overschreven door dit apparaat).
  const afterConflict = await gameDoc(team, gameId).get();
  expect(afterConflict.data()?.writerUid).toBe('uid-ander-apparaat');
});
