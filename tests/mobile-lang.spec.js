const { test, expect } = require('@playwright/test');
const { seedApp, appUrl, TEST_PLAYERS } = require('./fixtures');

// iPhone 14 viewport
const MOBILE_VIEWPORT = { width: 390, height: 844 };

/**
 * Helper om een compact segment in te voeren op mobiel.
 */
async function addSegmentMobile(page, { endTime, scoreFor, scoreAgainst }) {
  const [endMin, endSec] = endTime.split(':').map(s => String(parseInt(s, 10)));
  await page.locator('select.scoresel.amber').selectOption(String(scoreFor));
  await page.locator('select.scoresel.sky').selectOption(String(scoreAgainst));
  const timeSelects = page.locator('select.timesel');
  await timeSelects.nth(2).selectOption(endMin);
  await timeSelects.nth(3).selectOption(endSec);
  await page.locator('button:has-text("Segment opslaan")').click();
}

test.describe('Mobiele weergave en talen', () => {
  test('Nederlandse kernflow op mobiele viewport', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await seedApp(page);

    // Team tab in het Nederlands (app start op Wedstrijd)
    await page.locator('.tabbtn', { hasText: 'Team' }).click();
    await expect(page.locator('.tabbtn.on')).toHaveText('Team');
    await expect(page.locator('text=Speler toevoegen')).toBeVisible();

    // Wedstrijd tab
    await page.locator('.tabbtn', { hasText: 'Wedstrijd' }).click();
    await expect(page.locator('.tabbtn.on')).toHaveText('Wedstrijd');
    await expect(page.locator('text=Tegenstander')).toBeVisible();

    // Start wedstrijd
    await page.locator('#startbtn').click();
    await expect(page.locator('text=Op de vloer (5)')).toBeVisible();
    await expect(page.locator('text=Segment vastleggen')).toBeVisible();

    // Segment opslaan
    await addSegmentMobile(page, { endTime: '8:00', scoreFor: 4, scoreAgainst: 2 });
    await expect(page.locator('text=Segmenten (1)')).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/mobile-dutch-flow.png', fullPage: true });
  });

  test('Engelse taalwissel en labels', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await seedApp(page);

    // Wissel naar Engels
    await page.getByRole('button', { name: 'EN', exact: true }).click();

    // Tabbladen en labels moeten Engels zijn
    await expect(page.locator('.tabbtn.on')).toHaveText('Track');
    await expect(page.locator('.tabbtn', { hasText: 'Roster' })).toBeVisible();
    await expect(page.locator('.tabbtn', { hasText: 'Stats' })).toBeVisible();
    await expect(page.locator('.tabbtn', { hasText: 'Trends' })).toBeVisible();
    await expect(page.locator('.tabbtn', { hasText: 'History' })).toBeVisible();

    // Roster tab
    await page.locator('.tabbtn', { hasText: 'Roster' }).click();
    await expect(page.locator('text=Add player')).toBeVisible();

    // Track tab
    await page.locator('.tabbtn', { hasText: 'Track' }).click();
    await expect(page.locator('#startbtn')).toHaveText('Start match');

    // Start match
    await page.locator('#startbtn').click();
    await expect(page.locator('text=On court (5)')).toBeVisible();
    await expect(page.locator('text=Record segment')).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/mobile-english-flow.png', fullPage: true });
  });

  test('tweecijferige rugnummers blijven zichtbaar in chips', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await seedApp(page);

    await page.locator('.tabbtn', { hasText: 'Wedstrijd' }).click();
    await page.locator('#startbtn').click();

    // Controleer dat tweecijferige rugnummers (#14 en #33) zichtbaar zijn in chips
    const chipNrs = await page.locator('.chip .nr').evaluateAll(els => els.map(el => el.textContent.trim()));
    expect(chipNrs).toContain('14');
    expect(chipNrs).toContain('33');

    // Controleer dat elke chip een non-leeg rugnummer heeft
    for (const nr of chipNrs) {
      expect(nr.length).toBeGreaterThanOrEqual(1);
      expect(nr.length).toBeLessThanOrEqual(2);
    }

    await page.screenshot({ path: 'tests/screenshots/mobile-two-digit-numbers.png', fullPage: true });
  });
});
