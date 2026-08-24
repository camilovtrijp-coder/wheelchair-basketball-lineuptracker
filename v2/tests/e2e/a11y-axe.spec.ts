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
// Scope-beslissing: `TakeoverConfirmDialog` (het enige modaal op het
// live-trackingscherm) verschijnt uitsluitend tijdens een ECHTE cloud-
// wedstrijd met een tweede apparaat (`app/App.tsx`'s `isCloudGameActive`) —
// deze suite draait tegen de standaard `tests/e2e/fixtures.ts`-opzet
// ("onvertrouwd apparaat", lokale modus, zie die fixture se eigen
// commentaar), waarin dat dialoog dus niet bereikbaar is zonder de
// twee-apparaten-Firestore-emulatoropzet uit `tests/e2e-auth/
// game-sync-takeover.spec.ts`. Live tracking wordt hier daarom gescand
// zonder open modaal; de modaal-scandekking van werk 1 komt van Stats/
// Trends' `GamesFilterModal` (die dezelfde gedeelde `ModalDialog`
// gebruikt als `TakeoverConfirmDialog` se eigen structuurpatroon, zie
// `ui/game/TakeoverConfirmDialog.tsx` se eigen commentaar).
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
 * scherm draait i.p.v. een lege/onbereikbare staat. */
async function startTrackedGame(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
  await page.goto('/');
  await page.getByTestId('nav-roster').click();
  for (let i = 0; i < 5; i += 1) {
    await page.getByTestId('roster-add').click();
  }
  const names = page.locator('[data-testid^="roster-naam-"]');
  await expect(names).toHaveCount(5);
  for (let i = 0; i < 5; i += 1) {
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
});
