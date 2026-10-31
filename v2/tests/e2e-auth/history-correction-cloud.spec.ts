// PR 7.6c (docs/pr-7.6-plan.md §E 7.6c, besluiten §H): tweede-apparaat-e2e van
// de cloudcorrectie tegen de echte Auth-/Firestore-emulator MET echte Rules.
// Twee (of meer) onafhankelijke browsercontexten met dezelfde organisatie en
// hetzelfde team; fictieve data. Alleen tests en hulpen: de productiecode is
// ongewijzigd. Wacht overal op status-testids (`history-sync-status-<id>`),
// nooit op vaste sleeps. De standaard browserlocale in deze suite is en-US,
// dus teksten worden taalonafhankelijk via testids/attributen gecontroleerd.
import { expect, test, type Page } from '@playwright/test';
import { connectAsSecondClient } from './secondClientFixtures';
import {
  openPilotTeam,
  openSecondDevice,
  registerPilotCoach,
  seedPilotTeam,
  type PilotIdentity,
  type PilotTeam,
} from './twoDeviceFixtures';
import {
  finishGameWithOneSegment,
  readCompletedGameId,
  readLocalCompletedGameIds,
  seedPilotRoster,
  startTrackedGame,
} from './gameSyncFixtures';
import {
  correctFirstSegment,
  correctionLogCount,
  downloadCsv,
  expectSegmentValues,
  expectSyncStatus,
  firstCsvSegmentFields,
  firstSegment,
  joinTeamAs,
  openHistoryGame,
  readRecordedStatuses,
  readServerGame,
  recordStatusTransitions,
  syncStatus,
} from './correctionCloudFixtures';
import { correctSegment } from '../../src/domain/game/correction';
import { projectCompletedGameCorrection } from '../../src/application/game/projectCompletedGameForCloud';
import { FirestoreGameCloudGateway } from '../../src/infrastructure/game/FirestoreGameCloudGateway';
import { completedGamesStorageKey } from '../../src/infrastructure/game/LocalStorageCompletedGameRepository';
import type { CompletedGame } from '../../src/domain/game/types';

test.describe.configure({ timeout: 150_000 });

// Het ongecorrigeerde segment uit `finishGameWithOneSegment`: 3 voor, 1 tegen
// (plusminus +2), geen turnovers.
const ORIGINAL = { plusMinus: 2, turnovers: 0 };

interface FinishedGame {
  identity: PilotIdentity;
  team: PilotTeam;
  gameId: string;
}

/** Apparaat A: registreren, team seeden, een wedstrijd spelen, afronden en laten synchroniseren. */
async function finishAndSyncOnDeviceA(page: Page, label: string): Promise<FinishedGame> {
  const identity = await registerPilotCoach(page, label);
  const team = await seedPilotTeam(identity, label);
  await seedPilotRoster(team);
  await openPilotTeam(page, team);
  await startTrackedGame(page);
  await finishGameWithOneSegment(page);
  const gameId = await readCompletedGameId(page, team.orgId, team.teamId);
  await expectSyncStatus(page, gameId, 'gesynchroniseerd', 30_000);
  return { identity, team, gameId };
}

async function expectCorrectedOnDevice(
  page: Page,
  gameId: string,
  values: { plusMinus: number; turnovers: number },
): Promise<void> {
  await openHistoryGame(page, gameId);
  await expect(page.getByTestId('history-corrected-badge')).toBeVisible();
  await expectSegmentValues(page, values);
}

