import type { Settings } from '../settings/types';
import type { RosterPlayer } from '../roster/types';
import type { ActiveGame, CompletedGame } from '../game/types';
import type { Lang } from '../../i18n/strings';

/**
 * PR 6.6 §C/§D/§E — v2-back-upschema (eigenaarsbesluit 13 aug. 2026,
 * §E.1: nieuw `version: 2`-schema met benoemde secties i.p.v. v2-interne
 * localStorage-keys, v1 blijft importeerbaar via migratie). Alle types hier
 * zijn puur data — geen DOM/Preact/storage-afhankelijkheid (plan §D 6.6a).
 */
export const BACKUP_TYPE = 'lineup-tracker-backup';
export const CURRENT_BACKUP_VERSION = 2;
/** Plan §C.1: een groter bestand wordt vóór JSON-parse en zonder writes afgewezen. */
export const MAX_BACKUP_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Eén sectie van de back-up. Elke sectie is onafhankelijk optioneel
 * (eigenaarsbesluit §E.2: replace-per-onderdeel — een ontbrekende sectie
 * "leegt" dat onderdeel in het doel, geen impliciete merge). `activeGame:
 * null` betekent expliciet "geen actieve wedstrijd" (onderscheiden van
 * `undefined` = "sectie niet in de back-up aanwezig, laat ongemoeid tot
 * bevestiging, daarna leegmaken").
 */
export interface BackupV2Data {
  settings?: Settings & Record<string, unknown>;
  roster?: RosterPlayer[];
  activeGame?: ActiveGame | null;
  completedGames?: CompletedGame[];
  lang?: Lang;
}

export interface BackupSourceMeta {
  organizationId?: string;
  teamId?: string;
}

export interface BackupEnvelope {
  type: typeof BACKUP_TYPE;
  version: number;
  exportedAt: string;
  /** Puur informatief (plan §D, laatste bullet over provenance). */
  source?: BackupSourceMeta;
  data: BackupV2Data;
}

/**
 * Gestructureerde foutcodes (plan §F 6.6a: "UI vertaalt die NL/EN"). `detail`
 * draagt niet-vertaalbare identificerende info (bv. een spelernummer of
 * wedstrijd-ID) voor interpolatie in de vertaalde melding.
 */
export type BackupErrorCode =
  | 'notPlainObject'
  | 'wrongType'
  | 'dataNotObject'
  | 'invalidVersion'
  | 'migrationFailed'
  | 'emptyData'
  | 'fileTooLarge'
  | 'fileUnreadable'
  | 'fileNotJson'
  | 'settingsInvalid'
  | 'rosterInvalid'
  | 'rosterDuplicateId'
  | 'langInvalid'
  | 'gameInvalid'
  | 'gameInvalidLineupSize'
  | 'gameUnknownLineupPlayer'
  | 'gameInvalidDuration'
  | 'gameInvalidScore';

export interface BackupValidationError {
  code: BackupErrorCode;
  detail?: string;
}

export interface BackupValidationResult {
  errors: BackupValidationError[];
  /** Alleen betekenisvol wanneer `errors.length === 0`. */
  data: BackupV2Data;
}

/**
 * Effect van één sectie op de doelcontext, gebruikt door zowel de preview
 * als de coordinator (plan §C.6/§C.7: de preview mag nog niet schrijven,
 * maar moet exact tonen wat straks vervangen/geleegd wordt).
 */
export type SectionEffect = 'replace' | 'clear' | 'unchanged';

export interface ImportPreviewSection {
  present: boolean;
  effect: SectionEffect;
}

export interface SettingsPreview extends ImportPreviewSection {
  teamName: string | null;
}

export interface RosterPreview extends ImportPreviewSection {
  playerCount: number;
}

export interface ActiveGamePreview extends ImportPreviewSection {
  opponent: string | null;
}

export interface CompletedGamesPreview extends ImportPreviewSection {
  count: number;
}

export interface LangPreview extends ImportPreviewSection {
  value: Lang | null;
}

export interface ImportPreview {
  sourceVersion: number;
  exportedAt: string | null;
  settings: SettingsPreview;
  roster: RosterPreview;
  activeGame: ActiveGamePreview;
  completedGames: CompletedGamesPreview;
  lang: LangPreview;
}

/**
 * Resultaat van een import- of hersteljournaalstap (plan §C.10).
 * `rollbackFailed` is een apart, zichtbaar journaalresultaat (externe
 * PR-6.6-review, aug. 2026): een herstelwrite die zelf ook faalt mag NOOIT
 * stilzwijgend als `rolledBack` gemeld worden — dat zou een vals
 * hersteld-rapport zijn terwijl de sectie feitelijk in een onbekende/
 * gewijzigde staat is blijven staan.
 */
export interface ImportJournalEntry {
  section: 'settings' | 'roster' | 'activeGame' | 'completedGames' | 'lang';
  outcome: 'written' | 'skipped' | 'failed' | 'rolledBack' | 'rollbackFailed';
}

export interface ImportRunResult {
  ok: boolean;
  journal: ImportJournalEntry[];
}
