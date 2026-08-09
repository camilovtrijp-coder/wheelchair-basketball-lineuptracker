import { expect, test } from '@playwright/test';
import { openPilotTeam, registerPilotCoach, seedPilotTeam, settingsDoc } from './twoDeviceFixtures';

test('5.4b: twee gelijktijdige apparaten blijven volledig organisatiespecifiek', async ({
  browser,
  page,
}) => {
  const identityA = await registerPilotCoach(page, 'org-a');
  const teamA = await seedPilotTeam(identityA, 'A');
  await openPilotTeam(page, teamA);

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  const identityB = await registerPilotCoach(pageB, 'org-b');
  const teamB = await seedPilotTeam(identityB, 'B');
  await openPilotTeam(pageB, teamB);

  try {
    const nameA = `Alleen A ${Date.now()}`;
    const tagB = `Alleen B ${Date.now()}`;
    await page.getByTestId('settings-teamName').fill(nameA);
    await pageB.getByTestId('settings-tag1Label').fill(tagB);
    await Promise.all([
      page.getByTestId('settings-save').click(),
      pageB.getByTestId('settings-save').click(),
    ]);

    await expect
      .poll(async () => (await settingsDoc(teamA).get()).data()?.teamName, { timeout: 15_000 })
      .toBe(nameA);
    await expect
      .poll(async () => (await settingsDoc(teamB).get()).data()?.tag1Label, { timeout: 15_000 })
      .toBe(tagB);

    expect((await settingsDoc(teamA).get()).data()?.tag1Label).toBe('Categorie A');
    expect((await settingsDoc(teamB).get()).data()?.teamName).toBe(teamB.teamName);
  } finally {
    await contextB.close();
  }
});
