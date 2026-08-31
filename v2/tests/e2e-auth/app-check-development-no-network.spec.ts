import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('lokale emulator-modus doet geen App Check- of reCAPTCHA-request', async ({ page }) => {
  const externalAttestationRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/appcheck\.googleapis\.com|recaptcha(?:\.net|\.google\.com)/i.test(url)) {
      externalAttestationRequests.push(url);
    }
  });

  await signIn(page, 'bob@example.test', 'Spike123!');
  await expect(page.getByTestId('trusted-device-yes')).toBeVisible({ timeout: 10_000 });
  expect(externalAttestationRequests).toEqual([]);
});
