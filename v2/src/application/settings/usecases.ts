import type { Settings, SettingsKey } from '../../domain/settings/types';
import { applySettingUpdate } from '../../domain/settings/normalize';
import type { SettingsRepository } from './SettingsRepository';

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
