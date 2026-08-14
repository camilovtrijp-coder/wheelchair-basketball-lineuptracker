import type { Settings, SettingsKey } from '../settings/types';
import { SETTINGS_BOOLEAN_KEYS, SETTINGS_KEYS, SETTINGS_NUMBER_KEYS } from '../settings/types';
import type { RosterPlayer } from '../roster/types';
import { PLAYER_KEYS } from '../roster/types';
import type { ActiveGame, CompletedGame, GamePlayer, Segment } from '../game/types';
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
 *
 * Externe PR-6.6-review (aug. 2026): een vóór-migratie v2-native back-up
 * (`version: 2`) komt HIER binnen zonder door `migrateV1.ts`'s defensieve
 * `isPlainObject`-guards te zijn gegaan — elke sectie/array-item moet dus
 * hier zelf, opnieuw, tegen malformed/`null`-invoer bestand zijn (niet
 * aannemen dat een `Segment`/`GamePlayer`/`CompletedGame`-typering ook
 * daadwerkelijk een object oplevert). Zonder deze guards crasht een
 * `segments: [null]`-back-up met een ongefilterde `TypeError` i.p.v. een
 * vertaalde validatiefout.
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
 * aanroeper weet of migratie nodig is. Alleen gehele ondersteunde versies
 * worden geaccepteerd (`1.5` is bijvoorbeeld geen geldige versie — externe
 * PR-6.6-review, aug. 2026).
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
  if (!Number.isInteger(version) || version < 1 || version > CURRENT_BACKUP_VERSION) {
    return { errors: [{ code: 'invalidVersion' }], version: NaN, data: null };
  }
  return { errors: [], version, data: raw.data };
}

/** Nu ook exported (externe PR-6.6-review, aug. 2026) voor hergebruik door
 * `migrateV1.ts`'s fail-closed v1-settingsmigratie — die mag `normalizeSettings()`
 * (bewust permissief, vult ontbrekende velden aan met defaults, zie de
 * docstring daar) niet gebruiken vóórdat de RAUWE v1-data eerst tegen
 * dezelfde eisen als v1's eigen validator is getoetst: v1 wijst een
 * back-up met ontbrekende settingsvelden af i.p.v. ze aan te vullen. */
