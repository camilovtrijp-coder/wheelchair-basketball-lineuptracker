import { expect, test } from '@playwright/test';
import {
  openPilotTeam,
  openSecondDevice,
  registerPilotCoach,
  seedPilotTeam,
  settingsDoc,
} from './twoDeviceFixtures';
import { SYNC_WAIT_TIMEOUT_MS } from './gameSyncFixtures';

// Drie sequentiële conditionele waits (poll + twee toHaveValue), elk tot
// SYNC_WAIT_TIMEOUT_MS — ruim boven Playwright's standaard testtimeout
// (30s) in het theoretische worstcasepad. Zie gameSyncFixtures.ts'
// SYNC_WAIT_TIMEOUT_MS-docstring voor de onderbouwing van die 45s-waarde;
// dit is geen algemene suitebrede timeoutverhoging, alleen voor deze test.
test.setTimeout(150_000);

test('5.4b: hetzelfde veld volgt zichtbaar last-write-wins zonder actie-nodig', async ({
  browser,
  page,
}) => {
  const identity = await registerPilotCoach(page, 'conflict');
  const team = await seedPilotTeam(identity, 'conflict');
  await openPilotTeam(page, team);
  const second = await openSecondDevice(browser, identity, team);

  try {
    const alpha = `Alpha ${Date.now()}`;
    const beta = `Beta ${Date.now()}`;
    await page.getByTestId('settings-teamName').fill(alpha);
    await second.page.getByTestId('settings-teamName').fill(beta);
    await Promise.all([
      page.getByTestId('settings-save').click(),
      second.page.getByTestId('settings-save').click(),
    ]);

    let winner = '';
    await expect
      .poll(
        async () => {
          winner = String((await settingsDoc(team).get()).data()?.teamName ?? '');
          return [alpha, beta].includes(winner);
        },
        { timeout: SYNC_WAIT_TIMEOUT_MS },
      )
      .toBe(true);

    await expect(page.getByTestId('settings-teamName')).toHaveValue(winner, {
      timeout: SYNC_WAIT_TIMEOUT_MS,
    });
    await expect(second.page.getByTestId('settings-teamName')).toHaveValue(winner, {
      timeout: SYNC_WAIT_TIMEOUT_MS,
    });
    await expect(page.getByTestId('settings-last-modified')).toBeVisible();
    await expect(second.page.getByTestId('settings-last-modified')).toBeVisible();
    await expect(page.getByTestId('action-needed-panel')).toHaveCount(0);
    await expect(second.page.getByTestId('action-needed-panel')).toHaveCount(0);
  } finally {
    await second.context.close();
  }
});
