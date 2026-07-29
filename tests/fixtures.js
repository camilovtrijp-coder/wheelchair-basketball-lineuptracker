const path = require('path');

// Deterministische fictieve testdata voor de Lineup Tracker.
// Deze data is expres statisch zodat tests reproduceerbaar zijn.

const ROSTER_KEY = "lineup-tracker-roster";
const SETTINGS_KEY = "lineup-tracker-settings";
const LANG_KEY = "lineup-tracker-lang";
const GAMES_KEY = "lineup-tracker-games";
const STORAGE_KEY = "lineup-tracker-v1";
const SCHEMA_VERSION_KEY = "lineup-tracker-schema-version";
const SCHEMA_VERSION = 1;
const BACKUP_KEYS = [STORAGE_KEY, ROSTER_KEY, GAMES_KEY, SETTINGS_KEY, LANG_KEY];

/**
 * Vaste spelerslijst (zonder wedstrijdspecifieke velden start/participate).
 * De ID's en rugnummers zijn expres gekozen om dubbele rugnummers te vermijden
 * en om classificatie-combinaties te testen.
 */
const TEST_PLAYERS = [
  { id: 1, nr: "4", naam: "Anna", kl: "4.0", vrouw: true, jeugd: false },
  { id: 2, nr: "7", naam: "Bram", kl: "3.0", vrouw: false, jeugd: false },
  { id: 3, nr: "9", naam: "Cara", kl: "1.0", vrouw: true, jeugd: true },
  { id: 4, nr: "11", naam: "Dirk", kl: "2.5", vrouw: false, jeugd: true },
  { id: 5, nr: "14", naam: "Eva", kl: "3.5", vrouw: true, jeugd: false },
  { id: 6, nr: "21", naam: "Finn", kl: "2.0", vrouw: false, jeugd: false },
  { id: 7, nr: "33", naam: "Gijs", kl: "4.5", vrouw: false, jeugd: false },
  { id: 8, nr: "55", naam: "Hana", kl: "3.5", vrouw: true, jeugd: true }
];

/**
 * Kleine spelerslijst voor de volledige wedstrijdflow (classificatie uit).
 */
const SMALL_GAME_PLAYERS = [
  { id: 1, nr: "4", naam: "Anna", kl: "3.0", vrouw: false, jeugd: false },
  { id: 2, nr: "7", naam: "Bram", kl: "3.0", vrouw: false, jeugd: false },
  { id: 3, nr: "9", naam: "Cara", kl: "3.0", vrouw: false, jeugd: false },
  { id: 4, nr: "11", naam: "Dirk", kl: "3.0", vrouw: false, jeugd: false },
  { id: 5, nr: "14", naam: "Eva", kl: "3.0", vrouw: false, jeugd: false }
];

/**
 * Settings voor de kleine wedstrijdflow: classificatie uit, 2 kwarten.
 */
const SMALL_GAME_SETTINGS = {
  teamName: "Flowteam",
  logoUri: "",
  primaryColor: "#2563eb",
  accentColor: "#f97316",
  quarterCount: 2,
  periodLabel: "Kwart",
  useClassLimit: false,
  tag1Label: "",
  tag2Label: "",
  classBaseLimit: 14.5,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1.0,
  bonusBoth: 2.0
};

/**
 * Default test settings met classificatiesysteem aan.
 */
const TEST_SETTINGS = {
  teamName: "Testteam",
  logoUri: "",
  primaryColor: "#2563eb",
  accentColor: "#f97316",
  quarterCount: 4,
  periodLabel: "Kwart",
  useClassLimit: true,
  tag1Label: "Vrouw",
  tag2Label: "Jeugd",
  classBaseLimit: 14.5,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1.0,
  bonusBoth: 2.0
};

/**
 * Geeft de spelers terug met wedstrijdspecifieke velden.
 */
function playersWithMatchState() {
  return TEST_PLAYERS.map(p => ({
    ...p,
    start: false,
    participate: true
  }));
}

/**
 * Bouwt een lege match state.
 */
function freshMatchState() {
  const players = playersWithMatchState();
  const nextId = players.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  return {
    phase: "setup",
    players,
    clockDown: true,
    limitStr: String(TEST_SETTINGS.classBaseLimit),
    nextId,
    onCourt: [],
    selected: null,
    segments: [],
    curQuarter: 1,
    opponent: "",
    competition: "",
    beginMin: 10,
    beginSec: 0,
    endMin: 10,
    endSec: 0,
    scoreFor: 0,
    scoreAgainst: 0,
    segStartFor: 0,
    segStartAgainst: 0,
    savedAt: null
  };
}

