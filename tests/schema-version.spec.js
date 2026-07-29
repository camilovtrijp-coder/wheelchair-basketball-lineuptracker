const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  seedApp,
  seedEmpty,
  seedFullTeam,
  readLocalStorage,
  buildBackup,
  SMALL_GAME_PLAYERS,
  SMALL_GAME_SETTINGS,
  ROSTER_KEY,
  GAMES_KEY,
  SETTINGS_KEY,
  LANG_KEY,
  STORAGE_KEY,
  SCHEMA_VERSION_KEY,
  SCHEMA_VERSION
} = require('./fixtures');

/**
 * Schrijft een backup object naar een tijdelijk JSON bestand.
 */
function writeTempBackup(backup) {
  const filePath = path.join(os.tmpdir(), `lineup-tracker-schema-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2));
  return filePath;
}

test.describe('PR 2.1 - expliciete schemaversie', () => {
  test('exporteert een back-up met de huidige schemaversie', async ({ page }) => {
    await seedFullTeam(page);

    await page.locator('button:has-text("⚙")').click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button:has-text("Exporteer alle data")').click()
    ]);

    const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf-8'));
    expect(backup.type).toBe('lineup-tracker-backup');
    expect(backup.version).toBe(SCHEMA_VERSION);
    expect(backup.version).toBe(1);
  });

  test('importeert een back-up met expliciete versie 1', async ({ page }) => {
    await seedEmpty(page);

    const backup = buildBackup({ roster: SMALL_GAME_PLAYERS, settings: SMALL_GAME_SETTINGS, lang: 'nl', games: [] });
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

    // Confirm getoond, geen alert
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(1);
    expect(dialogs.filter(d => d.type === 'alert')).toHaveLength(0);

    const after = await readLocalStorage(page);
    expect(JSON.parse(after[ROSTER_KEY])).toEqual(SMALL_GAME_PLAYERS);
    expect(JSON.parse(after[SETTINGS_KEY])).toEqual(SMALL_GAME_SETTINGS);
    expect(after[LANG_KEY]).toBe('nl');

    fs.unlinkSync(backupFile);
  });

  test('accepteert een back-up zonder version als versie 1', async ({ page }) => {
    await seedEmpty(page);

    // Handmatig geconstrueerde payload zonder version veld
    const rawPayload = {
      type: 'lineup-tracker-backup',
      exportedAt: new Date().toISOString(),
      data: {
        'lineup-tracker-roster': SMALL_GAME_PLAYERS,
        'lineup-tracker-settings': SMALL_GAME_SETTINGS,
        'lineup-tracker-lang': 'nl',
        'lineup-tracker-games': []
      }
    };
    const backupFile = writeTempBackup(rawPayload);

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

    // Confirm is getoond, geen alert
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(1);
    expect(dialogs.filter(d => d.type === 'alert')).toHaveLength(0);

    const after = await readLocalStorage(page);
    expect(JSON.parse(after[ROSTER_KEY])).toEqual(SMALL_GAME_PLAYERS);
    expect(JSON.parse(after[SETTINGS_KEY])).toEqual(SMALL_GAME_SETTINGS);

    fs.unlinkSync(backupFile);
  });

  test('weigert een back-up met toekomstige versie zonder data te muteren', async ({ page }) => {
    await seedApp(page);

    const before = await readLocalStorage(page);
    expect(before[ROSTER_KEY]).toBeTruthy();

    // Bouw back-up met version: 2 (toekomstig, onbekend)
    const futureBackup = buildBackup({ roster: SMALL_GAME_PLAYERS, settings: SMALL_GAME_SETTINGS, lang: 'nl', games: [], version: 2 });
    const backupFile = writeTempBackup(futureBackup);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    // Wacht op exact één alert (FileReader is async); er mag geen confirm verschijnen
    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);

    // localStorage moet byte-gelijk blijven
    const after = await readLocalStorage(page);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('weigert een back-up met niet-numerieke version zonder data te muteren', async ({ page }) => {
    await seedApp(page);

    const before = await readLocalStorage(page);

    const rawPayload = {
      type: 'lineup-tracker-backup',
      version: 'nope',
      exportedAt: new Date().toISOString(),
      data: { 'lineup-tracker-roster': SMALL_GAME_PLAYERS }
    };
    const backupFile = writeTempBackup(rawPayload);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', backupFile);

    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);

    const after = await readLocalStorage(page);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('slaat SCHEMA_VERSION op in localStorage na een geldige import', async ({ page }) => {
    await seedEmpty(page);

    const backup = buildBackup({ roster: SMALL_GAME_PLAYERS, settings: SMALL_GAME_SETTINGS, lang: 'nl', games: [] });
    const backupFile = writeTempBackup(backup);

    page.on('dialog', dialog => dialog.accept());

    await page.locator('button:has-text("⚙")').click();
    await Promise.all([
      page.waitForNavigation(),
      page.setInputFiles('#backupFileInput', backupFile)
    ]);
    await page.waitForLoadState('networkidle');

    // SCHEMA_VERSION_KEY is een lokale sleutel, geen onderdeel van de back-up payload.
    const storedVersion = await page.evaluate((key) => localStorage.getItem(key), SCHEMA_VERSION_KEY);
    expect(storedVersion).toBe(String(SCHEMA_VERSION));
    expect(storedVersion).toBe('1');

    fs.unlinkSync(backupFile);
  });
});
