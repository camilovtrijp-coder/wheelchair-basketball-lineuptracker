// Async sibling-poort naast v2/src/application/settings/SettingsRepository.ts.
// Dezelfde intentie en dezelfde domeintypes (Settings), maar Promise-based — vereist voor
// Firestore. De bestaande synchrone poort blijft ongewijzigd (zie docs/SPIKE_REPORT.md §6).

import type { Settings } from '../../../v2/src/domain/settings/types.js';
import type { SyncState } from '../domain/syncState.js';

export interface AsyncSettingsRepository {
  read(): Promise<Settings & Record<string, unknown>>;
  write(
    settings: Settings & Record<string, unknown>,
  ): Promise<{ ok: boolean; syncState: SyncState }>;
  reset(): Promise<Settings & Record<string, unknown>>;
  subscribe(
    onNext: (settings: Settings & Record<string, unknown>, sync: SyncState) => void,
  ): () => void; // retourneert unsubscribe-functie
}
