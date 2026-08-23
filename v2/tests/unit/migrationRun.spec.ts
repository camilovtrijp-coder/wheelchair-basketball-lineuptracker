import { describe, expect, it } from 'vitest';
import { buildCloudMigrationPreview } from '../../src/domain/migration/preview';
import { buildLocalMigrationInventory } from '../../src/domain/migration/inventory';
import {
  createMigrationRun,
  deriveSettledMigrationRunStatus,
  isMigrationRunItemRetryable,
  isMigrationRunItemWritten,
  type MigrationRunItemCheckpoint,
} from '../../src/domain/migration/run';
import { DEFAULT_SETTINGS } from '../../src/domain/settings/types';
import type { CloudExistingSnapshot, MigrationContextRef } from '../../src/domain/migration/types';
import type { CompletedGame } from '../../src/domain/game/types';

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

function emptyCloudSnapshot(): CloudExistingSnapshot {
  return {
    settings: { present: false, hash: null },
    roster: { present: false, hash: null },
    completedGames: new Map(),
    activeGame: { present: false, hash: null, phase: null },
  };
}

const sampleRosterPlayer = {
  id: 1,
  nr: '4',
  naam: 'X',
  kl: '3.0',
  vrouw: false,
  jeugd: false,
};

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

function previewWithItems(existingCloud: CloudExistingSnapshot = emptyCloudSnapshot()) {
  const inventory = buildLocalMigrationInventory(sourceCtx.organizationId, sourceCtx.teamId, {
    settings: { ...DEFAULT_SETTINGS, teamName: 'De Adelaars' },
    roster: [sampleRosterPlayer],
    activeGame: undefined,
    completedGames: [completedGame],
  });
  return buildCloudMigrationPreview({
    now,
    source: sourceCtx,
    target: targetCtx,
    callerRole: 'coach',
    inventory,
    existingCloud,
  });
}

describe('domain/migration/run — createMigrationRun (docs/pr-7.4-plan.md §C 7.4b werk 1)', () => {
  it('neemt create/alreadyPresentIdentical/conflict-items over, met de juiste initiële status', () => {
    const cloud = emptyCloudSnapshot();
    cloud.roster = { present: true, hash: 'afwijkende-hash' };
    const preview = previewWithItems(cloud);
    const run = createMigrationRun(preview, preview.manifestHash, 'uid-1', now);

    expect(run.runId).toBe(preview.manifestHash);
    expect(run.rollbackRequested).toBe(false);
    expect(run.items).toHaveLength(3); // settings, roster (conflict), completedGame

    const settingsItem = run.items.find((i) => i.kind === 'settings');
    expect(settingsItem?.status).toBe('pending');
    const rosterItem = run.items.find((i) => i.kind === 'roster');
    expect(rosterItem?.status).toBe('conflict');
    const gameItem = run.items.find((i) => i.kind === 'completedGame');
    expect(gameItem?.status).toBe('pending');
  });

  it('een reeds-identiek clouditem start meteen als confirmed, zonder write', () => {
    const inventory = buildLocalMigrationInventory(sourceCtx.organizationId, sourceCtx.teamId, {
      settings: { ...DEFAULT_SETTINGS, teamName: 'De Adelaars' },
      roster: undefined,
      activeGame: undefined,
      completedGames: undefined,
    });
    const settingsHash = buildCloudMigrationPreview({
      now,
      source: sourceCtx,
      target: targetCtx,
      callerRole: 'coach',
      inventory,
      existingCloud: emptyCloudSnapshot(),
    }).items.find((i) => i.kind === 'settings')!.payloadHash;

    const cloud = emptyCloudSnapshot();
    cloud.settings = { present: true, hash: settingsHash };
    const preview = buildCloudMigrationPreview({
      now,
      source: sourceCtx,
      target: targetCtx,
      callerRole: 'coach',
      inventory,
      existingCloud: cloud,
    });
    const run = createMigrationRun(preview, preview.manifestHash, 'uid-1', now);
    expect(run.items[0]?.status).toBe('confirmed');
  });

  it('een geweigerde preview (roleDenied) levert een run zonder items op', () => {
    const inventory = buildLocalMigrationInventory(sourceCtx.organizationId, sourceCtx.teamId, {
      settings: undefined,
      roster: undefined,
      activeGame: undefined,
      completedGames: undefined,
    });
    const preview = buildCloudMigrationPreview({
      now,
      source: sourceCtx,
      target: targetCtx,
      callerRole: 'viewer',
      inventory,
      existingCloud: emptyCloudSnapshot(),
    });
    const run = createMigrationRun(preview, preview.manifestHash, 'uid-1', now);
    expect(run.items).toHaveLength(0);
    expect(run.status).toBe('completed'); // nul items = triviaal "elk item confirmed"
  });

  it('dezelfde preview levert altijd dezelfde runId op (§B: retry maakt geen duplicaat)', () => {
    const preview1 = previewWithItems();
    const preview2 = previewWithItems();
    expect(preview1.manifestHash).toBe(preview2.manifestHash);
    const run1 = createMigrationRun(preview1, preview1.manifestHash, 'uid-1', now);
    const run2 = createMigrationRun(
      preview2,
      preview2.manifestHash,
      'uid-2',
      '2026-08-23T11:00:00.000Z',
    );
    expect(run1.runId).toBe(run2.runId);
  });
});

