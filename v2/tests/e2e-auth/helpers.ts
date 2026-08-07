import type { Page } from '@playwright/test';

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await signInInPlace(page, email, password);
}

/**
 * Zelfde als `signIn`, maar zonder de `page.goto('/')` — nodig wanneer de
 * pagina al op een specifieke URL staat (bijv. een uitnodigingslink met
 * `?orgId=...&invitationId=...`) die `signIn`'s eigen navigatie zou wissen.
 */
export async function signInInPlace(page: Page, email: string, password: string): Promise<void> {
  await page.waitForSelector('[data-testid="auth-email"]');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
}

export async function signUp(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('[data-testid="auth-email"]');
  await page.getByTestId('auth-switch-mode').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
}

export async function answerTrustedDevice(page: Page, trusted: boolean): Promise<void> {
  const testId = trusted ? 'trusted-device-yes' : 'trusted-device-no';
  await page.waitForSelector(`[data-testid="${testId}"]`, { timeout: 10_000 });
  await page.getByTestId(testId).click();
}

/** Kiest een org+team in de contextwisselaar en wacht tot de bestaande App zichtbaar is. */
export async function selectContext(page: Page, orgId: string, teamId: string): Promise<void> {
  await page.waitForSelector(`[data-testid="context-org-${orgId}"]`, { timeout: 10_000 });
  await page.getByTestId(`context-org-${orgId}`).click();
  await page.waitForSelector(`[data-testid="context-team-${teamId}"]`, { timeout: 10_000 });
  await page.getByTestId(`context-team-${teamId}`).click();
  await page.waitForSelector('[data-testid="nav-settings"]', { timeout: 10_000 });
}

export function uniqueTestEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}
