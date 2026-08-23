import type { MigrationRun, MigrationRunItemCheckpoint } from '../../domain/migration/run';

/**
 * PR 7.4c (docs/pr-7.4-plan.md §C 7.4c werk 1: "retry/export"). Zelfde
 * blob-`<a download>`-patroon als `infrastructure/game/exportPendingGameActions.ts`
 * (PR 7.3c) — een run die vaststaat (`actionNeeded`/`compensationFailed`)
 * moet zichtbaar en downloadbaar zijn, nooit alleen een niet-navigeerbare
 * UI-status. Exporteert UITSLUITEND de vastzittende items (conflict/failed/
 * compensationFailed), niet de hele run — een `confirmed`/`compensated`-item
 * is al klaar, daar is niets aan te "retrien/exporteren".
 */
export interface StuckMigrationItemsEnvelope {
  type: 'lineup-tracker-migration-stuck-items';
  version: 1;
  exportedAt: string;
  runId: string;
  organizationId: string;
  teamId: string;
  status: MigrationRun['status'];
  items: MigrationRunItemCheckpoint[];
}

const STUCK_STATUSES: ReadonlySet<MigrationRunItemCheckpoint['status']> = new Set([
  'conflict',
  'failed',
  'compensationFailed',
]);

export function stuckMigrationItems(run: MigrationRun): MigrationRunItemCheckpoint[] {
  return run.items.filter((item) => STUCK_STATUSES.has(item.status));
}

export function buildStuckMigrationItemsEnvelope(
  run: MigrationRun,
  now: () => string = () => new Date().toISOString(),
): StuckMigrationItemsEnvelope {
  return {
    type: 'lineup-tracker-migration-stuck-items',
    version: 1,
    exportedAt: now(),
    runId: run.runId,
    organizationId: run.target.organizationId,
    teamId: run.target.teamId,
    status: run.status,
    items: stuckMigrationItems(run),
  };
}

export function downloadStuckMigrationItems(run: MigrationRun): void {
  const envelope = buildStuckMigrationItemsEnvelope(run);
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `migratie-${run.runId}-actie-nodig-${Date.now()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
