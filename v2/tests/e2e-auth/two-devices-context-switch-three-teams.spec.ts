import { expect, test, type Page } from '@playwright/test';
import { selectContext } from './helpers';
import {
  openPilotTeam,
  openSecondDevice,
  registerPilotCoach,
  seedAdditionalPilotTeam,
  seedPilotTeam,
  type PilotTeam,
} from './twoDeviceFixtures';

async function switchTo(page: Page, team: PilotTeam): Promise<void> {
  await page.getByTestId('switch-context').click();
  await selectContext(page, team.orgId, team.teamId);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-teamName')).toHaveValue(team.teamName);
}

test('5.4c: beide apparaten wisselen tussen twee organisaties en drie teams', async ({
  browser,
  page,
}) => {
  const identity = await registerPilotCoach(page, 'three-team-switch');
  const teamA1 = await seedPilotTeam(identity, 'organisatie A / team 1');
  const teamA2 = await seedAdditionalPilotTeam(identity, teamA1, 'organisatie A / team 2');
  const teamB1 = await seedPilotTeam(identity, 'organisatie B / team 3');

  await openPilotTeam(page, teamA1);
  const second = await openSecondDevice(browser, identity, teamA1);

  try {
    for (const device of [page, second.page]) {
      await expect(device.getByTestId('settings-teamName')).toHaveValue(teamA1.teamName);
      await switchTo(device, teamA2);
      await switchTo(device, teamB1);
      await switchTo(device, teamA1);
    }
  } finally {
    await second.context.close();
  }
});
