// PR 8.2a (docs/pr-8.2-plan.md §C 8.2a werk 1/§B punt 1): runtime-a11y-
// nulmeting met `@axe-core/playwright` tegen de bestaande kernschermen —
// dezelfde schermenlijst die `mobile.spec.ts` en de auth-e2e-suite al
// aanraken, geen nieuwe navigatiepaden. Draait bewust VÓÓR de focus-trap uit
// werk 2 zichtbaar effect kan hebben op deze scan (de scan test axe-core-
// violations, niet de focus-trapcyclus zelf — dat is `a11y-keyboard.spec.ts`
// hieronder), zodat een latere regressie in de gescande regelset zichtbaar
// wordt t.o.v. deze nulmeting.
//
// Vaste WCAG-tags (§B punt 1, externe review PR #80): WCAG 2.0 A/AA plus
// WCAG 2.1 A/AA, bewust NIET axe-core's bredere standaardregelset (die ook
// niet-WCAG-`best-practice`-regels meeneemt) — voorkomt dat een toekomstige
// axe-core-major-upgrade stilzwijgend de gescande regelset laat verschuiven.
// `impact: 'minor'` wordt NIET uitgesloten.
//
// Scope-correctie (externe review PR #81): een eerdere versie van deze
// suite scande live tracking zonder open modaal, met als onderbouwing dat
// `TakeoverConfirmDialog` (dat uitsluitend tijdens een ECHTE cloud-
// wedstrijd met een tweede apparaat verschijnt, `app/App.tsx`'s
// `isCloudGameActive`) het enige modaal op dit scherm zou zijn — dat
// klopte niet: `LiveTrackingPanel.tsx` heeft ook `swap-confirm-modal`
// (wissel-kloktijd-bevestiging) en `edit-segment-modal` (segment
// bewerken), allebei bereikbaar in de standaard lokale-modus-fixture
// hieronder, zonder cloud/tweede apparaat. De "live tracking"-scan opent
// nu `swap-confirm-modal`. `TakeoverConfirmDialog` blijft wél buiten deze
// suite — zie nog steeds `ui/game/TakeoverConfirmDialog.tsx` se eigen
// commentaar voor die specifieke, cloud-only afbakening.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

/** Zie game-tracking.spec.ts/game-history.spec.ts `startTrackedGame()` —
 * zelfde opzet, hergebruikt hier zodat de live-trackingscan op het echte
 * scherm draait i.p.v. een lege/onbereikbare staat. `playerCount` is
 * instelbaar op 6 voor de wisselflow hieronder (5 op de vloer + 1 op de
 * bank, nodig om `swap-confirm-modal` te kunnen openen). */
async function startTrackedGame(page: Page, playerCount = 5): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
  await page.goto('/');
  await page.getByTestId('nav-roster').click();
  for (let i = 0; i < playerCount; i += 1) {
    await page.getByTestId('roster-add').click();
  }
  const names = page.locator('[data-testid^="roster-naam-"]');
  await expect(names).toHaveCount(playerCount);
  for (let i = 0; i < playerCount; i += 1) {
    await names.nth(i).fill(`Speler ${i + 1}`);
  }
  await page.getByTestId('roster-save').click();
  await page.reload();
}

test.describe('v2 a11y — axe-core-nulmeting kernschermen (PR 8.2a)', () => {
  test('instellingen', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('settings-teamName')).toBeVisible();
    await expectNoViolations(page);
  });

  test('roster', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-roster').click();
    await expectNoViolations(page);
  });

  test('wedstrijd-opzet', async ({ page }) => {
    await startTrackedGame(page);
    await page.getByTestId('nav-game').click();
    await expect(page.getByTestId('game-start-btn')).toBeVisible();
    await expectNoViolations(page);
  });

  test('live tracking', async ({ page }) => {
    await startTrackedGame(page);
    await page.getByTestId('nav-game').click();
    await page.getByTestId('game-start-btn').click();
    await expect(page.getByTestId('score-row-for')).toBeVisible();
    await expectNoViolations(page);
  });

  test('live tracking incl. open wissel-kloktijd-modaal', async ({ page }) => {
    // 6 spelers zodat er één bankspeler over is om mee te wisselen — zelfde
    // opzet als game-tracking.spec.ts's wisselflow-test.
    await startTrackedGame(page, 6);
    await page.getByTestId('nav-game').click();
    await page.getByTestId('game-start-btn').click();
    await expect(page.getByTestId('score-row-for')).toBeVisible();

    await page.locator('[data-testid^="court-chip-"]').first().click();
    await page.locator('[data-testid^="bench-chip-"]').first().click();
    await page.getByTestId('swap-done-btn').click();
    await expect(page.getByTestId('swap-confirm-modal')).toBeVisible();

    await expectNoViolations(page);
  });

  test('live tracking incl. open segment-bewerken-modaal', async ({ page }) => {
    await startTrackedGame(page);
    await page.getByTestId('nav-game').click();
    await page.getByTestId('game-start-btn').click();
    await page.getByTestId('score-plus2-for').click();
    await page.getByTestId('end-min').selectOption('5');
    await page.getByTestId('save-segment-btn').click();
    await expect(page.locator('[data-testid^="segment-item-"]')).toHaveCount(1);

    await page.locator('[data-testid^="segment-item-"]').first().click();
    await expect(page.getByTestId('edit-segment-modal')).toBeVisible();

    await expectNoViolations(page);
  });

  test('historie', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-history').click();
    await expectNoViolations(page);
  });

  test('stats incl. open filtermodaal', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-stats').click();
    await page.getByTestId('stats-games-btn').click();
    await expect(page.getByTestId('stats-games-modal')).toBeVisible();
    await expectNoViolations(page);
  });

  test('trends incl. open filtermodaal', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-trends').click();
    await page.getByTestId('trends-games-btn').click();
    await expect(page.getByTestId('trends-games-modal')).toBeVisible();
    await expectNoViolations(page);
  });

  // PR 8.2c (na de externe review op PR #84): de vertrouwd-apparaat-
  // bevestigingsdialoog in SessionBar.tsx miste aanvankelijk elke axe-
  // dekking — deze suite opende 'm nooit.
  test('instellingen incl. open vertrouwd-apparaat-bevestigingsdialoog', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByTestId('trusted-device-setting-toggle');
    await toggle.click();
    await page.waitForSelector('[data-testid="nav-settings"]', { timeout: 15_000 });
    await page.getByTestId('trusted-device-setting-toggle').click();
    await expect(page.getByTestId('trusted-device-revoke-confirm')).toBeVisible();
    await expectNoViolations(page);
  });
});
