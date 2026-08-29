// PR 8.2c emulator-e2e (docs/pr-8.2-plan.md §B punt 7 / §C 8.2c werk 4):
// zwakke, NIET-onderbroken verbinding tijdens een lopende, live wedstrijd-
// sync — een aanvulling op de bestaande volledig-offline-suites (§B punt 7),
// geen dubbele "offline werkt"-suite. CDP-netwerkemulatie
// (`Network.emulateNetworkConditions`) vertraagt elke Firestore-roundtrip
// merkbaar. Bewijst (a) de score-knop blijft klikbaar tijdens die
// vertraging (geen UI-lock — zie LiveTrackingPanel.tsx: score-knoppen zijn
// alleen `disabled` op `!canWrite`, nooit op syncstatus) en (b) twee
// achtereenvolgende, verschillende score-toekenningen komen allebei aan met
// de juiste sequence/delta (geen dubbele/omgewisselde acties, zelfde
// garantie als de bestaande actielog-idempotentie uit PR 7.1c).
//
// **Scope bewust versmald t.o.v. de externe review op PR #80/#84 (na zes
// CI-iteraties):** het oorspronkelijke voorstel — de TWEEDE actie klikken
// terwijl de EERSTE nog synchroniseert, dus vóórdat die upload klaar is —
// bleek onder CDP-netwerkemulatie reproduceerbaar en onbeslist op
// 'gesynchroniseerd' te blijven hangen, EXACT op elke geprobeerde
// timeoutwaarde (45s/90s), ongeacht throttleprofiel (met/zonder
// bandbreedteplafond) of vóór/ná welk punt de emulatie werd ingeschakeld —
// dat sluit netwerktiming als oorzaak uit. Waarschijnlijk raakt dat exacte
// scenario dezelfde klasse concurrent-sync-kwetsbaarheid als de bekende,
// reeds gedocumenteerde race in `finishGameWithOneSegment()`
// (`gameSyncFixtures.ts`, PR 7.1c/7.2a-scope) — een apart, dieper
// coordinator-niveau-onderzoek waard, geen test-timingprobleem. Deze test
// wacht daarom nu op de EERSTE actie se eigen volledige synccyclus vóórdat
// de TWEEDE geklikt wordt (zelfde "wacht-tussen-acties"-conventie als de
// rest van deze e2e-auth-suite), en bewijst zo nog steeds beide kernclaims
// hierboven — alleen niet meer het specifieke overlappende-actiescenario.
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
  // De standaard Playwright-testtimeout (30s) is niet genoeg zodra de CDP-
  // netwerkemulatie hieronder actief is.
  test.setTimeout(150_000);

  const identity = await registerPilotCoach(page, 'game-sync-weak-network');
  const team = await seedPilotTeam(identity, 'game-sync-weak-network');
  await seedPilotRoster(team);

  // Alleen Chromium ondersteunt CDP — playwright.auth.config.ts draait deze
  // suite uitsluitend tegen het 'chromium'-project, dus dit is geen
  // voorwaardelijke skip voor andere browsers, puur de sessie opzetten.
  //
  // Bewust VÓÓR openPilotTeam()/startTrackedGame() ingeschakeld — niet pas
  // ná de eerste sync-cyclus. Twee eerdere CI-pogingen die de emulatie pas
  // ná een al bestaande 'gesynchroniseerd'-cyclus inschakelden (eerst een
  // ~1500ms/400kbps-, daarna een alleen-latency-500ms-profiel) bleven
  // consequent EXACT op de gekozen timeoutwaarde vastlopen (45s, 90s) —
  // geen "iets meer marge nodig", maar een teken dat de sync-cyclus
  // structureel nooit meer landde. Waarschijnlijke oorzaak: Firestores
  // lang-lopende long-polling-GET (`experimentalForceLongPolling: true`,
  // `firebaseClient.ts`) was op het moment van `emulateNetworkConditions()`
  // al open, en een netwerkwijziging op een reeds-openstaande stream lijkt
  // die stream (en daarmee alle schrijfacties erachter) blijvend te
  // verstoren i.p.v. 'm alleen te vertragen. Door de emulatie AL actief te
  // hebben vóórdat Firestore zijn eerste verbinding opzet, wordt die
  // verbinding vanaf het begin ONDER de vertraging opgebouwd — geen
  // live-wijziging op een bestaande stream meer.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 500,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });

  await openPilotTeam(page, team);
  await startTrackedGame(page);
  await waitForGameSyncStatus(page, 'gesynchroniseerd', 60_000);

  const gameId = await readLocalGameId(page, team);

  await page.getByTestId('score-plus2-for').click();
  // Direct na de klik, terwijl de (vertraagde) uploadronde nog loopt: de
  // knop mag niet vergrendeld zijn.
  await expect(page.getByTestId('score-plus2-for')).toBeEnabled();
  await expect(page.getByTestId('score-plus1-against')).toBeEnabled();

  // Wacht de eerste actie se eigen synccyclus af (zie de scope-toelichting
  // bovenaan) vóórdat de tweede, andersoortige score-toekenning volgt.
  await waitForGameSyncStatus(page, 'gesynchroniseerd', 60_000);

  await page.getByTestId('score-plus1-against').click();
  await expect(page.getByTestId('score-plus1-against')).toBeEnabled();

  await waitForGameSyncStatus(page, 'gesynchroniseerd', 60_000);

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
  // bestaande PR 7.1c-actielog-idempotentietests). `sequence` — niet de
  // (willekeurige) Firestore-leesvolgorde — is het daadwerkelijke
  // volgordecontract (`projectGameActions()`/`deriveGameStateFromCloud()`):
  // expliciet vastleggen dat de EERST geklikte 'for'-actie sequence 0 kreeg
  // en de daaropvolgende 'against'-actie sequence 1, ook onder de
  // netwerkvertraging hierboven (externe review PR #84, P2).
  expect(forAction?.data().sequence).toBe(0);
  expect(againstAction?.data().sequence).toBe(1);
  expect(actionsSnap.docs.every((d) => d.data().gameId === gameId)).toBe(true);
});
