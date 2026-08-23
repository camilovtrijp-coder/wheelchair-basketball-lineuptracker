import { describe, expect, it } from 'vitest';
import { buildCloudMigrationPreview } from '../../src/domain/migration/preview';
import { buildLocalMigrationInventory } from '../../src/domain/migration/inventory';
import { DEFAULT_SETTINGS } from '../../src/domain/settings/types';
import type { CloudExistingSnapshot, MigrationContextRef } from '../../src/domain/migration/types';
import type { CompletedGame } from '../../src/domain/game/types';
import type { MigrationCallerContext } from '../../src/domain/migration/capability';
import {
  MigrationCoordinator,
  type MigrationLocalSource,
} from '../../src/application/migration/MigrationCoordinator';
import type { CloudMigrationInventoryGateway } from '../../src/application/migration/CloudMigrationInventoryGateway';
import type {
  CloudMigrationRunGateway,
  MigrationRunCloudWriteResult,
  MigrationRunManifestProjection,
} from '../../src/application/migration/CloudMigrationRunGateway';
import type { MigrationRunRepository } from '../../src/application/migration/MigrationRunRepository';
import type {
  MigrationItemWriteResult,
  MigrationWriteGateway,
} from '../../src/application/migration/MigrationWriteGateway';
import type { MigrationRun, MigrationRunItemCheckpoint } from '../../src/domain/migration/run';

const now = '2026-08-23T10:00:00.000Z';

const sourceCtx: MigrationContextRef = {
  organizationId: 'org-src',
  teamId: 'team-src',
  organizationName: 'Bron Org',
  teamName: 'De Adelaars',
};
const targetCtx: MigrationContextRef = {
  organizationId: 'org-dst',
  teamId: 'team-dst',
  organizationName: 'Doel Org',
  teamName: 'De Adelaars',
};
const callerContext: MigrationCallerContext = {
  organizationId: targetCtx.organizationId,
  teamId: targetCtx.teamId,
  role: 'coach',
};
const writer = { authorUid: 'uid-1', deviceId: 'device-1' };

function emptyCloudSnapshot(): CloudExistingSnapshot {
  return {
    settings: { present: false, hash: null },
    roster: { present: false, hash: null },
    completedGames: new Map(),
    activeGame: { present: false, hash: null, phase: null },
  };
}

const sampleRosterPlayer = { id: 1, nr: '4', naam: 'X', kl: '3.0', vrouw: false, jeugd: false };
const samplePlayer = {
  id: 'p1',
  rosterId: 1,
  nr: '4',
  naam: 'X',
  kl: '3.0',
  vrouw: false,
  jeugd: false,
  participate: true,
  start: true,
};
const completedGame: CompletedGame = {
  id: 'c1',
  organizationId: sourceCtx.organizationId,
  teamId: sourceCtx.teamId,
  sourceGameId: 'src-1',
  opponent: 'Tegenstander A',
  competition: '',
  date: '2026-01-01T10:00:00.000Z',
  players: [samplePlayer],
  segments: [],
  scoreFor: 10,
  scoreAgainst: 8,
  quarterCount: 4,
  periodLabel: '',
  useClassLimit: false,
  revision: 0,
  deletedAt: null,
  deletedBy: null,
};

function buildPreview(existingCloud: CloudExistingSnapshot = emptyCloudSnapshot()) {
  const settingsValue = { ...DEFAULT_SETTINGS, teamName: 'De Adelaars' };
  const inventory = buildLocalMigrationInventory(sourceCtx.organizationId, sourceCtx.teamId, {
    settings: settingsValue,
    roster: [sampleRosterPlayer],
    activeGame: undefined,
    completedGames: [completedGame],
  });
  const preview = buildCloudMigrationPreview({
    now,
    source: sourceCtx,
    target: targetCtx,
    callerRole: 'coach',
    inventory,
    existingCloud,
  });
  const local: MigrationLocalSource = {
    settings: settingsValue,
    roster: [sampleRosterPlayer],
    completedGames: new Map([[completedGame.id, completedGame]]),
  };
  return { preview, local };
}

class FakeRunRepository implements MigrationRunRepository {
  private store = new Map<string, MigrationRun>();
  private key(orgId: string, teamId: string) {
    return `${orgId}:${teamId}`;
  }
  read(organizationId: string, teamId: string): MigrationRun | null {
    return this.store.get(this.key(organizationId, teamId)) ?? null;
  }
  write(run: MigrationRun): boolean {
    this.store.set(this.key(run.target.organizationId, run.target.teamId), run);
    return true;
  }
  clear(organizationId: string, teamId: string): boolean {
    this.store.delete(this.key(organizationId, teamId));
    return true;
  }
}

