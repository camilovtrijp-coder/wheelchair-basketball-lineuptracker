import { LANG_STORAGE_KEY, type Lang, isValidLang } from './strings';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readLang(storage: KeyValueStorage): Lang | null {
  const raw = storage.getItem(LANG_STORAGE_KEY);
  return isValidLang(raw) ? raw : null;
}

export function writeLang(storage: KeyValueStorage, lang: Lang): void {
  storage.setItem(LANG_STORAGE_KEY, lang);
}

export function clearLang(storage: KeyValueStorage): void {
  storage.removeItem(LANG_STORAGE_KEY);
}
