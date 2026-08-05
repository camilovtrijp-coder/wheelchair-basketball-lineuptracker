import { SETTINGS_STORAGE_KEY, type Settings } from '../../domain/settings/types';
import { normalizeSettings } from '../../domain/settings/normalize';
import type { KeyValueStorage } from '../../i18n/persistence';
import type { SettingsRepository } from '../../application/settings/SettingsRepository';

export class LocalStorageSettingsRepository implements SettingsRepository {
  constructor(private readonly storage: KeyValueStorage) {}

  read(): Settings & Record<string, unknown> {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(SETTINGS_STORAGE_KEY);
    } catch {
      return normalizeSettings(undefined);
    }

    if (raw === null || raw === '') {
      return normalizeSettings(undefined);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return normalizeSettings(undefined);
    }

    return normalizeSettings(parsed);
  }

  write(settings: Settings & Record<string, unknown>): boolean {
    try {
      this.storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      return true;
    } catch {
      /* opslag kan falen (quota overschreden, uitgeschakeld); laat caller het weten */
      return false;
    }
  }

  reset(): Settings & Record<string, unknown> {
    const defaults = normalizeSettings(undefined);
    this.write(defaults);
    return defaults;
  }
}
