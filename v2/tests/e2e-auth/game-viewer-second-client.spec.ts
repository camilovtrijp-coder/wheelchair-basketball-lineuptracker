// PR 7.3b emulator-e2e (docs/pr-7.3-plan.md §C 7.3b werk 5): bewijst
// `FirestoreGameViewerGateway` tegen de echte Firestore-/Auth-emulator en de
// echte firestore.rules — een onafhankelijke, apart ingelogde tweede client
// (dezelfde patroon als `game-sync-second-client-readback.spec.ts`, geen
// Admin SDK) ontdekt de actieve wedstrijd van apparaat A via de
// discoveryquery, ziet live updates binnenkomen zonder reload, blijft op de
// laatst servergesynchroniseerde stand staan terwijl apparaat A offline
// doorscoort (nooit een crash/stale-fout), en convergeert na reconnect —
// en meldt terecht "geen actieve wedstrijd" vóór tip-off en ná afronden.
import { test, expect } from '@playwright/test';
import {
  openPilotTeam,
  PILOT_PASSWORD,
  registerPilotCoach,
  seedPilotTeam,
} from './twoDeviceFixtures';
import {
  finishGameWithOneSegment,
  seedPilotRoster,
  startTrackedGame,
  waitForGameSyncStatus,
} from './gameSyncFixtures';
import { connectAsSecondClient } from './secondClientFixtures';
import { FirestoreGameViewerGateway } from '../../src/infrastructure/game/FirestoreGameViewerGateway';
import { deriveGameHistory } from '../../src/domain/game/tracking';
import type { ActiveGameViewerSnapshot } from '../../src/application/game/GameViewerGateway';

function collectSnapshots(gateway: FirestoreGameViewerGateway) {
  const snapshots: ActiveGameViewerSnapshot[] = [];
  const errors: unknown[] = [];
  const unsubscribe = gateway.subscribeActiveGame(
    (snapshot) => snapshots.push(snapshot),
    (error) => errors.push(error),
  );
  return { snapshots, errors, unsubscribe };
}

function lastScoreFor(snapshots: ActiveGameViewerSnapshot[]): number | null {
  const last = snapshots.at(-1);
  return last?.kind === 'active' ? deriveGameHistory(last.game).scoreFor : null;
}

test('een onafhankelijke tweede client ontdekt apparaat A se actieve wedstrijd, ziet live updates, en convergeert na reconnect', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const identity = await registerPilotCoach(page, 'game-viewer');
  const team = await seedPilotTeam(identity, 'game-viewer');
  await seedPilotRoster(team);

  const second = await connectAsSecondClient(identity.email, PILOT_PASSWORD);
  const gateway = new FirestoreGameViewerGateway(second.db, team.orgId, team.teamId);
  const { snapshots, errors, unsubscribe } = collectSnapshots(gateway);
  try {
    // Vóór tip-off: geen enkele wedstrijd van dit team staat op
    // 'tracking'/completedGameId:null — de discoveryquery meldt 'none'.
    await expect.poll(() => snapshots.at(-1)?.kind, { timeout: 15_000 }).toBe('none');

    await openPilotTeam(page, team);
    await startTrackedGame(page);
    await waitForGameSyncStatus(page, 'gesynchroniseerd');

    // Ontdekking: de tweede client vindt de wedstrijd zonder de gameId
    // vooraf te kennen, en herkent apparaat A als de writer.
    await expect.poll(() => snapshots.at(-1)?.kind, { timeout: 15_000 }).toBe('active');
    const discovered = snapshots.at(-1);
    if (discovered?.kind !== 'active') throw new Error('verwachtte kind:active');
    expect(discovered.writer.writerUid).toBe(identity.uid);
    expect(discovered.game.organizationId).toBe(team.orgId);
    expect(discovered.game.teamId).toBe(team.teamId);
    expect(lastScoreFor(snapshots)).toBe(0);

    // Live update zonder reload: apparaat A scoort +2.
    await page.getByTestId('score-plus2-for').click();
    await waitForGameSyncStatus(page, 'gesynchroniseerd');
    await expect.poll(() => lastScoreFor(snapshots), { timeout: 15_000 }).toBe(2);

    // Offline writer + online viewer: apparaat A gaat offline en scoort
    // lokaal door — de viewer (blijft online) mag dat NIET meezien vóórdat
    // het geüpload is, en mag zeker niet crashen of een foutstatus tonen.
    await page.context().setOffline(true);
    await page.getByTestId('score-plus3-for').click();
    await expect(page.getByTestId('score-select-for')).toHaveValue('5');
    await page.waitForTimeout(1_500);
    expect(lastScoreFor(snapshots)).toBe(2);
    expect(errors).toEqual([]);

    // Reconnect: beide apparaten convergeren op dezelfde stand, zonder
    // dubbele of terugwerkende actie.
    await page.context().setOffline(false);
    await waitForGameSyncStatus(page, 'gesynchroniseerd', 20_000);
    await expect.poll(() => lastScoreFor(snapshots), { timeout: 15_000 }).toBe(5);

    // Ná afronden: de wedstrijd krijgt server-side completedGameId != null en
    // valt uit de discoveryquery — de viewer meldt weer 'none', niet een
    // stale 'active' met de laatste bekende stand.
    await finishGameWithOneSegment(page);
    await expect.poll(() => snapshots.at(-1)?.kind, { timeout: 15_000 }).toBe('none');
    expect(errors).toEqual([]);
  } finally {
    unsubscribe();
    await second.close();
  }
});
