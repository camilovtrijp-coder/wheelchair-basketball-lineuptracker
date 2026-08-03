import type { Settings } from '../../domain/settings/types';

export interface SettingsRepository {
  read(): Settings & Record<string, unknown>;
  write(settings: Settings & Record<string, unknown>): void;
  reset(): Settings & Record<string, unknown>;
}
