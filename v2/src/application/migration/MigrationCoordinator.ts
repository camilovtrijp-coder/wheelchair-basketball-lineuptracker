import type { Settings } from '../../domain/settings/types';
import type { Roster } from '../../domain/roster/types';
import type { CompletedGame } from '../../domain/game/types';
import type { CloudMigrationPreview } from '../../domain/migration/types';
import { resolveAction } from '../../domain/migration/preview';
import {
  isPreviewStillValid,
  type MigrationCallerContext,
} from '../../domain/migration/capability';
import {
  createMigrationRun,
  deriveSettledMigrationRunStatus,
  isMigrationRunItemRetryable,
  isMigrationRunItemWritten,
  type MigrationRun,
  type MigrationRunItemCheckpoint,
} from '../../domain/migration/run';
import type { CloudMigrationInventoryGateway } from './CloudMigrationInventoryGateway';
import type {
  CloudMigrationRunGateway,
  MigrationRunManifestProjection,
} from './CloudMigrationRunGateway';
import type { MigrationItemWriteResult, MigrationWriteGateway } from './MigrationWriteGateway';
import type { MigrationRunRepository } from './MigrationRunRepository';

/**
 * PR 7.4b (docs/pr-7.4-plan.md §C 7.4b): orkestreert een hervatbare
 * cloudmigratie voor precies één `CloudMigrationPreview`. Mirrort
 * `GameSyncCoordinator`'s opzet (application-poorten, geen Firebase-import
 * hier) en stapstructuur (elke stap: lees vlak-voor-bevestiging opnieuw →
 * schrijf → readback/checkpoint → volgende stap; stopt bij de eerste ECHTE
 * fout, hervat gewoon vanaf het eerste nog-niet-bevestigde item bij een
 * volgende aanroep).
 *
 * **Ontwerpbeslissing — settings/roster hebben GEEN Firestore-optimistische-
 * concurrency** (anders dan games/completedGames, zie firestore.rules'
 * `settings`/`roster`-paden: alleen `canManageTeamData`, geen
 * revisie-/create-only-eis). Een `setDoc()` daar overschrijft dus
 * ONVOORWAARDELIJK. Om work item 4's "afwijkende payload... nooit een
 * overwrite" tóch waar te maken, doet `runMigration()` VLAK VOOR elke
 * schrijfronde een VERSE `CloudMigrationInventoryGateway.readTargetSnapshot()`
 * en herclassificeert elk nog niet bevestigd item (`resolveAction()`,
 * hergebruikt van `domain/migration/preview.ts` — geen tweede formule) —
 * pas als dat een `'create'` oplevert, volgt de daadwerkelijke write. Dit
 * sluit het race-venster NIET volledig (er blijft een klein venster tussen
 * deze recheck en de write zelf open, zolang firestore.rules zelf geen
 * concurrency-veld voor settings/roster afdwingt — een bestaand gat uit
 * PR 5.3, geen nieuw gat van 7.4b, dus bewust NIET hier "gefixed" met een
 * Rules-wijziging buiten scope), maar reduceert het van "altijd" naar
 * "alleen bij een write die exact tussen recheck en schrijfmoment gebeurt".
 *
 * **Ontwerpbeslissing — cloud-checkpointpersistentie is best-effort.** Elke
 * itemstap schrijft ALTIJD naar het lokale checkpoint (`MigrationRunRepository`
 * — de bron van waarheid voor hervatten); de cloud-manifestpatch
 * (`CloudMigrationRunGateway`) is audit-/cross-apparaatbewijs en mag falen
 * (bijv. tijdelijk offline) zonder de daadwerkelijke datamigratie te
 * blokkeren — de ECHTE voortgang zit in settings/roster/completedGames zelf,
 * niet in het manifest. Een falende cloud-patch laat `cloudRevision`
 * ongewijzigd; een volgende `persist()`-aanroep probeert opnieuw (eerst
 * `ensureRun()` als er nog nooit een geslaagde cloud-create was).
 */
export interface MigrationCoordinatorDeps {
  writeGateway: MigrationWriteGateway;
  inventoryGateway: CloudMigrationInventoryGateway;
  runRepo: MigrationRunRepository;
  cloudRunGateway: CloudMigrationRunGateway;
  now?: () => string;
}