/**
 * Geeft het pad naar index.html.
 */
function appUrl() {
  return "file://" + path.resolve(__dirname, "../index.html").replace(/\\/g, "/");
}

/**
 * Navigeert naar de app en seedt localStorage met deterministische data.
 * Wist eerst alle bekende localStorage keys.
 */
async function seedApp(page, { withMatchState = false } = {}) {
  await page.goto(appUrl());
  const payload = {
    keys: {
      rosterKey: ROSTER_KEY,
      settingsKey: SETTINGS_KEY,
      langKey: LANG_KEY,
      gamesKey: GAMES_KEY,
      storageKey: STORAGE_KEY,
      schemaVersionKey: SCHEMA_VERSION_KEY
    },
    roster: TEST_PLAYERS,
    settings: TEST_SETTINGS,
    lang: "nl",
    games: [],
    matchState: withMatchState ? freshMatchState() : null
  };
  await page.evaluate((data) => {
    const { keys, roster, settings, lang, games, matchState } = data;
    // Schone opslag
    localStorage.removeItem(keys.rosterKey);
    localStorage.removeItem(keys.settingsKey);
    localStorage.removeItem(keys.langKey);
    localStorage.removeItem(keys.gamesKey);
    localStorage.removeItem(keys.storageKey);
    localStorage.removeItem(keys.schemaVersionKey);

    // Seed deterministische data
    localStorage.setItem(keys.rosterKey, JSON.stringify(roster));
    localStorage.setItem(keys.settingsKey, JSON.stringify(settings));
    localStorage.setItem(keys.langKey, lang);
    localStorage.setItem(keys.gamesKey, JSON.stringify(games));
    if (matchState) {
      localStorage.setItem(keys.storageKey, JSON.stringify(matchState));
    }
  }, payload);
  // Herlaad zodat de app de nieuwe localStorage waarden oppakt
  await page.goto(appUrl());
  await page.waitForLoadState("networkidle");
}

/**
 * Spelerslijst die expres over de classificatielimiet gaat.
 * Som = 18.5, toegestaan = 17.0 (basis 14.5 + bonus 2.5).
 */
const OVER_LIMIT_PLAYERS = [
  { id: 1, nr: "4", naam: "Anna", kl: "4.0", vrouw: true, jeugd: false },
  { id: 2, nr: "7", naam: "Bram", kl: "3.0", vrouw: false, jeugd: false },
  { id: 5, nr: "14", naam: "Eva", kl: "3.5", vrouw: true, jeugd: false },
  { id: 7, nr: "33", naam: "Gijs", kl: "4.5", vrouw: false, jeugd: false },
  { id: 8, nr: "55", naam: "Hana", kl: "3.5", vrouw: true, jeugd: true }
];

/**
 * Geeft metadata voor de eerste vijf spelers (laagste rugnummers).
 */
function expectedStarters() {
  return TEST_PLAYERS.slice(0, 5);
}

/**
 * Geeft de spelers terug met wedstrijdspecifieke velden voor een specifieke roster.
 */
function playersWithMatchStateFromRoster(roster) {
  return roster.map(p => ({
    ...p,
    start: false,
    participate: true
  }));
}

/**
 * Bouwt een lege match state voor een specifieke roster.
 */
function freshMatchStateForRoster(roster) {
  const players = playersWithMatchStateFromRoster(roster);
  const nextId = players.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  return {
    phase: "setup",
    players,
    clockDown: true,
    limitStr: String(TEST_SETTINGS.classBaseLimit),
    nextId,
    onCourt: [],
    selected: null,
    segments: [],
    curQuarter: 1,
    opponent: "",
    competition: "",
    beginMin: 10,
    beginSec: 0,
    endMin: 10,
    endSec: 0,
    scoreFor: 0,
    scoreAgainst: 0,
    segStartFor: 0,
    segStartAgainst: 0,
    savedAt: null
  };
}

/**
 * Seed de app met een specifieke roster.
 */
