import type { GamePlayer, Segment, ActiveGame, CompletedGame } from '../game/types';
import { V1_ACTIVE_GAME_STORAGE_KEY, migrateV1ActiveGame } from '../game/v1Migration';
import { ROSTER_STORAGE_KEY } from '../roster/types';
import { SETTINGS_STORAGE_KEY } from '../settings/types';
import { LANG_STORAGE_KEY, isValidLang } from '../../i18n/strings';
import type { BackupV2Data, BackupValidationError } from './types';
import { validateSettingsSection, validateRosterSection } from './validate';

/**
 * v1's `GAMES_KEY` (index.html `BACKUP_KEYS`) — de enige v1-back-upsleutel
 * zonder al een v2-tegenhanger, omdat v1 geen historie-repository kende (die
 * kwam pas in PR 6.3, per organisatie/team). Alleen relevant voor back-up-
 * import, niet voor live app-migratie — vandaar hier gedefinieerd i.p.v. in
 * `domain/game/v1Migration.ts`.
 */
export const V1_GAMES_STORAGE_KEY = 'lineup-tracker-games';

/**
 * De vijf v1-back-upsleutels (index.html `BACKUP_KEYS`), in dezelfde
 * volgorde als v1's `exportBackup()`. Een v1-back-up-`data`-object bevat een
 * subset van deze sleutels als top-level properties.
 */
