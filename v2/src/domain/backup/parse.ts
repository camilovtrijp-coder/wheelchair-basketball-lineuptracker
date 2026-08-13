import { migrateV1BackupData } from './migrateV1';
import { validateBackupData, validateEnvelope } from './validate';
import type { BackupV2Data, BackupValidationError } from './types';

export interface ParsedBackup {
  errors: BackupValidationError[];
  data: BackupV2Data;
  version: number;
  exportedAt: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Pure top-tot-teen-pijplijn (plan §C.2-§C.5): envelope-vorm → versie/
 * migratie → sectievalidatie. Schrijft niets en raakt geen DOM/storage —
 * de infra-laag (`readBackupFile.ts`) levert alleen de al-ingelezen tekst
 * aan, en de coordinator (application-laag) roept dit vóór elke preview
 * aan. Retourneert ALTIJD een `data`, ook bij fouten (dan leeg/ongebruikt —
 * de aanroeper mag alleen schrijven als `errors.length === 0`).
 */
export function parseBackupPayload(raw: unknown): ParsedBackup {
  const envelope = validateEnvelope(raw);
  if (envelope.errors.length > 0 || envelope.data === null) {
    return { errors: envelope.errors, data: {}, version: NaN, exportedAt: null };
  }

  const exportedAt =
    isPlainObject(raw) && typeof raw.exportedAt === 'string' ? raw.exportedAt : null;

  // version === 1 (of ontbrekend) betekent v1 (plan §C.3); migreer eerst
  // stapsgewijs (hier: één stap, want er is vooralsnog maar één oudere
  // versie) naar het huidige v2-schema vóórdat sectievalidatie draait. Een
  // migratiefout (bv. een corrupte wedstrijd in `lineup-tracker-games`)
  // stopt hier al fail-closed — sectievalidatie draait dan niet meer, net
  // als v1's "migratie mislukt" i.p.v. stil een deel van de data te
  // negeren en de rest tóch te valideren.
  let data: BackupV2Data;
  if (envelope.version < 2) {
    const migrated = migrateV1BackupData(envelope.data);
    if (migrated.errors.length > 0) {
      return { errors: migrated.errors, data: {}, version: envelope.version, exportedAt };
    }
    data = migrated.data;
  } else {
    data = envelope.data as unknown as BackupV2Data;
  }

  const errors = validateBackupData(data);
  return { errors, data: errors.length === 0 ? data : {}, version: envelope.version, exportedAt };
}
