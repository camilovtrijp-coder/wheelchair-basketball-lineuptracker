import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import {
  DocumentValidationError,
  assertInteger,
  assertIsoTimestampString,
  assertNonEmptyString,
  assertNullableTimestamp,
  assertOneOf,
  assertTimestamp,
  isPlainObject,
} from './validation.js';

const TYPE = 'deletionRequest';

/**
 * De vijf toestanden van `organizations/{orgId}/deletionRequests/current`
 * (docs/pr-8.3c-besluitvoorstel.md §2.5). Een CLIENT mag via Rules alleen
 * `requested` aanmaken, annuleren (`requested → cancelled`) en herstarten
 * (`cancelled → requested`, `attempt + 1`); `executing`/`completed`/`failed`
 * worden uitsluitend door het handmatige runbook gezet.
 */
export const DELETION_REQUEST_STATUSES = [
  'requested',
  'cancelled',
  'executing',
  'completed',
  'failed',
] as const;
export type DeletionRequestStatus = (typeof DELETION_REQUEST_STATUSES)[number];

/**
 * Exact de tien sleutels die `firestore.rules` (`exportCountKeys()`) voor
 * `exportProof.counts` eist — spiegelt `OrganizationExportSectionCounts` uit
 * v2 (`domain/export/types.ts`). Dat v2-type is structureel identiek; een test
 * in v2 bewijst dat de twee niet uit elkaar kunnen lopen.
 */
export const DELETION_REQUEST_COUNT_KEYS = [
  'organizationMembers',
  'invitations',
  'teams',
  'teamMembers',
  'settingsDocuments',
  'rosterPlayers',
  'games',
  'gameActions',
  'completedGames',
  'migrationRuns',
] as const;
export type DeletionRequestCountKey = (typeof DELETION_REQUEST_COUNT_KEYS)[number];
export type DeletionRequestExportCounts = Record<DeletionRequestCountKey, number>;

/**
 * De uitkomst van een geslaagde 8.3b-organisatie-export. Een UX-poort met een
 * vaste vorm, GEEN bewijs: de export die telt is die van de beheerder, vlak vóór
 * het wissen (besluitrecord §2.5).
 */
export interface DeletionRequestExportProof {
  contentHash: string;
  /** ISO-8601 (`toISOString()`), dezelfde vorm die `firestore.rules` afdwingt. */
  exportedAt: string;
  counts: DeletionRequestExportCounts;
}

/** organizations/{orgId}/deletionRequests/current — singleton per organisatie. */
export interface DeletionRequestDocument {
  organizationId: string;
  status: DeletionRequestStatus;
  /** Generatienummer van de poging; begint op 1, +1 bij elke herstart na annuleren. */
  attempt: number;
  requestedBy: string;
  requestedAt: Timestamp;
  exportProof: DeletionRequestExportProof;
  cancelledAt: Timestamp | null;
  /** Optimistische concurrency: gaat per patch met exact 1 omhoog, start op 0. */
  revision: number;
}

function assertNonNegativeInteger(field: string, value: unknown): number {
  const n = assertInteger(TYPE, field, value);
  if (n < 0) {
    throw new DocumentValidationError(TYPE, field, `mag niet negatief zijn, kreeg ${n}`);
  }
  return n;
}

function readExportProof(value: unknown): DeletionRequestExportProof {
  if (!isPlainObject(value)) {
    throw new DocumentValidationError(TYPE, 'exportProof', 'moet een object zijn');
  }
  const rawCounts = value.counts;
  if (!isPlainObject(rawCounts)) {
    throw new DocumentValidationError(TYPE, 'exportProof.counts', 'moet een object zijn');
  }
  const allowed = new Set<string>(DELETION_REQUEST_COUNT_KEYS);
  for (const key of Object.keys(rawCounts)) {
    if (!allowed.has(key)) {
      throw new DocumentValidationError(
        TYPE,
        'exportProof.counts',
        `bevat een onbekende telling "${key}"`,
      );
    }
  }
  const counts = {} as DeletionRequestExportCounts;
  for (const key of DELETION_REQUEST_COUNT_KEYS) {
    counts[key] = assertNonNegativeInteger(`exportProof.counts.${key}`, rawCounts[key]);
  }
  return {
    contentHash: assertNonEmptyString(TYPE, 'exportProof.contentHash', value.contentHash),
    exportedAt: assertIsoTimestampString(TYPE, 'exportProof.exportedAt', value.exportedAt),
    counts,
  };
}

export const deletionRequestConverter: FirestoreDataConverter<DeletionRequestDocument> = {
  toFirestore(request: DeletionRequestDocument) {
    return request;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): DeletionRequestDocument {
    const data = snapshot.data();
    const attempt = assertInteger(TYPE, 'attempt', data.attempt);
    if (attempt < 1) {
      throw new DocumentValidationError(TYPE, 'attempt', `moet minstens 1 zijn, kreeg ${attempt}`);
    }
    return {
      organizationId: assertNonEmptyString(TYPE, 'organizationId', data.organizationId),
      status: assertOneOf(TYPE, 'status', data.status, DELETION_REQUEST_STATUSES),
      attempt,
      requestedBy: assertNonEmptyString(TYPE, 'requestedBy', data.requestedBy),
      requestedAt: assertTimestamp(TYPE, 'requestedAt', data.requestedAt),
      exportProof: readExportProof(data.exportProof),
      cancelledAt: assertNullableTimestamp(TYPE, 'cancelledAt', data.cancelledAt),
      revision: assertNonNegativeInteger('revision', data.revision),
    };
  },
};
