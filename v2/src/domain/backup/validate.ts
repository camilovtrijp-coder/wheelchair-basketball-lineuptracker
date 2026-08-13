import type { Settings, SettingsKey } from '../settings/types';
import { SETTINGS_BOOLEAN_KEYS, SETTINGS_KEYS, SETTINGS_NUMBER_KEYS } from '../settings/types';
import type { RosterPlayer } from '../roster/types';
import { PLAYER_KEYS } from '../roster/types';
import type { CompletedGame, GamePlayer, Segment } from '../game/types';
import { isValidLang } from '../../i18n/strings';
import {
  BACKUP_TYPE,
  CURRENT_BACKUP_VERSION,
  type BackupV2Data,
  type BackupValidationError,
} from './types';

/**
 * PR 6.6 §C — structurele/referentiële validatie, gestructureerde foutcodes
 * (de UI vertaalt die NL/EN, plan §F 6.6a). Alles hier is puur: geen writes,
 * geen DOM. Zoals v1 (`validateBackupData`) is dit alles-of-niets per
 * aanwezige sectie — één fout in een aanwezige sectie verwerpt de HELE
 * import (geen writes), maar een ONTBREKENDE sectie is geen fout (dat is
 * precies de "leegt dat onderdeel"-semantiek uit eigenaarsbesluit §E.2).
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isBackupEnvelopeShape(
  value: unknown,
): value is { type: unknown; version: unknown; data: unknown; exportedAt?: unknown } {
  return isPlainObject(value) && isPlainObject(value.data);
}

/**
 * Plan §C.2/§C.3: eerste structuurcontrole vóór eventuele migratie. Geeft
 * de genormaliseerde versie terug (ontbrekend = v1 = `1`) zodat de
 * aanroeper weet of migratie nodig is.
 */
export function validateEnvelope(raw: unknown): {
  errors: BackupValidationError[];
  version: number;
  data: Record<string, unknown> | null;
} {
  if (!isPlainObject(raw)) {
    return { errors: [{ code: 'notPlainObject' }], version: NaN, data: null };
  }
  if (raw.type !== BACKUP_TYPE) {
    return { errors: [{ code: 'wrongType' }], version: NaN, data: null };
  }
  if (!isPlainObject(raw.data)) {
    return { errors: [{ code: 'dataNotObject' }], version: NaN, data: null };
  }
  const version = raw.version == null ? 1 : Number(raw.version);
  if (!Number.isFinite(version) || version < 1 || version > CURRENT_BACKUP_VERSION) {
    return { errors: [{ code: 'invalidVersion' }], version: NaN, data: null };
  }
  return { errors: [], version, data: raw.data };
}

function validateSettingsSection(settings: unknown): BackupValidationError[] {
  if (!isPlainObject(settings)) return [{ code: 'settingsInvalid', detail: 'not-object' }];
  const errors: BackupValidationError[] = [];
  for (const key of SETTINGS_KEYS) {
    if (!(key in settings)) {
      errors.push({ code: 'settingsInvalid', detail: `missing:${key}` });
      continue;
    }
    const value = settings[key];
    if ((SETTINGS_BOOLEAN_KEYS as readonly SettingsKey[]).includes(key)) {
      if (typeof value !== 'boolean')
        errors.push({ code: 'settingsInvalid', detail: `type:${key}` });
    } else if ((SETTINGS_NUMBER_KEYS as readonly SettingsKey[]).includes(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push({ code: 'settingsInvalid', detail: `type:${key}` });
      }
    } else if (typeof value !== 'string') {
      errors.push({ code: 'settingsInvalid', detail: `type:${key}` });
    }
  }
  return errors;
}

function validateRosterSection(roster: unknown): BackupValidationError[] {
  if (!Array.isArray(roster)) return [{ code: 'rosterInvalid', detail: 'not-array' }];
  const errors: BackupValidationError[] = [];
  const seenIds = new Set<number>();
  roster.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      errors.push({ code: 'rosterInvalid', detail: `entry:${index}` });
      return;
    }
    for (const key of PLAYER_KEYS) {
      if (!(key in entry)) {
        errors.push({ code: 'rosterInvalid', detail: `missing:${key}:${index}` });
      }
    }
    if (typeof entry.id !== 'number') {
      errors.push({ code: 'rosterInvalid', detail: `idType:${index}` });
    } else if (seenIds.has(entry.id)) {
      errors.push({ code: 'rosterDuplicateId', detail: String(entry.id) });
    } else {
      seenIds.add(entry.id);
    }
  });
  return errors;
}

/**
 * Referentiële check gedeeld door `activeGame` en elk item in
 * `completedGames`: een `Segment.lineup` moet exact 5 bekende
 * `GamePlayer.id`'s bevatten (v1-pariteit: precies vijf spelers op het
 * veld), `durSec` positief, `pf`/`pa` niet-negatief.
 */