async function seedAppWithRoster(page, roster, { withMatchState = false } = {}) {
  await page.goto(appUrl());
  const payload = {
    keys: {
      rosterKey: ROSTER_KEY,
      settingsKey: SETTINGS_KEY,
      langKey: LANG_KEY,
      gamesKey: GAMES_KEY,
      storageKey: STORAGE_KEY,
      schemaVersionKey: SCHEMA_VERSION_KEY
    },
    roster,
    settings: TEST_SETTINGS,
    lang: "nl",
    games: [],
    matchState: withMatchState ? freshMatchStateForRoster(roster) : null
  };
  await page.evaluate((data) => {
    const { keys, roster, settings, lang, games, matchState } = data;
    localStorage.removeItem(keys.rosterKey);
    localStorage.removeItem(keys.settingsKey);
    localStorage.removeItem(keys.langKey);
    localStorage.removeItem(keys.gamesKey);
    localStorage.removeItem(keys.storageKey);
    localStorage.removeItem(keys.schemaVersionKey);

    localStorage.setItem(keys.rosterKey, JSON.stringify(roster));
    localStorage.setItem(keys.settingsKey, JSON.stringify(settings));
    localStorage.setItem(keys.langKey, lang);
    localStorage.setItem(keys.gamesKey, JSON.stringify(games));
    if (matchState) {
      localStorage.setItem(keys.storageKey, JSON.stringify(matchState));
    }
  }, payload);
  await page.goto(appUrl());
  await page.waitForLoadState("networkidle");
}

/**
 * Geeft het totaal aantal test spelers.
 */
function playerCount() {
  return TEST_PLAYERS.length;
}

/**
 * Geeft de test teamnaam.
 */
function teamName() {
  return TEST_SETTINGS.teamName;
}

/**
 * Bouwt een state voor een lopende wedstrijd met één segment.
 */
function runningMatchState() {
  const players = playersWithMatchStateFromRoster(SMALL_GAME_PLAYERS);
  const nextId = players.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  const onCourt = players.slice(0, 5).map(p => p.id);
  return {
    phase: "tracking",
    players,
    clockDown: true,
    limitStr: String(SMALL_GAME_SETTINGS.classBaseLimit),
    nextId,
    onCourt,
    selected: null,
    segments: [{
      quarter: 1,
      beginSec: 600,
      endSec: 480,
      durSec: 120,
      lineup: onCourt.slice(),
      pf: 4,
      pa: 2,
      classSum: 0,
      allowed: 0,
      over: false
    }],
    curQuarter: 1,
    opponent: "Team B",
    competition: "Testcompetitie",
    beginMin: 8,
    beginSec: 0,
    endMin: 8,
    endSec: 0,
    scoreFor: 4,
    scoreAgainst: 2,
    segStartFor: 4,
    segStartAgainst: 2,
    savedAt: Date.now()
  };
}

/**
 * Bouwt een volledige backup payload.
 */
function buildBackup({ state, roster, settings, lang, games, version }) {
  const data = {};
  if (state != null) data[STORAGE_KEY] = state;
  if (roster != null) data[ROSTER_KEY] = roster;
  if (settings != null) data[SETTINGS_KEY] = settings;
  if (lang != null) data[LANG_KEY] = lang;
  if (games != null) data[GAMES_KEY] = games;
  return {
    type: "lineup-tracker-backup",
    version: version != null ? version : SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data
  };
}

/**
 * Seed de app met een lopende wedstrijd.
 */
async function seedRunningMatch(page) {
  const state = runningMatchState();
  const roster = SMALL_GAME_PLAYERS;
  const settings = SMALL_GAME_SETTINGS;
  await page.goto(appUrl());
  const payload = { keys: { rosterKey: ROSTER_KEY, settingsKey: SETTINGS_KEY, langKey: LANG_KEY, gamesKey: GAMES_KEY, storageKey: STORAGE_KEY, schemaVersionKey: SCHEMA_VERSION_KEY }, state, roster, settings, lang: "nl", games: [] };
  await page.evaluate((data) => {
    const { keys, state, roster, settings, lang, games } = data;
    localStorage.removeItem(keys.rosterKey);
    localStorage.removeItem(keys.settingsKey);
    localStorage.removeItem(keys.langKey);
    localStorage.removeItem(keys.gamesKey);
    localStorage.removeItem(keys.storageKey);
    localStorage.removeItem(keys.schemaVersionKey);

    localStorage.setItem(keys.storageKey, JSON.stringify(state));
    localStorage.setItem(keys.rosterKey, JSON.stringify(roster));
    localStorage.setItem(keys.settingsKey, JSON.stringify(settings));
    localStorage.setItem(keys.langKey, lang);
    localStorage.setItem(keys.gamesKey, JSON.stringify(games));
  }, payload);
  await page.goto(appUrl());
  await page.waitForLoadState("networkidle");
}

