// Async sibling-poort naast v2/src/application/roster/RosterRepository.ts.
//
// Roster is hier één document (roster/current met { players: RosterPlayer[] }) —
// volgt dezelfde interim-keuze als de Firebase-spike (zie SPIKE_REPORT.md §5.2).
// Fase 7 beslist of normalisatie naar players/{playerId} nodig wordt.

import type { Roster } from '../../domain/roster/types';
import type { SyncState } from '../../domain/syncState';

export interface AsyncRosterRepository {
  read(): Promise<Roster>;
  write(players: Roster): Promise<{ ok: boolean; syncState: SyncState }>;
  subscribe(
    onNext: (players: Roster, sync: SyncState) => void,
    onError?: (error: unknown) => void,
  ): () => void;
}
