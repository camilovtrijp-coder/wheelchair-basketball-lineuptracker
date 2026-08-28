// PR 8.2b — regressietest voor de P1-bevinding op de review van PR #83
// (28 aug. 2026): een eerdere versie van de bug-10-fix (`--team-primary`/
// `--team-accent` als tekstkleur) toetste `primaryColor`/`accentColor`
// alleen tegen de LICHTE-modus-vaste kleuren. `tokens.css`'s
// `@media (prefers-color-scheme: dark)`-blok wijzigt `--lt-color-accent-fg`
// en `--lt-color-surface` echter, waardoor de DEFAULT-teamkleuren in
// donkere modus onder de AA-contrastdrempel renderden (axe-core
// `color-contrast`, "serious"): `.btn-primary` (#2563eb op de toenmalige
// vaste donkere-modus-knoptekst #0b1220 = 3.62:1) en `.app-title` (#c2410c
// op de donkere headerachtergrond #111827 = 3.43:1). De fix
// (`domain/settings/colorContrast.ts`'s `deriveButtonForeground`/
// `deriveAccentForeground`) kiest nu een daadwerkelijk leesbare voorgrond
// per element/kleurenschema i.p.v. een vaste tekstkleur — deze suite bewijst
// dat met dezelfde methode als de review (`@axe-core/playwright` tegen de
// DEFAULT-instellingen, met `colorScheme: 'dark'` geëmuleerd) én met
// expliciete, becijferde kleurassertions.
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { test } from './fixtures';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('v2 a11y — dark-mode-contrast (PR 8.2b, P1-regressie PR #83)', () => {
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

  test('DEFAULT_SETTINGS in donkere modus: .btn-primary en .app-title renderen met een berekend leesbare voorgrond', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');

    // Achtergrond van .btn-primary blijft de rauwe primaryColor (#2563eb) —
    // die wisselt niet met het kleurenschema. De tekstkleur is wit: wit
    // haalt 5.17:1 tegen #2563eb (dus meteen de eerste kandidaat, geen
    // terugval nodig) — dit is dus GEEN wijziging t.o.v. de oude vaste
    // `--lt-color-accent-fg`-lichte-modus-waarde, wel t.o.v. de oude
    // donkere-modus-waarde (#0b1220, 3.62:1, de regressie).
    await expect(page.getByTestId('settings-save')).toHaveCSS(
      'background-color',
      'rgb(37, 99, 235)',
    );
    await expect(page.getByTestId('settings-save')).toHaveCSS('color', 'rgb(255, 255, 255)');

    // .app-title: #c2410c haalt zelf slechts 3.43:1 tegen de donkere
    // headerachtergrond (#111827) — valt terug op wit (17.74:1).
    await expect(page.locator('.app-title')).toHaveCSS('color', 'rgb(255, 255, 255)');
  });

  test('DEFAULT_SETTINGS in lichte modus (regressiebescherming): .app-title behoudt de daadwerkelijke accentkleur, want die haalt zelf al 4.5:1', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');

    // #c2410c haalt 4.96:1 tegen de lichte headerachtergrond (#f9fafb) —
    // ruim boven de AA-drempel, dus geen terugval naar wit/zwart nodig.
    await expect(page.locator('.app-title')).toHaveCSS('color', 'rgb(194, 65, 12)');
  });
});
