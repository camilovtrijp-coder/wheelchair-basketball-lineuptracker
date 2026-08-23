// PR 7.3b emulator-e2e (docs/pr-7.3-plan.md §C 7.3b werk 2/5): bewijst de
// live viewer-subscriptie tegen de ECHTE Firestore-emulator, met firestore.rules'
// `canReadTeam` daadwerkelijk gehandhaafd (net als
// game-sync-second-client-readback.spec.ts) — een onafhankelijke, apart
// ingelogde tweede client abonneert zich via `FirestoreGameCloudGateway.
// subscribeToGame()` op parent + actions terwijl apparaat A (de browser-app)
// scoort, ook offline. Bewijst: (1) de viewer ontvangt live updates zonder
// enige actie van de schrijver zelf te vereisen, (2) een offline schrijver
// blokkeert niet — de viewer blijft gewoon op de laatst bekende serverstand
// staan, (3) na reconnect convergeren beide zonder dubbele/terugwerkende
// actie — de viewer se afgeleide historie (`deriveCloudGameHistory()`) komt
// exact overeen met de schrijver se lokale historie.
import { test, expect } from '@playwright/test';
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
import { FirestoreGameCloudGateway } from '../../src/infrastructure/game/FirestoreGameCloudGateway';
import {
  deriveCloudGameHistory,
  type CloudGameActionEnvelope,
} from '../../src/domain/game/deriveGameStateFromCloud';
import type { GameDocument } from 'firebase-base/documents';

test.setTimeout(90_000);

test('een live tweede-client-viewer ziet score-updates in real time, blijft werken terwijl de schrijver offline is, en convergeert na reconnect zonder dubbele actie', async ({
  page,
}) => {
  const identity = await registerPilotCoach(page, 'game-sync-live-viewer');
  const team = await seedPilotTeam(identity, 'game-sync-live-viewer');
  await seedPilotRoster(team);

  await openPilotTeam(page, team);
  await startTrackedGame(page);
  await waitForGameSyncStatus(page, 'gesynchroniseerd');
  const gameId = await readLocalGameId(page, team);

  const second = await connectAsSecondClient(identity.email, PILOT_PASSWORD);
  const gateway = new FirestoreGameCloudGateway(second.db);

  // Mutable container (i.p.v. losse `let`-variabelen) — TypeScript's
  // control-flow-analyse narrowt een `let` die alleen binnen een geneste
  // closure gereassigneerd wordt anders tot z'n declaratietype op elk
  // gebruikspunt in de buitenste functie, wat hier tot een onterechte
  // `never`-fout leidt; een object-property-toegang (`state.parent`) heeft
  // dat probleem niet.
  const state: {
    parent: GameDocument | null;
    actions: CloudGameActionEnvelope[];
    errorCount: number;
  } = { parent: null, actions: [], errorCount: 0 };
  const unsubscribe = gateway.subscribeToGame(team.orgId, team.teamId, gameId, {
    onParent: (update) => {
      state.parent = update.doc;
    },
    onActions: (update) => {
      state.actions = update.actions;
    },
    onError: () => {
      state.errorCount += 1;
    },
  });

  try {
    // 1. Live update terwijl A online scoort — geen enkele actie van de
    // viewer zelf nodig, alleen de listener.
    await page.getByTestId('score-plus2-for').click();
    await waitForGameSyncStatus(page, 'gesynchroniseerd');
    await expect.poll(() => state.parent?.scoreFor, { timeout: 10_000 }).toBe(2);
    expect(state.errorCount).toBe(0);

    // 2. Schrijver gaat offline — blijft lokaal ongehinderd scoren (werk 4);
    // de viewer blijft op de laatst bekende serverstand staan, geen crash.
    await page.context().setOffline(true);
    await page.getByTestId('score-plus3-against').click();
    await expect(page.getByTestId('score-select-against')).toHaveValue('3');
    await waitForGameSyncStatus(page, 'actie-nodig', 20_000);
    // De viewer ziet de offline actie nog niet — laatst bekende stand blijft staan.
    expect(state.parent?.scoreAgainst).toBe(0);

    // 3. Reconnect — schrijver haalt de achterstand in, viewer convergeert
    // vanzelf (geen page.reload(), puur de live listener).
    await page.context().setOffline(false);
    await waitForGameSyncStatus(page, 'gesynchroniseerd', 20_000);
    await expect.poll(() => state.parent?.scoreAgainst, { timeout: 10_000 }).toBe(3);
    await expect.poll(() => state.actions.length, { timeout: 10_000 }).toBe(2);

    // 4. Gelijkheid van de afgeleide historie op A (impliciet via scoreFor/
    // scoreAgainst hierboven, de "draaivelden") en op de viewer (expliciet
    // via dezelfde `deriveCloudGameHistory()`-reducer als de lokale writer
    // gebruikt) — geen dubbele/terugwerkende actie na reconnect.
    const history = deriveCloudGameHistory(state.actions);
    expect(history.scoreFor).toBe(2);
    expect(history.scoreAgainst).toBe(3);
    expect(state.errorCount).toBe(0);
  } finally {
    unsubscribe();
    await second.close();
  }
});
