import { expect, test } from '@playwright/test';
import { uniqueTestEmail } from './helpers';

const OOB_CODES_URL = 'http://127.0.0.1:9099/emulator/v1/projects/demo-lineup-tracker-dev/oobCodes';

test('wachtwoordherstel verstuurt een mail voor een bestaand account en toont voor onbekend adres dezelfde bevestiging', async ({
  page,
  request,
}) => {
  await page.goto('/');
  const resetButton = page.getByTestId('auth-reset-password');
  const emailInput = page.getByTestId('auth-email');
  await expect(resetButton).toBeVisible();

  await resetButton.click();
  await expect(page.getByTestId('auth-error')).toBeVisible();
  await expect(emailInput).toBeFocused();

  const beforeResponse = await request.get(OOB_CODES_URL);
  expect(beforeResponse.ok()).toBe(true);
  const before = (await beforeResponse.json()) as { oobCodes?: unknown[] };

  await emailInput.fill('bob@example.test');
  await resetButton.click();
  const confirmation = page.getByTestId('auth-reset-sent');
  await expect(confirmation).toBeVisible();
  const confirmationText = await confirmation.textContent();
  await expect(page.getByTestId('auth-email')).toBeVisible();

  const afterResponse = await request.get(OOB_CODES_URL);
  expect(afterResponse.ok()).toBe(true);
  const after = (await afterResponse.json()) as {
    oobCodes?: { email: string; requestType: string }[];
  };
  expect(after.oobCodes?.length).toBe((before.oobCodes?.length ?? 0) + 1);
  expect(after.oobCodes).toContainEqual(
    expect.objectContaining({ email: 'bob@example.test', requestType: 'PASSWORD_RESET' }),
  );

  await emailInput.fill(uniqueTestEmail('unknown-reset'));
  await resetButton.click();
  await expect(confirmation).toHaveText(confirmationText ?? '');
  await expect(page.getByTestId('auth-error')).toHaveCount(0);
  const unknownResponse = await request.get(OOB_CODES_URL);
  const unknownCodes = (await unknownResponse.json()) as { oobCodes?: unknown[] };
  expect(unknownCodes.oobCodes?.length).toBe(after.oobCodes?.length);

  await page.getByTestId('lang-switch').click();
  await expect(confirmation).not.toHaveText(confirmationText ?? '');

  await page.getByTestId('auth-switch-mode').click();
  await expect(resetButton).toHaveCount(0);
});
