// Async sibling-poort naast v2/src/application/roster/RosterRepository.ts.
// Roster is hier één document (roster/current met { players: RosterPlayer[] }) — zie
// docs/SPIKE_REPORT.md §6 voor waarom dit afwijkt van ADR-003's players/{playerId}-vorm.

import type { Roster } from '../../../v2/src/domain/roster/types.js';
import type { SyncState } from '../domain/syncState.js';

export interface AsyncRosterRepository {
  read(): Promise<Roster>;
  write(players: Roster): Promise<{ ok: boolean; syncState: SyncState }>;
  subscribe(onNext: (players: Roster, sync: SyncState) => void): () => void;
}