test('1. A corrigeert online: B ziet live de badge en de nieuwe waarden (detail, CSV); A loopt via wachten naar Gesynchroniseerd', async ({
  browser,
  page,
}) => {
  const { identity, team, gameId } = await finishAndSyncOnDeviceA(page, 'corr-basis');

  const second = await openSecondDevice(browser, identity, team);
  try {
    // B heeft de wedstrijd (cloud-only) en ziet hem nog zonder badge.
    await second.page.getByTestId('nav-history').click();
    await expect(second.page.getByTestId(`history-item-${gameId}`)).toBeVisible({
      timeout: 30_000,
    });
    await expect(second.page.getByTestId(`history-item-corrected-${gameId}`)).toHaveCount(0);

    // A corrigeert; we leggen alle statusovergangen vast om geen vals succes te missen.
    await openHistoryGame(page, gameId);
    await expectSegmentValues(page, ORIGINAL);
    await recordStatusTransitions(page, gameId);
    await correctFirstSegment(page, { pf: 7, tov: 2 });
    await expect(page.getByTestId('history-corrected-badge')).toBeVisible();
    await expectSyncStatus(page, gameId, 'gesynchroniseerd');
    const transitions = await readRecordedStatuses(page);
    expect(transitions).toContain('wacht-op-synchronisatie');
    expect(transitions[transitions.length - 1]).toBe('gesynchroniseerd');

    // Geen vals succes: 'Gesynchroniseerd' betekent dat de server de correctie heeft.
    const server = await readServerGame(team, gameId);
    expect(server.revision).toBe(1);
    expect(server.corrections).toHaveLength(1);
    expect(server.corrections[0]!.by).toBe(identity.uid);
    expect(server.scoreFor).toBe(7);
    expect(server.scoreAgainst).toBe(1);

    // B ziet de badge uit zichzelf (live listener) in de lijst, daarna de nieuwe waarden.
    await expect(second.page.getByTestId(`history-item-corrected-${gameId}`)).toBeVisible({
      timeout: 30_000,
    });
    await expectCorrectedOnDevice(second.page, gameId, { plusMinus: 6, turnovers: 2 });
    await expectSyncStatus(second.page, gameId, 'gesynchroniseerd');
    expect(await correctionLogCount(second.page)).toBe(1);

    // CSV van B bevat de nieuwe segmentwaarden: pf 7, pa 1, plusminus 6, turnovers 2.
    const fields = firstCsvSegmentFields(await downloadCsv(second.page));
    expect(fields.slice(5, 8)).toEqual(['7', '1', '6']);
    expect(fields[fields.length - 1]).toBe('2');
  } finally {
    await second.context.close();
  }
});

test('2. A corrigeert offline: lokaal bewaard (wacht), na reconnect uit zichzelf geüpload, precies één logregel, B ziet haar', async ({
  browser,
  page,
  context,
}) => {
  const { identity, team, gameId } = await finishAndSyncOnDeviceA(page, 'corr-offline');
  await openHistoryGame(page, gameId);

  await context.setOffline(true);
  await correctFirstSegment(page, { pf: 6, tov: 1 });

  // Lokaal staat de correctie er direct, maar zonder serverbevestiging.
  await expect(page.getByTestId('history-corrected-badge')).toBeVisible();
  await expectSegmentValues(page, { plusMinus: 5, turnovers: 1 });
  await expect
    .poll(async () => syncStatus(page, gameId).getAttribute('data-status'), { timeout: 20_000 })
    .toBe('wacht-op-synchronisatie');
  await expect(page.getByTestId('history-correction-hint')).toBeVisible();
  expect((await readServerGame(team, gameId)).corrections).toHaveLength(0);
  expect(await readLocalCompletedGameIds(page, team.orgId, team.teamId)).toContain(gameId);

  // Reconnect: geen handmatige actie, de correctie wordt uit zichzelf geüpload.
  await context.setOffline(false);
  await expectSyncStatus(page, gameId, 'gesynchroniseerd', 60_000);
  const server = await readServerGame(team, gameId);
  expect(server.revision).toBe(1);
  expect(server.corrections).toHaveLength(1);
  expect(await correctionLogCount(page)).toBe(1);

  const second = await openSecondDevice(browser, identity, team);
  try {
    await expectCorrectedOnDevice(second.page, gameId, { plusMinus: 5, turnovers: 1 });
    expect(await correctionLogCount(second.page)).toBe(1);
  } finally {
    await second.context.close();
  }
  // Nog steeds precies één logregel op de server (geen late dubbele upload).
  expect((await readServerGame(team, gameId)).corrections).toHaveLength(1);
});

test('3. Cloud-only: een alleen op A afgeronde wedstrijd wordt op B gecorrigeerd; de correctie komt terug bij A', async ({
  browser,
  page,
}) => {
  const { identity, team, gameId } = await finishAndSyncOnDeviceA(page, 'corr-cloudonly');

  const second = await openSecondDevice(browser, identity, team);
  try {
    // B heeft de wedstrijd nooit lokaal gehad.
    expect(await readLocalCompletedGameIds(second.page, team.orgId, team.teamId)).not.toContain(
      gameId,
    );
    await openHistoryGame(second.page, gameId);
    await expectSyncStatus(second.page, gameId, 'gesynchroniseerd');
    await correctFirstSegment(second.page, { pf: 5, pa: 2, tov: 3 });
    // De correctie van B komt server-bevestigd op de server en B toont daarna
    // 'Gesynchroniseerd' (een lokale kopie zonder checkpoint met bevestigde cloudkopie).
    await expectSyncStatus(second.page, gameId, 'gesynchroniseerd', 30_000);
    await expect
      .poll(async () => (await readServerGame(team, gameId)).corrections.length, {
        timeout: 30_000,
      })
      .toBe(1);
    const server = await readServerGame(team, gameId);
    expect(server.revision).toBe(1);
    expect(server.corrections[0]!.by).toBe(identity.uid);

    // A (had een lokale kopie) krijgt de correctie via de samenvoeging terug.
    await expect(page.getByTestId('history-corrected-badge')).toBeVisible({ timeout: 30_000 });
    await expectSegmentValues(page, { plusMinus: 3, turnovers: 3 });
    await expectSyncStatus(page, gameId, 'gesynchroniseerd');
    expect(await correctionLogCount(page)).toBe(1);
  } finally {
    await second.context.close();
  }
});

