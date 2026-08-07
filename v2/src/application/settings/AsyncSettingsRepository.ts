// Async sibling-poort naast v2/src/application/settings/SettingsRepository.ts.
//
// Zelfde intentie en dezelfde domeintypes (Settings), maar Promise-based — vereist
// voor Firestore (zie docs/SPIKE_REPORT.md §5.1 en docs/pr-5.3-plan.md §C/5.3a).
// De bestaande synchrone poort blijft ongewijzigd voor de localStorage-modus.

import type { Settings } from '../../domain/settings/types';
import type { SyncState } from '../../domain/syncState';

export interface AsyncSettingsRepository {
  read(): Promise<Settings & Record<string, unknown>>;
  write(
    settings: Settings & Record<string, unknown>,
  ): Promise<{ ok: boolean; syncState: SyncState; error?: unknown }>;
  reset(): Promise<Settings & Record<string, unknown>>;
  subscribe(
    onNext: (settings: Settings & Record<string, unknown>, sync: SyncState) => void,
    onError?: (error: unknown) => void,
  ): () => void;
}
