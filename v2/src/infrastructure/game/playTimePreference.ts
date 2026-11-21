/**
 * Voorkeur "Speeltijd per speler" in het Rustig-scherm. Uitsluitend een
 * voorkeur van dit apparaat, onder één NIEUWE eigen key (geen bestaande key of
 * gebruikersdata geraakt). Nooit onderdeel van `ActiveGame`, het datacontract,
 * CSV of cloudsync. Patroon van `gameScreenPreference`: ontbrekende, ongeldige
 * of onbeschikbare storage valt stil terug op "uit" (de standaard).
 */
export const PLAY_TIME_STORAGE_KEY = 'lineup-tracker-v2-play-time';

export function parsePlayTimePreference(raw: string | null | undefined): boolean {
  return raw === 'on';
}

export function readPlayTimePreference(): boolean {
  try {
    return parsePlayTimePreference(window.localStorage.getItem(PLAY_TIME_STORAGE_KEY));
  } catch {
    return false;
  }
}

/** Bewaart de keuze; faalt stil (de keuze geldt dan alleen voor deze sessie). */
export function storePlayTimePreference(on: boolean): void {
  try {
    window.localStorage.setItem(PLAY_TIME_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Onbeschikbare storage.
  }
}
