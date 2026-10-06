// PR 8.3c-2b-i (docs/pr-8.3c-2b-plan.md §B.10): telt onbevestigd lokaal wedstrijdwerk
// voor één organisatie op dit apparaat, uitsluitend door BESTAANDE sleutels te LEZEN.
// Deze probe schrijft, wijzigt of verwijdert nooit een sleutel en voegt geen sleutel toe.
//
// Wat telt (aanname A2, geverifieerd in `App.tsx`: na afronden schrijft de app direct
// een nieuwe wedstrijd met `phase: 'setup'`, dus alleen `tracking` is "gestart"):
//   - elke openstaande afronding in `PENDING_FINALIZE_STORAGE_KEY_PREFIX{orgId}:{teamId}`
//     (de duurzame outbox van een nog niet door de server bevestigde afronding);
//   - een actieve wedstrijd in `ACTIVE_GAME_STORAGE_KEY_PREFIX{orgId}:{teamId}` met
//     `phase: 'tracking'`. Een opgezette maar niet gestarte wedstrijd (`setup`) telt niet.
// Fail closed: een sleutel die niet te lezen of te ontleden is telt als 1, want "geen
// onbevestigd werk" moet bewezen zijn voordat vertrekken dat werk onsynchroniseerbaar maakt.
// Dat geldt ook als de sleutels zelf niet op te sommen zijn (reviewbevinding B op 2b-i):
// "onbekend" blokkeert (telling 1). Alleen "helemaal geen storage" (onvertrouwd apparaat,
// sandbox) is een bewezen lege lijst en telt 0.
import type { LocalUnsyncedWorkProbe } from '../../application/account/LocalUnsyncedWorkProbe';
import type { KeyValueStorage } from '../../i18n/persistence';
import { listBrowserStorageKeysOrThrow, strictReadBrowserStorage } from '../../i18n/browserStorage';
import { ACTIVE_GAME_STORAGE_KEY_PREFIX } from '../game/LocalStorageGameRepository';
import { PENDING_FINALIZE_STORAGE_KEY_PREFIX } from '../game/LocalStoragePendingFinalizeRepository';

type Reader = Pick<KeyValueStorage, 'getItem'>;

function readJson(storage: Reader, key: string): { ok: true; value: unknown } | { ok: false } {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { ok: false };
  }
  if (raw === null || raw === '') return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
}

function countPendingFinalize(storage: Reader, key: string): number {
  const read = readJson(storage, key);
  if (!read.ok) return 1;
  if (read.value === null) return 0;
  return Array.isArray(read.value) ? read.value.length : 1;
}

function countActiveGame(storage: Reader, key: string): number {
  const read = readJson(storage, key);
  if (!read.ok) return 1;
  if (read.value === null) return 0;
  if (typeof read.value !== 'object') return 1;
  const phase = (read.value as { phase?: unknown }).phase;
  if (phase === 'setup') return 0;
  return 1; // `tracking`, of een onbekende vorm: fail closed.
}

/** Telling bij sleutels die niet op te sommen zijn: onbekend = blokkeren (fail closed). */
export const UNKNOWN_KEYS_COUNT = 1;

export class LocalStorageUnsyncedWorkProbe implements LocalUnsyncedWorkProbe {
  constructor(
    private readonly storage: Reader = strictReadBrowserStorage,
    private readonly listKeys: () => string[] = listBrowserStorageKeysOrThrow,
  ) {}

  countForOrganization(organizationId: string): number {
    const pendingPrefix = `${PENDING_FINALIZE_STORAGE_KEY_PREFIX}${organizationId}:`;
    const activePrefix = `${ACTIVE_GAME_STORAGE_KEY_PREFIX}${organizationId}:`;
    let keys: string[];
    try {
      keys = this.listKeys();
    } catch {
      return UNKNOWN_KEYS_COUNT;
    }
    let count = 0;
    for (const key of keys) {
      if (key.startsWith(pendingPrefix)) count += countPendingFinalize(this.storage, key);
      else if (key.startsWith(activePrefix)) count += countActiveGame(this.storage, key);
    }
    return count;
  }
}
