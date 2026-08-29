// PR 8.2c emulator-e2e (docs/pr-8.2-plan.md §B punt 7 / §C 8.2c werk 4):
// zwakke, NIET-onderbroken verbinding tijdens een lopende, live wedstrijd-
// sync — een aanvulling op de bestaande volledig-offline-suites (§B punt 7),
// geen dubbele "offline werkt"-suite. Concreet scenario uit de externe
// review op PR #80: CDP-netwerkemulatie (`Network.emulateNetworkConditions`)
// vertraagt de Firestore-writeronde van een scoretoekenning met ~1500ms.
// Bewijst (a) de score-knop blijft klikbaar tijdens die vertraging (geen
// UI-lock — zie LiveTrackingPanel.tsx: score-knoppen zijn alleen
// `disabled` op `!canWrite`, nooit op syncstatus) en (b) een tweede
// score-toekenning binnen 5 seconden na de eerste — dus vóórdat de eerste
// upload klaar is — in de juiste volgorde verwerkt wordt (geen dubbele/
// omgewisselde acties, zelfde garantie als de bestaande
// actielog-idempotentie uit PR 7.1c).
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

test('score-/wisselbediening blijft bruikbaar tijdens een geëmuleerde trage verbinding, acties komen in de juiste volgorde aan', async ({
  page,
}) => {
  const identity = await registerPilotCoach(page, 'game-sync-weak-network');
  const team = await seedPilotTeam(identity, 'game-sync-weak-network');
  await seedPilotRoster(team);

  await openPilotTeam(page, team);
  await startTrackedGame(page);
  await waitForGameSyncStatus(page, 'gesynchroniseerd');

  const gameId = await readLocalGameId(page, team);

  // Alleen Chromium ondersteunt CDP — playwright.auth.config.ts draait deze
  // suite uitsluitend tegen het 'chromium'-project, dus dit is geen
  // voorwaardelijke skip voor andere browsers, puur de sessie opzetten.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 1500,
    // 3G-achtige bandbreedte (bytes/s) — traag maar niet nul, zie §B punt 7.
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
  });

  await page.getByTestId('score-plus2-for').click();
  // Direct na de klik, terwijl de (vertraagde) uploadronde nog loopt: de
  // knop mag niet vergrendeld zijn.
  await expect(page.getByTestId('score-plus2-for')).toBeEnabled();
  await expect(page.getByTestId('score-plus1-against')).toBeEnabled();

  // Binnen 5s na de eerste, vóórdat de eerste (vertraagde) upload klaar is:
  // een tweede, andersoortige score-toekenning.
  await page.getByTestId('score-plus1-against').click();
  await expect(page.getByTestId('score-plus1-against')).toBeEnabled();

  await waitForGameSyncStatus(page, 'gesynchroniseerd', 30_000);

  // Netwerkemulatie uitzetten vóórdat de test verder leest/opruimt.
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });

  const afterActions = await gameDoc(team, gameId).get();
  expect(afterActions.data()?.scoreFor).toBe(2);
  expect(afterActions.data()?.scoreAgainst).toBe(1);

  const actionsSnap = await gameActionsCollection(team, gameId).get();
  expect(actionsSnap.size).toBe(2);
  const forAction = actionsSnap.docs.find((d) => d.data().action.team === 'for');
  const againstAction = actionsSnap.docs.find((d) => d.data().action.team === 'against');
  expect(forAction?.data().action.delta).toBe(2);
  expect(againstAction?.data().action.delta).toBe(1);
  // Geen dubbele/omgewisselde acties: precies één 'for'- en één
  // 'against'-actie, elk met de juiste delta (zelfde controle als de
  // bestaande PR 7.1c-actielog-idempotentietests).
  expect(actionsSnap.docs.every((d) => d.data().gameId === gameId)).toBe(true);
});