export interface MigrationLocalSource {
  settings: (Settings & Record<string, unknown>) | null;
  roster: Roster | null;
  completedGames: ReadonlyMap<string, CompletedGame>;
}

export interface PrepareRunResult {
  run: MigrationRun;
  /** Aanwezig als er al een ANDERE, nog niet afgeronde run voor deze doelcontext bestaat — de aanroeper moet die eerst afronden/afbreken vóórdat een nieuwe manifest-run start. */
  blockedByExistingRunId?: string;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'onbekende migratiefout';
}

function toManifestProjection(run: MigrationRun): MigrationRunManifestProjection {
  return {
    manifestHash: run.manifestHash,
    source: run.source,
    target: run.target,
    callerRole: run.callerRole,
    contextFingerprint: run.contextFingerprint,
    createdBy: run.createdBy,
    createdAt: run.createdAt,
    items: run.items,
    status: run.status,
    rollbackRequested: run.rollbackRequested,
  };
}

export class MigrationCoordinator {
  private readonly writeGateway: MigrationWriteGateway;
  private readonly inventoryGateway: CloudMigrationInventoryGateway;
  private readonly runRepo: MigrationRunRepository;
  private readonly cloudRunGateway: CloudMigrationRunGateway;
  private readonly now: () => string;

  constructor(deps: MigrationCoordinatorDeps) {
    this.writeGateway = deps.writeGateway;
    this.inventoryGateway = deps.inventoryGateway;
    this.runRepo = deps.runRepo;
    this.cloudRunGateway = deps.cloudRunGateway;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /**
   * Levert de run op die `runMigration()` moet uitvoeren voor `preview` —
   * hervat een bestaande lokale run met hetzelfde `manifestHash` (idempotent
   * tegen een herhaalde preview-bevestiging), of bouwt een verse run
   * (`runId === preview.manifestHash`, §B: "Retry maakt geen duplicaat" ook
   * hier toegepast — dezelfde preview levert altijd dezelfde `runId`).
   * Weigert stilzwijgend NOOIT een andersoortige, nog niet afgeronde run
   * voor dezelfde doelcontext te vervangen — `blockedByExistingRunId` maakt
   * dat zichtbaar voor de aanroeper (7.4c-scope: die run eerst afronden of
   * expliciet afbreken).
   */
  async prepareRun(preview: CloudMigrationPreview, createdBy: string): Promise<PrepareRunResult> {
    const runId = preview.manifestHash;
    const existing = this.runRepo.read(preview.target.organizationId, preview.target.teamId);
    if (existing && existing.manifestHash === runId) {
      return { run: existing };
    }
    if (existing) {
      const settled = deriveSettledMigrationRunStatus(existing);
      if (settled === 'paused' || settled === 'actionNeeded') {
        return { run: existing, blockedByExistingRunId: existing.runId };
      }
    }

    const now = this.now();
    const fresh = createMigrationRun(preview, runId, createdBy, now);
    const ensure = await this.cloudRunGateway.ensureRun(
      preview.target.organizationId,
      preview.target.teamId,
      runId,
      toManifestProjection(fresh),
    );
    const withCloudRevision: MigrationRun = {
      ...fresh,
      cloudRevision: ensure.ok ? (ensure.revision ?? 0) : -1,
    };
    this.runRepo.write(withCloudRevision);
    return { run: withCloudRevision };
  }

  private withItem(run: MigrationRun, updated: MigrationRunItemCheckpoint): MigrationRun {
    const items = run.items.map((i) =>
      i.kind === updated.kind && i.targetId === updated.targetId ? updated : i,
    );
    const next: MigrationRun = { ...run, items, updatedAt: this.now() };
    return { ...next, status: deriveSettledMigrationRunStatus(next) };
  }

  private async persist(run: MigrationRun): Promise<MigrationRun> {
    this.runRepo.write(run);
    let cloudRevision = run.cloudRevision;
    if (cloudRevision < 0) {
      const ensure = await this.cloudRunGateway.ensureRun(
        run.target.organizationId,
        run.target.teamId,
        run.runId,
        toManifestProjection(run),
      );
      if (ensure.ok) cloudRevision = ensure.revision ?? 0;
    }
    if (cloudRevision >= 0) {
      const patch = await this.cloudRunGateway.patchRunCheckpoint(
        run.target.organizationId,
        run.target.teamId,
        run.runId,
        {
          items: run.items,
          status: run.status,
          rollbackRequested: run.rollbackRequested,
          updatedAt: run.updatedAt,
        },
        cloudRevision,
      );
      if (patch.ok) cloudRevision = patch.revision ?? cloudRevision + 1;
    }
    const withRevision: MigrationRun = { ...run, cloudRevision };
    if (withRevision.cloudRevision !== run.cloudRevision) this.runRepo.write(withRevision);
    return withRevision;
  }

  private existingFor(
    kind: MigrationRunItemCheckpoint['kind'],
    targetId: string,
    fresh: Awaited<ReturnType<CloudMigrationInventoryGateway['readTargetSnapshot']>>,
  ): { present: boolean; hash: string | null } {
    if (kind === 'settings') return fresh.settings;
    if (kind === 'roster') return fresh.roster;
    if (kind === 'completedGame') {
      const entry = fresh.completedGames.get(targetId);
      return entry ? { present: true, hash: entry.hash } : { present: false, hash: null };
    }
    return { present: false, hash: null };
  }

  private async writeItem(
    item: MigrationRunItemCheckpoint,
    local: MigrationLocalSource,
    target: { organizationId: string; teamId: string },
    writer: { authorUid: string; deviceId: string },
    now: string,
  ): Promise<MigrationItemWriteResult> {
    switch (item.kind) {
      case 'settings':
        if (!local.settings) return { ok: false, error: 'lokale settings ontbreken voor deze run' };
        return this.writeGateway.writeSettings(
          target.organizationId,
          target.teamId,
          local.settings,
        );
      case 'roster':
        if (!local.roster) return { ok: false, error: 'lokale roster ontbreekt voor deze run' };
        return this.writeGateway.writeRoster(target.organizationId, target.teamId, local.roster);
      case 'completedGame': {
        const game = local.completedGames.get(item.sourceId);
        if (!game)
          return { ok: false, error: `lokale wedstrijd ${item.sourceId} ontbreekt voor deze run` };
        return this.writeGateway.writeCompletedGame(
          target.organizationId,
          target.teamId,
          game,
          writer,
          now,
        );
      }
      case 'activeGame':
        // §B/§D: nooit via het bulkpad — `createMigrationRun()` neemt dit
        // itemtype nooit mee (alleen `excludedTrackingGame`/
        // `needsSeparateDecision`-acties bestaan voor `activeGame`, beide
        // uitgefilterd). Defensief bewaakt, nooit werkelijk bereikbaar.
        return { ok: false, error: 'activeGame wordt nooit via het bulkmigratiepad geschreven' };
    }
  }

  /**
   * Voert `run` zo ver mogelijk uit: (1) capability-/contextrecheck (werk 4),
   * (2) verse doelcontext-recheck + herclassificatie van nog niet bevestigde
   * items, (3) itemsgewijs schrijven met server-readback + checkpoint per
   * stap, stopt bij de eerste ECHTE fout (netwerk/Rules-afwijzing) — een
   * gedetecteerd `'conflict'` blokkeert alleen DAT item, niet de rest (elk
   * item is een onafhankelijk domeinobject). Veilig herhaaldelijk aan te
   * roepen: al bevestigde/conflict-/compensatie-items worden nooit opnieuw
   * geprobeerd (`isMigrationRunItemRetryable()`).
   */
  async runMigration(
    run: MigrationRun,
    local: MigrationLocalSource,
    writer: { authorUid: string; deviceId: string },
    currentContext: MigrationCallerContext,
  ): Promise<MigrationRun> {
    if (run.rollbackRequested) return run;

    if (!isPreviewStillValid(run.contextFingerprint, currentContext)) {
      let blocked = run;
      for (const item of run.items) {
        if (!isMigrationRunItemRetryable(item)) continue;
        blocked = this.withItem(blocked, {
          ...item,
          status: 'failed',
          lastError: 'context gewijzigd sinds bevestiging — bouw een nieuwe preview vóór hervatten',
        });
      }
      return this.persist(blocked);
    }

    let current = run;
    const completedGameIds = current.items
      .filter((i) => i.kind === 'completedGame' && isMigrationRunItemRetryable(i))
      .map((i) => i.targetId);
    const fresh = await this.inventoryGateway.readTargetSnapshot(
      current.target.organizationId,
      current.target.teamId,
      completedGameIds,
      null,
    );
    for (const item of current.items) {
      if (!isMigrationRunItemRetryable(item)) continue;
      const existing = this.existingFor(item.kind, item.targetId, fresh);
      const action = resolveAction(item.payloadHash, existing.present, existing.hash);
      if (action === 'conflict') {
        current = this.withItem(current, { ...item, status: 'conflict', lastError: undefined });
      } else if (action === 'alreadyPresentIdentical') {
        current = this.withItem(current, { ...item, status: 'confirmed', lastError: undefined });
      } else if (item.status === 'failed') {
        current = this.withItem(current, { ...item, status: 'pending', lastError: undefined });
      }
    }
    current = await this.persist(current);

    for (const item of current.items) {
      if (current.rollbackRequested) break;
      if (!isMigrationRunItemRetryable(item)) continue;
      const outcome = await this.writeItem(item, local, current.target, writer, this.now());
      current = this.withItem(
        current,
        outcome.ok
          ? {
              ...item,
              status: 'confirmed',
              payloadHash: outcome.confirmedHash ?? item.payloadHash,
              lastError: undefined,
            }
          : { ...item, status: 'failed', lastError: describeError(outcome.error) },
      );
      current = await this.persist(current);
      if (!outcome.ok) break;
    }
    return current;
  }

  /**
   * §B-rollback: stopt onmiddellijk verdere writes (`rollbackRequested`,
   * bewaakt door `runMigration()` hierboven) en compenseert daarna elk al
   * geschreven (`'confirmed'`) `completedGame`-item via tombstone. Settings/
   * roster-items blijven bewust ONGECOMPENSEERD (zie deze klasse se
   * docstring-ontwerpbeslissing hieronder) — hun status blijft `'confirmed'`,
   * zichtbaar in het manifest, nooit stilzwijgend "als teruggedraaid"
   * gerapporteerd (de opgeslagen `status` wordt bij een rollback nooit
   * `'completed'`, zie `deriveSettledMigrationRunStatus()`).
   *
   * **Ontwerpbeslissing — waarom geen settings/roster-compensatie?** Settings/
   * roster zijn SINGLETON-documenten (`settings/current`/`roster/current`),
   * geen append-only geschiedenis zoals `completedGames`. "Compenseren" zou
   * hier moeten betekenen: terug naar de staat VÓÓR deze migratie — maar die
   * vorige staat is voor een bestaande-gebruikersmigratie naar een team dat
   * doorgaans NOG GEEN eigen settings/roster had (§A: dit is een migratie
   * NAAR een cloudcontext, typisch een team dat lokaal-only was) typisch
   * "nog niet aanwezig", dus een write-actie zou zelf al nooit als
   * `'create'` zijn uitgevoerd als er al iets anders stond (zie de
   * conflictrecheck in `runMigration()` hierboven). Reversie naar "weer
   * afwezig" is geen Rules-toegestane operatie (geen delete-pad voor
   * settings/roster) en zou bovendien, als een ANDER teamlid inmiddels op
   * die net-aangemaakte settings/roster verder werkt, een ECHTE wijziging
   * ongedaan maken — riskanter dan laten staan. §B eist "veilig gecompenseerd
   * OF getombstoned", niet "elk itemtype moet letterlijk ongedaan gemaakt
   * worden" — voor deze twee itemtypes is "stoppen, laten staan, zichtbaar
   * documenteren" de veiligere lezing van "veilig".
   */
  async abortAndCompensate(run: MigrationRun, deletedBy: string): Promise<MigrationRun> {
    let current = this.withRollbackRequested(run);
    current = await this.persist(current);

    for (const item of current.items) {
      if (!isMigrationRunItemWritten(item)) continue;
      if (item.kind !== 'completedGame') continue; // zie docstring hierboven
      const outcome = await this.writeGateway.compensateCompletedGame(
        current.target.organizationId,
        current.target.teamId,
        item.targetId,
        deletedBy,
      );
      current = this.withItem(
        current,
        outcome.ok
          ? { ...item, status: 'compensated', lastError: undefined }
          : { ...item, status: 'compensationFailed', lastError: describeError(outcome.error) },
      );
      current = await this.persist(current);
    }
    return current;
  }

  private withRollbackRequested(run: MigrationRun): MigrationRun {
    const next: MigrationRun = { ...run, rollbackRequested: true, updatedAt: this.now() };
    return { ...next, status: deriveSettledMigrationRunStatus(next) };
  }
}
