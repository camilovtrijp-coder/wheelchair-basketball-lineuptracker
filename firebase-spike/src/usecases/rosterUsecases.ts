// Async spiegels van v2/src/application/roster/usecases.ts.

import type { Roster } from '../../../v2/src/domain/roster/types.js';
import type { AsyncRosterRepository } from '../ports/AsyncRosterRepository.js';
import type { SyncState } from '../domain/syncState.js';

export async function getRoster(repo: AsyncRosterRepository): Promise<Roster> {
  return repo.read();
}

export async function saveRoster(
  repo: AsyncRosterRepository,
  players: Roster,
): Promise<{ ok: boolean; syncState: SyncState }> {
  return repo.write(players);
}
