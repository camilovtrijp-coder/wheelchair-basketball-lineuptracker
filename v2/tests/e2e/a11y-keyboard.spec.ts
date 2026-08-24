// PR 8.2a (docs/pr-8.2-plan.md §C 8.2a werk 5/§B punt 3): keyboard-only-
// e2e-bewijs dat de nieuwe focus-trap (`infrastructure/a11y/focusTrap.ts`,
// `application/a11y/useFocusTrap.ts`) daadwerkelijk werkt in de browser-DOM,
// niet alleen in de jsdom-unit-tests (`focusTrap.spec.ts`). Minimale dekking
// per §C 8.2a werk 5: modaal openen met het toetsenbord, Tab-cyclus binnen
// het dialoog, Escape sluit, focus-restore naar het openende element. De
// live-wedstrijdbediening (score/wissel/context) via alleen toetsenbord is
// PR 8.2b-scope (§B punt 3 tweede helft) — die knoppen zijn vandaag nog geen
// volwaardige focusbare/toetsenbord-activeerbare elementen.
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

/** Verzamelt de `data-testid` van elk element dat op zijn beurt focus krijgt
 * terwijl er herhaaldelijk Tab gedrukt wordt — voor het aantonen dat de
 * cyclus binnen het dialoog blijft (nooit een element buiten `.modal`). */
async function activeTestId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
}

async function activeIsInsideModal(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement;
    const modal = document.querySelector('.modal');
    return Boolean(active && modal && modal.contains(active));
  });
}

test.describe('v2 a11y — keyboard-only modaalbediening (PR 8.2a)', () => {
  test('modaal openen/sluiten met toetsenbord: Tab-cyclus blijft binnen het dialoog, Escape sluit, focus keert terug', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('nav-stats').click();

    const opener = page.getByTestId('stats-games-btn');
    await opener.focus();
    await expect(opener).toBeFocused();

    // Openen puur via toetsenbord — geen `click()`/`tap()`.
    await page.keyboard.press('Enter');
    const modal = page.getByTestId('stats-games-modal');
    await expect(modal).toBeVisible();

    // De focus-trap verplaatst focus meteen naar het eerste focusbare
    // element binnen het dialoog (de "wissen"-knop, want deze modal heeft
    // een `onClear`) — nooit op de openende knop erachter.
    await expect(page.getByTestId('stats-games-modal-clear')).toBeFocused();

    // Zonder wedstrijddata bevat dit dialoog precies twee focusbare
    // elementen (clear + done) — Tab vanaf de laatste cyclet terug naar de
    // eerste, nooit naar de achtergrondpagina.
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('stats-games-modal-done')).toBeFocused();
    expect(await activeIsInsideModal(page)).toBe(true);

    await page.keyboard.press('Tab');
    await expect(page.getByTestId('stats-games-modal-clear')).toBeFocused();
    expect(await activeTestId(page)).toBe('stats-games-modal-clear');

    // Shift+Tab vanaf het eerste element cyclet terug naar het laatste.
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('stats-games-modal-done')).toBeFocused();

    // Escape sluit het dialoog en geeft focus terug aan de knop die het
    // opende.
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(opener).toBeFocused();
  });
});