/**
 * Seed de app met een compleet team, instellingen en afgeronde wedstrijden.
 */
async function seedFullTeam(page) {
  const roster = SMALL_GAME_PLAYERS;
  const settings = SMALL_GAME_SETTINGS;
  const game = {
    id: "g1722268800000",
    opponent: "Archiefteam",
    competition: "Oude competitie",
    date: "2024-07-29T10:00:00.000Z",
    players: roster,
    segments: [{
      quarter: 1, beginSec: 600, endSec: 540, durSec: 60, lineup: roster.map(p => p.id),
      pf: 2, pa: 1, classSum: 0, allowed: 0, over: false
    }],
    scoreFor: 2, scoreAgainst: 1,
    quarterCount: settings.quarterCount, periodLabel: settings.periodLabel, useClassLimit: settings.useClassLimit
  };
  await page.goto(appUrl());
  const payload = { keys: { rosterKey: ROSTER_KEY, settingsKey: SETTINGS_KEY, langKey: LANG_KEY, gamesKey: GAMES_KEY, storageKey: STORAGE_KEY, schemaVersionKey: SCHEMA_VERSION_KEY }, roster, settings, lang: "nl", games: [game] };
  await page.evaluate((data) => {
    const { keys, roster, settings, lang, games } = data;
    localStorage.removeItem(keys.rosterKey);
    localStorage.removeItem(keys.settingsKey);
    localStorage.removeItem(keys.langKey);
    localStorage.removeItem(keys.gamesKey);
    localStorage.removeItem(keys.storageKey);
    localStorage.removeItem(keys.schemaVersionKey);

    localStorage.setItem(keys.rosterKey, JSON.stringify(roster));
    localStorage.setItem(keys.settingsKey, JSON.stringify(settings));
    localStorage.setItem(keys.langKey, lang);
    localStorage.setItem(keys.gamesKey, JSON.stringify(games));
  }, payload);
  await page.goto(appUrl());
  await page.waitForLoadState("networkidle");
}

/**
 * Seed de app met lege localStorage.
 */
async function seedEmpty(page) {
  await page.goto(appUrl());
  await page.evaluate((keys) => {
    localStorage.removeItem(keys.rosterKey);
    localStorage.removeItem(keys.settingsKey);
    localStorage.removeItem(keys.langKey);
    localStorage.removeItem(keys.gamesKey);
    localStorage.removeItem(keys.storageKey);
    localStorage.removeItem(keys.schemaVersionKey);
  }, { rosterKey: ROSTER_KEY, settingsKey: SETTINGS_KEY, langKey: LANG_KEY, gamesKey: GAMES_KEY, storageKey: STORAGE_KEY, schemaVersionKey: SCHEMA_VERSION_KEY });
  await page.goto(appUrl());
  await page.waitForLoadState("networkidle");
}

/**
 * Geeft alle waarden uit localStorage terug als object.
 */
async function readLocalStorage(page) {
  return await page.evaluate((keys) => {
    const out = {};
    keys.forEach((k) => { const v = localStorage.getItem(k); if (v != null) out[k] = v; });
    return out;
  }, BACKUP_KEYS);
}

module.exports = {
  TEST_PLAYERS,
  TEST_SETTINGS,
  OVER_LIMIT_PLAYERS,
  SMALL_GAME_PLAYERS,
  SMALL_GAME_SETTINGS,
  playersWithMatchState,
  playersWithMatchStateFromRoster,
  freshMatchState,
  freshMatchStateForRoster,
  runningMatchState,
  buildBackup,
  appUrl,
  seedApp,
  seedAppWithRoster,
  seedRunningMatch,
  seedFullTeam,
  seedEmpty,
  readLocalStorage,
  expectedStarters,
  playerCount,
  teamName,
  ROSTER_KEY,
  SETTINGS_KEY,
  LANG_KEY,
  GAMES_KEY,
  STORAGE_KEY,
  SCHEMA_VERSION_KEY,
  SCHEMA_VERSION,
  BACKUP_KEYS
};
