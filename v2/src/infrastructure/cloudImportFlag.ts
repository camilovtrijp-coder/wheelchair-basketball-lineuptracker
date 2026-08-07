// Cloud-import-vlag (PR 5.3b). Houdt bij of de lokale v1-settings/roster al
// eenmalig naar de cloud zijn gekopieerd. Strikt gescheiden van de v1-data:
// de vlag gebruikt een eigen localStorage-key, en de v1-keys
// `lineup-tracker-settings`/`-roster` worden door de migratie NIET
// aangeraakt of verwijderd (zie AGENTS.md §3 + plan §C/5.3b punt 4).

import type { KeyValueStorage } from '../i18n/persistence';

export type CloudImportKind = 'settings' | 'roster';

const SETTINGS_FLAG_KEY = 'lineup-tracker-cloud-imported-settings';
const ROSTER_FLAG_KEY = 'lineup-tracker-cloud-imported-roster';

function keyFor(kind: CloudImportKind): string {
  return kind === 'settings' ? SETTINGS_FLAG_KEY : ROSTER_FLAG_KEY;
}

export function isCloudImported(storage: KeyValueStorage, kind: CloudImportKind): boolean {
  try {
    return storage.getItem(keyFor(kind)) !== null;
  } catch {
    return false;
  }
}

export function markCloudImported(
  storage: KeyValueStorage,
  kind: CloudImportKind,
  at: number = Date.now(),
): void {
  try {
    storage.setItem(keyFor(kind), JSON.stringify({ at }));
  } catch {
    /* opslag kan falen (quota, uitgeschakeld); UI-hint is niet kritisch */
  }
}

export function clearCloudImported(storage: KeyValueStorage, kind: CloudImportKind): void {
  try {
    storage.removeItem(keyFor(kind));
  } catch {
    /* negeer */
  }
}
