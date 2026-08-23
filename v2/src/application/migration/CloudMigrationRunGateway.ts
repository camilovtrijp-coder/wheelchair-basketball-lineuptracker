import type { MigrationRun, MigrationRunItemCheckpoint } from '../../domain/migration/run';

/**
 * PR 7.4b (docs/pr-7.4-plan.md §C 7.4b werk 1/2): application-poort voor het
 * cloud-`migrationRun`-manifest (plan §B: "Migratie gebruikt een cloud
 * `migrationRun`-manifest met hash, doelcontext, aantallen, status en
 * per-itemcheckpoint"). Spiegelt `GameCloudGateway`'s `ensureGame()`/
 * `patchSnapshot()`-paar: een create-only manifest (immutabele kernvelden —
 * `manifestHash`/`source`/`target`/`createdBy`/`createdAt`) plus een
 * revisie-bewaakte checkpointpatch (`items`/`status`/`rollbackRequested`).
 *
 * **Waarom BEIDE een lokale (`MigrationRunRepository`) én een cloudkopie
 * (deze poort)?** Zie `domain/migration/run.ts`'s bestandsdocstring. Kort:
 * de lokale kopie is de OFFLINE-hervatbare bron (zelfde rol als
 * `GameSyncCheckpoint` voor een wedstrijd — reload/crash zonder netwerk mag
 * nooit de voortgang kwijtraken), de cloudkopie is het AUDIT-/cross-
 * apparaatbewijs (plan §B: "Alleen een volledig bevestigde run wordt als
 * voltooid gepresenteerd" — "bevestigd" impliceert een serverbron, geen
 * uitsluitend-lokale claim). `MigrationCoordinator` schrijft na ELKE
 * itemstap naar BEIDE (eerst cloud, dan pas het lokale checkpoint — bij een
 * crash tussen de twee toont een volgende sessie dus hooguit een lokaal
 * checkpoint dat ACHTERLOOPT op de cloudstand, nooit andersom; de coordinator
 * leidt zijn hervatpunt daarom uit een gemergde stand, zie
 * `MigrationCoordinator.resumeOrCreateRun()`).
 */
export interface MigrationRunCloudWriteResult {
  ok: boolean;
  /** Aanwezig bij `ok: true`: de nieuwe serverrevisie na deze write. */
  revision?: number;
  error?: unknown;
}

export interface MigrationRunManifestProjection {
  manifestHash: string;
  source: MigrationRun['source'];
  target: MigrationRun['target'];
  callerRole: MigrationRun['callerRole'];
  contextFingerprint: MigrationRun['contextFingerprint'];
  createdBy: string;
  createdAt: string;
  items: MigrationRunItemCheckpoint[];
  status: MigrationRun['status'];
  rollbackRequested: boolean;
}

export interface CloudMigrationRunGateway {
  /**
   * Maakt het cloud-manifest aan als het nog niet bestaat (create-only,
   * immutabele kernvelden — zie hierboven); een al bestaand document met
   * hetzelfde `runId` blijft ongemoeid en het BESTAANDE manifest komt terug
   * (idempotent tegen een herhaalde aanroep, bijv. na een crash vlak ná de
   * eerste create maar vóór het lokale checkpoint bijgewerkt was).
   */
  ensureRun(
    organizationId: string,
    teamId: string,
    runId: string,
    manifest: MigrationRunManifestProjection,
  ): Promise<
    MigrationRunCloudWriteResult & {
      existing?: MigrationRunManifestProjection & { revision: number };
    }
  >;
  /** Patcht uitsluitend `items`/`status`/`rollbackRequested`/`updatedAt`; faalt bij een revisiemismatch (optimistische concurrency, spiegelt `GameCloudGateway.patchSnapshot()`). */
  patchRunCheckpoint(
    organizationId: string,
    teamId: string,
    runId: string,
    patch: {
      items: MigrationRunItemCheckpoint[];
      status: MigrationRun['status'];
      rollbackRequested: boolean;
      updatedAt: string;
    },
    expectedRevision: number,
  ): Promise<MigrationRunCloudWriteResult>;
}
