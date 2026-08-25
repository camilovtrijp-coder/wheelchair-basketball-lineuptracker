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

  // Externe review PR #81: de bovenstaande test bewijst alleen de gedeelde
  // `ModalDialog`/`GamesFilterModal`-implementatie, niet de twee losse
  // live-wedstrijdmodals (`swap-confirm-modal`, `edit-segment-modal` in
  // `LiveTrackingPanel.tsx`) die hun eigen `modal-overlay`/`modal`-opbouw
  // hebben (zelfde reden als `TakeoverConfirmDialog`: een ander
  // knoppenpaar dan clear/done). Beide kregen in dezelfde PR de
  // focus-trap; deze test bewijst 'm op `swap-confirm-modal`. Deze twee
  // modals hebben (net als vóór deze PR) geen Escape-sluitgedrag — alleen
  // de focus-trap zelf is hier getest, geen Escape-regressie geïntroduceerd.
  test('swap-confirm-modal (live-wedstrijdmodaal, geen ModalDialog-hergebruik): Tab-cyclus blijft binnen het dialoog, "Terug" geeft focus terug aan de openende knop', async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
    await page.goto('/');
    await page.getByTestId('nav-roster').click();
    for (let i = 0; i < 6; i += 1) {
      await page.getByTestId('roster-add').click();
    }
    const names = page.locator('[data-testid^="roster-naam-"]');
    await expect(names).toHaveCount(6);
    for (let i = 0; i < 6; i += 1) {
      await names.nth(i).fill(`Speler ${i + 1}`);
    }
    await page.getByTestId('roster-save').click();
    await page.reload();

    await page.getByTestId('nav-game').click();
    await page.getByTestId('game-start-btn').click();
    await expect(page.getByTestId('score-row-for')).toBeVisible();

    await page.locator('[data-testid^="court-chip-"]').first().click();
    await page.locator('[data-testid^="bench-chip-"]').first().click();
    const swapDoneBtn = page.getByTestId('swap-done-btn');
    await swapDoneBtn.click();

    const modal = page.getByTestId('swap-confirm-modal');
    await expect(modal).toBeVisible();

    // De focus-trap verplaatst focus meteen naar het eerste focusbare
    // element (de minuten-select).
    await expect(page.getByTestId('swap-confirm-min')).toBeFocused();

    // Vier focusbare elementen: min-select, sec-select, terug-knop,
    // bevestig-knop. Tab vanaf het laatste cyclet terug naar het eerste.
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('swap-confirm-sec')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('swap-confirm-back')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('swap-confirm-confirm')).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await activeTestId(page)).toBe('swap-confirm-min');
    expect(await activeIsInsideModal(page)).toBe(true);

    // "Terug" sluit het dialoog en geeft focus terug aan de knop die het
    // opende (geen Escape-ondersteuning op dit dialoog, zie boven).
    await page.getByTestId('swap-confirm-back').click();
    await expect(modal).not.toBeVisible();
    await expect(swapDoneBtn).toBeFocused();
  });
});