test('3b. Cloud-only gecorrigeerd op B: B toont daarna Gesynchroniseerd en blijft corrigeerbaar', async ({
  browser,
  page,
}) => {
  const { identity, team, gameId } = await finishAndSyncOnDeviceA(page, 'corr-cloudonly-b');
  const second = await openSecondDevice(browser, identity, team);
  try {
    await openHistoryGame(second.page, gameId);
    await correctFirstSegment(second.page, { pf: 5, pa: 2, tov: 3 });
    await expectSyncStatus(second.page, gameId, 'gesynchroniseerd', 15_000);
    await expect(second.page.getByTestId('history-correction-waiting')).toHaveCount(0);
    await expect(second.page.getByTestId('history-correct-hint')).toBeVisible();
  } finally {
    await second.context.close();
  }
});

test('4. Conflict: A en B corrigeren dezelfde wedstrijd; B krijgt conflict, verwerpt bewust zijn lokale versie, ziet die van A en kan opnieuw corrigeren', async ({
  browser,
  page,
}) => {
  const { identity, team, gameId } = await finishAndSyncOnDeviceA(page, 'corr-conflict');

  const second = await openSecondDevice(browser, identity, team);
  const b = second.page;
  try {
    await openHistoryGame(b, gameId);
    await expectSyncStatus(b, gameId, 'gesynchroniseerd');

    // B corrigeert offline (neemt de cloudkopie eerst lokaal op) ...
    await second.context.setOffline(true);
    await correctFirstSegment(b, { pf: 5, tov: 4 });
    await expectSegmentValues(b, { plusMinus: 4, turnovers: 4 });
    await expect
      .poll(async () => syncStatus(b, gameId).getAttribute('data-status'), { timeout: 20_000 })
      .toBe('wacht-op-synchronisatie');

    // ... terwijl A (online) eerst corrigeert en de server bevestigt.
    await openHistoryGame(page, gameId);
    await correctFirstSegment(page, { pf: 8, tov: 2 });
    await expectSyncStatus(page, gameId, 'gesynchroniseerd');
    const afterA = await readServerGame(team, gameId);
    expect(afterA.revision).toBe(1);
    expect(afterA.corrections).toHaveLength(1);

    // B komt online: de logs zijn uiteengelopen, dus conflict met melding; niets overschreven.
    await second.context.setOffline(false);
    await expectSyncStatus(b, gameId, 'conflict', 60_000);
    await expect(b.getByTestId('history-correction-conflict')).toBeVisible();
    const afterConflict = await readServerGame(team, gameId);
    expect(afterConflict.revision).toBe(1);
    expect(afterConflict.corrections).toHaveLength(1);
    expect(afterConflict.corrections[0]!.id).toBe(afterA.corrections[0]!.id);
    await expectSegmentValues(b, { plusMinus: 4, turnovers: 4 }); // eigen lokale versie blijft staan

    // Annuleren laat alles ongemoeid.
    await b.getByTestId('history-correction-discard-btn').click();
    await expect(b.getByTestId('history-correction-discard-dialog')).toBeVisible();
    await expect(b.getByTestId('history-correction-discard-text')).toBeVisible();
    await b.getByTestId('history-correction-discard-cancel').click();
    await expect(b.getByTestId('history-correction-discard-dialog')).toHaveCount(0);
    await expectSyncStatus(b, gameId, 'conflict', 5_000);
    expect(await readLocalCompletedGameIds(b, team.orgId, team.teamId)).toContain(gameId);
    await expectSegmentValues(b, { plusMinus: 4, turnovers: 4 });

    // Bevestigen verwerpt alleen de lokale kopie van B; B toont daarna de versie van A.
    await b.getByTestId('history-correction-discard-btn').click();
    await b.getByTestId('history-correction-discard-confirm').click();
    await expect(b.getByTestId('history-correction-discard-dialog')).toHaveCount(0);
    await expect(b.getByTestId('history-correction-conflict')).toHaveCount(0);
    await expectSyncStatus(b, gameId, 'gesynchroniseerd');
    expect(await readLocalCompletedGameIds(b, team.orgId, team.teamId)).not.toContain(gameId);
    await expectSegmentValues(b, { plusMinus: 7, turnovers: 2 });
    expect(await correctionLogCount(b)).toBe(1);

    // De cloud is onaangeroerd en de wedstrijd bestaat nog voor het team (geen tombstone).
    const afterDiscard = await readServerGame(team, gameId);
    expect(afterDiscard.deletedAt).toBeNull();
    expect(afterDiscard.revision).toBe(1);
    expect(afterDiscard.corrections).toHaveLength(1);
    await openHistoryGame(page, gameId);
    await expect(page.getByTestId('history-corrected-badge')).toBeVisible();
    await expectSegmentValues(page, { plusMinus: 7, turnovers: 2 });
    await expectSyncStatus(page, gameId, 'gesynchroniseerd');

    // Daarna kan B opnieuw corrigeren en dat wordt geüpload.
    await correctFirstSegment(b, { pf: 6, tov: 1 });
    await expectSyncStatus(b, gameId, 'gesynchroniseerd', 30_000);
    await expect(b.getByTestId('history-correct-hint')).toBeVisible();
    await expect
      .poll(async () => (await readServerGame(team, gameId)).corrections.length, {
        timeout: 30_000,
      })
      .toBe(2);
    const final = await readServerGame(team, gameId);
    expect(final.revision).toBe(2);
    expect(final.corrections).toHaveLength(2);
    expect(final.deletedAt).toBeNull();
    await expectSegmentValues(page, { plusMinus: 5, turnovers: 1 });
    expect(await correctionLogCount(page)).toBe(2);
  } finally {
    await second.context.close();
  }
});

