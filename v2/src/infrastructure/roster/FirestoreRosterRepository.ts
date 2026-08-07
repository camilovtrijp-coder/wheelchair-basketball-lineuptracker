// Firestore-implementatie van AsyncRosterRepository.
//
// Bewaart het pad organizations/{orgId}/teams/{teamId}/roster/current (zie
// firebase/firestore.rules §roster en SPIKE_REPORT.md §5.2 — interim-keuze van
// één document met { players }, niet de per-speler subcollectie uit ADR-003).
//
// Zelfde cache/offline-strategie als FirestoreSettingsRepository: getDocFromCache
// eerst, server-fallback, leeg document → lege array (geen stille defaults; het
// team is dan echt leeg).

import {
  doc,
  getDoc,
  getDocFromCache,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import { rosterConverter } from 'firebase-base/documents';
import type { Roster } from '../../domain/roster/types';
import { deriveSyncState, type SyncState } from '../../domain/syncState';
import type { AsyncRosterRepository } from '../../application/roster/AsyncRosterRepository';

export class FirestoreRosterRepository implements AsyncRosterRepository {
  constructor(
    private readonly db: Firestore,
    private readonly orgId: string,
    private readonly teamId: string,
  ) {}

  private ref() {
    return doc(this.db, 'organizations', this.orgId, 'teams', this.teamId, 'roster', 'current');
  }

  async read(): Promise<Roster> {
    const ref = this.ref().withConverter(rosterConverter);
    try {
      const snap = await getDocFromCache(ref);
      if (!snap.exists()) return [];
      return snap.data().players as Roster;
    } catch {
      const snap = await getDoc(ref);
      if (!snap.exists()) return [];
      return snap.data().players as Roster;
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

  subscribe(
    onNext: (players: Roster, sync: SyncState) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    return onSnapshot(
      this.ref().withConverter(rosterConverter),
      { includeMetadataChanges: true },
      (snap) => {
        const players: Roster = snap.exists() ? (snap.data().players as Roster) : [];
        onNext(players, deriveSyncState(snap.metadata));
      },
      (err) => {
        if (onError) onError(err);
      },
    );
  }
}
