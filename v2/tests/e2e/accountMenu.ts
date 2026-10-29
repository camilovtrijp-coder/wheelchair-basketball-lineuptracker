import type { Page } from '@playwright/test';

/**
 * Opent het accountmenu in de app-header (stap 3/5: accountchip) als het nog
 * dicht is. De items in het menu (e-mail, wissel van context, vertrouwd
 * apparaat, uitloggen) staan pas in de DOM zodra het menu open is.
 */
export async function openAccountMenu(page: Page): Promise<void> {
  const trigger = page.getByTestId('account-menu-trigger');
  await trigger.waitFor({ state: 'visible', timeout: 15_000 });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
  await page.getByTestId('account-menu').waitFor({ state: 'visible' });
}
