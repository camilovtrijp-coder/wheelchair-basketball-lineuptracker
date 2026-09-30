// PR 8.3c-1d: het minimale uitvoeringsrecord dat het runbook BUITEN Firestore bewaart
// (`deletionRequests/current` verdwijnt mee met de organisatie; besluitrecord §2.5).
// Uitsluitend deze zeven velden: organisatie-id, aanvraag- en uitvoeringstijdstip, aantallen
// per gegevensfamilie, de `contentHash` van de beheerdersdump en de uid van de aanvrager.
// Geen e-mailadressen, geen spelersnamen, geen exportinhoud.
import {
  DELETION_REQUEST_COUNT_KEYS,
  type DeletionRequestExportCounts,
} from '../../src/documents/deletionRequest.js';

export interface DeletionExecutionRecord {
  organizationId: string;
  requestedAt: string;
  requestedBy: string;
  executedAt: string;
  counts: DeletionRequestExportCounts;
  contentHash: string;
}

const ALLOWED_KEYS = [
  'organizationId',
  'requestedAt',
  'requestedBy',
  'executedAt',
  'counts',
  'contentHash',
] as const;

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`uitvoeringsrecord: ${field} ontbreekt of is leeg`);
  }
  // Een e-mailadres hoort hier nooit in; uids, ids, ISO-tijden en hashes bevatten geen '@'.
  if (value.includes('@')) {
    throw new Error(`uitvoeringsrecord: ${field} bevat een '@' (mogelijk een e-mailadres)`);
  }
  return value;
}

function requireIso(value: unknown, field: string): string {
  const text = requireText(value, field);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) {
    throw new Error(`uitvoeringsrecord: ${field} is geen ISO-8601 (toISOString)-tijdstip`);
  }
  return text;
}

/** Valideert en geeft een schoon record terug; alle andere velden worden geweigerd. */
export function buildExecutionRecord(input: Record<string, unknown>): DeletionExecutionRecord {
  const extra = Object.keys(input).filter(
    (key) => !(ALLOWED_KEYS as readonly string[]).includes(key),
  );
  if (extra.length > 0) {
    throw new Error(`uitvoeringsrecord: niet-toegestane velden: ${extra.join(', ')}`);
  }
  const countsInput = input.counts as Record<string, unknown> | undefined;
  if (countsInput === null || typeof countsInput !== 'object') {
    throw new Error('uitvoeringsrecord: counts ontbreekt');
  }
  const countKeys = Object.keys(countsInput).sort();
  const expected = [...DELETION_REQUEST_COUNT_KEYS].sort();
  if (countKeys.join(',') !== expected.join(',')) {
    throw new Error('uitvoeringsrecord: counts heeft niet exact de tien verwachte sleutels');
  }
  const counts = {} as DeletionRequestExportCounts;
  for (const key of DELETION_REQUEST_COUNT_KEYS) {
    const count = countsInput[key];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw new Error(`uitvoeringsrecord: counts.${key} is geen niet-negatief geheel getal`);
    }
    counts[key] = count;
  }
  return {
    organizationId: requireText(input.organizationId, 'organizationId'),
    requestedAt: requireIso(input.requestedAt, 'requestedAt'),
    requestedBy: requireText(input.requestedBy, 'requestedBy'),
    executedAt: requireIso(input.executedAt, 'executedAt'),
    counts,
    contentHash: requireText(input.contentHash, 'contentHash'),
  };
}
