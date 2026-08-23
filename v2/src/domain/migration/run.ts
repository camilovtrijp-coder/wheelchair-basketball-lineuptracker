import type { OrganizationRole } from '../organizations/types';
import type { MigrationContextFingerprint } from './capability';
import type { CloudMigrationItem, CloudMigrationPreview, MigrationContextRef } from './types';

/**
 * PR 7.4b (docs/pr-7.4-plan.md §C 7.4b): pure state-machine voor één
 * hervatbare migratierun. Geen Firebase-/storage-import — puur data in, puur
 * data uit, spiegelt bewust dezelfde stijl als `domain/game/syncCheckpoint.ts`
 * (lokaal checkpoint, `'idle' | 'actie-nodig'`) maar met de rijkere
 * vijf-statusverzameling die het plan voor 7.4b eist.
 *
 * **Ontwerpbeslissing (lokaal-vs-cloud manifest, zie plan-doc-update onder
 * "Geïmplementeerd" 7.4b):** een `MigrationRun` bestaat in TWEE vormen — een
 * lokale kopie (`MigrationRunRepository`, spiegelt `PendingFinalizeRepository`/
 * `GameSyncCheckpointRepository`: hervatbaarheid over reload/crash zonder
 * netwerk) EN een cloud-manifest (`CloudMigrationRunGateway`, spiegelt
 * `GameCloudGateway`'s `games/{gameId}`-parentdocument: create-only immutabele
 * kernvelden + een revisie-bewaakte checkpointpatch) — dit BESTAND kent geen
 * van beide, het is de pure kern die beide lagen delen.
 */

export type MigrationRunItemStatus =
  'pending' | 'confirmed' | 'conflict' | 'failed' | 'compensated' | 'compensationFailed';

export interface MigrationRunItemCheckpoint {
  kind: CloudMigrationItem['kind'];
  sourceId: string;
  targetId: string;
  label: string;
  payloadHash: string;
  status: MigrationRunItemStatus;
  lastError?: string;
}

export type MigrationRunStatus =
  'running' | 'paused' | 'actionNeeded' | 'completed' | 'compensationFailed';

/**
 * Eén hervatbare migratierun (plan §B: "cloud `migrationRun`-manifest met
 * hash, doelcontext, aantallen, status en per-itemcheckpoint"). `status` is
 * hier bewust een OPGESLAGEN, niet-herberekend veld — `deriveSettledMigration
 * RunStatus()` hieronder is de enige plek die het mag zetten, altijd ná een
 * mutatie van `items`/`rollbackRequested`, nooit los daarvan gewijzigd (geen
 * risico op een status die niet meer bij de itemset past).
 */
export interface MigrationRun {
  runId: string;
  manifestHash: string;
  source: MigrationContextRef;
  target: MigrationContextRef;
  callerRole: OrganizationRole;
  contextFingerprint: MigrationContextFingerprint;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Server-revisie van het cloud-manifest, voor optimistische concurrency op de checkpointpatch — `0` voor een nog niet cloud-bevestigde lokale run. */
  cloudRevision: number;
  /**
   * `true` zodra een gebruiker/aanroeper rollback heeft aangevraagd (plan §B:
   * "nog niet zichtbare clouditems stoppen, reeds geschreven items veilig
   * compenseren/tombstonen"). Onomkeerbaar binnen deze run — geen "un-abort".
   */
  rollbackRequested: boolean;
  items: MigrationRunItemCheckpoint[];
  status: Exclude<MigrationRunStatus, 'running'>;
}

/**
 * Bouwt een verse run uit een `allowed: true`-preview (plan werk 1). Neemt
 * UITSLUITEND items mee met actie `'create'`/`'alreadyPresentIdentical'`/
 * `'conflict'` — `'excludedTrackingGame'`/`'needsSeparateDecision'` horen
 * NOOIT tot een bulkrun (§B/§D: "Geen trackinggame via bulkpad om de
 * writerclaim heen"), die twee blijven exclusief 7.4c-scope (een aparte,
 * expliciete beslissing per actieve wedstrijd, niet dit bestand).
 *
 * `alreadyPresentIdentical` start meteen als `'confirmed'` (werk 4: "Detecteer
 * semantisch gelijke bestaande items als bevestigd") — geen write nodig.
 * `conflict` start meteen als `'conflict'` — nooit een write-poging, zichtbaar
 * vanaf het begin (werk 5/acceptatie: "afwijkende payload... nooit een
 * overwrite").
 */
