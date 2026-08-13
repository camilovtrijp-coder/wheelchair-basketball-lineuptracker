import type { GamePlayer, Segment, ActiveGame, CompletedGame } from '../game/types';
import { V1_ACTIVE_GAME_STORAGE_KEY, migrateV1ActiveGame } from '../game/v1Migration';
import { ROSTER_STORAGE_KEY } from '../roster/types';
import { normalizeRoster } from '../roster/normalize';
import { SETTINGS_STORAGE_KEY } from '../settings/types';
import { normalizeSettings } from '../settings/normalize';
import { LANG_STORAGE_KEY, isValidLang } from '../../i18n/strings';
import type { BackupV2Data, BackupValidationError } from './types';

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

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

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
export function migrateV1CompletedGame(raw: unknown): CompletedGame | null {
  if (!isPlainObject(raw)) return null;
  if (!Array.isArray(raw.players) || !Array.isArray(raw.segments)) return null;
  if (typeof raw.id !== 'string' && typeof raw.id !== 'number') return null;
  if (typeof raw.date !== 'string') return null;
  const legacyGameId = String(raw.id);

  const idMap = new Map<number, string>();
  const players: GamePlayer[] = [];
  for (const rawPlayer of raw.players) {
    if (!isPlainObject(rawPlayer) || typeof rawPlayer.id !== 'number') return null;
    const rosterId = rawPlayer.id;
    const gamePlayerId = deterministicPlayerId(legacyGameId, rosterId);
    idMap.set(rosterId, gamePlayerId);
    players.push({
      id: gamePlayerId,
      rosterId,
      nr: str(rawPlayer.nr, ''),
      naam: str(rawPlayer.naam, ''),
      kl: str(rawPlayer.kl, ''),
      vrouw: rawPlayer.vrouw === true,
      jeugd: rawPlayer.jeugd === true,
      participate: rawPlayer.participate !== false,
      start: rawPlayer.start === true,
    });
  }

  const segments: Segment[] = [];
  for (let index = 0; index < raw.segments.length; index += 1) {
    const rawSegment = raw.segments[index];
    if (!isPlainObject(rawSegment)) return null;
    segments.push({
      id: deterministicSegmentId(legacyGameId, index),
      quarter: num(rawSegment.quarter, 1),
      beginSec: num(rawSegment.beginSec, 0),
      endSec: num(rawSegment.endSec, 0),
      durSec: num(rawSegment.durSec, 0),
      lineup: remapIds(rawSegment.lineup, idMap),
      pf: num(rawSegment.pf, 0),
      pa: num(rawSegment.pa, 0),
      classSum: num(rawSegment.classSum, 0),
      allowed: num(rawSegment.allowed, 0),
      over: rawSegment.over === true,
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
    opponent: str(raw.opponent, ''),
    competition: str(raw.competition, ''),
    date: raw.date,
    players,
    segments,
    scoreFor: num(raw.scoreFor, 0),
    scoreAgainst: num(raw.scoreAgainst, 0),
    quarterCount: num(raw.quarterCount, 4),
    periodLabel: str(raw.periodLabel, ''),
    useClassLimit: raw.useClassLimit === true,
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
export function migrateV1BackupData(raw: unknown): V1MigrationResult {
  if (!isPlainObject(raw)) return { data: {}, errors: [] };
  const result: BackupV2Data = {};
  const errors: BackupValidationError[] = [];

  if (SETTINGS_STORAGE_KEY in raw) {
    result.settings = normalizeSettings(raw[SETTINGS_STORAGE_KEY]);
  }
  if (ROSTER_STORAGE_KEY in raw) {
    result.roster = normalizeRoster(raw[ROSTER_STORAGE_KEY]);
  }
  if (LANG_STORAGE_KEY in raw) {
    const lang = raw[LANG_STORAGE_KEY];
    if (isValidLang(lang)) result.lang = lang;
  }
  if (V1_ACTIVE_GAME_STORAGE_KEY in raw) {
    // migrateV1ActiveGame vereist organizationId/teamId als parameter (het
    // bestaande PR-6.1-contract) — hier nog lege placeholders, retagging
    // gebeurt pas na bevestiging (zie retagWithContext()).
    const migrated = migrateV1ActiveGame(raw[V1_ACTIVE_GAME_STORAGE_KEY], '', '');
    if (migrated !== null) result.activeGame = migrated;
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