class FakeCloudRunGateway implements CloudMigrationRunGateway {
  private store = new Map<string, { manifest: MigrationRunManifestProjection; revision: number }>();
  private key(orgId: string, teamId: string, runId: string) {
    return `${orgId}:${teamId}:${runId}`;
  }
  async ensureRun(
    organizationId: string,
    teamId: string,
    runId: string,
    manifest: MigrationRunManifestProjection,
  ): ReturnType<CloudMigrationRunGateway['ensureRun']> {
    const k = this.key(organizationId, teamId, runId);
    const existing = this.store.get(k);
    if (existing) return { ok: true, revision: existing.revision };
    this.store.set(k, { manifest, revision: 0 });
    return { ok: true, revision: 0 };
  }
  async patchRunCheckpoint(
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
  ): Promise<MigrationRunCloudWriteResult> {
    const k = this.key(organizationId, teamId, runId);
    const existing = this.store.get(k);
    if (!existing || existing.revision !== expectedRevision) {
      return { ok: false, error: 'stale-revision' };
    }
    existing.manifest = {
      ...existing.manifest,
      items: patch.items,
      status: patch.status,
      rollbackRequested: patch.rollbackRequested,
    };
    existing.revision += 1;
    return { ok: true, revision: existing.revision };
  }
}

class FakeInventoryGateway implements CloudMigrationInventoryGateway {
  constructor(public snapshot: CloudExistingSnapshot = emptyCloudSnapshot()) {}
  async readTargetSnapshot(): Promise<CloudExistingSnapshot> {
    return this.snapshot;
  }
}

class FakeWriteGateway implements MigrationWriteGateway {
  settingsCalls = 0;
  rosterCalls = 0;
  completedGameCalls = 0;
  compensateCalls: string[] = [];
  failNextCompletedGame = false;
  failCompensation = false;

  async writeSettings(): Promise<MigrationItemWriteResult> {
    this.settingsCalls += 1;
    return { ok: true, confirmedHash: 'settings-hash' };
  }
  async writeRoster(): Promise<MigrationItemWriteResult> {
    this.rosterCalls += 1;
    return { ok: true, confirmedHash: 'roster-hash' };
  }
  async writeCompletedGame(): Promise<MigrationItemWriteResult> {
    this.completedGameCalls += 1;
    if (this.failNextCompletedGame) {
      this.failNextCompletedGame = false;
      return { ok: false, error: 'netwerkfout' };
    }
    return { ok: true, confirmedHash: 'game-hash' };
  }
  async compensateCompletedGame(
    _org: string,
    _team: string,
    id: string,
  ): Promise<MigrationItemWriteResult> {
    this.compensateCalls.push(id);
    if (this.failCompensation) return { ok: false, error: 'tombstone-mislukt' };
    return { ok: true };
  }
}

function makeCoordinator(deps: {
  writeGateway: FakeWriteGateway;
  inventoryGateway: FakeInventoryGateway;
  runRepo: FakeRunRepository;
  cloudRunGateway: FakeCloudRunGateway;
}) {
  return new MigrationCoordinator({ ...deps, now: () => now });
}

describe('application/migration/MigrationCoordinator — happy path (docs/pr-7.4-plan.md §C 7.4b werk 2/3)', () => {
  it('schrijft settings/roster/completedGame in stappen en rapporteert completed', async () => {
    const { preview, local } = buildPreview();
    const writeGateway = new FakeWriteGateway();
    const coordinator = makeCoordinator({
      writeGateway,
      inventoryGateway: new FakeInventoryGateway(),
      runRepo: new FakeRunRepository(),
      cloudRunGateway: new FakeCloudRunGateway(),
    });
    const { run } = await coordinator.prepareRun(preview, 'uid-1');
    const result = await coordinator.runMigration(run, local, writer, callerContext);

    expect(result.status).toBe('completed');
    expect(result.items.every((i) => i.status === 'confirmed')).toBe(true);
    expect(writeGateway.settingsCalls).toBe(1);
    expect(writeGateway.rosterCalls).toBe(1);
    expect(writeGateway.completedGameCalls).toBe(1);
  });
});

