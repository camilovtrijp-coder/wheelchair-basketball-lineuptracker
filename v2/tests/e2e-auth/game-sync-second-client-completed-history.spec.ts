// PR 7.2b emulator-e2e (docs/pr-7.2-plan.md §C 7.2b werk 5): bewijst dat een
// op apparaat A afgeronde wedstrijd zonder reload op apparaat B verschijnt —
// via de UI zelf (Historie-tab), niet via een rechtstreekse Firestore-lezing
// zoals game-sync-second-client-readback.spec.ts (die dekt PR 7.1c's
// parentdocument/actielog, dit dekt PR 7.2b's `completedGames`-query en de
// `CompositeCompletedGameRepository`-samenvoeging in de echte App-UI, mét
// echte Rules gehandhaafd via `openSecondDevice()` — dezelfde ingelogde
// coach-identiteit, een volledig aparte browsercontext/Firestore-verbinding).
import { expect, test } from '@playwright/test';
import {
  openPilotTeam,
  openSecondDevice,
  registerPilotCoach,
  seedPilotTeam,
} from './twoDeviceFixtures';
import {
  finishGameWithOneSegment,
  readCompletedGameId,
  seedPilotRoster,
  startTrackedGame,
} from './gameSyncFixtures';

test('apparaat B ziet een op apparaat A afgeronde wedstrijd zonder reload, via de echte Historie-UI en echte Rules', async ({
  browser,
  page,
}) => {
  const identity = await registerPilotCoach(page, 'completed-history');
  const team = await seedPilotTeam(identity, 'completed-history');
  await seedPilotRoster(team);

  await openPilotTeam(page, team);
  await startTrackedGame(page);
  await finishGameWithOneSegment(page);

  const completedId = await readCompletedGameId(page, team.orgId, team.teamId);

  // Apparaat A's eigen historie-item toont 'gesynchroniseerd' zodra
  // `GameSyncCoordinator.finalize()` server-bevestigd is (PR 7.2a) — dat
  // bewijst dat de cloud-snapshot daadwerkelijk bestaat vóórdat apparaat B
  // hieronder gecontroleerd wordt (voorkomt een race met de finalize-upload).
  await expect(page.getByTestId(`history-sync-status-${completedId}`)).toHaveAttribute(
    'data-status',
    'gesynchroniseerd',
    { timeout: 20_000 },
  );

  // Onafhankelijk tweede apparaat: eigen browsercontext, eigen Auth-sessie,
  // eigen Firestore-verbinding — dezelfde coach-identiteit (canReadTeam
  // vereist alleen teamlidmaatschap, geen specifiek apparaat).
  const second = await openSecondDevice(browser, identity, team);
  try {
    await second.page.getByTestId('nav-history').click();

    // Nooit lokaal opgeslagen op apparaat B — uitsluitend zichtbaar via de
    // `CompositeCompletedGameRepository`-cloudquery (PR 7.2b). Geen reload
    // nodig: de live `subscribe()`-listener duwt de update door.
    await expect(second.page.getByTestId(`history-item-${completedId}`)).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      second.page.getByTestId(`history-item-${completedId}`).locator('.history-item__score'),
    ).toHaveText('3 - 1');

    // Een cloud-only item (nooit lokaal op DIT apparaat opgeslagen) is per
    // definitie al server-bevestigd, zie `app/App.tsx`'s
    // `finalizeStatuses`-effect (PR 7.2b-uitbreiding).
    await expect(second.page.getByTestId(`history-sync-status-${completedId}`)).toHaveAttribute(
      'data-status',
      'gesynchroniseerd',
    );

    // Lijstbrede cloud-syncindicator (plan §C 7.2b werk 4): toont dat de
    // getoonde historie server-actueel is, niet alleen lokale cache.
    await expect(second.page.getByTestId('history-cloud-sync-status')).toBeVisible();
  } finally {
    await second.context.close();
  }
});
