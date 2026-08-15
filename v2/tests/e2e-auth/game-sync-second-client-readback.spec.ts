// PR 7.1c emulator-e2e: échte tweede-client-readback (reviewopvolging op
// PR #56 — de eerdere specs bewezen alleen "hetzelfde apparaat na reload"
// (game-sync-online-upload.spec.ts) of gebruikten de Admin SDK, die Rules
// bewust omzeilt). Hier verbindt een volledig onafhankelijke, apart ingelogde
// Firestore-clientinstantie (secondClientFixtures.ts — dezelfde
// client-`firebase/firestore`-SDK als de browser-app, geen Admin SDK) en
// leest het door apparaat A gesynchroniseerde parentdocument en de
// actions-subcollectie, met firestore.rules' `canReadTeam` daadwerkelijk
// gehandhaafd.
import { test, expect } from '@playwright/test';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import {
  openPilotTeam,
  PILOT_PASSWORD,
  registerPilotCoach,
  seedPilotTeam,
} from './twoDeviceFixtures';
import {
  readLocalGameId,
  seedPilotRoster,
  startTrackedGame,
  waitForGameSyncStatus,
} from './gameSyncFixtures';
import { connectAsSecondClient } from './secondClientFixtures';

test('een onafhankelijke, apart ingelogde tweede client leest het gesynchroniseerde parentdocument en de volledige actielog via echte Rules', async ({
  page,
}) => {
  const identity = await registerPilotCoach(page, 'game-sync-second-client');
  const team = await seedPilotTeam(identity, 'game-sync-second-client');
  await seedPilotRoster(team);

  await openPilotTeam(page, team);
  await startTrackedGame(page);
  await waitForGameSyncStatus(page, 'gesynchroniseerd');

  await page.getByTestId('score-plus2-for').click();
  await page.getByTestId('score-plus1-against').click();
  await waitForGameSyncStatus(page, 'gesynchroniseerd');
  const gameId = await readLocalGameId(page, team);

  // Onafhankelijke tweede client: eigen FirebaseApp, eigen Auth-sessie
  // (dezelfde coach-identiteit — canReadTeam vereist alleen teamlidmaatschap,
  // geen specifiek apparaat), eigen Firestore-verbinding.
  const second = await connectAsSecondClient(identity.email, PILOT_PASSWORD);
  try {
    const gameSnap = await getDoc(
      doc(second.db, 'organizations', team.orgId, 'teams', team.teamId, 'games', gameId),
    );
    expect(gameSnap.exists()).toBe(true);
    expect(gameSnap.data()?.scoreFor).toBe(2);
    expect(gameSnap.data()?.scoreAgainst).toBe(1);
    expect(gameSnap.data()?.writerUid).toBe(identity.uid);

    const actionsSnap = await getDocs(
      collection(
        second.db,
        'organizations',
        team.orgId,
        'teams',
        team.teamId,
        'games',
        gameId,
        'actions',
      ),
    );
    expect(actionsSnap.size).toBe(2);
    const actionTypes = actionsSnap.docs.map((d) => d.data().action.type).sort();
    expect(actionTypes).toEqual(['score-delta', 'score-delta']);
  } finally {
    await second.close();
  }
});
