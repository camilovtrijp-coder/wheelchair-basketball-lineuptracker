import { describe, expect, it } from 'vitest';
import { buildCloudMigrationPreview } from '../../src/domain/migration/preview';
import { buildLocalMigrationInventory } from '../../src/domain/migration/inventory';
import {
  settingsPayloadHash,
  rosterPayloadHash,
  completedGamePayloadHash,
} from '../../src/domain/migration/payload';
import { DEFAULT_SETTINGS } from '../../src/domain/settings/types';
import type {
  CloudExistingSnapshot,
  LocalMigrationInventory,
  MigrationContextRef,
} from '../../src/domain/migration/types';
import type { ActiveGame, CompletedGame } from '../../src/domain/game/types';
import type { OrganizationRole } from '../../src/domain/organizations/types';

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

const emptyRawSource = {
  settings: undefined,
  roster: undefined,
  activeGame: undefined,
  completedGames: undefined,
};

function emptyInventory(): LocalMigrationInventory {
  return buildLocalMigrationInventory(sourceCtx.organizationId, sourceCtx.teamId, emptyRawSource);
}

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

function baseInput(
  role: OrganizationRole,
  inventory: LocalMigrationInventory,
  cloud: CloudExistingSnapshot,
) {
  return {
    now,
    source: sourceCtx,
    target: targetCtx,
    callerRole: role,
    inventory,
    existingCloud: cloud,
  };
}