function validateSegments(
  segments: readonly Segment[],
  players: readonly GamePlayer[],
  gameLabel: string,
): BackupValidationError[] {
  const knownIds = new Set(players.map((p) => p.id));
  const errors: BackupValidationError[] = [];
  for (const segment of segments) {
    if (!Array.isArray(segment.lineup) || segment.lineup.length !== 5) {
      errors.push({ code: 'gameInvalidLineupSize', detail: `${gameLabel}:${segment.id}` });
    } else {
      for (const id of segment.lineup) {
        if (!knownIds.has(id)) {
          errors.push({ code: 'gameUnknownLineupPlayer', detail: `${gameLabel}:${segment.id}` });
          break;
        }
      }
    }
    if (typeof segment.durSec !== 'number' || segment.durSec <= 0) {
      errors.push({ code: 'gameInvalidDuration', detail: `${gameLabel}:${segment.id}` });
    }
    if (
      typeof segment.pf !== 'number' ||
      segment.pf < 0 ||
      typeof segment.pa !== 'number' ||
      segment.pa < 0
    ) {
      errors.push({ code: 'gameInvalidScore', detail: `${gameLabel}:${segment.id}` });
    }
  }
  return errors;
}

function validateGamePlayers(players: unknown, gameLabel: string): BackupValidationError[] {
  if (!Array.isArray(players) || players.length === 0) {
    return [{ code: 'gameInvalid', detail: `players:${gameLabel}` }];
  }
  const errors: BackupValidationError[] = [];
  const seen = new Set<string>();
  for (const p of players) {
    if (!isPlainObject(p) || typeof p.id !== 'string' || typeof p.rosterId !== 'number') {
      errors.push({ code: 'gameInvalid', detail: `player:${gameLabel}` });
      continue;
    }
    if (seen.has(p.id)) {
      errors.push({ code: 'gameInvalid', detail: `duplicatePlayer:${gameLabel}` });
    }
    seen.add(p.id);
  }
  return errors;
}

export function validateCompletedGamesSection(games: unknown): BackupValidationError[] {
  if (!Array.isArray(games)) return [{ code: 'gameInvalid', detail: 'not-array' }];
  const errors: BackupValidationError[] = [];
  games.forEach((raw, index) => {
    const label = `game:${index}`;
    if (!isPlainObject(raw)) {
      errors.push({ code: 'gameInvalid', detail: label });
      return;
    }
    const game = raw as unknown as CompletedGame;
    errors.push(...validateGamePlayers(game.players, label));
    if (!Array.isArray(game.segments)) {
      errors.push({ code: 'gameInvalid', detail: `segments:${label}` });
      return;
    }
    if (Array.isArray(game.players)) {
      errors.push(...validateSegments(game.segments, game.players, label));
    }
    if (typeof game.scoreFor !== 'number' || game.scoreFor < 0) {
      errors.push({ code: 'gameInvalidScore', detail: `scoreFor:${label}` });
    }
    if (typeof game.scoreAgainst !== 'number' || game.scoreAgainst < 0) {
      errors.push({ code: 'gameInvalidScore', detail: `scoreAgainst:${label}` });
    }
  });
  return errors;
}

export function validateActiveGameSection(game: unknown): BackupValidationError[] {
  if (game === null) return [];
  if (!isPlainObject(game)) return [{ code: 'gameInvalid', detail: 'not-object' }];
  const g = game as unknown as CompletedGame;
  const errors: BackupValidationError[] = [];
  errors.push(...validateGamePlayers(g.players, 'activeGame'));
  if (!Array.isArray(g.segments)) {
    errors.push({ code: 'gameInvalid', detail: 'segments:activeGame' });
  } else if (Array.isArray(g.players)) {
    errors.push(...validateSegments(g.segments, g.players, 'activeGame'));
  }
  return errors;
}

/**
 * Valideert een reeds-gemigreerde `BackupV2Data` (plan §C.5). Retourneert
 * alle gevonden fouten; de aanroeper schrijft pas als deze lijst leeg is.
 */
export function validateBackupData(data: BackupV2Data): BackupValidationError[] {
  const errors: BackupValidationError[] = [];

  if (
    data.settings === undefined &&
    data.roster === undefined &&
    data.activeGame === undefined &&
    data.completedGames === undefined &&
    data.lang === undefined
  ) {
    return [{ code: 'emptyData' }];
  }

  if (data.settings !== undefined) {
    errors.push(...validateSettingsSection(data.settings as unknown as Settings));
  }
  if (data.roster !== undefined) {
    errors.push(...validateRosterSection(data.roster as unknown as RosterPlayer[]));
  }
  if (data.activeGame !== undefined) {
    errors.push(...validateActiveGameSection(data.activeGame));
  }
  if (data.completedGames !== undefined) {
    errors.push(...validateCompletedGamesSection(data.completedGames));
  }
  if (data.lang !== undefined && !isValidLang(data.lang)) {
    errors.push({ code: 'langInvalid' });
  }

  return errors;
}
