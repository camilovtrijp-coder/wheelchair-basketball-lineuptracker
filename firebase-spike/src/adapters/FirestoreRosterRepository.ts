import {
  doc,
  getDoc,
  getDocFromCache,
  setDoc,
  onSnapshot,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import type { Roster } from '../../../v2/src/domain/roster/types.js';
import type { AsyncRosterRepository } from '../ports/AsyncRosterRepository.js';
import { deriveSyncState, type SyncState } from '../domain/syncState.js';

export class FirestoreRosterRepository implements AsyncRosterRepository {
  constructor(
    private db: Firestore,
    private orgId: string,
    private teamId: string,
  ) {}

  private ref() {
    return doc(
      this.db,
      'organizations',
      this.orgId,
      'teams',
      this.teamId,
      'roster',
      'current',
    );
  }

  async read(): Promise<Roster> {
    // Probeer de lokale cache eerst zodat read() ook offline werkt (pending writes zijn zichtbaar).
    // Val terug op getDoc() (server) als het document nog nooit is opgehaald.
    try {
      const snap = await getDocFromCache(this.ref());
      if (!snap.exists()) return [];
      const data = snap.data() as { players?: unknown };
      return Array.isArray(data['players']) ? (data['players'] as Roster) : [];
    } catch {
      const snap = await getDoc(this.ref());
      if (!snap.exists()) return [];
      const data = snap.data() as { players?: unknown };
      return Array.isArray(data['players']) ? (data['players'] as Roster) : [];
    }
  }

  async write(players: Roster): Promise<{ ok: boolean; syncState: SyncState }> {
    try {
      await setDoc(this.ref(), { players, updatedAt: serverTimestamp() });
      return {
        ok: true,
        syncState: { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false },
      };
    } catch {
      return {
        ok: false,
        syncState: { status: 'actie-nodig', fromCache: false, hasPendingWrites: false },
      };
    }
  }

  subscribe(onNext: (players: Roster, sync: SyncState) => void): () => void {
    return onSnapshot(this.ref(), { includeMetadataChanges: true }, (snap) => {
      const data = snap.exists() ? (snap.data() as { players?: unknown }) : {};
      const players: Roster = Array.isArray(data['players'])
        ? (data['players'] as Roster)
        : [];
      onNext(players, deriveSyncState(snap.metadata));
    });
  }
}