describe('domain/migration/preview — buildCloudMigrationPreview (docs/pr-7.4-plan.md §C 7.4a)', () => {
  it('nul writes vóór bevestiging: een lege, toegestane preview heeft requiredWrites 0 en geen items', () => {
    const preview = buildCloudMigrationPreview(
      baseInput('coach', emptyInventory(), emptyCloudSnapshot()),
    );
    expect(preview.allowed).toBe(true);
    expect(preview.requiredWrites).toBe(0);
    expect(preview.items).toHaveLength(0);
  });

  it('scorer krijgt geen bulkactie (acceptatiecriterium)', () => {
    const preview = buildCloudMigrationPreview(
      baseInput('scorer', emptyInventory(), emptyCloudSnapshot()),
    );
    expect(preview.allowed).toBe(false);
    expect(preview.denialReason).toBe('roleDenied');
    expect(preview.items).toHaveLength(0);
    expect(preview.requiredWrites).toBe(0);
  });

  it('viewer krijgt geen bulkactie (acceptatiecriterium)', () => {
    const preview = buildCloudMigrationPreview(
      baseInput('viewer', emptyInventory(), emptyCloudSnapshot()),
    );
    expect(preview.allowed).toBe(false);
    expect(preview.denialReason).toBe('roleDenied');
  });

  it('organizationOwner/organizationAdmin/coach zijn wel toegestaan', () => {
    for (const role of ['organizationOwner', 'organizationAdmin', 'coach'] as const) {
      const preview = buildCloudMigrationPreview(
        baseInput(role, emptyInventory(), emptyCloudSnapshot()),
      );
      expect(preview.allowed).toBe(true);
    }
  });

  it('corrupte bron stopt de HELE preview, vóór er items gebouwd worden', () => {
    const inventory = buildLocalMigrationInventory(sourceCtx.organizationId, sourceCtx.teamId, {
      ...emptyRawSource,
      settings: { ...DEFAULT_SETTINGS, quarterCount: 'vier' },
      roster: [{ id: 1, nr: '4', naam: 'X', kl: '3.0', vrouw: false, jeugd: false }],
    });
    const preview = buildCloudMigrationPreview(baseInput('coach', inventory, emptyCloudSnapshot()));
    expect(preview.allowed).toBe(false);
    expect(preview.denialReason).toBe('corruptSource');
    expect(preview.items).toHaveLength(0);
    expect(preview.warnings.some((w) => w.code === 'settingsCorrupt')).toBe(true);
  });

  it('determinisme: dezelfde bron/doelcombinatie levert exact hetzelfde manifest op', () => {
    const inventory = buildLocalMigrationInventory(sourceCtx.organizationId, sourceCtx.teamId, {
      ...emptyRawSource,
      roster: [{ id: 1, nr: '4', naam: 'X', kl: '3.0', vrouw: false, jeugd: false }],
      completedGames: [completedGame],
    });
    const input = baseInput('coach', inventory, emptyCloudSnapshot());
    const p1 = buildCloudMigrationPreview(input);
    const p2 = buildCloudMigrationPreview({ ...input, now: '2099-01-01T00:00:00.000Z' });
    // builtAt mag verschillen (ander moment gebouwd), manifestHash NIET —
    // dat dekt bewust alles behalve `builtAt`.
    expect(p1.builtAt).not.toBe(p2.builtAt);
    expect(p1.manifestHash).toBe(p2.manifestHash);
    expect(p1.items).toEqual(p2.items);
  });

  it('bestaand, identiek clouditem: alreadyPresentIdentical, geen write nodig', () => {
    const inventory = buildLocalMigrationInventory(sourceCtx.organizationId, sourceCtx.teamId, {
      ...emptyRawSource,
      roster: [{ id: 1, nr: '4', naam: 'X', kl: '3.0', vrouw: false, jeugd: false }],
    });
    const hash = rosterPayloadHash(inventory.roster.value!);
    const cloud = emptyCloudSnapshot();
    cloud.roster = { present: true, hash };
    const preview = buildCloudMigrationPreview(baseInput('coach', inventory, cloud));
    const rosterItem = preview.items.find((i) => i.kind === 'roster')!;
    expect(rosterItem.action).toBe('alreadyPresentIdentical');
    expect(preview.requiredWrites).toBe(0);
  });

  it('bestaand clouditem met AFWIJKENDE inhoud: conflict, nooit stilzwijgend overwriten', () => {
    const inventory = buildLocalMigrationInventory(sourceCtx.organizationId, sourceCtx.teamId, {
      ...emptyRawSource,
      settings: { ...DEFAULT_SETTINGS, teamName: 'Lokale naam' },
    });
    const cloud = emptyCloudSnapshot();
    cloud.settings = {
      present: true,
      hash: settingsPayloadHash({ ...DEFAULT_SETTINGS, teamName: 'Andere naam' }),
    };
    const preview = buildCloudMigrationPreview(baseInput('coach', inventory, cloud));
    const settingsItem = preview.items.find((i) => i.kind === 'settings')!;
    expect(settingsItem.action).toBe('conflict');
    expect(preview.counts.conflict).toBe(1);
    expect(preview.requiredWrites).toBe(0);
    expect(preview.warnings.some((w) => w.code === 'itemConflict')).toBe(true);
  });

  it('dubbele completedGame-IDs in de bron worden als corrupt geweigerd (nooit als twee items gepland)', () => {
    const inventory = buildLocalMigrationInventory(sourceCtx.organizationId, sourceCtx.teamId, {
      ...emptyRawSource,
      completedGames: [completedGame, completedGame],
    });
    const preview = buildCloudMigrationPreview(baseInput('coach', inventory, emptyCloudSnapshot()));
    expect(preview.allowed).toBe(false);
    expect(preview.denialReason).toBe('corruptSource');
  });

  it('gelijknamige teams in meerdere organisaties krijgen een zichtbare waarschuwing', () => {
    const preview = buildCloudMigrationPreview(
      baseInput('coach', emptyInventory(), emptyCloudSnapshot()),
    );
    // sourceCtx.teamName === targetCtx.teamName === 'De Adelaars', andere organizationId.
    expect(preview.warnings.some((w) => w.code === 'duplicateTeamNameAcrossOrganizations')).toBe(
      true,
    );
    // Maar de identiteit blijft ondubbelzinnig: source/target org-ID's verschillen.
    expect(preview.source.organizationId).not.toBe(preview.target.organizationId);
  });

  it('een actieve wedstrijd in tracking wordt NOOIT bulk gemigreerd (§B)', () => {
    const trackingGame: ActiveGame = {
      id: 'g-track',
      organizationId: sourceCtx.organizationId,
      teamId: sourceCtx.teamId,
      phase: 'tracking',
      players: [samplePlayer],
      opponent: 'Live tegenstander',
      competition: '',
      clockDown: true,
      limitStr: '',
      onCourt: [],
      curQuarter: 1,
      beginSec: 500,
      endSec: 600,
      pendingSwapLineup: null,
      actions: [],
      createdAt: now,
      startedAt: now,
    };
    const inventory = buildLocalMigrationInventory(sourceCtx.organizationId, sourceCtx.teamId, {
      ...emptyRawSource,
      activeGame: trackingGame,
    });
    const preview = buildCloudMigrationPreview(baseInput('coach', inventory, emptyCloudSnapshot()));
    expect(preview.allowed).toBe(true);
    expect(preview.trackingGame.present).toBe(true);
    expect(preview.trackingGame.gameId).toBe('g-track');
    const item = preview.items.find((i) => i.kind === 'activeGame')!;
    expect(item.action).toBe('excludedTrackingGame');
    // Nooit meegeteld in requiredWrites — die vereist eerst het 7.3-writerprotocol.
    expect(preview.requiredWrites).toBe(0);
    expect(preview.warnings.some((w) => w.code === 'activeGameTracking')).toBe(true);
  });

  it('een setup-fase actieve wedstrijd staat WEL in de itemlijst maar telt niet automatisch mee (aparte previewbeslissing)', () => {
    const setupGame: ActiveGame = {
      id: 'g-setup',
      organizationId: sourceCtx.organizationId,
      teamId: sourceCtx.teamId,
      phase: 'setup',
      players: [samplePlayer],
      opponent: 'Nog niet gestart',
      competition: '',
      clockDown: true,
      limitStr: '',
      onCourt: [],
      curQuarter: 1,
      beginSec: 600,
      endSec: 600,
      pendingSwapLineup: null,
      actions: [],
      createdAt: now,
      startedAt: null,
    };
    const inventory = buildLocalMigrationInventory(sourceCtx.organizationId, sourceCtx.teamId, {
      ...emptyRawSource,
      activeGame: setupGame,
    });
    const preview = buildCloudMigrationPreview(baseInput('coach', inventory, emptyCloudSnapshot()));
    expect(preview.trackingGame.present).toBe(false);
    const item = preview.items.find((i) => i.kind === 'activeGame')!;
    expect(item.action).toBe('needsSeparateDecision');
    expect(preview.requiredWrites).toBe(0);
    expect(preview.warnings.some((w) => w.code === 'activeGameSetupNeedsDecision')).toBe(true);
  });

  it('een nieuw item zonder cloud-tegenhanger telt mee in requiredWrites', () => {
    const inventory = buildLocalMigrationInventory(sourceCtx.organizationId, sourceCtx.teamId, {
      ...emptyRawSource,
      completedGames: [completedGame],
    });
    const preview = buildCloudMigrationPreview(baseInput('coach', inventory, emptyCloudSnapshot()));
    const item = preview.items.find((i) => i.kind === 'completedGame')!;
    expect(item.action).toBe('create');
    expect(item.payloadHash).toBe(completedGamePayloadHash(completedGame));
    expect(preview.requiredWrites).toBe(1);
    expect(preview.counts.create).toBe(1);
  });

  it('bron en doel blijven ondubbelzinnig ook bij identieke teamnaam (acceptatiecriterium)', () => {
    const preview = buildCloudMigrationPreview(
      baseInput('coach', emptyInventory(), emptyCloudSnapshot()),
    );
    expect(preview.source.teamId).not.toBe(preview.target.teamId);
    expect(preview.source.organizationId).not.toBe(preview.target.organizationId);
  });

  it('contextFingerprint bindt de preview aan (target org, target team, rol)', () => {
    const preview = buildCloudMigrationPreview(
      baseInput('coach', emptyInventory(), emptyCloudSnapshot()),
    );
    const other = buildCloudMigrationPreview(
      baseInput('organizationOwner', emptyInventory(), emptyCloudSnapshot()),
    );
    expect(preview.contextFingerprint).not.toBe(other.contextFingerprint);
  });
});