export function createMigrationRun(
  preview: CloudMigrationPreview,
  runId: string,
  createdBy: string,
  now: string,
): MigrationRun {
  const items: MigrationRunItemCheckpoint[] = preview.items
    .filter(
      (item) =>
        item.action === 'create' ||
        item.action === 'alreadyPresentIdentical' ||
        item.action === 'conflict',
    )
    .map((item) => ({
      kind: item.kind,
      sourceId: item.sourceId,
      targetId: item.targetId,
      label: item.label,
      payloadHash: item.payloadHash,
      status:
        item.action === 'create'
          ? 'pending'
          : item.action === 'conflict'
            ? 'conflict'
            : 'confirmed',
    }));

  const run: MigrationRun = {
    runId,
    manifestHash: preview.manifestHash,
    source: preview.source,
    target: preview.target,
    callerRole: preview.callerRole,
    contextFingerprint: preview.contextFingerprint,
    createdBy,
    createdAt: now,
    updatedAt: now,
    cloudRevision: 0,
    rollbackRequested: false,
    items,
    status: 'paused',
  };
  return { ...run, status: deriveSettledMigrationRunStatus(run) };
}

/**
 * Herberekent de opgeslagen, "settled" status uit de huidige itemset (plan
 * werk 5). `'running'` bestaat expliciet NIET als opgeslagen waarde — dat is
 * een TRANSIËNTE live-status, uitsluitend zichtbaar terwijl een
 * `MigrationCoordinator.runMigration()`-aanroep in-flight is (de aanroeper
 * toont die zelf tijdens de `await`, zie de coordinator-docstring); zodra de
 * aanroep teruggeeft, is de status altijd één van de vier hieronder.
 *
 * Volgorde (een latere check wordt nooit bereikt als een eerdere al geldt):
 * 1. `rollbackRequested` — een compensatiefout domineert alles
 *    (`'compensationFailed'`), anders blijft een rollback-run altijd
 *    `'paused'` (nooit `'completed'`: een teruggedraaide/gestopte run is per
 *    definitie geen succesvol afgeronde migratie, §B: "geen vals 'alles
 *    teruggedraaid' wanneer een compensatie faalt" — en evenmin een vals
 *    'succesvol afgerond' voor een run die juist is afgebroken).
 * 2. Een `'conflict'`- of `'failed'`-item ⇒ `'actionNeeded'` (zichtbaar,
 *    exporteerbaar, nooit stilzwijgend genegeerd).
 * 3. Elk item `'confirmed'` ⇒ `'completed'`.
 * 4. Anders (nog `'pending'`-items over, geen fout/conflict) ⇒ `'paused'` —
 *    hervatbaar, geen actieve fout.
 */
export function deriveSettledMigrationRunStatus(
  run: Pick<MigrationRun, 'items' | 'rollbackRequested'>,
): Exclude<MigrationRunStatus, 'running'> {
  if (run.rollbackRequested) {
    const anyCompensationFailed = run.items.some((i) => i.status === 'compensationFailed');
    return anyCompensationFailed ? 'compensationFailed' : 'paused';
  }
  const anyBlocked = run.items.some((i) => i.status === 'conflict' || i.status === 'failed');
  if (anyBlocked) return 'actionNeeded';
  const allConfirmed = run.items.every((i) => i.status === 'confirmed');
  if (allConfirmed) return 'completed';
  return 'paused';
}

/** `true` zodra dit item nog een schrijfpoging nodig kan hebben (plan werk 2:
 * "ondersteunt reload/crash zonder opnieuw beginnen" — `'failed'` is bewust
 * WEL herprobeerbaar, `'confirmed'`/`'conflict'`/`'compensated'`/
 * `'compensationFailed'` nooit meer). */
export function isMigrationRunItemRetryable(item: MigrationRunItemCheckpoint): boolean {
  return item.status === 'pending' || item.status === 'failed';
}

/** `true` zodra dit item al een geslaagde cloudwrite draagt — de enige
 * itemsoort die `abortAndCompensate()` (application-laag) ooit hoeft te
 * overwegen te compenseren/tombstonen. */
export function isMigrationRunItemWritten(item: MigrationRunItemCheckpoint): boolean {
  return item.status === 'confirmed' || item.status === 'compensated';
}
