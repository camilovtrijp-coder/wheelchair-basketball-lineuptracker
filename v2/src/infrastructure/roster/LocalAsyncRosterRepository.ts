// Async-wrapper rond de bestaande synchrone LocalStorageRosterRepository —
// roster-equivalent van LocalAsyncSettingsRepository.ts. Zie dat bestand voor
// de rationale (docs/pr-5.3-plan.md §C/5.3c-1).

import type { Roster } from '../../domain/roster/types';
import type { SyncState, WriteResult } from '../../domain/syncState';
import type { AsyncRosterRepository } from '../../application/roster/AsyncRosterRepository';
import type { RosterRepository } from '../../application/roster/RosterRepository';

const SYNCED: SyncState = {
  status: 'lokaal-beschikbaar',
  fromCache: false,
  hasPendingWrites: false,
};
const FAILED: SyncState = { status: 'actie-nodig', fromCache: false, hasPendingWrites: false };

export class LocalAsyncRosterRepository implements AsyncRosterRepository {
  constructor(private readonly sync: RosterRepository) {}

  async read(): Promise<Roster> {
    return this.sync.read();
  }

  async write(players: Roster): Promise<WriteResult> {
    const ok = this.sync.write(players);
    return ok
      ? { ok: true, syncState: SYNCED, settled: Promise.resolve({ ok: true }) }
      : { ok: false, syncState: FAILED, settled: Promise.resolve({ ok: false }) };
  }

  subscribe(onNext: (players: Roster, sync: SyncState) => void): () => void {
    onNext(this.sync.read(), SYNCED);
    return () => undefined;
  }
}
