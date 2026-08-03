import type { KeyValueStorage } from './persistence';

export function createBrowserStorage(getStorage: () => Storage | null): KeyValueStorage {
  return {
    getItem: (key) => {
      try {
        return getStorage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        getStorage()?.setItem(key, value);
      } catch {
        /* negeer */
      }
    },
    removeItem: (key) => {
      try {
        getStorage()?.removeItem(key);
      } catch {
        /* negeer */
      }
    },
  };
}

export const browserStorage: KeyValueStorage = createBrowserStorage(() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
});
