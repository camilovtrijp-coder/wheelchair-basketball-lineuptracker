/**
 * Compact wedstrijdscherm: keuze "Uitwedstrijd" (tegenstander links in de
 * stand). Uitsluitend presentatie/invoervolgorde en bewust alleen lokaal:
 * per apparaat en per wedstrijd-ID onder één eigen key (nieuwe key; geen
 * bestaande key of gebruikersdata geraakt). Nooit onderdeel van `ActiveGame`,
 * het datacontract, CSV of cloudsync. Patroon van `infrastructure/theme/theme.ts`:
 * onbeschikbare, kapotte of ongeldige storage valt stil terug op "thuis".
 *
 * Opslagvorm: JSON-array van wedstrijd-ID's die als uitwedstrijd zijn gemarkeerd
 * (oudste eerst, begrensd op `MAX_AWAY_ENTRIES`).
 */
export const COMPACT_AWAY_STORAGE_KEY = 'lineup-tracker-v2-compact-away';

export const MAX_AWAY_ENTRIES = 100;

/** Alleen een array van niet-lege strings is geldig; al het andere leest als "geen uitwedstrijden". */
export function parseAwayGameIds(raw: string | null | undefined): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
    return Array.from(new Set(ids));
  } catch {
    return [];
  }
}

function readIds(): string[] {
  try {
    return parseAwayGameIds(window.localStorage.getItem(COMPACT_AWAY_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Is deze wedstrijd lokaal als uitwedstrijd gemarkeerd? Bij elk probleem: `false` (thuis). */
export function readAwayPreference(gameId: string): boolean {
  if (!gameId) return false;
  return readIds().includes(gameId);
}

/** Bewaart de keuze voor één wedstrijd; andere wedstrijden blijven ongemoeid. Faalt stil. */
export function storeAwayPreference(gameId: string, away: boolean): void {
  if (!gameId) return;
  try {
    const others = readIds().filter((id) => id !== gameId);
    const next = away ? [...others, gameId].slice(-MAX_AWAY_ENTRIES) : others;
    window.localStorage.setItem(COMPACT_AWAY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Onbeschikbare storage: de keuze geldt dan alleen voor deze sessie.
  }
}
