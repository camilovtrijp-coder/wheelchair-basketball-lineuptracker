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

export interface CreateBrowserStorageOptions {
  /**
   * Standaard `true` (bestaand contract, gebruikt door alle andere
   * `browserStorage`-callers zoals `i18n/persistence.ts`,
   * `device/trustedDevice.ts`, `context/selectedContext.ts`,
   * `onboarding/bootstrapProgress.ts`, `cloudImportFlag.ts` — geen van die
   * callers wrapt `getItem()` zelf in een try/catch, dus een throwende
   * `getItem()` zou daar een onbehandelde exception worden als dit ooit
   * globaal zou wijzigen).
   *
   * Zet dit op `false` voor een caller die zélf een throwende
   * `getItem()`-fout van een écht mislukte read moet kunnen onderscheiden
   * van een legitiem lege/nog-niet-bestaande sleutel — zie de externe
   * PR-6.3-review (aug. 2026): `LocalStorageCompletedGameRepository` mag een
   * storage-readfout niet als "leeg" behandelen (dat zou `add()`/`remove()`
   * de bestaande historie laten overschrijven), maar de gedeelde
   * `browserStorage`-instantie moet dat null-op-fout-gedrag voor alle
   * overige, hier niet-gewijzigde callers behouden.
   */
  swallowGetItemErrors?: boolean;
}

export function createBrowserStorage(
  getStorage: () => Storage | null,
  options: CreateBrowserStorageOptions = {},
): KeyValueStorage {
  const swallowGetItemErrors = options.swallowGetItemErrors ?? true;
  return {
    getItem: (key) => {
      const storage = tryGetStorage(getStorage);
      if (storage === null) return null;
      if (!swallowGetItemErrors) return storage.getItem(key);
      try {
        return storage.getItem(key);
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

function getWindowLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const browserStorage: KeyValueStorage = createBrowserStorage(getWindowLocalStorage);

/**
 * Zelfde backing storage als `browserStorage`, maar laat een echte
 * `getItem()`-fout van de onderliggende `Storage` doorwerpen i.p.v. die naar
 * `null` te vertalen — nodig voor callers die "leeg" en "read mislukt"
 * moeten kunnen onderscheiden (zie `CreateBrowserStorageOptions` hierboven).
 * Alleen gebruiken voor callers die hun eigen `getItem()`-aanroep al in een
 * try/catch wrappen (zoals `LocalStorageCompletedGameRepository.readAll()`).
 */
export const strictReadBrowserStorage: KeyValueStorage = createBrowserStorage(
  getWindowLocalStorage,
  { swallowGetItemErrors: false },
);
