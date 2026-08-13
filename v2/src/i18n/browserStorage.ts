import type { KeyValueStorage } from './persistence';

/**
 * Haalt de backing storage op en slikt alleen falen van de *getter* zelf
 * (bv. `window.localStorage` die een SecurityError gooit in een sandboxed
 * iframe) of een expliciete `null` — dat betekent "geen storage
 * beschikbaar", geen fout om te melden. Falen van de storage-methoden
 * zélf (`setItem`/`removeItem`, bv. `QuotaExceededError`) wordt bewust NIET
 * hier geslikt: callers zoals `LocalStorageGameRepository.write()` moeten
 * zo'n echte schrijffout kunnen detecteren (zie docs/IMPLEMENTATION_PLAN.md
 * §11 PR 6.2 — een bevestigde actie mag niet stilzwijgend verloren gaan).
 */
function tryGetStorage(getStorage: () => Storage | null): Storage | null {
  try {
    return getStorage();
  } catch {
    return null;
  }
}

export function createBrowserStorage(getStorage: () => Storage | null): KeyValueStorage {
  return {
    getItem: (key) => {
      try {
        return tryGetStorage(getStorage)?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      tryGetStorage(getStorage)?.setItem(key, value);
    },
    removeItem: (key) => {
      tryGetStorage(getStorage)?.removeItem(key);
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
