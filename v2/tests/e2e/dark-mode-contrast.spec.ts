// PR 8.2b — regressietest voor TWEE P1-bevindingen op de review van PR #83
// (28 aug. 2026):
//
// 1. Een eerdere versie van de bug-10-fix kleurde `.btn-primary`/
//    `.app-title` met vaste, alleen-lichte-modus-kleuren. `tokens.css`'s
//    `@media (prefers-color-scheme: dark)`-blok wijzigt die vaste kleuren
//    echter, waardoor de DEFAULT-teamkleuren in donkere modus onder de
//    AA-contrastdrempel renderden (axe-core `color-contrast`, "serious"):
//    `.btn-primary` (#2563eb op de toenmalige vaste donkere-modus-
//    knoptekst #0b1220 = 3.62:1) en `.app-title` (#c2410c op de donkere
//    headerachtergrond #111827 = 3.43:1).
// 2. De eerste fix (een uit `accentColor` afgeleide leesbare tekstkleur
//    voor `.app-title`) loste (1) op, maar bleek voor ALLE tien presets
//    in `SettingsPanel.tsx` terug te vallen op exact hetzelfde zwart tegen
//    de lichte headerachtergrond — de accentkeuze werd zo onzichtbaar.
//
// Eindoplossing: `.btn-primary`'s tekst gebruikt nog steeds een afgeleide
// leesbare voorgrond (`deriveButtonForeground`, wiskundig gegarandeerd
// ≥4.5:1 in beide schema's, want de knopachtergrond zelf wisselt niet met
// het schema). `.app-title`'s TEKST gebruikt de vaste, altijd-conforme
// `--lt-color-fg`; `accentColor` blijft zichtbaar en onderscheidend via
// een puur decoratief accent (`border-left`, geen WCAG-tekstcontrasteis).
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { test } from './fixtures';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('v2 a11y — dark-mode-contrast (PR 8.2b, P1-regressies PR #83)', () => {
  test('instellingen met DEFAULT_SETTINGS in donkere modus: geen axe-core color-contrast-schendingen', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.getByTestId('settings-teamName')).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const colorContrastViolations = results.violations.filter((v) => v.id === 'color-contrast');
    expect(colorContrastViolations, JSON.stringify(colorContrastViolations, null, 2)).toEqual([]);
  });

  test('DEFAULT_SETTINGS in donkere modus: .btn-primary rendert met een berekend leesbare voorgrond, .app-title met de vaste tekstkleur', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');

    // Achtergrond van .btn-primary blijft de rauwe primaryColor (#2563eb) —
    // die wisselt niet met het kleurenschema. De tekstkleur is wit: wit
    // haalt 5.17:1 tegen #2563eb (dus meteen de eerste kandidaat, geen
    // terugval nodig) — dit is dus GEEN wijziging t.o.v. de oude vaste
    // `--lt-color-accent-fg`-lichte-modus-waarde, wel t.o.v. de oude
    // donkere-modus-waarde (#0b1220, 3.62:1, de eerste regressie).
    await expect(page.getByTestId('settings-save')).toHaveCSS(
      'background-color',
      'rgb(37, 99, 235)',
    );
    await expect(page.getByTestId('settings-save')).toHaveCSS('color', 'rgb(255, 255, 255)');

    // .app-title: tekst blijft de vaste donkere-modus-`--lt-color-fg`
    // (#f3f4f6, tokens.css) — geen teamkleur, dus geen contrastrisico.
    // Het accent (#c2410c) blijft zichtbaar via de decoratieve rand.
    await expect(page.locator('.app-title')).toHaveCSS('color', 'rgb(243, 244, 246)');
    await expect(page.locator('.app-title')).toHaveCSS('border-left-color', 'rgb(194, 65, 12)');
  });

  // Expliciete review-eis (tweede ronde, PR #83): bewijs dat twee
  // verschillende accent-presets ook daadwerkelijk tot twee verschillende
  // gerenderde accentkleuren leiden — niet alleen dat de CSS custom
  // property verandert. Hier in donkere modus; de lichte-modus-variant
  // staat in settings.spec.ts.
  test('twee verschillende accentkleur-presets renderen als twee verschillende decoratieve accentranden (donkere modus)', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    const appTitle = page.locator('.app-title');

    await page.getByTestId('accentColor-3b82f6').click();
    await expect(appTitle).toHaveCSS('border-left-color', 'rgb(59, 130, 246)');
    await expect(appTitle).toHaveCSS('color', 'rgb(243, 244, 246)');

    await page.getByTestId('accentColor-14b8a6').click();
    await expect(appTitle).toHaveCSS('border-left-color', 'rgb(20, 184, 166)');
    await expect(appTitle).toHaveCSS('color', 'rgb(243, 244, 246)');
  });
});