describe('application/migration/MigrationCoordinator — hervatbaarheid (werk 2 acceptatie: retry/reload is idempotent)', () => {
  it('hervat na een mislukte stap zonder al bevestigde items opnieuw te schrijven', async () => {
    const { preview, local } = buildPreview();
    const runRepo = new FakeRunRepository();
    const cloudRunGateway = new FakeCloudRunGateway();
    const inventoryGateway = new FakeInventoryGateway();

    const writeGateway1 = new FakeWriteGateway();
    writeGateway1.failNextCompletedGame = true;
    const coordinator1 = makeCoordinator({
      writeGateway: writeGateway1,
      inventoryGateway,
      runRepo,
      cloudRunGateway,
    });
    const { run } = await coordinator1.prepareRun(preview, 'uid-1');
    const firstResult = await coordinator1.runMigration(run, local, writer, callerContext);

    expect(firstResult.status).toBe('actionNeeded');
    expect(firstResult.items.find((i) => i.kind === 'settings')?.status).toBe('confirmed');
    expect(firstResult.items.find((i) => i.kind === 'roster')?.status).toBe('confirmed');
    expect(firstResult.items.find((i) => i.kind === 'completedGame')?.status).toBe('failed');
    expect(writeGateway1.settingsCalls).toBe(1);
    expect(writeGateway1.rosterCalls).toBe(1);

    // Simuleert een reload: verse coordinator/gateway-instanties, maar
    // dezelfde lokale/cloud-checkpointopslag (runRepo/cloudRunGateway).
    const writeGateway2 = new FakeWriteGateway();
    const coordinator2 = makeCoordinator({
      writeGateway: writeGateway2,
      inventoryGateway,
      runRepo,
      cloudRunGateway,
    });
    const resumed = runRepo.read(targetCtx.organizationId, targetCtx.teamId)!;
    const secondResult = await coordinator2.runMigration(resumed, local, writer, callerContext);

    expect(secondResult.status).toBe('completed');
    // Settings/roster waren al 'confirmed' — geen tweede write.
    expect(writeGateway2.settingsCalls).toBe(0);
    expect(writeGateway2.rosterCalls).toBe(0);
    expect(writeGateway2.completedGameCalls).toBe(1);
  });

  it('een reeds voltooide run levert bij hernieuwde aanroep exact dezelfde staat op, zonder nieuwe writes', async () => {
    const { preview, local } = buildPreview();
    const writeGateway = new FakeWriteGateway();
    const coordinator = makeCoordinator({
      writeGateway,
      inventoryGateway: new FakeInventoryGateway(),
      runRepo: new FakeRunRepository(),
      cloudRunGateway: new FakeCloudRunGateway(),
    });
    const { run } = await coordinator.prepareRun(preview, 'uid-1');
    const first = await coordinator.runMigration(run, local, writer, callerContext);
    expect(first.status).toBe('completed');

    const second = await coordinator.runMigration(first, local, writer, callerContext);
    expect(second.status).toBe('completed');
    expect(writeGateway.settingsCalls).toBe(1);
    expect(writeGateway.rosterCalls).toBe(1);
    expect(writeGateway.completedGameCalls).toBe(1);
  });
});

describe('application/migration/MigrationCoordinator — nooit een stille overwrite (werk 4)', () => {
  it('detecteert een afwijkend clouditem vlak vóór bevestiging als conflict, zonder write', async () => {
    const { preview, local } = buildPreview();
    const runRepo = new FakeRunRepository();
    const cloudRunGateway = new FakeCloudRunGateway();
    const { run } = await makeCoordinator({
      writeGateway: new FakeWriteGateway(),
      inventoryGateway: new FakeInventoryGateway(),
      runRepo,
      cloudRunGateway,
    }).prepareRun(preview, 'uid-1');

    // Tussen preview en bevestiging schrijft iemand anders afwijkende roster-inhoud.
    const inventoryGateway = new FakeInventoryGateway({
      ...emptyCloudSnapshot(),
      roster: { present: true, hash: 'iemand-anders-schreef-dit' },
    });
    const writeGateway = new FakeWriteGateway();
    const coordinator = makeCoordinator({
      writeGateway,
      inventoryGateway,
      runRepo,
      cloudRunGateway,
    });
    const result = await coordinator.runMigration(run, local, writer, callerContext);

    expect(result.items.find((i) => i.kind === 'roster')?.status).toBe('conflict');
    expect(writeGateway.rosterCalls).toBe(0);
    expect(result.status).toBe('actionNeeded');
    // Settings/completedGame zijn onafhankelijke items — één conflict blokkeert de rest niet.
    expect(result.items.find((i) => i.kind === 'settings')?.status).toBe('confirmed');
    expect(result.items.find((i) => i.kind === 'completedGame')?.status).toBe('confirmed');
  });

  it('een preview met een reeds-bekend conflict schrijft dat item nooit, vanaf het begin', async () => {
    const cloud = emptyCloudSnapshot();
    cloud.roster = { present: true, hash: 'afwijkend' };
    const { preview, local } = buildPreview(cloud);
    const writeGateway = new FakeWriteGateway();
    const coordinator = makeCoordinator({
      writeGateway,
      inventoryGateway: new FakeInventoryGateway(cloud),
      runRepo: new FakeRunRepository(),
      cloudRunGateway: new FakeCloudRunGateway(),
    });
    const { run } = await coordinator.prepareRun(preview, 'uid-1');
    const result = await coordinator.runMigration(run, local, writer, callerContext);
    expect(result.items.find((i) => i.kind === 'roster')?.status).toBe('conflict');
    expect(writeGateway.rosterCalls).toBe(0);
  });
});

