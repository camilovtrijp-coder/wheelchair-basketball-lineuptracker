import type { Settings } from '../../domain/settings/types';

export interface SettingsRepository {
  read(): Settings & Record<string, unknown>;
  /** Retourneert `false` als de opslag faalde (bijv. quota overschreden). */
  write(settings: Settings & Record<string, unknown>): boolean;
  reset(): Settings & Record<string, unknown>;
}
