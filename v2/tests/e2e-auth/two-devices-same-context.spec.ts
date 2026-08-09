import { expect, test } from '@playwright/test';
import {
  openPilotTeam,
  openSecondDevice,
  registerPilotCoach,
  seedPilotTeam,
} from './twoDeviceFixtures';

test('5.4b: apparaat B ontvangt een live settingswijziging van A zonder reload', async ({
  browser,
  page,
}) => {
  const identity = await registerPilotCoach(page, 'same-context');
  const team = await seedPilotTeam(identity, 'zelfde-context');
  await openPilotTeam(page, team);
  const second = await openSecondDevice(browser, identity, team);

  try {
    const initialActuality = await second.page.getByTestId('settings-last-modified').textContent();
    expect(initialActuality).toContain('2000');

    const newName = `Live ${Date.now()}`;
    await page.getByTestId('settings-teamName').fill(newName);
    await page.getByTestId('settings-save').click();

    await expect(second.page.getByTestId('settings-teamName')).toHaveValue(newName, {
      timeout: 15_000,
    });
    await expect(second.page.getByTestId('settings-last-modified')).toBeVisible({
      timeout: 15_000,
    });
    await expect(second.page.getByTestId('settings-last-modified')).not.toContainText('2000', {
      timeout: 15_000,
    });
    expect(await second.page.getByTestId('settings-last-modified').textContent()).not.toBe(
      initialActuality,
    );
  } finally {
    await second.context.close();
  }
});