describe('application/migration/MigrationCoordinator — rollback/compensatie (§B)', () => {
  it('stopt verdere writes en tombstoned reeds geschreven completedGames', async () => {
    const { preview, local } = buildPreview();
    const writeGateway = new FakeWriteGateway();
    const coordinator = makeCoordinator({
      writeGateway,
      inventoryGateway: new FakeInventoryGateway(),
      runRepo: new FakeRunRepository(),
      cloudRunGateway: new FakeCloudRunGateway(),
    });
    const { run } = await coordinator.prepareRun(preview, 'uid-1');
    const completed = await coordinator.runMigration(run, local, writer, callerContext);
    expect(completed.status).toBe('completed');

    const rolledBack = await coordinator.abortAndCompensate(completed, 'uid-1');
    expect(rolledBack.rollbackRequested).toBe(true);
    expect(rolledBack.status).toBe('paused');
    expect(writeGateway.compensateCalls).toEqual([completedGame.id]);
    const gameItem = rolledBack.items.find((i) => i.kind === 'completedGame');
    expect(gameItem?.status).toBe('compensated');
    // Settings/roster blijven bewust ongecompenseerd (ontwerpbeslissing, zie coordinator-docstring).
    expect(rolledBack.items.find((i) => i.kind === 'settings')?.status).toBe('confirmed');

    // Een verdere runMigration()-aanroep mag geen writes meer doen.
    const afterRollback = await coordinator.runMigration(rolledBack, local, writer, callerContext);
    expect(afterRollback).toBe(rolledBack);
    expect(writeGateway.completedGameCalls).toBe(1);
  });

  it('meldt compensationFailed wanneer de tombstone-poging zelf mislukt, nooit een vals "teruggedraaid"', async () => {
    const { preview, local } = buildPreview();
    const writeGateway = new FakeWriteGateway();
    const coordinator = makeCoordinator({
      writeGateway,
      inventoryGateway: new FakeInventoryGateway(),
      runRepo: new FakeRunRepository(),
      cloudRunGateway: new FakeCloudRunGateway(),
    });
    const { run } = await coordinator.prepareRun(preview, 'uid-1');
    const completed = await coordinator.runMigration(run, local, writer, callerContext);
    writeGateway.failCompensation = true;
    const rolledBack = await coordinator.abortAndCompensate(completed, 'uid-1');
    expect(rolledBack.status).toBe('compensationFailed');
    expect(rolledBack.items.find((i) => i.kind === 'completedGame')?.status).toBe(
      'compensationFailed',
    );
  });
});

describe('application/migration/MigrationCoordinator — contextwissel (werk 4)', () => {
  it('een gewijzigde aanroepercontext blokkeert verdere writes zichtbaar (actionNeeded), nooit stil', async () => {
    const { preview, local } = buildPreview();
    const writeGateway = new FakeWriteGateway();
    const coordinator = makeCoordinator({
      writeGateway,
      inventoryGateway: new FakeInventoryGateway(),
      runRepo: new FakeRunRepository(),
      cloudRunGateway: new FakeCloudRunGateway(),
    });
    const { run } = await coordinator.prepareRun(preview, 'uid-1');
    const staleContext: MigrationCallerContext = { ...callerContext, role: 'scorer' };
    const result = await coordinator.runMigration(run, local, writer, staleContext);
    expect(result.status).toBe('actionNeeded');
    expect(writeGateway.settingsCalls).toBe(0);
    expect(writeGateway.rosterCalls).toBe(0);
    expect(writeGateway.completedGameCalls).toBe(0);
  });
});

