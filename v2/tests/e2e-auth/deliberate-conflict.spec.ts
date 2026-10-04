import { expect, test } from '@playwright/test';
import {
  openPilotTeam,
  openSecondDevice,
  registerPilotCoach,
  seedPilotTeam,
  settingsDoc,
} from './twoDeviceFixtures';

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

    // De winnaar mag pas bepaald worden zodra BEIDE writes door de server
    // verwerkt zijn. Eerder pakte deze test de eerste serverwaarde die
    // α of β was — maar dat is de write die als EERSTE landde, d.w.z. juist
    // de VERLIEZER zodra de tweede write daarna binnenkomt (last-write-wins).
    // Reproduceerbaar: "Expected Beta / Received Alpha" terwijl beide
    // apparaten al correct op de uiteindelijke serverwaarde stonden.
    //
    // Pollen op de volledige eindtoestand: (1) de indicator van beide
    // apparaten staat op 'gesynchroniseerd' — een eigen write met
    // `hasPendingWrites` of een nog niet-`settled` setDoc() houdt die op
    // 'wacht-op-synchronisatie' (useSyncStatus.ts), dus dan zijn beide writes
    // serverbevestigd en verandert de serverwaarde niet meer; (2) de
    // serverwaarde is α of β; (3) beide apparaten tonen precies die waarde.
    let winner = '';
    await expect
      .poll(
        async () => {
          winner = String((await settingsDoc(team).get()).data()?.teamName ?? '');
          return {
            winnerIsOneOfBoth: [alpha, beta].includes(winner),
            firstMatchesServer:
              (await page.getByTestId('settings-teamName').inputValue()) === winner,
            secondMatchesServer:
              (await second.page.getByTestId('settings-teamName').inputValue()) === winner,
            firstStatus: await page
              .getByTestId('sync-status-indicator')
              .getAttribute('data-status'),
            secondStatus: await second.page
              .getByTestId('sync-status-indicator')
              .getAttribute('data-status'),
          };
        },
        { timeout: 20_000 },
      )
      .toEqual({
        winnerIsOneOfBoth: true,
        firstMatchesServer: true,
        secondMatchesServer: true,
        firstStatus: 'gesynchroniseerd',
        secondStatus: 'gesynchroniseerd',
      });

    await expect(page.getByTestId('settings-teamName')).toHaveValue(winner);
    await expect(second.page.getByTestId('settings-teamName')).toHaveValue(winner);
    await expect(page.getByTestId('settings-last-modified')).toBeVisible();
    await expect(second.page.getByTestId('settings-last-modified')).toBeVisible();
    await expect(page.getByTestId('action-needed-panel')).toHaveCount(0);
    await expect(second.page.getByTestId('action-needed-panel')).toHaveCount(0);
  } finally {
    await second.context.close();
  }
});