export function validateSettingsSection(settings: unknown): BackupValidationError[] {
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

const ROSTER_STRING_KEYS = ['nr', 'naam', 'kl'] as const;
const ROSTER_BOOLEAN_KEYS = ['vrouw', 'jeugd'] as const;

/**
 * Externe PR-6.6-review (aug. 2026): controleerde voorheen alleen
 * AANWEZIGHEID van de bekende velden en het TYPE van `id` — een aanwezig
 * maar verkeerd-getypeerd `nr`/`naam`/`kl`/`vrouw`/`jeugd` (bv. `nr: 9`
 * i.p.v. `"9"`) werd zo geaccepteerd. Nu ook exported voor hergebruik door
 * `migrateV1.ts`'s fail-closed v1-rostermigratie (die dezelfde strengheid
 * nodig heeft als deze v2-sectievalidatie, i.p.v. `normalizeRoster()`'s
 * bewust permissieve live-app-boot-contract).
 */
export function validateRosterSection(roster: unknown): BackupValidationError[] {
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
    for (const key of ROSTER_STRING_KEYS) {
      if (key in entry && typeof entry[key] !== 'string') {
        errors.push({ code: 'rosterInvalid', detail: `type:${key}:${index}` });
      }
    }
    for (const key of ROSTER_BOOLEAN_KEYS) {
      if (key in entry && typeof entry[key] !== 'boolean') {
        errors.push({ code: 'rosterInvalid', detail: `type:${key}:${index}` });
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

const SEGMENT_STRING_KEYS = ['id'] as const;
const SEGMENT_NUMBER_KEYS = [
  'quarter',
  'beginSec',
  'endSec',
  'durSec',
  'pf',
  'pa',
  'classSum',
  'allowed',
] as const;

/**
 * Eén segment (los van de array eromheen) tegen een bekende spelers-ID-set.
 * Gedeeld door `completedGames[].segments` en elke `segment-saved`/
 * `segment-edited`-actie in `activeGame.actions` (externe PR-6.6-review, aug.
 * 2026: die embedded segmenten werden voorheen helemaal niet gecontroleerd —
 * alleen de array/veld-AANWEZIGHEID van `actions`, niet de inhoud). Elk item
 * wordt EERST als plain object gecontroleerd — de invoer is op dit punt nog
 * ongevalideerde `unknown`, ondanks de `readonly Segment[]`-typering
 * (`segments: [null]` mag nooit een TypeError geven).
 */
function validateSegmentShape(
  raw: unknown,
  knownIds: Set<string>,
  segLabel: string,
): BackupValidationError[] {
  const errors: BackupValidationError[] = [];
  if (!isPlainObject(raw)) {
    errors.push({ code: 'gameInvalid', detail: `segment:${segLabel}` });
    return errors;
  }
  for (const key of SEGMENT_STRING_KEYS) {
    if (typeof raw[key] !== 'string') {
      errors.push({ code: 'gameInvalid', detail: `segmentField:${key}:${segLabel}` });
    }
  }
  for (const key of SEGMENT_NUMBER_KEYS) {
    if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key])) {
      errors.push({ code: 'gameInvalid', detail: `segmentField:${key}:${segLabel}` });
    }
  }
  if (typeof raw.over !== 'boolean') {
    errors.push({ code: 'gameInvalid', detail: `segmentField:over:${segLabel}` });
  }
  const segment = raw as unknown as Segment;
  if (!Array.isArray(segment.lineup) || segment.lineup.length !== 5) {
    errors.push({ code: 'gameInvalidLineupSize', detail: segLabel });
  } else {
    for (const id of segment.lineup) {
      if (!knownIds.has(id)) {
        errors.push({ code: 'gameUnknownLineupPlayer', detail: segLabel });
        break;
      }
    }
  }
  if (typeof segment.durSec !== 'number' || segment.durSec <= 0) {
    errors.push({ code: 'gameInvalidDuration', detail: segLabel });
  } else if (
    typeof segment.beginSec === 'number' &&
    typeof segment.endSec === 'number' &&
    segment.durSec !== Math.abs(segment.endSec - segment.beginSec)
  ) {
    // Zelfde formule als `applyAction`'s segment-saved-tak
    // (domain/game/tracking.ts) — een afwijkende `durSec` kan geen
    // consistente CSV/stats-berekening opleveren.
    errors.push({ code: 'gameInvalidDuration', detail: `inconsistent:${segLabel}` });
  }
  if (
    typeof segment.pf !== 'number' ||
    segment.pf < 0 ||
    typeof segment.pa !== 'number' ||
    segment.pa < 0
  ) {
    errors.push({ code: 'gameInvalidScore', detail: segLabel });
  }
  return errors;
}

function validateSegments(
  segments: readonly unknown[],
  players: readonly GamePlayer[],
  gameLabel: string,
): BackupValidationError[] {
  const knownIds = new Set(players.map((p) => p.id));
  const errors: BackupValidationError[] = [];
  segments.forEach((raw, index) => {
    errors.push(...validateSegmentShape(raw, knownIds, `${gameLabel}:segment:${index}`));
  });
  return errors;
}

function validateGamePlayers(players: unknown, gameLabel: string): BackupValidationError[] {
  if (!Array.isArray(players) || players.length === 0) {
    return [{ code: 'gameInvalid', detail: `players:${gameLabel}` }];
  }
  const errors: BackupValidationError[] = [];
  const seen = new Set<string>();
  players.forEach((p, index) => {
    if (
      !isPlainObject(p) ||
      typeof p.id !== 'string' ||
      typeof p.rosterId !== 'number' ||
      typeof p.nr !== 'string' ||
      typeof p.naam !== 'string' ||
      typeof p.kl !== 'string' ||
      typeof p.vrouw !== 'boolean' ||
      typeof p.jeugd !== 'boolean' ||
      typeof p.participate !== 'boolean' ||
      typeof p.start !== 'boolean'
    ) {
      errors.push({ code: 'gameInvalid', detail: `player:${gameLabel}:${index}` });
      return;
    }
    if (seen.has(p.id)) {
      errors.push({ code: 'gameInvalid', detail: `duplicatePlayer:${gameLabel}` });
    }
    seen.add(p.id);
  });
  return errors;
}

/** Verplichte top-level `CompletedGame`-velden buiten spelers/segmenten/score
 * (die krijgen hun eigen, specifiekere foutcodes hierboven/-onder). Zonder
 * deze check accepteerde `validateCompletedGamesSection` eerder een
 * `CompletedGame` met alleen `id`/`date`/`players`/`segments`/`scoreFor`/
 * `scoreAgainst` — `sourceGameId`, `opponent`, `competition`, `quarterCount`,
 * `periodLabel` en `useClassLimit` ontbraken dan stilzwijgend (externe
 * PR-6.6-review, aug. 2026). */
const COMPLETED_GAME_STRING_KEYS = [
  'id',
  'sourceGameId',
  'opponent',
  'competition',
  'date',
] as const;
const COMPLETED_GAME_NUMBER_KEYS = ['quarterCount'] as const;

function validateCompletedGameFields(
  game: Record<string, unknown>,
  label: string,
): BackupValidationError[] {
  const errors: BackupValidationError[] = [];
  for (const key of COMPLETED_GAME_STRING_KEYS) {
    if (typeof game[key] !== 'string') {
      errors.push({ code: 'gameInvalid', detail: `field:${key}:${label}` });
    }
  }
  for (const key of COMPLETED_GAME_NUMBER_KEYS) {
    if (typeof game[key] !== 'number' || !Number.isFinite(game[key])) {
      errors.push({ code: 'gameInvalid', detail: `field:${key}:${label}` });
    }
  }
  if (typeof game.periodLabel !== 'string') {
    errors.push({ code: 'gameInvalid', detail: `field:periodLabel:${label}` });
  }
  if (typeof game.useClassLimit !== 'boolean') {
    errors.push({ code: 'gameInvalid', detail: `field:useClassLimit:${label}` });
  }
  return errors;
}

/**
 * Externe PR-6.6-review (aug. 2026): een dubbele `CompletedGame.id`/
 * `sourceGameId` binnen ÉÉN payload werd niet gedetecteerd — bijvoorbeeld
 * twee v1-wedstrijden met hetzelfde legacy-`Game.id` krijgen via de
 * deterministische mapping (`domain/backup/migrateV1.ts`) exact hetzelfde
 * gemigreerde `id`/`sourceGameId` en werden beide geaccepteerd. Omdat
 * `replaceAll()` (zie `BackupCoordinator`) de VOLLEDIGE doellijst in één
 * keer vervangt, zou zo'n interne botsing twee entries met hetzelfde ID
 * naast elkaar wegschrijven — een lijst die per-ID geïndexeerd/verwijderd
 * wordt (zie `remove(id)`) hoort nooit dubbele ID's te bevatten.
 */
function findDuplicateGameIds(games: readonly CompletedGame[]): BackupValidationError[] {
  const errors: BackupValidationError[] = [];
  const seenIds = new Set<string>();
  const seenSourceIds = new Set<string>();
  games.forEach((game, index) => {
    if (typeof game.id === 'string') {
      if (seenIds.has(game.id)) {
        errors.push({ code: 'gameDuplicateId', detail: `id:${game.id}:game:${index}` });
      } else {
        seenIds.add(game.id);
      }
    }
    if (typeof game.sourceGameId === 'string') {
      if (seenSourceIds.has(game.sourceGameId)) {
        errors.push({
          code: 'gameDuplicateId',
          detail: `sourceGameId:${game.sourceGameId}:game:${index}`,
        });
      } else {
        seenSourceIds.add(game.sourceGameId);
      }
    }
  });
  return errors;
}

export function validateCompletedGamesSection(games: unknown): BackupValidationError[] {
  if (!Array.isArray(games)) return [{ code: 'gameInvalid', detail: 'not-array' }];
  const errors: BackupValidationError[] = [];
  const plainGames: CompletedGame[] = [];
  games.forEach((raw, index) => {
    const label = `game:${index}`;
    if (!isPlainObject(raw)) {
      errors.push({ code: 'gameInvalid', detail: label });
      return;
    }
    const game = raw as unknown as CompletedGame;
    plainGames.push(game);
    errors.push(...validateCompletedGameFields(raw, label));
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
  errors.push(...findDuplicateGameIds(plainGames));
  return errors;
}

const ACTIVE_GAME_STRING_KEYS = [
  'id',
  'organizationId',
  'teamId',
  'opponent',
  'competition',
  'limitStr',
] as const;
const ACTIVE_GAME_NUMBER_KEYS = ['curQuarter', 'beginSec', 'endSec'] as const;

const ACTION_TYPES = [
  'score-delta',
  'score-set',
  'segment-saved',
  'segment-edited',
  'segment-deleted',
] as const;

/**
 * Elk item in `activeGame.actions` (externe PR-6.6-review, aug. 2026: alleen
 * de AANWEZIGHEID van de `actions`-array werd gecontroleerd, niet de inhoud
 * — een corrupte/afgeknotte actielog zou zo alsnog geïmporteerd kunnen
 * worden en later een crash of stille foutieve score/segmentreconstructie
 * geven, zie `domain/game/tracking.ts` `applyAction()`/`deriveGameHistory()`
 * die op precies deze velden vertrouwen zonder eigen runtime-guards).
 */
function validateActionShape(
  raw: unknown,
  knownIds: Set<string>,
  label: string,
): BackupValidationError[] {
  const errors: BackupValidationError[] = [];
  if (!isPlainObject(raw)) {
    errors.push({ code: 'gameInvalid', detail: `action:${label}` });
    return errors;
  }
  if (typeof raw.id !== 'string' || typeof raw.at !== 'string') {
    errors.push({ code: 'gameInvalid', detail: `actionField:id/at:${label}` });
  }
  if (!ACTION_TYPES.includes(raw.type as (typeof ACTION_TYPES)[number])) {
    errors.push({ code: 'gameInvalid', detail: `actionField:type:${label}` });
    return errors;
  }
  switch (raw.type) {
    case 'score-delta':
      if (raw.team !== 'for' && raw.team !== 'against') {
        errors.push({ code: 'gameInvalid', detail: `actionField:team:${label}` });
      }
      if (typeof raw.delta !== 'number' || !Number.isFinite(raw.delta)) {
        errors.push({ code: 'gameInvalid', detail: `actionField:delta:${label}` });
      }
      break;
    case 'score-set':
      if (raw.team !== 'for' && raw.team !== 'against') {
        errors.push({ code: 'gameInvalid', detail: `actionField:team:${label}` });
      }
      if (typeof raw.value !== 'number' || !Number.isFinite(raw.value) || raw.value < 0) {
        errors.push({ code: 'gameInvalid', detail: `actionField:value:${label}` });
      }
      break;
    case 'segment-saved':
      errors.push(...validateSegmentShape(raw.segment, knownIds, `${label}:segment`));
      break;
    case 'segment-edited':
      if (typeof raw.segmentId !== 'string') {
        errors.push({ code: 'gameInvalid', detail: `actionField:segmentId:${label}` });
      }
      errors.push(...validateSegmentShape(raw.segment, knownIds, `${label}:segment`));
      break;
    case 'segment-deleted':
      if (typeof raw.segmentId !== 'string') {
        errors.push({ code: 'gameInvalid', detail: `actionField:segmentId:${label}` });
      }
      break;
  }
  return errors;
}

export function validateActiveGameSection(game: unknown): BackupValidationError[] {
  if (game === null) return [];
  if (!isPlainObject(game)) return [{ code: 'gameInvalid', detail: 'not-object' }];
  const errors: BackupValidationError[] = [];
  for (const key of ACTIVE_GAME_STRING_KEYS) {
    if (typeof game[key] !== 'string') {
      errors.push({ code: 'gameInvalid', detail: `field:${key}:activeGame` });
    }
  }
  for (const key of ACTIVE_GAME_NUMBER_KEYS) {
    if (typeof game[key] !== 'number' || !Number.isFinite(game[key])) {
      errors.push({ code: 'gameInvalid', detail: `field:${key}:activeGame` });
    }
  }
  if (typeof game.clockDown !== 'boolean') {
    errors.push({ code: 'gameInvalid', detail: 'field:clockDown:activeGame' });
  }
  if (game.phase !== 'setup' && game.phase !== 'tracking') {
    errors.push({ code: 'gameInvalid', detail: 'field:phase:activeGame' });
  }
  const g = game as unknown as ActiveGame;
  errors.push(...validateGamePlayers(g.players, 'activeGame'));
  const knownIds = Array.isArray(g.players)
    ? new Set((g.players as unknown[]).filter(isPlainObject).map((p) => p.id as unknown as string))
    : new Set<string>();
  // ActiveGame heeft geen `segments` (die bestaan pas ná afronden, zie
  // CompletedGame) — alleen `onCourt` (huidige opstelling) en `actions`
  // (de append-only actielog, zie domain/game/tracking.ts). Referentiële
  // check: elke `onCourt`-referentie moet een bekende `GamePlayer.id` zijn.
  if (!Array.isArray(game.onCourt)) {
    errors.push({ code: 'gameInvalid', detail: 'field:onCourt:activeGame' });
  } else if (Array.isArray(g.players)) {
    for (const id of game.onCourt) {
      if (!knownIds.has(id)) {
        errors.push({ code: 'gameUnknownLineupPlayer', detail: 'onCourt:activeGame' });
        break;
      }
    }
  }
  if (game.pendingSwapLineup !== null) {
    if (!Array.isArray(game.pendingSwapLineup)) {
      errors.push({ code: 'gameInvalid', detail: 'field:pendingSwapLineup:activeGame' });
    } else if (Array.isArray(g.players)) {
      for (const id of game.pendingSwapLineup) {
        if (typeof id !== 'string' || !knownIds.has(id)) {
          errors.push({ code: 'gameUnknownLineupPlayer', detail: 'pendingSwapLineup:activeGame' });
          break;
        }
      }
    }
  }
  if (!Array.isArray(g.actions)) {
    errors.push({ code: 'gameInvalid', detail: 'field:actions:activeGame' });
  } else {
    g.actions.forEach((raw, index) => {
      errors.push(...validateActionShape(raw, knownIds, `activeGame:action:${index}`));
    });
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
