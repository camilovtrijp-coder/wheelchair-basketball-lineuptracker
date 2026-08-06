import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';

/** Spiegelt `v2/src/domain/roster/types.ts` (`Player`). */
export interface RosterPlayerDocument {
  id: number;
  nr: string;
  naam: string;
  kl: string;
  vrouw: boolean;
  jeugd: boolean;
}

/**
 * organizations/{orgId}/teams/{teamId}/roster/current
 *
 * Eén document met de volledige spelerslijst (interim-keuze uit de spike,
 * zie firebase-spike/docs/SPIKE_REPORT.md §2 — Fase 7 beslist of dit per
 * PR 6/7 naar `players/{playerId}`-subcollectie-documenten verhuist).
 */
export interface RosterDocument {
  players: RosterPlayerDocument[];
  updatedAt: Timestamp;
}

export const rosterConverter: FirestoreDataConverter<RosterDocument> = {
  toFirestore(roster: RosterDocument) {
    return roster;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): RosterDocument {
    const data = snapshot.data();
    return {
      players: data.players,
      updatedAt: data.updatedAt,
    };
  },
};
