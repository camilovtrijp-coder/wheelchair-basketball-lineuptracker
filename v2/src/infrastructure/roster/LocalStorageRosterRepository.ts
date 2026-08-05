import { ROSTER_STORAGE_KEY, type Roster } from '../../domain/roster/types';
import { normalizeRoster, toStoredPlayers } from '../../domain/roster/normalize';
import type { KeyValueStorage } from '../../i18n/persistence';
import type { RosterRepository } from '../../application/roster/RosterRepository';

export class LocalStorageRosterRepository implements RosterRepository {
  constructor(private readonly storage: KeyValueStorage) {}

  read(): Roster {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(ROSTER_STORAGE_KEY);
    } catch {
      return normalizeRoster(undefined);
    }

    if (raw === null || raw === '') {
      return normalizeRoster(undefined);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return normalizeRoster(undefined);
    }

    return normalizeRoster(parsed);
  }

  write(players: Roster): boolean {
    try {
      this.storage.setItem(ROSTER_STORAGE_KEY, JSON.stringify(toStoredPlayers(players)));
      return true;
    } catch {
      /* opslag kan falen (quota overschreden, uitgeschakeld); laat caller het weten */
      return false;
    }
  }
}
