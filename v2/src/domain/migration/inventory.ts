import type { Settings } from '../settings/types';
import type { Roster } from '../roster/types';
import type { ActiveGame, CompletedGame } from '../game/types';
import {
  validateActiveGameSection,
  validateCompletedGamesSection,
  validateRosterSection,
  validateSettingsSection,
} from '../backup/validate';
import type { LocalMigrationInventory, LocalMigrationSection } from './types';

/**
 * PR 7.4a (docs/pr-7.4-plan.md §C 7.4a werk 1): pure inventarisatie —
 * neemt RAUWE, al-uit-opslag-gelezen `unknown`-waarden (de aanroeper,
 * `infrastructure/migration/collectLocalMigrationInventory.ts`, doet zelf de
 * storage-/JSON.parse-poging en levert hier alleen het resultaat of
 * `undefined` bij ontbreken/leesfout) en bouwt er strikte
 * `LocalMigrationSection`-resultaten van. Hergebruikt bewust de BESTAANDE
 * `domain/backup/validate.ts`-sectievalidators — dezelfde strengheid als een
 * back-up-import (fail-closed: aanwezig-maar-fout-getypeerd is corrupt, niet
 * stilzwijgend een default), i.p.v. een tweede, divergerende validatiecopie
 * (plan §A: "hergebruikt PR 6.6's fail-closed validatie"). Corrupte data
 * `stopt vóór iedere cloudwrite` (werk 1) via `status: 'corrupt'` hier —
 * `preview.ts` weigert de HELE preview zodra ook maar één sectie corrupt is.
 *
 * `raw === undefined` (storage-sleutel ontbreekt/leeg): `status: 'empty'`,
 * niet `'corrupt'` — een team dat nog nooit lokaal iets opsloeg is een
 * legitieme, lege bron (v1-pariteit met `domain/backup/preview.ts`'s
 * afwezig-vs-corrupt-onderscheid), geen fout.
 */

function inventorySettings(
  raw: unknown,
): LocalMigrationSection<Settings & Record<string, unknown>> {
  if (raw === undefined) return { status: 'empty', value: null, errors: [] };
  const errors = validateSettingsSection(raw);
  if (errors.length > 0) return { status: 'corrupt', value: null, errors };
  return { status: 'ok', value: raw as Settings & Record<string, unknown>, errors: [] };
}

function inventoryRoster(raw: unknown): LocalMigrationSection<Roster> {
  if (raw === undefined) return { status: 'empty', value: null, errors: [] };
  const errors = validateRosterSection(raw);
  if (errors.length > 0) return { status: 'corrupt', value: null, errors };
  const roster = raw as Roster;
  if (roster.length === 0) return { status: 'empty', value: [], errors: [] };
  return { status: 'ok', value: roster, errors: [] };
}

/**
 * Werk 1's "onduidelijke data" dekt ook een item dat structureel geldig is
 * maar niet bij de opgevraagde bron-organisatie/team hoort — spiegelt
 * `LocalStorageGameRepository`'s eigen contextcontrole (zie die klasse's
 * docstring: "een payload die ... onder de verkeerde organisatie/team-
 * sleutel terecht is gekomen" wordt als ongeldig behandeld). Anders dan de
 * dagelijkse Historie-UI (`LocalStorageCompletedGameRepository.readAll()`,
 * die zo'n item stilzwijgend filtert — prima voor weergave) is een
 * migratie-inventarisatie STRIKTER (spiegelt `safeListStrict()`): welke
 * organisatie/team een item straks naar de cloud stuurt moet ondubbelzinnig
 * zijn, dus een mismatch stopt de hele sectie i.p.v. het item onzichtbaar te
 * filteren.
 */
function inventoryActiveGame(
  raw: unknown,
  organizationId: string,
  teamId: string,
): LocalMigrationSection<ActiveGame | null> {
  if (raw === undefined) return { status: 'empty', value: null, errors: [] };
  const errors = validateActiveGameSection(raw);
  if (errors.length > 0) return { status: 'corrupt', value: null, errors };
  // `validateActiveGameSection(null)` levert `[]` (§backup/validate.ts: expliciet
  // "geen actieve wedstrijd" is geldig) — spiegel dat hier bewust: `raw === null`
  // is een geldige, lege sectie, geen corrupte.
  if (raw === null) return { status: 'empty', value: null, errors: [] };
  const game = raw as ActiveGame;
  if (game.organizationId !== organizationId || game.teamId !== teamId) {
    return {
      status: 'corrupt',
      value: null,
      errors: [{ code: 'gameInvalid', detail: 'contextMismatch' }],
    };
  }
  return { status: 'ok', value: game, errors: [] };
}

function inventoryCompletedGames(
  raw: unknown,
  organizationId: string,
  teamId: string,
): LocalMigrationSection<CompletedGame[]> {
  if (raw === undefined) return { status: 'empty', value: null, errors: [] };
  const errors = validateCompletedGamesSection(raw);
  if (errors.length > 0) return { status: 'corrupt', value: null, errors };
  const games = raw as CompletedGame[];
  const mismatched = games.filter(
    (g) => g.organizationId !== organizationId || g.teamId !== teamId,
  );
  if (mismatched.length > 0) {
    return {
      status: 'corrupt',
      value: null,
      errors: mismatched.map((g) => ({ code: 'gameInvalid', detail: `contextMismatch:${g.id}` })),
    };
  }
  if (games.length === 0) return { status: 'empty', value: [], errors: [] };
  return { status: 'ok', value: games, errors: [] };
}

/**
 * Rauwe, per-sectie invoer voor `buildLocalMigrationInventory()` — exact wat
 * de infrastructure-laag na een storage-/JSON.parse-poging kan opleveren:
 * `undefined` bij ontbrekende sleutel/leesfout/parsefout (zelfde "kon niet
 * gelezen worden → behandel als leeg-met-mogelijke-fout hierboven, niet als
 * silent default"-conventie als `LocalStorageCompletedGameRepository.readAll()`),
 * anders de geparste `unknown`-waarde ongeacht vorm (deze module valideert
 * 'm zelf, fail-closed).
 */
export interface RawLocalMigrationSource {
  settings: unknown;
  roster: unknown;
  activeGame: unknown;
  completedGames: unknown;
}

export function buildLocalMigrationInventory(
  organizationId: string,
  teamId: string,
  raw: RawLocalMigrationSource,
): LocalMigrationInventory {
  return {
    organizationId,
    teamId,
    settings: inventorySettings(raw.settings),
    roster: inventoryRoster(raw.roster),
    activeGame: inventoryActiveGame(raw.activeGame, organizationId, teamId),
    completedGames: inventoryCompletedGames(raw.completedGames, organizationId, teamId),
  };
}

/** `true` zodra minstens één sectie corrupt is — `preview.ts` gebruikt dit
 * als harde stop (plan werk 1: "corrupte of onduidelijke data stopt vóór
 * iedere cloudwrite"). */
export function hasCorruptSection(inventory: LocalMigrationInventory): boolean {
  return (
    inventory.settings.status === 'corrupt' ||
    inventory.roster.status === 'corrupt' ||
    inventory.activeGame.status === 'corrupt' ||
    inventory.completedGames.status === 'corrupt'
  );
}