function itemOf(
  kind: MigrationRunItemCheckpoint['kind'],
  status: MigrationRunItemCheckpoint['status'],
) {
  return { kind, sourceId: 's', targetId: 't', label: 'l', payloadHash: 'h', status };
}

describe('domain/migration/run — deriveSettledMigrationRunStatus (werk 5)', () => {
  it('paused zolang er nog pending items zijn, geen conflict/failed', () => {
    const status = deriveSettledMigrationRunStatus({
      rollbackRequested: false,
      items: [itemOf('settings', 'confirmed'), itemOf('roster', 'pending')],
    });
    expect(status).toBe('paused');
  });

  it('actionNeeded zodra één item conflict of failed is', () => {
    expect(
      deriveSettledMigrationRunStatus({
        rollbackRequested: false,
        items: [itemOf('settings', 'confirmed'), itemOf('roster', 'conflict')],
      }),
    ).toBe('actionNeeded');
    expect(
      deriveSettledMigrationRunStatus({
        rollbackRequested: false,
        items: [itemOf('settings', 'failed')],
      }),
    ).toBe('actionNeeded');
  });

  it('completed zodra alle items confirmed zijn', () => {
    expect(
      deriveSettledMigrationRunStatus({
        rollbackRequested: false,
        items: [itemOf('settings', 'confirmed'), itemOf('roster', 'confirmed')],
      }),
    ).toBe('completed');
  });

  it('rollbackRequested is nooit completed, zelfs niet als alle items confirmed/compensated zijn', () => {
    expect(
      deriveSettledMigrationRunStatus({
        rollbackRequested: true,
        items: [itemOf('completedGame', 'compensated'), itemOf('settings', 'confirmed')],
      }),
    ).toBe('paused');
  });

  it('compensationFailed domineert elke andere itemstatus bij rollbackRequested', () => {
    expect(
      deriveSettledMigrationRunStatus({
        rollbackRequested: true,
        items: [itemOf('completedGame', 'compensationFailed'), itemOf('settings', 'confirmed')],
      }),
    ).toBe('compensationFailed');
  });
});

describe('domain/migration/run — item-predikaten', () => {
  it('isMigrationRunItemRetryable: pending/failed wel, de rest niet', () => {
    expect(isMigrationRunItemRetryable(itemOf('settings', 'pending'))).toBe(true);
    expect(isMigrationRunItemRetryable(itemOf('settings', 'failed'))).toBe(true);
    expect(isMigrationRunItemRetryable(itemOf('settings', 'confirmed'))).toBe(false);
    expect(isMigrationRunItemRetryable(itemOf('settings', 'conflict'))).toBe(false);
    expect(isMigrationRunItemRetryable(itemOf('settings', 'compensated'))).toBe(false);
  });

  it('isMigrationRunItemWritten: alleen confirmed/compensated', () => {
    expect(isMigrationRunItemWritten(itemOf('settings', 'confirmed'))).toBe(true);
    expect(isMigrationRunItemWritten(itemOf('settings', 'compensated'))).toBe(true);
    expect(isMigrationRunItemWritten(itemOf('settings', 'pending'))).toBe(false);
    expect(isMigrationRunItemWritten(itemOf('settings', 'conflict'))).toBe(false);
  });
});
