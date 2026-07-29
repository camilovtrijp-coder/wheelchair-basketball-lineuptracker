const path = require('path');

// Deterministische fictieve testdata voor de Lineup Tracker.
// Deze data is expres statisch zodat tests reproduceerbaar zijn.

const ROSTER_KEY = "lineup-tracker-roster";
const SETTINGS_KEY = "lineup-tracker-settings";
const LANG_KEY = "lineup-tracker-lang";
const GAMES_KEY = "lineup-tracker-games";
const STORAGE_KEY = "lineup-tracker-v1";

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
      storageKey: STORAGE_KEY
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
      storageKey: STORAGE_KEY
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

module.exports = {
  TEST_PLAYERS,
  TEST_SETTINGS,
  OVER_LIMIT_PLAYERS,
  playersWithMatchState,
  playersWithMatchStateFromRoster,
  freshMatchState,
  freshMatchStateForRoster,
  appUrl,
  seedApp,
  seedAppWithRoster,
  expectedStarters,
  playerCount,
  teamName,
  ROSTER_KEY,
  SETTINGS_KEY,
  LANG_KEY,
  GAMES_KEY,
  STORAGE_KEY
};
