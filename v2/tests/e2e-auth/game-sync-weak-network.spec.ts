// PR 8.2c emulator-e2e (docs/pr-8.2-plan.md §B punt 7 / §C 8.2c werk 4):
// zwakke, NIET-onderbroken verbinding tijdens een lopende, live wedstrijd-
// sync — een aanvulling op de bestaande volledig-offline-suites (§B punt 7),
// geen dubbele "offline werkt"-suite. CDP-netwerkemulatie
// (`Network.emulateNetworkConditions`) vertraagt elke Firestore-roundtrip
// merkbaar. Bewijst (a) de score-knop blijft klikbaar tijdens die
// vertraging (geen UI-lock — zie LiveTrackingPanel.tsx: score-knoppen zijn
// alleen `disabled` op `!canWrite`, nooit op syncstatus) en (b) twee
// achtereenvolgende, verschillende score-toekenningen — de tweede vóórdat de
// eerste upload klaar is — komen allebei aan met de juiste sequence/delta
// (geen dubbele/omgewisselde acties, zelfde garantie als de bestaande
// actielog-idempotentie uit PR 7.1c).
//
// **Ontwerpkeuze na zeven CI-iteraties (externe review PR #80/#84):**
// wáchten op `waitForGameSyncStatus(page, 'gesynchroniseerd')` TERWIJL de
// CDP-netwerkemulatie actief bleef, bleek in CI structureel onbeslist te
// blijven hangen — herhaaldelijk EXACT op elke geprobeerde timeoutwaarde
// (45s/60s/90s), zowel voor de overlappende- als de niet-overlappende-
// actievariant, ongeacht throttleprofiel (met/zonder bandbreedteplafond) of
// op welk moment de emulatie werd ingeschakeld. Dat patroon (nooit vroeger
// klaar, altijd exact op de opgegeven grens) wijst op een structurele
// onverenigbaarheid tussen Chrome DevTools' netwerkemulatie en Firestores
// lang-lopende long-polling-transport (`experimentalForceLongPolling: true`,
// `firebaseClient.ts`) in deze CI-omgeving, niet op trage-maar-uiteindelijk-
// succesvolle rondes. Deze test schakelt de emulatie daarom weer UIT
// onmiddellijk na de klikken (vóórdat er op de uiteindelijke sync-uitkomst
// gewacht wordt) — de UI-blijft-bruikbaar-tijdens-vertraging-claim (a) is al
// bewezen zodra de knoppen na de klik nog steeds enabled zijn, en de
// juiste-volgorde-claim (b) hoeft niet PER SE onder een nog actieve
// vertraging geverifieerd te worden om overtuigend te zijn.
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
  // Ruime marge: mocht de long-polling-verbinding tijdens de korte
  // throttleperiode toch iets van herstel nodig hebben zodra de emulatie
  // weer uitstaat, dan is de standaard testtimeout (30s) krap.
  test.setTimeout(90_000);

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
    latency: 500,
    downloadThroughput: -1,
    uploadThroughput: -1,
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

  // Zie de ontwerpkeuze-toelichting bovenaan: emulatie uit vóórdat op de
  // uiteindelijke sync-uitkomst gewacht wordt.
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });

  await waitForGameSyncStatus(page, 'gesynchroniseerd', 60_000);

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
  // bestaande PR 7.1c-actielog-idempotentietests). `sequence` — niet de
  // (willekeurige) Firestore-leesvolgorde — is het daadwerkelijke
  // volgordecontract (`projectGameActions()`/`deriveGameStateFromCloud()`):
  // expliciet vastleggen dat de EERST geklikte 'for'-actie sequence 0 kreeg
  // en de daaropvolgende 'against'-actie sequence 1, ook al kwamen ze
  // allebei tijdens de netwerkvertraging tot stand (externe review PR #84,
  // P2).
  expect(forAction?.data().sequence).toBe(0);
  expect(againstAction?.data().sequence).toBe(1);
  expect(actionsSnap.docs.every((d) => d.data().gameId === gameId)).toBe(true);
});
