import type { Roster } from '../../domain/roster/types';

export interface RosterRepository {
  read(): Roster;
  /** Retourneert `false` als de opslag faalde (bijv. quota overschreden). */
  write(players: Roster): boolean;
}