export const V1_BACKUP_KEYS = [
  V1_ACTIVE_GAME_STORAGE_KEY,
  ROSTER_STORAGE_KEY,
  V1_GAMES_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  LANG_STORAGE_KEY,
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function remapIds(ids: unknown, idMap: Map<number, string>): string[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .map((id) => (typeof id === 'number' ? idMap.get(id) : undefined))
    .filter((id): id is string => id !== undefined);
}

/**
 * Deterministische, herhaalbare ID's afgeleid van het v1-`Game.id` (plan §D:
 * "vertrouw niet op een nieuwe `randomUUID()` per poging"). Twee migraties
 * van EXACT dezelfde v1-back-up moeten byte-voor-byte dezelfde
 * `CompletedGame` opleveren, anders zou `replaceAll()`-idempotentie bij
 * retry alsnog een ander resultaat geven (externe PR-6.6-review, aug. 2026).
 * `legacyGameId` is zelf al verplicht (zie `migrateV1CompletedGame` hieronder
 * — ontbreken is nu een migratiefout, geen willekeurige fallback).
 */
function deterministicGameId(legacyGameId: string): string {
  return `v1-import:${legacyGameId}`;
}
function deterministicPlayerId(legacyGameId: string, rosterId: number): string {
  return `v1-import:${legacyGameId}:player:${rosterId}`;
}
function deterministicSegmentId(legacyGameId: string, index: number): string {
  return `v1-import:${legacyGameId}:segment:${index}`;
}

/**
 * Projecteert één v1-`Game` (uit `lineup-tracker-games`) naar een
 * context-vrije `CompletedGame` — `organizationId`/`teamId` zijn hier nog
 * lege placeholders; `application/backup/BackupCoordinator.ts` tagt ze pas
 * na de door de gebruiker bevestigde doelcontext (plan §D: "Alle
 * gemigreerde objecten worden pas na volledige projectie met de
 * doelcontext getagd"). Spiegelt `migrateV1ActiveGame()`'s
 * spelersnapshot-/lineup-remapping (zelfde numerieke v1-speler-ID-schema),
 * maar zonder actielog — `CompletedGame` bevriest score/segmenten al direct.
 *
 * Fail-closed (externe PR-6.6-review, aug. 2026): een ontbrekend/ongeldig
 * `Game.id`, een niet-plain-object spelers-/segment-item, of een
 * niet-numerieke speler-`id` maakt de HELE wedstrijd ongeldig (`null`) i.p.v.
 * stilzwijgend te defaulten naar `0`/`''`/een nieuwe willekeurige UUID — een
 * corrupte v1-back-up mag nooit een halve of verzonnen wedstrijd opleveren.
 */
/** `undefined` bij een ontbrekend/verkeerd-getypeerd verplicht stringveld —
 * NOOIT een fallback-waarde (externe PR-6.6-review, aug. 2026: `str(...,
 * '')`/`num(..., 0)` maskeerden eerder een aanwezige-maar-fout-getypeerde
 * v1-waarde — bv. `scoreFor: "6"` — als een stille `0`, vóórdat
 * `validateBackupData()` de kans kreeg die typefout te zien). */
function reqStr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function reqNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function reqBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function migrateV1CompletedGame(raw: unknown): CompletedGame | null {
  if (!isPlainObject(raw)) return null;
  if (!Array.isArray(raw.players) || !Array.isArray(raw.segments)) return null;
  if (typeof raw.id !== 'string' && typeof raw.id !== 'number') return null;
  const date = reqStr(raw.date);
  if (date === undefined) return null;
  const opponent = reqStr(raw.opponent);
  const competition = reqStr(raw.competition);
  const scoreFor = reqNum(raw.scoreFor);
  const scoreAgainst = reqNum(raw.scoreAgainst);
  const quarterCount = reqNum(raw.quarterCount);
  const periodLabel = reqStr(raw.periodLabel);
  const useClassLimit = reqBool(raw.useClassLimit);
  if (
    opponent === undefined ||
    competition === undefined ||
    scoreFor === undefined ||
    scoreAgainst === undefined ||
    quarterCount === undefined ||
    periodLabel === undefined ||
    useClassLimit === undefined
  ) {
    return null;
  }
  const legacyGameId = String(raw.id);

  const idMap = new Map<number, string>();
  const players: GamePlayer[] = [];
  for (const rawPlayer of raw.players) {
    if (!isPlainObject(rawPlayer) || typeof rawPlayer.id !== 'number') return null;
    const nr = reqStr(rawPlayer.nr);
    const naam = reqStr(rawPlayer.naam);
    const kl = reqStr(rawPlayer.kl);
    const vrouw = reqBool(rawPlayer.vrouw);
    const jeugd = reqBool(rawPlayer.jeugd);
    // v1's `finishGame()` snapshot (index.html) bewaart uitsluitend de zes
    // teamvelden en laat de per-wedstrijdkeuzes `participate`/`start` bewust
    // weg. Oudere/handmatige exports kunnen deze velden wel bevatten: als
    // ze aanwezig zijn moeten ze booleans zijn, maar afwezigheid is de
    // geldige canonieke v1-vorm. Gebruik dan dezelfde compatibiliteits-
    // defaults als vóór de fail-closed aanscherping.
    const participate = 'participate' in rawPlayer ? reqBool(rawPlayer.participate) : true;
    const start = 'start' in rawPlayer ? reqBool(rawPlayer.start) : false;
    if (
      nr === undefined ||
      naam === undefined ||
      kl === undefined ||
      vrouw === undefined ||
      jeugd === undefined ||
      participate === undefined ||
      start === undefined
    ) {
      return null;
    }
    const rosterId = rawPlayer.id;
    const gamePlayerId = deterministicPlayerId(legacyGameId, rosterId);
    idMap.set(rosterId, gamePlayerId);
    players.push({ id: gamePlayerId, rosterId, nr, naam, kl, vrouw, jeugd, participate, start });
  }

  const segments: Segment[] = [];
  for (let index = 0; index < raw.segments.length; index += 1) {
    const rawSegment = raw.segments[index];
    if (!isPlainObject(rawSegment)) return null;
    const quarter = reqNum(rawSegment.quarter);
    const beginSec = reqNum(rawSegment.beginSec);
    const endSec = reqNum(rawSegment.endSec);
    const durSec = reqNum(rawSegment.durSec);
    const pf = reqNum(rawSegment.pf);
    const pa = reqNum(rawSegment.pa);
    const classSum = reqNum(rawSegment.classSum);
    const allowed = reqNum(rawSegment.allowed);
    const over = reqBool(rawSegment.over);
    if (
      quarter === undefined ||
      beginSec === undefined ||
      endSec === undefined ||
      durSec === undefined ||
      pf === undefined ||
      pa === undefined ||
      classSum === undefined ||
      allowed === undefined ||
      over === undefined
    ) {
      return null;
    }
    segments.push({
      id: deterministicSegmentId(legacyGameId, index),
      quarter,
      beginSec,
      endSec,
      durSec,
      lineup: remapIds(rawSegment.lineup, idMap),
      pf,
      pa,
      classSum,
      allowed,
      over,
    });
  }

  return {
    id: deterministicGameId(legacyGameId),
    organizationId: '',
    teamId: '',
    // Provenance: traceert terug naar het v1-`Game.id`. Ook gebruikt als
    // basis voor `id` hierboven — een herhaalde migratie van dezelfde
    // back-up levert zo een identiek object op, waardoor `replaceAll()`
    // (zie BackupCoordinator) een retry idempotent maakt zonder aparte
    // dedupe-sleutel.
    sourceGameId: `v1-import:${legacyGameId}`,
    opponent,
    competition,
    date,
    players,
    segments,
    scoreFor,
    scoreAgainst,
    quarterCount,
    periodLabel,
    useClassLimit,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
  };
}

export interface V1MigrationResult {
  data: BackupV2Data;
  errors: BackupValidationError[];
}

/**
 * Projecteert v1's back-up-`data`-object (subset van `V1_BACKUP_KEYS`) naar
 * `BackupV2Data`. Puur en context-vrij: `activeGame`/`completedGames`-items
 * krijgen lege `organizationId`/`teamId`-placeholders, retagging gebeurt
 * pas na bevestiging (zie `retagWithContext()` hieronder en plan §D).
 * Settings/roster hergebruiken de bestaande normalizers — "onbekende velden
 * alleen behouden wanneer het actuele contract dat expliciet toestaat"
 * (plan §D) is precies wat `normalizeSettings`/`normalizeRoster` al doen.
 *
 * Fail-closed op de wedstrijdenlijst (externe PR-6.6-review, aug. 2026): als
 * `lineup-tracker-games` aanwezig is maar één item niet migreerbaar is (bv.
 * `null`, of een structureel ongeldige wedstrijd), wordt dat NIET
 * stilzwijgend uit de lijst gefilterd — de hele migratie faalt met een
 * `migrationFailed`-fout, zodat een bevestiging nooit onbedoeld minder
 * wedstrijden importeert dan de back-up feitelijk bevatte (en zo geldige
 * doelhistorie kan leegmaken via het replace-per-onderdeel-contract).
 */
/**
 * Structurele plausibiliteitscheck vóór `migrateV1ActiveGame()` (externe
 * PR-6.6-review, aug. 2026): die functie retourneert `null` zowel voor
 * "structureel onbruikbaar" als voor de bewust toegestane, legitieme v1-
 * uitzondering "opzet nog niet gestart, dus niet hervatbaar" (zie
 * `isV1Resumable()` in `domain/game/v1Migration.ts` — geen segments én geen
 * `phase:'tracking'`). Zonder onderscheid zou een corrupte v1-actieve-
 * wedstrijd (bv. `players` niet eens een array) stilzwijgend als "geen
 * actieve wedstrijd" behandeld worden i.p.v. de import te blokkeren. Alleen
 * de vorm wordt hier gecontroleerd; welke v1-staat wél/niet hervatbaar is
 * blijft uitsluitend `isV1Resumable()`'s beslissing.
 */
function isPlausibleV1ActiveGame(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  if (!Array.isArray(value.players)) return false;
  return value.players.every((p) => isPlainObject(p));
}

export function migrateV1BackupData(raw: unknown): V1MigrationResult {
  if (!isPlainObject(raw)) return { data: {}, errors: [] };
  const result: BackupV2Data = {};
  const errors: BackupValidationError[] = [];

  // Fail-closed op settings/roster/taal (externe PR-6.6-review, aug. 2026):
  // `normalizeSettings`/`normalizeRoster` zijn bewust permissief voor de
  // LIVE-app-boot (v1-pariteit: ontbrekende/onbruikbare opgeslagen data
  // valt daar terug op defaults/leeg, en niet-object rosterentries worden
  // stil gefilterd — zie hun eigen docstrings), maar die permissiviteit
  // hoort niet thuis in een back-up-IMPORT: v1's eigen `validateSettings()`
  // wijst een back-up met ontbrekende settingsvelden al af, en een
  // `[geldigeSpeler, null]`-roster hoort de HELE import te blokkeren, niet
  // stilzwijgend tot één speler te worden ingekort. Hergebruikt daarom
  // dezelfde velddiepe validators als de v2-sectievalidatie
  // (`validateSettingsSection`/`validateRosterSection` uit `validate.ts`)
  // in plaats van de permissieve normalizers: de rauwe v1-data moet AL
  // volledig en correct getypeerd zijn vóór migratie, er wordt niets meer
  // aangevuld/gerepareerd.
  if (SETTINGS_STORAGE_KEY in raw) {
    const rawSettings = raw[SETTINGS_STORAGE_KEY];
    const settingsErrors = validateSettingsSection(rawSettings);
    if (settingsErrors.length > 0) {
      errors.push({ code: 'migrationFailed', detail: 'settings' });
    } else {
      result.settings = rawSettings as BackupV2Data['settings'];
    }
  }
  if (ROSTER_STORAGE_KEY in raw) {
    const rawRoster = raw[ROSTER_STORAGE_KEY];
    const rosterErrors = validateRosterSection(rawRoster);
    if (rosterErrors.length > 0) {
      errors.push({ code: 'migrationFailed', detail: 'roster' });
    } else {
      result.roster = rawRoster as BackupV2Data['roster'];
    }
  }
  if (LANG_STORAGE_KEY in raw) {
    const lang = raw[LANG_STORAGE_KEY];
    if (!isValidLang(lang)) {
      errors.push({ code: 'migrationFailed', detail: 'lang' });
    } else {
      result.lang = lang;
    }
  }
  if (V1_ACTIVE_GAME_STORAGE_KEY in raw) {
    const rawActiveGame = raw[V1_ACTIVE_GAME_STORAGE_KEY];
    if (
      rawActiveGame !== null &&
      rawActiveGame !== undefined &&
      !isPlausibleV1ActiveGame(rawActiveGame)
    ) {
      errors.push({ code: 'migrationFailed', detail: 'activeGame' });
    } else {
      // migrateV1ActiveGame vereist organizationId/teamId als parameter (het
      // bestaande PR-6.1-contract) — hier nog lege placeholders, retagging
      // gebeurt pas na bevestiging (zie retagWithContext()). `null` hier is
      // ofwel afwezige data ofwel isV1Resumable()'s legitieme "niet
      // hervatbaar" — beide zijn geen migratiefout.
      const migrated = migrateV1ActiveGame(rawActiveGame, '', '');
      if (migrated !== null) result.activeGame = migrated;
    }
  }
  if (V1_GAMES_STORAGE_KEY in raw) {
    const gamesRaw = raw[V1_GAMES_STORAGE_KEY];
    if (!Array.isArray(gamesRaw)) {
      errors.push({ code: 'migrationFailed', detail: 'games-not-array' });
    } else {
      const migratedGames: CompletedGame[] = [];
      for (let index = 0; index < gamesRaw.length; index += 1) {
        const migrated = migrateV1CompletedGame(gamesRaw[index]);
        if (migrated === null) {
          errors.push({ code: 'migrationFailed', detail: `game:${index}` });
        } else {
          migratedGames.push(migrated);
        }
      }
      if (errors.length === 0) result.completedGames = migratedGames;
    }
  }

  return { data: errors.length === 0 ? result : {}, errors };
}

/**
 * Tagt een gemigreerde/geïmporteerde `BackupV2Data` met de door de
 * gebruiker bevestigde doelcontext. Puur — schrijft niets; de coordinator
 * roept dit pas aan ná expliciete bevestiging van organisatie + team (plan
 * §C.7/§D). `activeGame: null` (expliciet "geen wedstrijd") blijft `null`.
 */
export function retagWithContext(
  data: BackupV2Data,
  organizationId: string,
  teamId: string,
): BackupV2Data {
  return {
    ...data,
    activeGame:
      data.activeGame === undefined
        ? undefined
        : data.activeGame === null
          ? null
          : ({ ...data.activeGame, organizationId, teamId } as ActiveGame),
    completedGames: data.completedGames?.map((g) => ({ ...g, organizationId, teamId })),
  };
}
