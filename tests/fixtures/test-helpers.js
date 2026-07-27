/**
 * Test helpers and fixture data generators for ROBA Lineup Tracker tests.
 * Uitsluitend fictieve testspelers (geen echte ROBA-spelersdata).
 */

const STORAGE_KEYS = {
  activeMatch: 'lineup-tracker-v1',
  roster: 'lineup-tracker-roster',
  games: 'lineup-tracker-games',
  settings: 'lineup-tracker-settings',
  lang: 'lineup-tracker-lang',
};

/**
 * Genereert een fictieve spelerslijst (7 spelers) voor testdoeleinden.
 */
function createMockRoster() {
  return [
    { id: 1, nr: '4', naam: 'Alex de Vries', kl: '3.5', vrouw: false, jeugd: true },
    { id: 2, nr: '7', naam: 'Bo Jansen', kl: '2.0', vrouw: true, jeugd: false },
    { id: 3, nr: '10', naam: 'Charlie Bakker', kl: '4.0', vrouw: false, jeugd: false },
    { id: 4, nr: '12', naam: 'Dana Smit', kl: '1.5', vrouw: true, jeugd: true },
    { id: 5, nr: '15', naam: 'Evan Mulder', kl: '2.5', vrouw: false, jeugd: false },
    { id: 6, nr: '22', naam: 'Frank Visser', kl: '3.0', vrouw: false, jeugd: false },
    { id: 7, nr: '33', naam: 'Gabi Hermans', kl: '1.0', vrouw: true, jeugd: false },
  ];
}

/**
 * Wist alle `lineup-tracker-*` localStorage keys in de browser.
 */
async function clearLocalStorage(page) {
  await page.evaluate((keys) => {
    Object.values(keys).forEach((key) => localStorage.removeItem(key));
  }, STORAGE_KEYS);
}

/**
 * Injecteert optionele testdata rechtstreeks in localStorage.
 */
async function seedLocalStorage(page, { roster, games, settings, activeMatch, lang = 'nl' } = {}) {
  await page.evaluate(
    ({ keys, roster, games, settings, activeMatch, lang }) => {
      if (roster) localStorage.setItem(keys.roster, JSON.stringify(roster));
      if (games) localStorage.setItem(keys.games, JSON.stringify(games));
      if (settings) localStorage.setItem(keys.settings, JSON.stringify(settings));
      if (activeMatch) localStorage.setItem(keys.activeMatch, JSON.stringify(activeMatch));
      if (lang) localStorage.setItem(keys.lang, lang);
    },
    { keys: STORAGE_KEYS, roster, games, settings, activeMatch, lang }
  );
}

/**
 * Genereert afgeronde testwedstrijden met het exacte segmentschema van de app:
 * { quarter, beginSec, endSec, durSec, pf, pa, lineup }
 */
function createMockFinishedGames() {
  const roster = createMockRoster();
  const lineup1 = [1, 2, 3, 4, 5];
  const lineup2 = [2, 3, 5, 6, 7]; // Alex (id 1) zit uitsluitend in lineup1

  return [
    {
      id: 'g101',
      date: '2026-07-20T14:00:00.000Z',
      opponent: 'Lions BC',
      competition: 'Regio Competitie',
      scoreFor: 78,
      scoreAgainst: 65,
      quarterCount: 4,
      periodLabel: '',
      useClassLimit: false,
      players: roster.map((p) => ({ id: p.id, nr: p.nr, naam: p.naam, kl: p.kl, vrouw: p.vrouw, jeugd: p.jeugd })),
      segments: [
        {
          quarter: 1,
          beginSec: 600,
          endSec: 0,
          durSec: 600,
          pf: 22,
          pa: 14,
          lineup: lineup1,
        },
        {
          quarter: 2,
          beginSec: 600,
          endSec: 0,
          durSec: 600,
          pf: 18,
          pa: 20,
          lineup: lineup2,
        },
        {
          quarter: 3,
          beginSec: 600,
          endSec: 0,
          durSec: 600,
          pf: 20,
          pa: 16,
          lineup: lineup1,
        },
        {
          quarter: 4,
          beginSec: 600,
          endSec: 0,
          durSec: 600,
          pf: 18,
          pa: 15,
          lineup: lineup2,
        },
      ],
    },
    {
      id: 'g102',
      date: '2026-07-25T15:30:00.000Z',
      opponent: 'Eagles Basketball',
      competition: 'Beker',
      scoreFor: 82,
      scoreAgainst: 80,
      quarterCount: 4,
      periodLabel: '',
      useClassLimit: false,
      players: roster.map((p) => ({ id: p.id, nr: p.nr, naam: p.naam, kl: p.kl, vrouw: p.vrouw, jeugd: p.jeugd })),
      segments: [
        {
          quarter: 1,
          beginSec: 600,
          endSec: 0,
          durSec: 600,
          pf: 25,
          pa: 18,
          lineup: lineup1,
        },
        {
          quarter: 2,
          beginSec: 600,
          endSec: 0,
          durSec: 600,
          pf: 15,
          pa: 22,
          lineup: lineup2,
        },
        {
          quarter: 3,
          beginSec: 600,
          endSec: 0,
          durSec: 600,
          pf: 22,
          pa: 20,
          lineup: lineup1,
        },
        {
          quarter: 4,
          beginSec: 600,
          endSec: 0,
          durSec: 600,
          pf: 20,
          pa: 20,
          lineup: lineup1,
        },
      ],
    },
  ];
}

module.exports = {
  STORAGE_KEYS,
  createMockRoster,
  clearLocalStorage,
  seedLocalStorage,
  createMockFinishedGames,
};
