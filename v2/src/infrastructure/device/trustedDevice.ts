import type { KeyValueStorage } from '../../i18n/persistence';

export const TRUSTED_DEVICE_STORAGE_KEY = 'lineup-tracker-trusted-device';

/** `null` betekent: nog niet beantwoord (nieuw apparaat of gewiste opslag). */
export function readTrustedDevice(storage: KeyValueStorage): boolean | null {
  const raw = storage.getItem(TRUSTED_DEVICE_STORAGE_KEY);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

export function writeTrustedDevice(storage: KeyValueStorage, trusted: boolean): void {
  storage.setItem(TRUSTED_DEVICE_STORAGE_KEY, trusted ? 'true' : 'false');
}

export function clearTrustedDevice(storage: KeyValueStorage): void {
  storage.removeItem(TRUSTED_DEVICE_STORAGE_KEY);
}
