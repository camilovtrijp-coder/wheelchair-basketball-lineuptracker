import type { Settings, SettingsKey } from '../../domain/settings/types';
import { applySettingUpdate } from '../../domain/settings/normalize';
import type { SettingsRepository } from './SettingsRepository';

export function getSettings(repo: SettingsRepository): Settings & Record<string, unknown> {
  return repo.read();
}

export function saveSettings(
  repo: SettingsRepository,
  settings: Settings & Record<string, unknown>,
): void {
  repo.write(settings);
}

export function updateSetting(
  repo: SettingsRepository,
  current: Settings & Record<string, unknown>,
  field: SettingsKey,
  value: unknown,
): Settings & Record<string, unknown> {
  const next = applySettingUpdate(current, field, value);
  repo.write(next);
  return next;
}

export function resetSettings(repo: SettingsRepository): Settings & Record<string, unknown> {
  return repo.reset();
}
