import type { Settings, SettingsKey } from '../../domain/settings/types';
import { applySettingUpdate } from '../../domain/settings/normalize';
import type { SettingsRepository } from './SettingsRepository';
import type { AsyncSettingsRepository } from './AsyncSettingsRepository';
import type { KeyValueStorage } from '../../i18n/persistence';
import { markCloudImported } from '../../infrastructure/cloudImportFlag';

export function getSettings(repo: SettingsRepository): Settings & Record<string, unknown> {
  return repo.read();
}

export function saveSettings(
  repo: SettingsRepository,
  settings: Settings & Record<string, unknown>,
): boolean {
  return repo.write(settings);
}

/**
 * Past een veld-update toe in het geheugen zonder te persisteren. Schrijven
 * naar de repository gebeurt uitsluitend via een expliciete `saveSettings`-
 * of `resetSettings`-aanroep (save-/reset-knop in de UI).
 */
export function updateSetting(
  current: Settings & Record<string, unknown>,
  field: SettingsKey,
  value: unknown,
): Settings & Record<string, unknown> {
  return applySettingUpdate(current, field, value);
}

export function resetSettings(repo: SettingsRepository): Settings & Record<string, unknown> {
  return repo.reset();
}

export interface CloudMigrationResult {
  ok: boolean;
  imported: boolean;
  errors: string[];
}

/**
 * Kopieert de v1-settings uit `local` (sync localStorage) één keer naar de
 * Firestore-adapter `cloud`, zonder de v1-key aan te raken. Bewust
 * éénrichtingsverkeer (zie docs/pr-5.3-plan.md §C/5.3b): geen automatische
 * v1→cloud-resync, geen terugschrijven van cloud naar v1, geen delete van
 * `lineup-tracker-settings` — de lokale kopie blijft beschikbaar als vangnet
 * (zie AGENTS.md §3 en PR 5.3b punt 4: byte-equality van de v1-key is een
 * harde Vitest-garantie).
 *
 * Bij geslaagde cloud-write wordt een aparte UI-hint-vlag gezet
 * (`lineup-tracker-cloud-imported-settings`) zodat de banner niet opnieuw
 * verschijnt. Die vlag raakt de v1-data niet.
 */
/**
 * Async tegenhangers van getSettings/saveSettings/resetSettings (PR 5.3c-1):
 * App praat na de repository-wiring uitsluitend via AsyncSettingsRepository,
 * ongeacht of de actieve adapter lokaal (LocalAsyncSettingsRepository) of
 * cloud (FirestoreSettingsRepository) is. De synchrone functies hierboven
 * blijven bestaan voor de eenmalige v1-migratiebron in migrateLocalStorageToCloud.
 */
export async function getSettingsAsync(
  repo: AsyncSettingsRepository,
): Promise<Settings & Record<string, unknown>> {
  return repo.read();
}

export async function saveSettingsAsync(
  repo: AsyncSettingsRepository,
  settings: Settings & Record<string, unknown>,
): Promise<boolean> {
  const result = await repo.write(settings);
  return result.ok;
}

export async function resetSettingsAsync(
  repo: AsyncSettingsRepository,
): Promise<Settings & Record<string, unknown>> {
  return repo.reset();
}

export async function migrateLocalStorageToCloud(
  local: SettingsRepository,
  cloud: AsyncSettingsRepository,
  storage: KeyValueStorage,
): Promise<CloudMigrationResult> {
  const data = local.read();
  const result = await cloud.write(data);
  if (result.ok) {
    markCloudImported(storage, 'settings');
  }
  return {
    ok: result.ok,
    imported: result.ok,
    errors: result.ok ? [] : [`syncState: ${result.syncState.status}`],
  };
}
