// PR 7.2c emulator-e2e (docs/pr-7.2-plan.md §C 7.2c werk 5): bewijst de
// tombstone-flow tegen de echte Firestore-/Auth-emulator, met echte Rules —
// niet alleen de unit-testfakes in `CompositeCompletedGameRepository.spec.ts`/
// `AppTombstoneDelete.spec.tsx`. Apparaat A rondt af en verwijdert via de
// echte 'Verwijderen'-knop (coach-rol); apparaat B (een onafhankelijke
// browsercontext/Firestore-verbinding, geopend NA de tombstone) ziet het item
// nooit — bewijst dat een later apparaat de tombstone leert i.p.v. het
// verwijderde item alsnog te tonen (resurrectie-preventie). Een directe
// Admin-SDK-lezing bevestigt de serverkant: `deletedAt`/`deletedBy` gezet,
// de bevroren wedstrijdinhoud (score/segmenten) ongewijzigd.
import { expect, test } from '@playwright/test';
import {
  openPilotTeam,
  openSecondDevice,
  registerPilotCoach,
  seedPilotTeam,
} from './twoDeviceFixtures';
import {
  SYNC_WAIT_TIMEOUT_MS,
  finishGameWithOneSegment,
  readCompletedGameId,
  readLocalCompletedGameIds,
  seedPilotRoster,
  startTrackedGame,
} from './gameSyncFixtures';
import { adminDb } from './adminFixtures';

// Meerdere sequentiële conditionele waits (finishGameWithOneSegment() intern,
// plus history-sync-status/-back-btn/-empty/-tombstone-notice hieronder),
// elk tot SYNC_WAIT_TIMEOUT_MS (45s) in het worstcasepad — zie
// gameSyncFixtures.ts voor de onderbouwing. Alleen deze twee tests krijgen de
// ruimere testtimeout, geen suitebrede wijziging.
test.setTimeout(300_000);

test('apparaat A verwijdert (tombstone) een afgeronde wedstrijd; apparaat B ziet het item nooit, server-kant bevestigt deletedAt/deletedBy en behoudt de bevroren inhoud', async ({
  browser,
  page,
}) => {
  const identity = await registerPilotCoach(page, 'tombstone');
  const team = await seedPilotTeam(identity, 'tombstone');
  await seedPilotRoster(team);

  await openPilotTeam(page, team);
  await startTrackedGame(page);
  await finishGameWithOneSegment(page);

  const completedId = await readCompletedGameId(page, team.orgId, team.teamId);

  await expect(page.getByTestId(`history-sync-status-${completedId}`)).toHaveAttribute(
    'data-status',
    'gesynchroniseerd',
    { timeout: SYNC_WAIT_TIMEOUT_MS },
  );

  // 'Afronden' laat het net afgeronde item al open staan — de detailweergave
  // toont daar de 'Verwijderen'-knop (coach mag, zie firestore.rules'
  // completedGames-update-regel/`canManageTeamData`).
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('history-delete-btn').click();

  // Server-bevestigd verwijderd: het item verdwijnt uit apparaat A's eigen
  // lijst (terug naar de lijstweergave, geen 'geen wedstrijden' nog niet
  // — de tombstone-patch zelf is de server-round-trip, geen losse readback
  // nodig, zie `CompositeCompletedGameRepository.tombstone()`).
  await expect(page.getByTestId('history-back-btn')).toHaveCount(0, {
    timeout: SYNC_WAIT_TIMEOUT_MS,
  });
  await expect(page.getByTestId(`history-item-${completedId}`)).toHaveCount(0);

  // Serverkant, rechtstreeks via Admin SDK (buiten Rules/UI om): tombstone
  // gezet, bevroren inhoud (score/segmenten) letterlijk ongewijzigd.
  const completedRef = adminDb().doc(
    `organizations/${team.orgId}/teams/${team.teamId}/completedGames/${completedId}`,
  );
  const snapshot = await completedRef.get();
  expect(snapshot.exists).toBe(true);
  const data = snapshot.data()!;
  expect(data.deletedAt).not.toBeNull();
  expect(data.deletedBy).toBe(identity.uid);
  expect(data.scoreFor).toBe(3);
  expect(data.scoreAgainst).toBe(1);
  expect(data.segments).toHaveLength(1);

  // Apparaat B, geopend NA de tombstone: onafhankelijke browsercontext/
  // Firestore-verbinding, dezelfde coach-identiteit. Ziet het item nooit —
  // niet via de cloudquery (getombstoned items worden serverzijdig gewoon
  // teruggegeven, maar `CompositeCompletedGameRepository.mergeGames()`
  // filtert ze altijd uit de zichtbare lijst) en zeker niet via een lokale
  // kopie (dit apparaat heeft de wedstrijd nooit lokaal gehad).
  const second = await openSecondDevice(browser, identity, team);
  try {
    await second.page.getByTestId('nav-history').click();
    await expect(second.page.getByTestId('history-empty')).toBeVisible({
      timeout: SYNC_WAIT_TIMEOUT_MS,
    });
    await expect(second.page.getByTestId(`history-item-${completedId}`)).toHaveCount(0);
  } finally {
    await second.context.close();
  }
});