test('5. Rechten: scorer en viewer kunnen niet corrigeren (UI) en de Rules weigeren hun schrijfpoging', async ({
  browser,
  page,
}) => {
  const { identity, team, gameId } = await finishAndSyncOnDeviceA(page, 'corr-rechten');

  const scorer = await joinTeamAs(browser, team, 'scorer', 'corr-scorer');
  const viewer = await joinTeamAs(browser, team, 'viewer', 'corr-viewer');
  try {
    for (const member of [scorer, viewer]) {
      await openHistoryGame(member.page, gameId);
      // Wel leesbaar, niet aantikbaar: een <div> i.p.v. een knop, geen hint, geen verwerp-/retryknop.
      await expectSegmentValues(member.page, ORIGINAL);
      expect(await firstSegment(member.page).evaluate((el) => el.tagName)).toBe('DIV');
      await expect(member.page.getByTestId('history-correct-hint')).toHaveCount(0);
      await expect(member.page.getByTestId('history-correction-waiting')).toHaveCount(0);
      await expect(member.page.getByTestId('history-correction-retry-btn')).toHaveCount(0);
      await expect(member.page.getByTestId('history-correction-discard-btn')).toHaveCount(0);
      await expect(member.page.getByTestId('correct-segment-modal')).toHaveCount(0);
    }

    // Eén korte Rules-controle met een echt, geldig correctiepayload (via de
    // eigen gateway van de app): scorer/viewer worden geweigerd en de server
    // blijft onveranderd; dezelfde payload slaagt voor de coach (positieve
    // controle, zodat de weigering aan de rol ligt en niet aan de vorm).
    const raw = await page.evaluate(
      (key) => localStorage.getItem(key),
      completedGamesStorageKey(team.orgId, team.teamId),
    );
    const game = (JSON.parse(raw!) as CompletedGame[]).find((g) => g.id === gameId)!;
    const result = correctSegment(game, game.segments[0]!.id, { pf: 9 }, null);
    if (!result.ok) throw new Error(`correctSegment faalde: ${result.error}`);
    const payload = projectCompletedGameCorrection(result.game, result.correction)!;

    for (const member of [scorer, viewer]) {
      const client = await connectAsSecondClient(member.email, member.password);
      try {
        const outcome = await new FirestoreGameCloudGateway(client.db, 5_000).correctCompletedGame(
          team.orgId,
          team.teamId,
          gameId,
          0,
          payload,
        );
        expect(outcome.ok).toBe(false);
        expect((outcome.error as { code?: string } | undefined)?.code).toBe('permission-denied');
      } finally {
        await client.close();
      }
    }
    const unchanged = await readServerGame(team, gameId);
    expect(unchanged.revision).toBe(0);
    expect(unchanged.corrections).toHaveLength(0);

    const coachClient = await connectAsSecondClient(identity.email, identity.password);
    try {
      const outcome = await new FirestoreGameCloudGateway(
        coachClient.db,
        5_000,
      ).correctCompletedGame(team.orgId, team.teamId, gameId, 0, payload);
      expect(outcome.ok).toBe(true);
    } finally {
      await coachClient.close();
    }
    expect((await readServerGame(team, gameId)).corrections).toHaveLength(1);
  } finally {
    await scorer.context.close();
    await viewer.context.close();
  }
});

