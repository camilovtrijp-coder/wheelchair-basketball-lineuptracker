// PR 8.2b (docs/pr-8.2-plan.md §A/§C werk 5): bevestigt dat het bestaande
// globale `@media (prefers-reduced-motion: reduce) { * { animation: none
// !important; transition: none !important; } }`-blok (index.css) een
// daadwerkelijk geanimeerd element raakt. Vóór deze PR had v2 geen enkele
// CSS-`animation`/`transition`, dus dit blok had in de praktijk niets te
// onderdrukken — de `.modal`-intredeanimatie (`modal-enter`, toegevoegd in
// dezelfde PR) is het minimale geanimeerde element dat deze regressietest
// nodig heeft.
import { expect } from '@playwright/test';
import { test } from './fixtures';

test.describe('v2 a11y — prefers-reduced-motion onderdrukt animaties (PR 8.2b)', () => {
  test('zonder reduced-motion-voorkeur speelt de modal-intredeanimatie', async ({ page }) => {
    // Expliciet 'no-preference' i.p.v. te vertrouwen op de omgevingsdefault:
    // headless Chromium rapporteert `prefers-reduced-motion` niet overal
    // hetzelfde (sommige headless/CI-omgevingen geven standaard `reduce`
    // terug, zonder dat de OS/testrunner dat expliciet vraagt) — dit maakt
    // de baseline van deze test deterministisch, ongeacht die omgeving.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.getByTestId('nav-stats').click();
    await page.getByTestId('stats-games-btn').click();

    // `data-testid="stats-games-modal"` staat op de buitenste
    // `.modal-overlay` (ModalDialog.tsx); de `modal-enter`-animatie zit op
    // de binnenste `.modal` (het daadwerkelijke dialoogpaneel).
    const modal = page.getByTestId('stats-games-modal').locator('.modal');
    await expect(modal).toBeVisible();
    const animationName = await modal.evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toBe('modal-enter');
  });

  test('met prefers-reduced-motion: reduce staat de modal-intredeanimatie uit', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByTestId('nav-stats').click();
    await page.getByTestId('stats-games-btn').click();

    const modal = page.getByTestId('stats-games-modal').locator('.modal');
    // Blijft zichtbaar en bruikbaar — reduced-motion onderdrukt alleen de
    // animatie, niet de modal zelf.
    await expect(modal).toBeVisible();
    const animationName = await modal.evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toBe('none');
  });
});