// PR 7.2c, externe review op PR #65 (P1 — het letterlijke 7.2c-
// acceptatiecriterium "een late client verliest zijn lokale bron niet stil
// en de zichtbare status verklaart wat herstel vraagt"): dit dekt het
// scenario dat de test hierboven NIET dekt — een apparaat dat de wedstrijd
// AL lokaal had (het heeft 'm zelf afgerond), offline gaat, en pas NA een
// tombstone door een ander apparaat weer online komt. Bewijst: (1) de lokale
// kopie verdwijnt uit localStorage zodra dit apparaat de tombstone leert
// (geen resurrectie NA reconnect, en geen stille state die achterblijft), en
// (2) een zichtbare banner verklaart WAAROM ("verwijderd door een
// teamgenoot"), i.p.v. het item gewoon te laten verdwijnen.
test("apparaat A (offline, had de wedstrijd al lokaal) leert bij reconnect dat apparaat B 'm intussen tombstoned heeft — lokale bron verdwijnt niet stil, banner verklaart waarom", async ({
  browser,
  page,
  context,
}) => {
  const identity = await registerPilotCoach(page, 'tombstone-late');
  const team = await seedPilotTeam(identity, 'tombstone-late');
  await seedPilotRoster(team);

  await openPilotTeam(page, team);
  await startTrackedGame(page);
  await finishGameWithOneSegment(page);
  const completedId = await readCompletedGameId(page, team.orgId, team.teamId);

  await expect(page.getByTestId(`history-sync-status-${completedId}`)).toHaveAttribute(
    'data-status',
    'gesynchroniseerd',
    { timeout: SYNC_WAIT_TIMEOUT_MS },
  );
  await expect(await readLocalCompletedGameIds(page, team.orgId, team.teamId)).toContain(
    completedId,
  );

  // Apparaat A gaat offline — MET de wedstrijd nog gewoon lokaal aanwezig.
  await context.setOffline(true);

  // Apparaat B: onafhankelijke browsercontext/Firestore-verbinding, dezelfde
  // coach-identiteit (rules vereisen alleen de rol, niet een specifiek
  // apparaat) — tombstonet het item terwijl apparaat A niets kan weten.
  const second = await openSecondDevice(browser, identity, team);
  try {
    await second.page.getByTestId('nav-history').click();
    await second.page.getByTestId(`history-item-${completedId}`).click();
    second.page.once('dialog', (dialog) => dialog.accept());
    await second.page.getByTestId('history-delete-btn').click();
    await expect(second.page.getByTestId('history-back-btn')).toHaveCount(0, {
      timeout: SYNC_WAIT_TIMEOUT_MS,
    });
  } finally {
    await second.context.close();
  }

  // Apparaat A reconnect — GEEN reload: bewijst dat de al-actieve
  // `onSnapshot()`-listener zelf, zonder handmatig herladen, de tombstone
  // oppikt zodra het netwerk terugkomt (zelfde patroon als
  // `offline-reload-cache-write-second-client.spec.ts` test 3).
  await context.setOffline(false);

  // (1) Niet stil: de banner verschijnt en verklaart WAAROM (taal-
  // onafhankelijk gecontroleerd — de standaard browserlocale in deze suite
  // is en-US, zie `i18n/detect.ts`, dus de gerenderde tekst is Engels).
  await expect(page.getByTestId('history-tombstone-notice')).toBeVisible({
    timeout: SYNC_WAIT_TIMEOUT_MS,
  });
  await expect(page.getByTestId('history-tombstone-notice')).toContainText('deleted by a teammate');

  // (2) Geen resurrectie: het item verdwijnt uit de zichtbare lijst.
  await expect(page.getByTestId(`history-item-${completedId}`)).toHaveCount(0);

  // (3) Geen stille achtergebleven bron: de lokale kopie is daadwerkelijk
  // opgeruimd, niet alleen uit de gerenderde lijst gefilterd.
  expect(await readLocalCompletedGameIds(page, team.orgId, team.teamId)).not.toContain(completedId);

  // (4) Overleeft een volledige reload — geen in-memory-only staat. Reload
  // reset de UI naar het standaard-tabblad, dus eerst weer naar Historie.
  await page.reload();
  await expect(page.locator('.app-title')).toHaveText(team.teamName, { timeout: 10_000 });
  await page.getByTestId('nav-history').click();
  await expect(page.getByTestId(`history-item-${completedId}`)).toHaveCount(0);
  expect(await readLocalCompletedGameIds(page, team.orgId, team.teamId)).not.toContain(completedId);
});
