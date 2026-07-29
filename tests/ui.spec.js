const { test, expect } = require('@playwright/test');
const { seedApp, seedAppWithRoster, expectedStarters, playerCount, teamName, appUrl, OVER_LIMIT_PLAYERS } = require('./fixtures');

test.describe('Lineup Tracker UI - deterministische testbasis', () => {
  test('start vanuit schone state met vaste testdata', async ({ page }) => {
    await seedApp(page);

    // De app start standaard op Wedstrijd; navigeer eerst naar Team om de data te verifiëren
    await page.locator('.tabbtn', { hasText: 'Team' }).click();
    await expect(page.locator('.tabbtn.on')).toHaveText('Team');
    const playerInputs = page.locator('input[placeholder="Naam"]');
    await expect(playerInputs).toHaveCount(playerCount());

    await page.screenshot({ path: 'tests/screenshots/1-team-roster.png', fullPage: true });

    // Ga naar Wedstrijd tabblad
    await page.locator('.tabbtn', { hasText: 'Wedstrijd' }).click();
    await expect(page.locator('.tabbtn.on')).toHaveText('Wedstrijd');
    await page.screenshot({ path: 'tests/screenshots/2-pregame-match.png', fullPage: true });

    // Startknop moet enabled zijn omdat we exacte testdata gebruiken
    const startBtn = page.locator('#startbtn');
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toBeEnabled();
    await expect(startBtn).toHaveText('Start wedstrijd');

    // Start de wedstrijd
    await startBtn.click();

    // Na start moeten we in de tracking view zijn
    await expect(page.locator('.tabbtn.on')).toHaveText('Wedstrijd');
    await expect(page.locator('#startbtn')).not.toBeVisible();
    await expect(page.locator('text=Op de vloer (5)')).toBeVisible();
    await expect(page.getByText('Bank', { exact: true })).toBeVisible();
    await expect(page.locator('text=Segment vastleggen')).toBeVisible();
    // 5 spelers op het veld + 3 spelers op de bank = 8 chips
    await expect(page.locator('.chip')).toHaveCount(playerCount());

    // Controleer dat de verwachte 5 starters zichtbaar zijn als chip knop
    for (const p of expectedStarters()) {
      await expect(page.getByRole('button', { name: new RegExp(p.naam) })).toBeVisible();
    }

    // Teamnaam moet zichtbaar zijn
    await expect(page.locator('h1')).toContainText(teamName());

    // Classificatie systeem assertions
    // Starters: Anna 4.0 + Bram 3.0 + Cara 1.0 + Dirk 2.5 + Eva 3.5 = 14.0
    // Bonus: Cara (both) 2.0 + Anna (vrouw) 1.5 + Dirk (jeugd) 1.0 + Eva (vrouw) 1.5 = 6.0 → max 2.5
    // Toegestaan: 14.5 + 2.5 = 17.0
    await expect(page.locator('text=14.0 / 17.0')).toBeVisible();
    await expect(page.locator('text=Te veel classificatiepunten')).not.toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/3-live-match.png', fullPage: true });
  });

  test('classificatiewaarschuwing bij opstelling boven de limiet', async ({ page }) => {
    await seedAppWithRoster(page, OVER_LIMIT_PLAYERS);

    await page.locator('.tabbtn', { hasText: 'Wedstrijd' }).click();
    await page.locator('#startbtn').click();

    // Opstelling: Anna 4.0 + Bram 3.0 + Eva 3.5 + Gijs 4.5 + Hana 3.5 = 18.5
    // Toegestaan: 14.5 + 2.5 = 17.0
    await expect(page.locator('text=18.5 / 17.0')).toBeVisible();
    await expect(page.locator('text=Te veel classificatiepunten op het veld')).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/4-classification-over-limit.png', fullPage: true });
  });

  test('wissel wordt bevestigd en segment opgeslagen', async ({ page }) => {
    await seedApp(page);

    await page.locator('.tabbtn', { hasText: 'Wedstrijd' }).click();
    await page.locator('#startbtn').click();

    // Startopstelling classificatie check
    await expect(page.locator('text=14.0 / 17.0')).toBeVisible();

    // Klik op veldspeler Anna (#4)
    await page.getByRole('button', { name: /Anna/ }).click();
    await expect(page.locator('text=Anna #4 gekozen')).toBeVisible();

    // Klik op bankspeler Hana (#55)
    await page.getByRole('button', { name: /Hana/ }).click();

    // Na de wissel staat Hana op het veld en Anna op de bank
    // De wissel is pending totdat "Klaar met wisselen" wordt geklikt
    await expect(page.locator('text=Klaar met wisselen')).toBeVisible();

    // Classificatie is nu veranderd door de wissel
    await expect(page.locator('text=13.5 / 17.0')).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/5-swap-pending.png', fullPage: true });

    // Bevestig wissel
    await page.locator('button:has-text("Klaar met wisselen")').click();

    // Swap confirm modal
    const swapModal = page.locator('.modal').filter({ hasText: 'Wissel(s) — kloktijd?' });
    await expect(swapModal).toBeVisible();

    // Stel tijd in op 8:00 (begin was 10:00)
    const swapSelects = swapModal.locator('select');
    await swapSelects.first().selectOption('8');
    await swapSelects.nth(1).selectOption('0');

    await swapModal.locator('button:has-text("Bevestigen")').click();

    // Segment moet nu opgeslagen zijn
    await expect(page.locator('text=Segmenten (1)')).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/6-swap-segment-saved.png', fullPage: true });
  });

  test('startknop is disabled als er te weinig spelers zijn', async ({ page }) => {
    // Gebruik lege localStorage: geen spelers, geen settings seed
    await page.goto(appUrl());
    await page.waitForLoadState('networkidle');

    await page.locator('.tabbtn', { hasText: 'Wedstrijd' }).click();

    // Zonder spelers is de startknop niet eens aanwezig; de app toont een melding
    // met een knop om naar Team te gaan.
    await expect(page.locator('#startbtn')).not.toBeVisible();
    await expect(page.locator('text=Nog geen spelers')).toBeVisible();
    await expect(page.locator('button:has-text("Naar Team")')).toBeVisible();
  });
});
