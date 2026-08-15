import type { KeyValueStorage } from '../../i18n/persistence';

/**
 * Stabiel, per-browser apparaat-ID voor het schrijver-/epoch-fencingcontract
 * van PR 7.1 (ADR-002 §"Verduidelijkingen voor fase 7" punt 3;
 * `GameActionEnvelopeDocument.deviceId` / `GameDocument.deviceId`). Losstaand
 * van `infrastructure/device/trustedDevice.ts` — dat is een UI-keuze over de
 * Firestore-cachemodus (persistent vs. memory), dit is een kale identiteit
 * die net zo goed op een niet-vertrouwd apparaat moet blijven bestaan zodat
 * dezelfde sessie na een reload dezelfde `writerUid`/`deviceId`-claim
 * herkent (zie GameSyncCoordinator) in plaats van telkens een nieuwe,
 * onbekende schrijver te lijken.
 */
export const DEVICE_ID_STORAGE_KEY = 'lineup-tracker-v2-device-id';

export function readOrCreateDeviceId(storage: KeyValueStorage): string {
  let existing: string | null = null;
  try {
    existing = storage.getItem(DEVICE_ID_STORAGE_KEY);
  } catch {
    existing = null;
  }
  if (existing) return existing;

  const generated = crypto.randomUUID();
  try {
    storage.setItem(DEVICE_ID_STORAGE_KEY, generated);
  } catch {
    /* opslag kan falen (quota overschreden, uitgeschakeld) — deze sessie
     * gebruikt het gegenereerde ID dan alleen in-memory; een volgende reload
     * genereert opnieuw (nooit een blokkerende fout waard voor een ID dat
     * uitsluitend de sync-claim identificeert, geen data zelf). */
  }
  return generated;
}
