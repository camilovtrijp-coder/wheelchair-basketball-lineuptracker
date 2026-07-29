const { test, expect } = require('@playwright/test');
const {
  appUrl,
  STORAGE_KEY,
  ROSTER_KEY,
  GAMES_KEY,
  SETTINGS_KEY,
  LANG_KEY,
  SMALL_GAME_PLAYERS,
  SMALL_GAME_SETTINGS
} = require('./fixtures');

/**
 * Seedt de app met een kleine roster en classificatie uit.
 */
async function seedSmallGame(page) {
  await page.goto(appUrl());
  const payload = {
    keys: { rosterKey: ROSTER_KEY, settingsKey: SETTINGS_KEY, langKey: LANG_KEY, gamesKey: GAMES_KEY, storageKey: STORAGE_KEY },
    roster: SMALL_GAME_PLAYERS,
    settings: SMALL_GAME_SETTINGS,
    lang: "nl",
    games: []
  };
  await page.evaluate((data) => {
    const { keys, roster, settings, lang, games } = data;
    localStorage.removeItem(keys.rosterKey);
    localStorage.removeItem(keys.settingsKey);
    localStorage.removeItem(keys.langKey);
    localStorage.removeItem(keys.gamesKey);
    localStorage.removeItem(keys.storageKey);

    localStorage.setItem(keys.rosterKey, JSON.stringify(roster));
    localStorage.setItem(keys.settingsKey, JSON.stringify(settings));
    localStorage.setItem(keys.langKey, lang);
    localStorage.setItem(keys.gamesKey, JSON.stringify(games));
  }, payload);
  await page.goto(appUrl());
  await page.waitForLoadState('networkidle');
}

/**
 * Voegt een segment toe via de UI.
 * @param {Object} page - Playwright page
 * @param {Object} opts
 * @param {number} opts.quarter - 1 of 2
 * @param {string} opts.endTime - "M:SS" (begin is altijd 10:00)
 * @param {number} opts.scoreFor - Cumulatieve score voor eigen team
 * @param {number} opts.scoreAgainst - Cumulatieve score tegen
 */
async function addSegment(page, { quarter, endTime, scoreFor, scoreAgainst }) {
  // Kwart selectie
  await page.locator('.q').filter({ hasText: String(quarter) }).click();

  // Score instellen
  await page.locator('select.scoresel.amber').selectOption(String(scoreFor));
  await page.locator('select.scoresel.sky').selectOption(String(scoreAgainst));

  // Eindtijd instellen (begin staat op 10:00)
  const [endMin, endSec] = endTime.split(':').map(s => String(parseInt(s, 10)));
  const timeSelects = page.locator('select.timesel');
  await timeSelects.nth(2).selectOption(endMin); // endMin
  await timeSelects.nth(3).selectOption(endSec); // endSec

  // Segment opslaan
  await page.locator('button:has-text("Segment opslaan")').click();
}

test.describe('Volledige wedstrijdflow', () => {
  test('speel een kleine wedstrijd en controleer totalen', async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());
    await seedSmallGame(page);

    // 1. Team tab: spelers automatisch gesorteerd op rugnummer
    await page.locator('.tabbtn', { hasText: 'Team' }).click();
    const playerInputs = page.locator('input[placeholder="Naam"]');
    await expect(playerInputs).toHaveCount(5);
    const names = await playerInputs.evaluateAll(els => els.map(el => el.value));
    expect(names).toEqual(['Anna', 'Bram', 'Cara', 'Dirk', 'Eva']);

    // 2. Wedstrijd opzetten
    await page.locator('.tabbtn', { hasText: 'Wedstrijd' }).click();
    await page.locator('input[placeholder="Optioneel"]').nth(0).fill('Team B');
    await page.locator('input[placeholder="Optioneel"]').nth(1).fill('Testcompetitie');

    // Starters: automatisch laagste 5 (alle 5)
    await page.locator('#startbtn').click();

    // 3. Segment 1: Q1 10:00 -> 8:00, pf=4, pa=2
    await addSegment(page, { quarter: 1, endTime: '8:00', scoreFor: 4, scoreAgainst: 2 });

    // 4. Segment 2: Q1 8:00 -> 6:00, pf=3, pa=5
    await addSegment(page, { quarter: 1, endTime: '6:00', scoreFor: 7, scoreAgainst: 7 });

    // 5. Segment 3: Q2 10:00 -> 8:00, pf=6, pa=4
    await page.locator('.q').filter({ hasText: '2' }).click();
    await addSegment(page, { quarter: 2, endTime: '8:00', scoreFor: 13, scoreAgainst: 11 });

    // 6. Controleer tussenstand op scherm
    await expect(page.locator('select.scoresel.amber')).toHaveValue('13');
    await expect(page.locator('select.scoresel.sky')).toHaveValue('11');
    await expect(page.locator('text=Segmenten (3)')).toBeVisible();

    // 7. Segment bewerken: segment 1 (pf 4 -> 5)
    await page.locator('.seg').nth(0).click();
    const editModal = page.locator('.modal').filter({ hasText: 'Segment bewerken' });
    await expect(editModal).toBeVisible();
    await editModal.locator('input[type="number"]').nth(0).fill('5');
    await editModal.locator('button:has-text("Opslaan")').click();
    await expect(editModal).not.toBeVisible();
    // Na bewerken: score = 5 + 3 + 6 = 14
    await expect(page.locator('select.scoresel.amber')).toHaveValue('14');

    // 8. Segment verwijderen: segment 2 verwijderen
    await page.locator('.seg').nth(1).click();
    const editModal2 = page.locator('.modal').filter({ hasText: 'Segment bewerken' });
    await expect(editModal2).toBeVisible();
    await editModal2.locator('button:has-text("Verwijderen")').click();
    await expect(editModal2).not.toBeVisible();
    // Na verwijderen: score = 5 + 6 = 11, tegen = 2 + 4 = 6
    await expect(page.locator('select.scoresel.amber')).toHaveValue('11');
    await expect(page.locator('select.scoresel.sky')).toHaveValue('6');
    await expect(page.locator('text=Segmenten (2)')).toBeVisible();

    // 9. Wedstrijd afronden (native confirm wordt door event handler geaccepteerd)
    await page.locator('button:has-text("Wedstrijd afronden")').click();

    // 10. Historie check
    await page.locator('.tabbtn', { hasText: 'Historie' }).click();
    await expect(page.locator('text=Team B')).toBeVisible();
    await expect(page.locator('text=Testcompetitie')).toBeVisible();
    await expect(page.locator('text=11 - 6')).toBeVisible();

    // 11. Stats check: er moet minstens één 5-spelers combinatie zijn
    await page.locator('.tabbtn', { hasText: 'Stats' }).click();
    await page.locator('.q.on').filter({ hasText: '5' }).waitFor();
    await expect(page.locator('text=Wedstrijden (1)')).toBeVisible();
    for (const p of SMALL_GAME_PLAYERS) {
      await expect(page.locator('text=#' + p.nr + ' ' + p.naam)).toBeVisible();
    }
    await expect(page.locator('text=4:00')).toBeVisible();
    await expect(page.locator('text=+5.0')).toBeVisible();

    // 12. Trends check: alle 5 spelers hebben gespeeld
    await page.locator('.tabbtn', { hasText: 'Trends' }).click();
    for (const p of SMALL_GAME_PLAYERS) {
      await expect(page.locator('text=#' + p.nr + ' ' + p.naam)).toBeVisible();
    }
  });
});