test('6. Cross-org: een gebruiker van een andere organisatie ziet de wedstrijd niet (UI en Rules)', async ({
  browser,
  page,
}) => {
  const { team, gameId } = await finishAndSyncOnDeviceA(page, 'corr-org-a');

  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  try {
    const other = await registerPilotCoach(otherPage, 'corr-org-b');
    const otherTeam = await seedPilotTeam(other, 'corr-org-b');
    await openPilotTeam(otherPage, otherTeam);
    await otherPage.getByTestId('nav-history').click();
    await expect(otherPage.getByTestId('history-empty')).toBeVisible({ timeout: 30_000 });
    await expect(otherPage.getByTestId(`history-item-${gameId}`)).toHaveCount(0);

    // Rules: lezen van het document van de andere organisatie wordt geweigerd.
    const client = await connectAsSecondClient(other.email, other.password);
    try {
      const { doc, getDoc } = await import('firebase/firestore');
      await expect(
        getDoc(
          doc(
            client.db,
            'organizations',
            team.orgId,
            'teams',
            team.teamId,
            'completedGames',
            gameId,
          ),
        ),
      ).rejects.toMatchObject({ code: 'permission-denied' });
    } finally {
      await client.close();
    }
  } finally {
    await otherContext.close();
  }
});

test('7. Geblokkeerd tijdens een onbevestigde afronding: corrigeren staat uit tot de afronding server-bevestigd is', async ({
  browser,
  page,
  context,
}) => {
  const identity = await registerPilotCoach(page, 'corr-blok');
  const team = await seedPilotTeam(identity, 'corr-blok');
  await seedPilotRoster(team);
  await openPilotTeam(page, team);
  await startTrackedGame(page);

  // Offline spelen en afronden: de afronding wacht in de outbox.
  await context.setOffline(true);
  await page.getByTestId('score-plus3-for').click();
  await page.getByTestId('score-plus1-against').click();
  await page.getByTestId('end-min').selectOption('5');
  await page.getByTestId('save-segment-btn').click();
  await expect(page.locator('[data-testid^="segment-item-"]')).toHaveCount(1);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('finish-game-btn').click();
  await expect(page.getByTestId('history-back-btn')).toBeVisible();
  const gameId = await readCompletedGameId(page, team.orgId, team.teamId);

  await expect
    .poll(async () => syncStatus(page, gameId).getAttribute('data-status'), { timeout: 20_000 })
    .toMatch(/^(wacht-op-synchronisatie|lokaal-beschikbaar)$/);
  await expect(page.getByTestId('history-correction-waiting')).toBeVisible();
  await expect(page.getByTestId('history-correct-hint')).toHaveCount(0);
  expect(await firstSegment(page).evaluate((el) => el.tagName)).toBe('DIV');

  // Reconnect: de afronding wordt bevestigd en corrigeren komt beschikbaar.
  await context.setOffline(false);
  await expectSyncStatus(page, gameId, 'gesynchroniseerd', 90_000);
  await expect(page.getByTestId('history-correction-waiting')).toHaveCount(0);
  await expect(page.getByTestId('history-correct-hint')).toBeVisible();
  expect(await firstSegment(page).evaluate((el) => el.tagName)).toBe('BUTTON');

  await correctFirstSegment(page, { pf: 4, tov: 1 });
  await expectSyncStatus(page, gameId, 'gesynchroniseerd');
  expect((await readServerGame(team, gameId)).corrections).toHaveLength(1);

  const second = await openSecondDevice(browser, identity, team);
  try {
    await expectCorrectedOnDevice(second.page, gameId, { plusMinus: 3, turnovers: 1 });
  } finally {
    await second.context.close();
  }
});
