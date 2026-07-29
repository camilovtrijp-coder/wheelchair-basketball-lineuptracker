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
  LANG_KEY,
  SCHEMA_VERSION
} = require('./fixtures');

/**
 * Schrijft een backup object naar een tijdelijk JSON bestand.
 */
function writeTempBackup(backup) {
  const filePath = path.join(os.tmpdir(), `lineup-tracker-migration-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2));
  return filePath;
}

test.describe('PR 2.3 - migratieframework', () => {
  test('migrateBackup is beschikbaar op window en is een functie', async ({ page }) => {
    await seedEmpty(page);
    const hasFunction = await page.evaluate(() => typeof window.migrateBackup === 'function');
    expect(hasFunction).toBe(true);
  });

  test('migrateBackup met gelijke versies geeft data ongewijzigd terug', async ({ page }) => {
    await seedEmpty(page);
    const result = await page.evaluate(() => {
      var input = { 'lineup-tracker-lang': 'nl' };
      return window.migrateBackup(input, 1, 1);
    });
    expect(result).toEqual({ 'lineup-tracker-lang': 'nl' });
  });

  test('migrateBackup past een geregistreerde migratie toe', async ({ page }) => {
    await seedEmpty(page);
    // Registreer een v1 -> v2 migratie die een extra veld toevoegt.
    const transformed = await page.evaluate(() => {
      window.MIGRATIONS[1] = function (data) {
        var out = Object.assign({}, data);
        out['lineup-tracker-marker'] = 'migrated-v2';
        return out;
      };
      // SCHEMA_VERSION is 1, dus we forceren een test door direct te migreren van 1 naar 2.
      return window.migrateBackup({ 'lineup-tracker-lang': 'nl' }, 1, 2);
    });
    expect(transformed['lineup-tracker-lang']).toBe('nl');
    expect(transformed['lineup-tracker-marker']).toBe('migrated-v2');
  });

  test('migrateBackup retourneert null bij ontbrekende migratie', async ({ page }) => {
    await seedEmpty(page);
    const result = await page.evaluate(() => {
      // Geen migratie geregistreerd voor 5 -> 6
      return window.migrateBackup({ 'lineup-tracker-lang': 'nl' }, 5, 6);
    });
    expect(result).toBeNull();
  });

  test('migrateBackup retourneert null wanneer een migratie throwt', async ({ page }) => {
    await seedEmpty(page);
    const result = await page.evaluate(() => {
      window.MIGRATIONS[2] = function () { throw new Error('boom'); };
      return window.migrateBackup({ 'lineup-tracker-lang': 'nl' }, 2, 3);
    });
    expect(result).toBeNull();
  });

  test('migrateBackup retourneert null wanneer een migratie een non-object teruggeeft', async ({ page }) => {
    await seedEmpty(page);
    const result = await page.evaluate(() => {
      window.MIGRATIONS[3] = function () { return 'geen-object'; };
      return window.migrateBackup({ 'lineup-tracker-lang': 'nl' }, 3, 4);
    });
    expect(result).toBeNull();
  });

  test('import met v1 doorloopt migratie (no-op) en accepteert', async ({ page }) => {
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

    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(1);
    expect(dialogs.filter(d => d.type === 'alert')).toHaveLength(0);

    const after = await readLocalStorage(page);
    expect(JSON.parse(after[ROSTER_KEY])).toEqual(SMALL_GAME_PLAYERS);
    expect(JSON.parse(after[SETTINGS_KEY])).toEqual(SMALL_GAME_SETTINGS);
    expect(after[LANG_KEY]).toBe('nl');

    fs.unlinkSync(backupFile);
  });

  test('import zonder version doorloopt migratie (v1 no-op) en accepteert', async ({ page }) => {
    await seedEmpty(page);

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

    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(1);
    expect(dialogs.filter(d => d.type === 'alert')).toHaveLength(0);

    const after = await readLocalStorage(page);
    expect(JSON.parse(after[ROSTER_KEY])).toEqual(SMALL_GAME_PLAYERS);

    fs.unlinkSync(backupFile);
  });

  test('migratiefout wordt getoond en data wordt niet gemuteerd', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);

    // Overschrijf MIGRATIONS[1] zodat het throwt. Omdat SCHEMA_VERSION = 1 en
    // backupVersion = 1, wordt de migratieloop niet aangeroepen in de huidige
    // importflow. Daarom verlagen we tijdelijk SCHEMA_VERSION naar 2 zodat
    // het migratiepad 1 -> 2 daadwerkelijk wordt doorlopen.
    await page.evaluate(() => {
      window.MIGRATIONS[1] = function () { throw new Error('migratie-mislukt'); };
      window.SCHEMA_VERSION = 2;
    });

    const backup = buildBackup({ roster: SMALL_GAME_PLAYERS, settings: SMALL_GAME_SETTINGS, lang: 'nl', games: [] });
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
    expect(dialogs[0].message.toLowerCase()).toContain('gemigreerd');

    const after = await readLocalStorage(page);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('migratie die null teruggeeft wordt afgewezen zonder mutatie', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);

    await page.evaluate(() => {
      window.MIGRATIONS[1] = function () { return null; };
      window.SCHEMA_VERSION = 2;
    });

    const backup = buildBackup({ roster: SMALL_GAME_PLAYERS, settings: SMALL_GAME_SETTINGS, lang: 'nl', games: [] });
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
    expect(dialogs[0].message.toLowerCase()).toContain('gemigreerd');

    const after = await readLocalStorage(page);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const key of Object.keys(before)) {
      expect(after[key]).toEqual(before[key]);
    }

    fs.unlinkSync(backupFile);
  });

  test('Engelse foutmelding bij migratiefout', async ({ page }) => {
    await seedApp(page);
    await page.getByRole('button', { name: 'EN', exact: true }).click();

    await page.evaluate(() => {
      window.MIGRATIONS[1] = function () { throw new Error('migratie-mislukt'); };
      window.SCHEMA_VERSION = 2;
    });

    const backup = buildBackup({ roster: SMALL_GAME_PLAYERS, settings: SMALL_GAME_SETTINGS, lang: 'nl', games: [] });
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
    expect(dialogs[0].message.toLowerCase()).toContain('migrated');

    fs.unlinkSync(backupFile);
  });
});
