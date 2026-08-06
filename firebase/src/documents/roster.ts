import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import {
  DocumentValidationError,
  assertBoolean,
  assertNumber,
  assertString,
  assertTimestamp,
  isPlainObject,
} from './validation.js';

const TYPE = 'roster';

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

function assertRosterPlayer(index: number, value: unknown): RosterPlayerDocument {
  if (!isPlainObject(value)) {
    throw new DocumentValidationError(TYPE, `players[${index}]`, 'moet een object zijn');
  }
  const fieldType = `${TYPE}.players[${index}]`;
  return {
    id: assertNumber(fieldType, 'id', value.id),
    nr: assertString(fieldType, 'nr', value.nr),
    naam: assertString(fieldType, 'naam', value.naam),
    kl: assertString(fieldType, 'kl', value.kl),
    vrouw: assertBoolean(fieldType, 'vrouw', value.vrouw),
    jeugd: assertBoolean(fieldType, 'jeugd', value.jeugd),
  };
}

export const rosterConverter: FirestoreDataConverter<RosterDocument> = {
  toFirestore(roster: RosterDocument) {
    return roster;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): RosterDocument {
    const data = snapshot.data();
    if (!Array.isArray(data.players)) {
      throw new DocumentValidationError(TYPE, 'players', 'moet een array zijn');
    }
    return {
      players: data.players.map((player, index) => assertRosterPlayer(index, player)),
      updatedAt: assertTimestamp(TYPE, 'updatedAt', data.updatedAt),
    };
  },
};
