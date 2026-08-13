import type { GamePlayer, Segment, ActiveGame, CompletedGame } from '../game/types';
import { V1_ACTIVE_GAME_STORAGE_KEY, migrateV1ActiveGame } from '../game/v1Migration';
import { ROSTER_STORAGE_KEY } from '../roster/types';
import { normalizeRoster } from '../roster/normalize';
import { SETTINGS_STORAGE_KEY } from '../settings/types';
import { normalizeSettings } from '../settings/normalize';
import { LANG_STORAGE_KEY, isValidLang } from '../../i18n/strings';
import type { BackupV2Data } from './types';

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
 * Projecteert één v1-`Game` (uit `lineup-tracker-games`) naar een
 * context-vrije `CompletedGame` — `organizationId`/`teamId` zijn hier nog
 * lege placeholders; `application/backup/BackupCoordinator.ts` tagt ze pas
 * na de door de gebruiker bevestigde doelcontext (plan §D: "Alle
 * gemigreerde objecten worden pas na volledige projectie met de
 * doelcontext getagd"). Spiegelt exact `migrateV1ActiveGame()`'s
 * spelersnapshot-/lineup-remapping (zelfde numerieke v1-speler-ID-schema),
 * maar zonder actielog — `CompletedGame` bevriest score/segmenten al direct.
 */
export function migrateV1CompletedGame(raw: unknown): CompletedGame | null {
  if (!isPlainObject(raw)) return null;
  if (!Array.isArray(raw.players) || !Array.isArray(raw.segments)) return null;

  const idMap = new Map<number, string>();
  const players: GamePlayer[] = raw.players.map((rawPlayer) => {
    const p = isPlainObject(rawPlayer) ? rawPlayer : {};
    const rosterId = num(p.id, 0);
    const gamePlayerId = crypto.randomUUID();
    idMap.set(rosterId, gamePlayerId);
    return {
      id: gamePlayerId,
      rosterId,
      nr: str(p.nr, ''),
      naam: str(p.naam, ''),
      kl: str(p.kl, ''),
      vrouw: p.vrouw === true,
      jeugd: p.jeugd === true,
      participate: p.participate !== false,
      start: p.start === true,
    };
  });

  const segments: Segment[] = raw.segments.map((rawSegment) => {
    const s = isPlainObject(rawSegment) ? rawSegment : {};
    return {
      id: crypto.randomUUID(),
      quarter: num(s.quarter, 1),
      beginSec: num(s.beginSec, 0),
      endSec: num(s.endSec, 0),
      durSec: num(s.durSec, 0),
      lineup: remapIds(s.lineup, idMap),
      pf: num(s.pf, 0),
      pa: num(s.pa, 0),
      classSum: num(s.classSum, 0),
      allowed: num(s.allowed, 0),
      over: s.over === true,
    };
  });

  return {
    id: crypto.randomUUID(),
    organizationId: '',
    teamId: '',
    // Provenance: traceert terug naar het v1-`Game.id` — puur diagnostisch,
    // niet gebruikt voor deduplicatie (die loopt via `replaceAll()`, zie
    // BackupCoordinator: een herhaalde import van dezelfde back-up
    // vervangt de doellijst identiek i.p.v. te stapelen).
    sourceGameId: `v1-import:${str(raw.id, crypto.randomUUID())}`,
    opponent: str(raw.opponent, ''),
    competition: str(raw.competition, ''),
    date: str(raw.date, new Date().toISOString()),
    players,
    segments,
    scoreFor: num(raw.scoreFor, 0),
    scoreAgainst: num(raw.scoreAgainst, 0),
    quarterCount: num(raw.quarterCount, 4),
    periodLabel: str(raw.periodLabel, ''),
    useClassLimit: raw.useClassLimit === true,
  };
}

/**
 * Projecteert v1's back-up-`data`-object (subset van `V1_BACKUP_KEYS`) naar
 * `BackupV2Data`. Puur en context-vrij: `activeGame`/`completedGames`-items
 * krijgen lege `organizationId`/`teamId`-placeholders, retagging gebeurt
 * pas na bevestiging (zie `retagWithContext()` hieronder en plan §D).
 * Settings/roster hergebruiken de bestaande normalizers — "onbekende velden
 * alleen behouden wanneer het actuele contract dat expliciet toestaat"
 * (plan §D) is precies wat `normalizeSettings`/`normalizeRoster` al doen.
 */
export function migrateV1BackupData(raw: unknown): BackupV2Data {
  if (!isPlainObject(raw)) return {};
  const result: BackupV2Data = {};

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
    if (Array.isArray(gamesRaw)) {
      result.completedGames = gamesRaw
        .map((g) => migrateV1CompletedGame(g))
        .filter((g): g is CompletedGame => g !== null);
    }
  }

  return result;
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
