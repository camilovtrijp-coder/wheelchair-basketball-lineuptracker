const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  seedApp,
  seedEmpty,
  readLocalStorage,
  buildBackup,
  SMALL_GAME_PLAYERS,
  SMALL_GAME_SETTINGS,
  ROSTER_KEY,
  GAMES_KEY,
  SETTINGS_KEY,
  LANG_KEY
} = require('./fixtures');

/**
 * Schrijft een backup object naar een tijdelijk JSON bestand.
 */
function writeTempBackup(backup) {
  const filePath = path.join(os.tmpdir(), `lineup-tracker-validation-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2));
  return filePath;
}

test.describe('PR 2.2 - importvalidatie', () => {
  test('geldige back-up met alle velden wordt geaccepteerd', async ({ page }) => {
    await seedEmpty(page);

    const backup = buildBackup({
      roster: SMALL_GAME_PLAYERS,
      settings: SMALL_GAME_SETTINGS,
      lang: 'nl',
      games: []
    });
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.accept();
    });

    await page.locator('button:has-text("⚙")').click();
    await Promise.all([
      page.waitForNavigation(),
      page.setInputFiles('#backupFileInput', backupFile)
    ]);
    await page.waitForLoadState('networkidle');

    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(1);
    expect(dialogs.filter(d => d.type === 'alert')).toHaveLength(0);

    fs.unlinkSync(backupFile);
  });

  test('geldige back-up zonder optionele velden wordt geaccepteerd', async ({ page }) => {
    await seedEmpty(page);

    // Alleen lang, geen roster/games/settings
    const backup = { type: 'lineup-tracker-backup', version: 1, data: { 'lineup-tracker-lang': 'nl' } };
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.accept();
    });

    await page.locator('button:has-text("⚙")').click();
    await Promise.all([
      page.waitForNavigation(),
      page.setInputFiles('#backupFileInput', backupFile)
    ]);
    await page.waitForLoadState('networkidle');

    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(1);
    expect(dialogs.filter(d => d.type === 'alert')).toHaveLength(0);

    fs.unlinkSync(backupFile);
  });

  test('data: {} (volledig leeg) wordt afgewezen', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);

    const backup = { type: 'lineup-tracker-backup', version: 1, data: {} };
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);
    expect(dialogs[0].message.toLowerCase()).toContain('geen herkenbare');

    const after = await readLocalStorage(page);
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('roster als string wordt afgewezen', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);

    const backup = { type: 'lineup-tracker-backup', version: 1, data: { 'lineup-tracker-roster': 'not-an-array' } };
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);
    expect(dialogs[0].message).toContain('roster moet een array zijn');

    const after = await readLocalStorage(page);
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('roster met ontbrekend veld wordt afgewezen', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);

    const invalidRoster = [{ id: 1, nr: '4', naam: 'Test' }]; // mist kl, vrouw, jeugd
    const backup = { type: 'lineup-tracker-backup', version: 1, data: { 'lineup-tracker-roster': invalidRoster } };
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);
    expect(dialogs[0].message).toContain("mist veld");

    const after = await readLocalStorage(page);
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('roster met dubbele id wordt afgewezen', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);

    const dupRoster = [
      { id: 1, nr: '4', naam: 'A', kl: '3.0', vrouw: false, jeugd: false },
      { id: 1, nr: '7', naam: 'B', kl: '3.0', vrouw: false, jeugd: false }
    ];
    const backup = { type: 'lineup-tracker-backup', version: 1, data: { 'lineup-tracker-roster': dupRoster } };
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);
    expect(dialogs[0].message).toContain('dubbel id');

    const after = await readLocalStorage(page);
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('games als object (geen array) wordt afgewezen', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);

    const backup = { type: 'lineup-tracker-backup', version: 1, data: { 'lineup-tracker-games': { '0': 'fake' } } };
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);
    expect(dialogs[0].message).toContain('games moet een array zijn');

    const after = await readLocalStorage(page);
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('game zonder verplicht veld wordt afgewezen', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);

    const incompleteGame = {
      id: 'g1', opponent: 'X'
      // mist competition, date, players, segments, etc.
    };
    const backup = { type: 'lineup-tracker-backup', version: 1, data: { 'lineup-tracker-games': [incompleteGame] } };
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);
    expect(dialogs[0].message).toContain("mist veld");

    const after = await readLocalStorage(page);
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('settings als array wordt afgewezen', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);

    const backup = { type: 'lineup-tracker-backup', version: 1, data: { 'lineup-tracker-settings': ['a', 'b'] } };
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);
    expect(dialogs[0].message).toContain('settings moet een object zijn');

    const after = await readLocalStorage(page);
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('settings met verkeerd type wordt afgewezen', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);

    const badSettings = { ...SMALL_GAME_SETTINGS, useClassLimit: 'yes' };
    const backup = { type: 'lineup-tracker-backup', version: 1, data: { 'lineup-tracker-settings': badSettings } };
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);
    expect(dialogs[0].message).toContain('useClassLimit moet een boolean zijn');

    const after = await readLocalStorage(page);
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('lang met ongeldige waarde wordt afgewezen', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);

    const backup = { type: 'lineup-tracker-backup', version: 1, data: { 'lineup-tracker-lang': 'fr' } };
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);
    expect(dialogs[0].message).toContain("'nl' of 'en'");

    const after = await readLocalStorage(page);
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('segment.lineup met onbekend speler-id wordt afgewezen', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);

    const game = {
      id: 'g-bad-ref',
      opponent: 'X',
      competition: 'Y',
      date: '2025-01-01T00:00:00.000Z',
      players: SMALL_GAME_PLAYERS,
      segments: [{
        quarter: 1, beginSec: 600, endSec: 540, durSec: 60,
        lineup: [1, 2, 3, 4, 999], // 999 bestaat niet
        pf: 2, pa: 1, classSum: 0, allowed: 0, over: false
      }],
      scoreFor: 2, scoreAgainst: 1,
      quarterCount: 4, periodLabel: 'Kwart', useClassLimit: false
    };
    const backup = { type: 'lineup-tracker-backup', version: 1, data: { 'lineup-tracker-games': [game] } };
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);
    expect(dialogs[0].message).toContain('onbekend speler-id');

    const after = await readLocalStorage(page);
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('game met scoreFor als string wordt afgewezen', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);

    const game = {
      id: 'g-bad-type', opponent: 'X', competition: 'Y',
      date: '2025-01-01T00:00:00.000Z',
      players: SMALL_GAME_PLAYERS, segments: [],
      scoreFor: 'twee', scoreAgainst: 1,
      quarterCount: 4, periodLabel: 'Kwart', useClassLimit: false
    };
    const backup = { type: 'lineup-tracker-backup', version: 1, data: { 'lineup-tracker-games': [game] } };
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);
    expect(dialogs[0].message).toContain('games[0].scoreFor moet een getal zijn');

    const after = await readLocalStorage(page);
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('game met useClassLimit als string wordt afgewezen', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);

    const game = {
      id: 'g-bad-type', opponent: 'X', competition: 'Y',
      date: '2025-01-01T00:00:00.000Z',
      players: SMALL_GAME_PLAYERS, segments: [],
      scoreFor: 2, scoreAgainst: 1,
      quarterCount: 4, periodLabel: 'Kwart', useClassLimit: 'nee'
    };
    const backup = { type: 'lineup-tracker-backup', version: 1, data: { 'lineup-tracker-games': [game] } };
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);
    expect(dialogs[0].message).toContain('games[0].useClassLimit moet een boolean zijn');

    const after = await readLocalStorage(page);
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('game met players als string (geen array) wordt afgewezen', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);

    const game = {
      id: 'g-bad-type', opponent: 'X', competition: 'Y',
      date: '2025-01-01T00:00:00.000Z',
      players: 'niet-een-array', segments: [],
      scoreFor: 2, scoreAgainst: 1,
      quarterCount: 4, periodLabel: 'Kwart', useClassLimit: false
    };
    const backup = { type: 'lineup-tracker-backup', version: 1, data: { 'lineup-tracker-games': [game] } };
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);
    expect(dialogs[0].message).toContain('games[0].players moet een array zijn');

    const after = await readLocalStorage(page);
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('meerdere fouten toont eerste + samenvatting', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);

    const backup = {
      type: 'lineup-tracker-backup',
      version: 1,
      data: {
        'lineup-tracker-roster': 'not-array',        // fout 1
        'lineup-tracker-settings': 'not-object',     // fout 2
        'lineup-tracker-lang': 'fr'                  // fout 3
      }
    };
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);
    // Bevat de eerste fout en de samenvatting van 2 andere
    expect(dialogs[0].message).toContain('roster moet een array zijn');
    expect(dialogs[0].message).toMatch(/2 andere fouten/);

    const after = await readLocalStorage(page);
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('Engelse foutmelding bij ongeldige data', async ({ page }) => {
    await seedApp(page);
    // Wissel naar Engels
    await page.getByRole('button', { name: 'EN', exact: true }).click();

    const before = await readLocalStorage(page);

    const backup = { type: 'lineup-tracker-backup', version: 1, data: { 'lineup-tracker-roster': 'not-an-array' } };
    const backupFile = writeTempBackup(backup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);
    expect(dialogs[0].message).toContain('invalid data');
    expect(dialogs[0].message).toContain('roster must be an array');

    const after = await readLocalStorage(page);
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });
});
