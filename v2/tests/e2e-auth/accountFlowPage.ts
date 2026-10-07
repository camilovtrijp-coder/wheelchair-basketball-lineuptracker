// PR 8.3c-2d: paginahulpfuncties voor de e2e van verlaten, accountverwijdering en
// overdracht. Teksten komen uit dezelfde vertaaltabel als de app (`translate`), zodat een
// test op de echte NL/EN-tekst controleert zonder die te dupliceren.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { translate, type Lang, type StringKey } from '../../src/i18n/strings';
import { answerTrustedDevice, selectContext, signIn } from './helpers';
import type { TestUser } from './accountFlowFixtures';

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** De vertaalde tekst met ingevulde `{param}`s, zoals `formatLine` in de app. */
export function text(lang: Lang, key: StringKey, params: Record<string, string | number> = {}) {
  let value = translate(lang, key);
  for (const [name, param] of Object.entries(params)) {
    value = value.split(`{${name}}`).join(String(param));
  }
  return value;
}

/** Logt in via de echte UI (vertrouwd apparaat), met de taal vooraf gezet. */
export async function signInUser(page: Page, user: TestUser, lang: Lang = 'nl'): Promise<void> {
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem('lineup-tracker-lang', value);
    } catch {
      // geen opslag: de app valt terug op de browsertaal
    }
  }, lang);
  await signIn(page, user.typedEmail, user.password);
  await answerTrustedDevice(page, true);
}

export async function signInAndSelect(
  page: Page,
  user: TestUser,
  orgId: string,
  teamId: string,
  lang: Lang = 'nl',
): Promise<void> {
  await signInUser(page, user, lang);
  await selectContext(page, orgId, teamId);
}

/** Tabblad Instellingen met het accountpaneel. */
export async function openAccountPanel(page: Page): Promise<void> {
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('account-panel')).toBeVisible();
}

export function dialog(page: Page) {
  return page.getByTestId('account-flow-dialog');
}

/**
 * axe (WCAG 2 A/AA) op het open accountdialoog. Zoals in `deletion-request-flow.spec.ts`:
 * reduced motion, zodat axe de eindtoestand meet en niet een kleur midden in de
 * intrede-animatie van de modal.
 */
export async function expectNoDialogViolations(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(dialog(page)).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include('[data-testid="account-flow-dialog"]')
    .withTags(WCAG_TAGS)
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

/** Alle sleutels van de Firestore-IndexedDB-persistentie van deze pagina (B7). */
export async function firestoreIndexedDbNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const all = await indexedDB.databases();
    return all
      .map((db) => db.name ?? '')
      .filter((name) => name.startsWith('firestore/'))
      .sort();
  });
}

export async function readLocalStorage(
  page: Page,
  keys: string[],
): Promise<Record<string, string | null>> {
  return page.evaluate(
    (list) => Object.fromEntries(list.map((key) => [key, window.localStorage.getItem(key)])),
    keys,
  );
}
