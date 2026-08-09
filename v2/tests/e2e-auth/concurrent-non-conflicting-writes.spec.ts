import { expect, test } from '@playwright/test';
import {
  openPilotTeam,
  openSecondDevice,
  registerPilotCoach,
  seedPilotTeam,
  settingsDoc,
} from './twoDeviceFixtures';

test('5.4b: gelijktijdige wijzigingen aan verschillende velden blijven beide behouden', async ({
  browser,
  page,
}) => {
  const identity = await registerPilotCoach(page, 'non-conflict');
  const team = await seedPilotTeam(identity, 'non-conflict');
  await openPilotTeam(page, team);
  const second = await openSecondDevice(browser, identity, team);

  try {
    const teamName = `Samen X ${Date.now()}`;
    const tag1Label = `Samen Y ${Date.now()}`;
    await page.getByTestId('settings-teamName').fill(teamName);
    await second.page.getByTestId('settings-tag1Label').fill(tag1Label);
    await Promise.all([
      page.getByTestId('settings-save').click(),
      second.page.getByTestId('settings-save').click(),
    ]);

    await expect
      .poll(
        async () => {
          const data = (await settingsDoc(team).get()).data();
          return { teamName: data?.teamName, tag1Label: data?.tag1Label };
        },
        { timeout: 15_000 },
      )
      .toEqual({ teamName, tag1Label });

    for (const client of [page, second.page]) {
      await expect(client.getByTestId('settings-teamName')).toHaveValue(teamName, {
        timeout: 15_000,
      });
      await expect(client.getByTestId('settings-tag1Label')).toHaveValue(tag1Label, {
        timeout: 15_000,
      });
    }
  } finally {
    await second.context.close();
  }
});
