// Firestore-implementatie van AsyncRosterRepository.
//
// Bewaart het pad organizations/{orgId}/teams/{teamId}/roster/current (zie
// firebase/firestore.rules §roster en SPIKE_REPORT.md §5.2 — interim-keuze van
// één document met { players }, niet de per-speler subcollectie uit ADR-003).
//
// Zelfde cache/offline-strategie als FirestoreSettingsRepository: getDocFromCache
// eerst, server-fallback. read() geeft een lege array voor een bevestigd
// niet-bestaand document (cache of server heeft het genomen). subscribe()
// emit NOOIT voor een niet-bestaand document (zelfde gate als bij Settings,
// zie ADR-002 §"Syncstatuscontract") — anders is een ongecachete, offline
// context niet te onderscheiden van een team met écht nul spelers.

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
import { deriveSyncState, type SyncState, type WriteResult } from '../../domain/syncState';
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

  // Zie FirestoreSettingsRepository.write() voor de rationale: niet op de
  // volledige backend-ack wachten (offline anders onbeperkt pending), meteen
  // het lokale resultaat teruggeven, `settled` draagt de uiteindelijke
  // serverbevestiging/-afwijzing en reject nooit.
  async write(players: Roster): Promise<WriteResult> {
    const serverAck = setDoc(this.ref(), { players, updatedAt: serverTimestamp() });
    const settled = serverAck.then(
      () => ({ ok: true }),
      (error: unknown) => ({ ok: false, error }),
    );
    return {
      ok: true,
      syncState: { status: 'wacht-op-synchronisatie', fromCache: true, hasPendingWrites: true },
      settled,
    };
  }

  subscribe(
    onNext: (players: Roster, sync: SyncState, updatedAt?: number) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    return onSnapshot(
      this.ref().withConverter(rosterConverter),
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        onNext(
          data.players as Roster,
          deriveSyncState(snap.metadata),
          toEpochMillis(data.updatedAt),
        );
      },
      (err) => {
        if (onError) onError(err);
      },
    );
  }
}

function toEpochMillis(value: unknown): number | undefined {
  if (
    typeof value === 'object' &&
    value !== null &&
    'toMillis' in value &&
    typeof value.toMillis === 'function'
  ) {
    return value.toMillis();
  }
  return undefined;
}