describe('application/migration/MigrationCoordinator — prepareRun blokkeert een botsende run (reviewer-fix minimax PR #71, quick-win 3)', () => {
  it('blokkeert een tweede manifest voor dezelfde doelcontext zolang de eerste run nog niet is afgerond, zonder de eerste te overschrijven', async () => {
    const { preview: previewA } = buildPreview();
    const runRepo = new FakeRunRepository();
    const cloudRunGateway = new FakeCloudRunGateway();
    const coordinator = makeCoordinator({
      writeGateway: new FakeWriteGateway(),
      inventoryGateway: new FakeInventoryGateway(),
      runRepo,
      cloudRunGateway,
    });

    const { run: runA } = await coordinator.prepareRun(previewA, 'uid-1');
    expect(runA.status).not.toBe('completed'); // nog niet uitgevoerd — 'paused'

    // Andere manifest-inhoud (afwijkende teamnaam) ⇒ andere manifestHash,
    // maar dezelfde doelcontext (org-dst/team-dst).
    const settingsValueB = { ...DEFAULT_SETTINGS, teamName: 'Een Andere Naam' };
    const inventoryB = buildLocalMigrationInventory(sourceCtx.organizationId, sourceCtx.teamId, {
      settings: settingsValueB,
      roster: [sampleRosterPlayer],
      activeGame: undefined,
      completedGames: [completedGame],
    });
    const previewB = buildCloudMigrationPreview({
      now,
      source: sourceCtx,
      target: targetCtx,
      callerRole: 'coach',
      inventory: inventoryB,
      existingCloud: emptyCloudSnapshot(),
    });
    expect(previewB.manifestHash).not.toBe(previewA.manifestHash);

    const prepareB = await coordinator.prepareRun(previewB, 'uid-2');

    expect(prepareB.blockedByExistingRunId).toBe(runA.runId);
    expect(prepareB.run.runId).toBe(runA.runId);
    expect(prepareB.run.manifestHash).toBe(runA.manifestHash);

    // De opgeslagen staat van run A is niet gemuteerd/overschreven door de blokkade.
    const storedAfter = runRepo.read(targetCtx.organizationId, targetCtx.teamId);
    expect(storedAfter).toEqual(runA);
  });
});

describe('application/migration/MigrationCoordinator — ontbrekende lokale bron voor completedGame (reviewer-fix minimax PR #71, quick-win 4)', () => {
  it('meldt {ok:false} zichtbaar als actionNeeded wanneer de lokale wedstrijd inmiddels weg is, zonder te crashen', async () => {
    const { preview, local } = buildPreview();
    const writeGateway = new FakeWriteGateway();
    const coordinator = makeCoordinator({
      writeGateway,
      inventoryGateway: new FakeInventoryGateway(),
      runRepo: new FakeRunRepository(),
      cloudRunGateway: new FakeCloudRunGateway(),
    });
    const { run } = await coordinator.prepareRun(preview, 'uid-1');

    // Simuleert een concurrente backup-import die de lokale wedstrijd verwijderde
    // tussen run-creatie en run-uitvoering.
    const localWithoutGame: MigrationLocalSource = {
      ...local,
      completedGames: new Map(),
    };

    const result = await coordinator.runMigration(run, localWithoutGame, writer, callerContext);

    const gameItem = result.items.find((i) => i.kind === 'completedGame');
    expect(gameItem?.status).toBe('failed');
    expect(gameItem?.lastError).toBe(
      `lokale wedstrijd ${completedGame.id} ontbreekt voor deze run`,
    );
    expect(result.status).toBe('actionNeeded');
    expect(writeGateway.completedGameCalls).toBe(0);
  });
});

describe('application/migration/MigrationCoordinator — lokale bron blijft onaangeraakt (§B/werk 5)', () => {
  it('mutateert het meegegeven MigrationLocalSource-object nooit', async () => {
    const { preview, local } = buildPreview();
    const frozenSettings = local.settings ? { ...local.settings } : null;
    const frozenRoster = local.roster ? [...local.roster] : null;
    const coordinator = makeCoordinator({
      writeGateway: new FakeWriteGateway(),
      inventoryGateway: new FakeInventoryGateway(),
      runRepo: new FakeRunRepository(),
      cloudRunGateway: new FakeCloudRunGateway(),
    });
    const { run } = await coordinator.prepareRun(preview, 'uid-1');
    await coordinator.runMigration(run, local, writer, callerContext);
    expect(local.settings).toEqual(frozenSettings);
    expect(local.roster).toEqual(frozenRoster);
    expect(local.completedGames.get(completedGame.id)).toEqual(completedGame);
  });
});
