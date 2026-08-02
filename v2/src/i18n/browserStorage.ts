import type { KeyValueStorage } from './persistence';

function safeGet(storage: KeyValueStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: KeyValueStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* opslag kan falen (geheugen vol, uitgeschakeld); negeer voor taalvoorkeur */
  }
}

export const browserStorage: KeyValueStorage = {
  getItem: (key) => safeGet(window.localStorage, key),
  setItem: (key, value) => safeSet(window.localStorage, key, value),
  removeItem: (key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* negeer */
    }
  },
};
