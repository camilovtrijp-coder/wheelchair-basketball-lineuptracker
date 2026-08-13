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

/**
 * Vraagt de backing storage op zonder iets te slikken: een throwende getter
 * blijft throwen, en een expliciete `null` (geen storage beschikbaar) wordt
 * hier zelf omgezet in een throw — nodig zodat "storage onbeschikbaar" een
 * caller-detecteerbare fout is i.p.v. een stille `null`/no-op (zie
 * `CreateBrowserStorageOptions` hieronder).
 */
function requireStorage(getStorage: () => Storage | null): Storage {
  const storage = getStorage();
  if (storage === null) throw new Error('storage unavailable');
  return storage;
}

export interface CreateBrowserStorageOptions {
  /**
   * Standaard `true` (bestaand contract, gebruikt door alle andere
   * `browserStorage`-callers zoals `i18n/persistence.ts`,
   * `device/trustedDevice.ts`, `context/selectedContext.ts`,
   * `onboarding/bootstrapProgress.ts`, `cloudImportFlag.ts` — geen van die
   * callers wrapt `getItem()`/`setItem()` zelf in een try/catch, dus een
   * throwende storage zou daar een onbehandelde exception worden als dit
   * ooit globaal zou wijzigen).
   *
   * Zet dit op `false` voor een caller die zélf betrouwbaar "storage
   * onbeschikbaar of de operatie is mislukt" moet kunnen onderscheiden van
   * "leeg"/"gelukt" — zie de externe PR-6.3-review (aug. 2026), twee ronden:
   * 1. eerste ronde: `LocalStorageCompletedGameRepository` mag een
   *    METHODEFOUT van `Storage.getItem()` (bv. een corrupte/geweigerde
   *    read) niet als "leeg" behandelen, anders overschrijven `add()`/
   *    `remove()` de bestaande historie op basis van een foutief lege lijst;
   * 2. herreview: dezelfde repository mag óók een falende of niet-
   *    beschikbare storage-GETTER (`getStorage()` zelf gooit, of geeft
   *    expliciet `null` terug) niet als "leeg" behandelen — én mag een
   *    `setItem()` die daardoor stilzwijgend een no-op is niet als geslaagde
   *    write rapporteren. In strict-modus (`false`) gooien `getItem()`,
   *    `setItem()` en `removeItem()` daarom alledrie door zodra de storage
   *    zelf niet verkregen kon worden, niet alleen bij een methodefout op
   *    een wél verkregen storage. De gedeelde, niet-strikte `browserStorage`
   *    behoudt voor alle overige callers het bestaande null-op-fout-gedrag.
   */
  swallowGetItemErrors?: boolean;
}

export function createBrowserStorage(
  getStorage: () => Storage | null,
  options: CreateBrowserStorageOptions = {},
): KeyValueStorage {
  const strict = !(options.swallowGetItemErrors ?? true);
  if (strict) {
    return {
      getItem: (key) => requireStorage(getStorage).getItem(key),
      setItem: (key, value) => requireStorage(getStorage).setItem(key, value),
      removeItem: (key) => requireStorage(getStorage).removeItem(key),
    };
  }
  return {
    getItem: (key) => {
      const storage = tryGetStorage(getStorage);
      if (storage === null) return null;
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
