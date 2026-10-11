import { expect, test } from '@playwright/test';
import { answerTrustedDevice, selectContext, signIn } from './helpers';

test('bestaand account maakt via de contextwisselaar een nieuwe organisatie met een eerste team', async ({
  page,
}) => {
  const orgName = `Fictieve nieuwe organisatie ${Date.now()}`;
  const teamName = 'Fictief nieuw team';

  await signIn(page, 'alice@example.test', 'Spike123!');
  await answerTrustedDevice(page, true);
  await selectContext(page, 'org-rotterdam', 'team-u23');
  await page.getByTestId('switch-context').click();
  await expect(page.getByTestId('context-org-org-rotterdam')).toBeVisible();
  await expect(page.getByTestId('context-org-org-nbb')).toBeVisible();

  await page.getByTestId('context-create-organization').click();
  await expect(page.getByRole('heading', { name: 'New organization and team' })).toBeVisible();
  await page.getByTestId('onboarding-cancel').click();
  await expect(page.getByTestId('context-create-organization')).toBeVisible();
  await page.getByTestId('context-create-organization').click();

  await page.getByTestId('onboarding-org-name').fill(orgName);
  await page.getByTestId('onboarding-team-name').fill(teamName);
  await page.getByTestId('onboarding-submit').click();

  const newOrg = page.locator('[data-testid^="context-org-"]').filter({ hasText: orgName });
  await expect(newOrg).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('context-org-org-rotterdam')).toBeVisible();
  await newOrg.click();
  await expect(
    page.locator('[data-testid^="context-team-"]').filter({ hasText: teamName }),
  ).toBeVisible();
  await page.locator('[data-testid^="context-team-"]').filter({ hasText: teamName }).click();
  await expect(page.getByTestId('nav-settings')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('switch-context').click();
  await expect(newOrg).toBeVisible();
  await expect(page.getByTestId('context-org-org-rotterdam')).toBeVisible();
});
