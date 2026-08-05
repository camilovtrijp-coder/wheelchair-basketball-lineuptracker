import type { Roster } from '../../domain/roster/types';
import type { RosterRepository } from './RosterRepository';

export function getRoster(repo: RosterRepository): Roster {
  return repo.read();
}

export function saveRoster(repo: RosterRepository, players: Roster): boolean {
  return repo.write(players);
}
