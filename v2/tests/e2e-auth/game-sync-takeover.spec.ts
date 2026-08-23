// PR 7.3c emulator-e2e (docs/pr-7.3-plan.md §C 7.3c werk 1/2/4): bewijst de
// nieuwe overname-bevestigingsflow (`ui/game/TakeoverConfirmDialog.tsx`,
// `app/App.tsx`'s "Overnemen…"-knop) end-to-end tegen de ECHTE Firestore-
// emulator, met firestore.rules' 10d-overnamepad daadwerkelijk gehandhaafd.
//
// Twee-apparatenpatroon (zelfde als game-sync-live-viewer.spec.ts/
// game-sync-second-client-readback.spec.ts): apparaat A is de echte browser-
// app (Playwright `page`); apparaat B is een onafhankelijke, apart
// ingelogde tweede client (`connectAsSecondClient()`, Node-side, ECHTE
// client-SDK + Rules — geen Admin-SDK-omzeiling) die rechtstreeks
// `FirestoreGameCloudGateway.takeoverWriter()` aanroept met een AFWIJKENDE
// `deviceId` (dezelfde coach-uid, want dat is in deze pilotopzet de enige
// beschikbare rol — een overname-conflict draait om `deviceId`, niet om
// `uid`, zie firestore.rules punt 10d).
//
// Dekt: (1) de oude schrijver (A) ziet zijn eigen sync na een ECHTE overname
// zichtbaar `actie-nodig` worden (geen force-push, geen stille dataverlies —
// §D "Geen force-push van oude actions naar een nieuwe epoch"), (2) de
// live-viewerbanner + "Overnemen…"-knop verschijnen op A en tonen de huidige
// writer/laatste serveractiviteit, (3) een bevestigde overname door A zelf
// (terugnemen) werkt end-to-end door de UI heen — nieuwe epoch, schrijven
// hervat zonder reload, (4) de wedstrijd is daarna gewoon afrondbaar
// (werk 4's "afronden"-scenario).
import { test, expect } from '@playwright/test';
import {
  openPilotTeam,
  PILOT_PASSWORD,
  registerPilotCoach,
  seedPilotTeam,
} from './twoDeviceFixtures';
import {
  finishGameWithOneSegment,
  readLocalGameId,
  seedPilotRoster,
  startTrackedGame,
  waitForGameSyncStatus,
} from './gameSyncFixtures';
import { connectAsSecondClient } from './secondClientFixtures';
import { FirestoreGameCloudGateway } from '../../src/infrastructure/game/FirestoreGameCloudGateway';

test.setTimeout(90_000);

test('een echte overname door een ander apparaat wordt zichtbaar/auditbaar op de oude schrijver, en terugnemen via de UI hervat het schrijverschap', async ({
  page,
}) => {
  const identity = await registerPilotCoach(page, 'game-sync-takeover');
  const team = await seedPilotTeam(identity, 'game-sync-takeover');
  await seedPilotRoster(team);

  await openPilotTeam(page, team);
  await startTrackedGame(page);
  await waitForGameSyncStatus(page, 'gesynchroniseerd');

  // Apparaat A scoort één keer, gesynchroniseerd — bewijst dat er
  // server-bevestigde activiteit (`lastWriterActivityAt`) is vóórdat B
  // overneemt, en dat A daarna nog een 2e sync-cyclus start die op het
  // conflict stuit (i.p.v. dat de eerste al 'actie-nodig' zou zijn).
  await page.getByTestId('score-plus1-for').click();
  await waitForGameSyncStatus(page, 'gesynchroniseerd');

  const second = await connectAsSecondClient(identity.email, PILOT_PASSWORD);
  const gatewayB = new FirestoreGameCloudGateway(second.db);

  try {
    const gameId = await readLocalGameId(page, team);

    // Apparaat B leest de actuele epoch/revisie via z'n eigen (Rules-
    // gehandhaafde) ensureGame()-aanroep, exact zoals de echte
    // overname-bevestigingsflow dat zou doen (`GameSyncCoordinator.
    // takeoverWriter()` verwacht een vooraf gelezen epoch/revisie). Het
    // document bestaat al (apparaat A maakte het aan) — dit
    // fallback-snapshot wordt dus nooit daadwerkelijk geschreven, alleen de
    // vorm moet een geldige `GameSnapshotProjection` zijn.
    const ensured = await gatewayB.ensureGame(team.orgId, team.teamId, gameId, {
      organizationId: team.orgId,
      teamId: team.teamId,
      phase: 'tracking',
      players: [],
      opponent: '',
      competition: '',
      clockDown: true,
      limitStr: '',
      onCourt: [],
      curQuarter: 1,
      beginSec: 0,
      endSec: 0,
      pendingSwapLineup: null,
      scoreFor: 0,
      scoreAgainst: 0,
      segmentCount: 0,
      writerUid: null,
      deviceId: null,
      writerEpoch: 0,
      claimedAt: null,
      lastWriterActivityAt: null,
      revision: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedGameId: null,
    });
    expect(ensured.ok).toBe(true);
    const expectedEpoch = ensured.writerEpoch ?? 0;
    const expectedRevision = ensured.revision ?? 0;

    const takeover = await gatewayB.takeoverWriter(
      team.orgId,
      team.teamId,
      gameId,
      { authorUid: identity.uid, deviceId: 'apparaat-B' },
      expectedEpoch,
      expectedRevision,
      new Date().toISOString(),
    );
    expect(takeover.ok).toBe(true);
    if (!takeover.ok) throw new Error('takeover mislukt');
    expect(takeover.identity.writerEpoch).toBe(expectedEpoch + 1);
    expect(takeover.identity.deviceId).toBe('apparaat-B');

    // Apparaat A weet nog niets van de overname — z'n volgende lokale actie
    // start gewoon een nieuwe sync-cyclus die nu op het conflict stuit.
    // Geen force-push, geen crash: alleen zichtbaar 'actie-nodig'.
    await page.getByTestId('score-plus1-for').click();
    await waitForGameSyncStatus(page, 'actie-nodig');

    // De live-viewerbanner verschijnt op A zodra de eigen
    // parent-listener de epoch-bevorderde overname ziet
    // (`isEpochPromotedTakeover()`), met de nieuwe "Overnemen…"-knop.
    await expect(page.getByTestId('cloud-viewer-banner')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('takeover-open-btn').click();

    await expect(page.getByTestId('takeover-confirm-dialog')).toBeVisible();
    // Toont de huidige (ANDERE) writer — apparaat B — en een bekende
    // laatste serveractiviteit (niet "nog nooit", want A had al gesynct).
    await expect(page.getByTestId('takeover-current-writer')).toContainText('apparaat');
    await expect(page.getByTestId('takeover-last-activity')).not.toContainText('nog nooit');

    // Bevestigt de overname vanuit de UI — A neemt het schrijverschap
    // terug, een nieuwe epoch (3), zonder reload.
    await page.getByTestId('takeover-confirm-btn').click();
    await expect(page.getByTestId('takeover-confirm-dialog')).not.toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('cloud-viewer-banner')).not.toBeVisible();

    // Schrijven werkt weer meteen door, zonder paginaherlaad.
    await page.getByTestId('score-plus1-for').click();
    await waitForGameSyncStatus(page, 'gesynchroniseerd', 20_000);
    await expect(page.getByTestId('score-select-for')).toHaveValue('3');

    // Werk 4 "afronden": de wedstrijd blijft na een overname gewoon
    // afrondbaar via de normale flow.
    await finishGameWithOneSegment(page);
  } finally {
    await second.close();
  }
});
