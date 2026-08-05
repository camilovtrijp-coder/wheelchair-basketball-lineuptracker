// Async spiegels van v2/src/application/settings/usecases.ts — zelfde functionele bedoeling,
// Promise-based voor Firestore. De bestaande sync-usecases blijven ongewijzigd.

import type { Settings, SettingsKey } from '../../../v2/src/domain/settings/types.js';
import { applySettingUpdate } from '../../../v2/src/domain/settings/normalize.js';
import type { AsyncSettingsRepository } from '../ports/AsyncSettingsRepository.js';
import type { SyncState } from '../domain/syncState.js';

export async function getSettings(
  repo: AsyncSettingsRepository,
): Promise<Settings & Record<string, unknown>> {
  return repo.read();
}

export async function saveSettings(
  repo: AsyncSettingsRepository,
  settings: Settings & Record<string, unknown>,
): Promise<{ ok: boolean; syncState: SyncState }> {
  return repo.write(settings);
}

/** Past een veld-update in het geheugen toe zonder te persisteren (zelfde als sync-variant). */
export function updateSetting(
  current: Settings & Record<string, unknown>,
  field: SettingsKey,
  value: unknown,
): Settings & Record<string, unknown> {
  return applySettingUpdate(current, field, value);
}

export async function resetSettings(
  repo: AsyncSettingsRepository,
): Promise<Settings & Record<string, unknown>> {
  return repo.reset();
}
