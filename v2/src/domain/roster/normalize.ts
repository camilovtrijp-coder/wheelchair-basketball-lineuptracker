import { DEFAULT_KL, type Player, type Roster, type RosterPlayer } from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parseert opgeslagen rosterdata. Spiegelt v1-`loadRoster`: geen structurele
 * validatie of typecorrectie van bestaande spelersvelden (geen stille
 * vormwijziging). Alleen niet-object entries worden gefilterd zodat de UI
 * niet crasht op corrupte data; niet-array-data levert een lege lijst op.
 */
export function normalizeRoster(value: unknown): Roster {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainObject) as Roster;
}

function nrSortValue(nr: unknown): number {
  const n = typeof nr === 'string' ? parseInt(nr, 10) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Sorteert spelers op rugnummer (numeriek), net als v1 na iedere wijziging. */
export function sortRoster(players: Roster): Roster {
  return [...players].sort((a, b) => nrSortValue(a.nr) - nrSortValue(b.nr));
}

/** Rugnummers die meer dan eens voorkomen bij spelers met een ingevulde naam. */
export function findDuplicateNumbers(players: Roster): string[] {
  const counts = new Map<string, number>();
  for (const p of players) {
    const naam = typeof p.naam === 'string' ? p.naam.trim() : '';
    const nr = typeof p.nr === 'string' ? p.nr.trim() : '';
    if (naam === '' || nr === '') continue;
    counts.set(nr, (counts.get(nr) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([nr]) => nr);
}

function nextPlayerId(players: Roster): number {
  return players.reduce((max, p) => (typeof p.id === 'number' && p.id > max ? p.id : max), 0) + 1;
}

/** Voegt een nieuwe speler toe met v1-standaardwaarden en sorteert opnieuw. */
export function addPlayer(players: Roster): Roster {
  const player: RosterPlayer = {
    id: nextPlayerId(players),
    nr: String(players.length + 1),
    naam: '',
    kl: DEFAULT_KL,
    vrouw: false,
    jeugd: false,
  };
  return sortRoster([...players, player]);
}

/** Werkt één veld van één speler bij en sorteert opnieuw bij een rugnummerwijziging. */
export function updatePlayerField<K extends keyof Player>(
  players: Roster,
  id: number,
  field: K,
  value: Player[K],
): Roster {
  const next = players.map((p) => (p.id === id ? { ...p, [field]: value } : p));
  return field === 'nr' ? sortRoster(next) : next;
}

/** Verwijdert een speler op id. */
export function removePlayer(players: Roster, id: number): Roster {
  return players.filter((p) => p.id !== id);
}

/**
 * Serialiseert naar de v1-opslagvorm: uitsluitend de bekende teamvelden.
 * Spiegelt v1-`saveRoster`, dat alleen id/nr/naam/kl/vrouw/jeugd bewaart.
 */
export function toStoredPlayers(players: Roster): Player[] {
  return players.map((p) => ({
    id: p.id,
    nr: p.nr,
    naam: p.naam,
    kl: p.kl,
    vrouw: p.vrouw,
    jeugd: p.jeugd,
  }));
}
