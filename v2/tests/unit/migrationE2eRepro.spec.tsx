// @vitest-environment jsdom
// Permanente component-niveau regressietest (docs/pr-7.4-plan.md §C 7.4c):
// draait de EXACTE `seedLocalMigrationSource()`-fixture en rol/flow van
// `tests/e2e-auth/migration-flow.spec.ts` werk 4.3/4.4/4.5 tegen de ECHTE
// domeinfuncties (niet gemockt), buiten een browser om. Ontstaan tijdens het
// onderzoeken van twee echte CI-only bugs (`isUntouchedAutoSetupGame()` in
// inventory.ts, de `manifestHash`-stabiliteit in preview.ts — zie 7.4c's
// "Geïmplementeerd"-sectie) die de lokale `vitest`-suite niet kon vangen
// omdat Playwright/Chromium in deze sandbox niet draait; blijft bestaan als
// snelle, browserloze bevestiging dat die twee root causes niet terugkeren.
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/preact';
import { MigrationPanel } from '../../src/ui/migration/MigrationPanel';
import { MigrationCoordinator } from '../../src/application/migration/MigrationCoordinator';
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
import type { CloudExistingSnapshot } from '../../src/domain/migration/types';
import type { KeyValueStorage } from '../../src/i18n/persistence';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type Settings,
} from '../../src/domain/settings/types';
import { ROSTER_STORAGE_KEY } from '../../src/domain/roster/types';
import { collectLocalMigrationInventory } from '../../src/infrastructure/migration/collectLocalMigrationInventory';
import { buildCloudMigrationPreview } from '../../src/domain/migration/preview';

afterEach(() => cleanup());

const ORG_ID = 'org-e2e-repro';
const TEAM_ID = 'team-e2e-repro';

// EXACTE kopie van migration-flow.spec.ts's seedLocalMigrationSource() —
// zelfde sleutels, zelfde Settings-object, zelfde roster-fixture.
function fakeStorage(seed: Record<string, string> = {}): KeyValueStorage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function e2eSettings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    teamName: 'Migratie-Team',
    quarterCount: 4,
    periodLabel: 'Kwart',
    useClassLimit: false,
    primaryColor: '#123456',
    accentColor: '#654321',
  };
}

function e2eRoster() {
  return [{ id: 1, nr: '4', naam: 'Migratie Speler Een', kl: '3.0', vrouw: false, jeugd: false }];
}

function e2eStorage(): KeyValueStorage {
  return fakeStorage({
    [SETTINGS_STORAGE_KEY]: JSON.stringify(e2eSettings()),
    [ROSTER_STORAGE_KEY]: JSON.stringify(e2eRoster()),
  });
}

function emptySnapshot(): CloudExistingSnapshot {
  return {
    settings: { present: false, hash: null },
    roster: { present: false, hash: null },
    completedGames: new Map(),
    activeGame: { present: false, hash: null, phase: null },
  };
}

class FakeInventoryGateway implements CloudMigrationInventoryGateway {
  constructor(private snapshot: CloudExistingSnapshot = emptySnapshot()) {}
  async readTargetSnapshot(): Promise<CloudExistingSnapshot> {
    return this.snapshot;
  }
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
    if (!existing || existing.revision !== expectedRevision) return { ok: false, error: 'stale' };
    existing.manifest = { ...existing.manifest, ...patch };
    existing.revision += 1;
    return { ok: true, revision: existing.revision };
  }
}

class FakeWriteGateway implements MigrationWriteGateway {
  async writeSettings(): Promise<MigrationItemWriteResult> {
    return { ok: true, confirmedHash: 'settings-hash' };
  }
  async writeRoster(): Promise<MigrationItemWriteResult> {
    return { ok: true, confirmedHash: 'roster-hash' };
  }
  async writeCompletedGame(): Promise<MigrationItemWriteResult> {
    return { ok: true, confirmedHash: 'game-hash' };
  }
  async compensateCompletedGame(): Promise<MigrationItemWriteResult> {
    return { ok: true };
  }
}

function makeCoordinator(inventoryGateway: CloudMigrationInventoryGateway) {
  return new MigrationCoordinator({
    writeGateway: new FakeWriteGateway(),
    inventoryGateway,
    runRepo: new FakeRunRepository(),
    cloudRunGateway: new FakeCloudRunGateway(),
    now: () => '2026-08-23T10:00:00.000Z',
  });
}

const writer = { authorUid: 'uid-e2e-repro', deviceId: 'device-e2e-repro' };

describe('permanente regressietest: migration-flow.spec.ts werk 4.3/4.4/4.5 op de echte domeinfuncties (docs/pr-7.4-plan.md §C 7.4c)', () => {
  it('collectLocalMigrationInventory + buildCloudMigrationPreview op de exacte e2e-fixture staat een migratie toe', () => {
    const storage = e2eStorage();
    const inventory = collectLocalMigrationInventory(storage, ORG_ID, TEAM_ID);
    const ref = {
      organizationId: ORG_ID,
      teamId: TEAM_ID,
      organizationName: 'Migratie-Org',
      teamName: 'Migratie-Team',
    };
    const preview = buildCloudMigrationPreview({
      now: '2026-08-23T10:00:00.000Z',
      source: ref,
      target: ref,
      callerRole: 'organizationOwner',
      inventory,
      existingCloud: emptySnapshot(),
    });
    expect(preview.allowed).toBe(true);
  });

  it('volledige MigrationPanel-flow met de e2e-fixture (organizationOwner) bereikt de preview-stap', async () => {
    const storage = e2eStorage();
    const inventoryGateway = new FakeInventoryGateway();
    const coordinator = makeCoordinator(inventoryGateway);
    render(
      <MigrationPanel
        lang="nl"
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Migratie-Org"
        teamName="Migratie-Team"
        callerRole="organizationOwner"
        storage={storage}
        inventoryGateway={inventoryGateway}
        coordinator={coordinator}
        writer={writer}
      />,
    );

    fireEvent.click(screen.getByTestId('migration-start-btn'));

    await waitFor(
      () => {
        const denied = screen.queryByTestId('migration-denied');
        const error = screen.queryByTestId('migration-error');
        const preview = screen.queryByTestId('migration-preview');
        if (denied) {
          throw new Error(`DENIED shown instead of preview: ${denied.textContent}`);
        }
        if (error) {
          throw new Error(`ERROR shown instead of preview: ${error.textContent}`);
        }
        expect(preview).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });
});
