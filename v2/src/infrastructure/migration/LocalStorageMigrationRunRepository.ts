import type { KeyValueStorage } from '../../i18n/persistence';
import type { MigrationRunRepository } from '../../application/migration/MigrationRunRepository';
import type { MigrationRun } from '../../domain/migration/run';

/**
 * localStorage-implementatie van `MigrationRunRepository` (PR 7.4b,
 * docs/pr-7.4-plan.md §C 7.4b werk 1/2). Sleutel per DOELcontext (zie de
 * poort-docstring) — spiegelt `pendingFinalizeStorageKey()`'s per-org/team-
 * sleutelpatroon. Fail-closed shape-check net als
 * `LocalStorageGameSyncCheckpointRepository`: een corrupte/onherkenbare
 * waarde telt als "geen run", nooit als een crash.
 */
export function migrationRunStorageKey(organizationId: string, teamId: string): string {
  return `lineup-tracker-v2-migration-run:${organizationId}:${teamId}`;
}

function isMigrationRunShape(value: unknown): value is MigrationRun {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.runId === 'string' &&
    typeof v.manifestHash === 'string' &&
    typeof v.source === 'object' &&
    typeof v.target === 'object' &&
    typeof v.createdBy === 'string' &&
    typeof v.createdAt === 'string' &&
    typeof v.updatedAt === 'string' &&
    typeof v.cloudRevision === 'number' &&
    typeof v.rollbackRequested === 'boolean' &&
    Array.isArray(v.items) &&
    typeof v.status === 'string'
  );
}

export class LocalStorageMigrationRunRepository implements MigrationRunRepository {
  constructor(private readonly storage: KeyValueStorage) {}

  read(organizationId: string, teamId: string): MigrationRun | null {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(migrationRunStorageKey(organizationId, teamId));
    } catch {
      return null;
    }
    if (raw === null || raw === '') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isMigrationRunShape(parsed)) return null;
    // Zelfde contextvalidatie-precedent als `GameSyncCoordinator.readCheckpoint()`
    // (P1-fix PR #56): een run die niet bij DEZE sleutel se doelcontext hoort
    // wordt nooit hergebruikt, ook al staat 'ie toevallig op dit pad.
    if (parsed.target.organizationId !== organizationId || parsed.target.teamId !== teamId)
      return null;
    return parsed;
  }

  write(run: MigrationRun): boolean {
    try {
      this.storage.setItem(
        migrationRunStorageKey(run.target.organizationId, run.target.teamId),
        JSON.stringify(run),
      );
      return true;
    } catch {
      return false;
    }
  }

  clear(organizationId: string, teamId: string): boolean {
    try {
      this.storage.removeItem(migrationRunStorageKey(organizationId, teamId));
      return true;
    } catch {
      return false;
    }
  }
}
