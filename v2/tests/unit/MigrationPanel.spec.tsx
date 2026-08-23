// @vitest-environment jsdom
// PR 7.4c (docs/pr-7.4-plan.md §C 7.4c): UI-wiringtests bovenop 7.4a/7.4b's
// al-geteste engine (`migrationCoordinator.spec.ts`/`migrationRun.spec.ts`/
// `migrationPreview.spec.ts`) — dit bestand bewijst dat de UI de juiste
// poorten aanroept en de juiste stappen toont, niet dat de coordinator zelf
// correct is (dat blijft exclusief 7.4b-scope).
import { describe, it, expect, vi, afterEach } from 'vitest';
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
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '../../src/domain/settings/types';
import { ROSTER_STORAGE_KEY } from '../../src/domain/roster/types';

afterEach(() => cleanup());

const ORG_ID = 'org-1';
const TEAM_ID = 'team-1';

function fakeStorage(seed: Record<string, string> = {}): KeyValueStorage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function seededStorage(): KeyValueStorage {
  return fakeStorage({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({ ...DEFAULT_SETTINGS, teamName: 'De Adelaars' }),
    [ROSTER_STORAGE_KEY]: JSON.stringify([]),
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

const writer = { authorUid: 'uid-1', deviceId: 'device-1' };

describe('ui/migration/MigrationPanel — rolgrens (docs/pr-7.4-plan.md §C 7.4c werk 2, §B)', () => {
  it('rendert helemaal niets voor een scorer (geen bulkactie, ook geen disabled knop)', () => {
    const storage = seededStorage();
    const inventoryGateway = new FakeInventoryGateway();
    const { container } = render(
      <MigrationPanel
        lang="nl"
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Org"
        teamName="De Adelaars"
        callerRole="scorer"
        storage={storage}
        inventoryGateway={inventoryGateway}
        coordinator={makeCoordinator(inventoryGateway)}
        writer={writer}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('rendert helemaal niets voor een viewer', () => {
    const storage = seededStorage();
    const inventoryGateway = new FakeInventoryGateway();
    const { container } = render(
      <MigrationPanel
        lang="nl"
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Org"
        teamName="De Adelaars"
        callerRole="viewer"
        storage={storage}
        inventoryGateway={inventoryGateway}
        coordinator={makeCoordinator(inventoryGateway)}
        writer={writer}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('ui/migration/MigrationPanel — happy path (werk 1: preview → herstelback-up → bevestiging → voortgang → resultaat)', () => {
  it('doorloopt de volledige stroom tot een completed-resultaat', async () => {
    const storage = seededStorage();
    const inventoryGateway = new FakeInventoryGateway();
    const coordinator = makeCoordinator(inventoryGateway);
    render(
      <MigrationPanel
        lang="nl"
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Org"
        teamName="De Adelaars"
        callerRole="coach"
        storage={storage}
        inventoryGateway={inventoryGateway}
        coordinator={coordinator}
        writer={writer}
      />,
    );

    fireEvent.click(screen.getByTestId('migration-start-btn'));
    await waitFor(() => expect(screen.getByTestId('migration-preview')).toBeTruthy());

    fireEvent.click(screen.getByTestId('migration-preview-next-btn'));
    expect(screen.getByTestId('migration-backup')).toBeTruthy();
    // Downloaden vereist vóór doorgaan (werk 1: verplichte herstelback-up-stap).
    expect((screen.getByTestId('migration-backup-next-btn') as HTMLButtonElement).disabled).toBe(
      true,
    );

    // downloadBackupFile() gebruikt DOM-anchor-click/Blob — jsdom ondersteunt
    // dat prima; alleen createObjectURL ontbreekt soms in jsdom, dus stub 'm.
    if (!('createObjectURL' in URL)) {
      // @ts-expect-error jsdom-polyfill voor deze testomgeving
      URL.createObjectURL = () => 'blob:fake';
    }
    if (!('revokeObjectURL' in URL)) {
      // @ts-expect-error jsdom-polyfill voor deze testomgeving
      URL.revokeObjectURL = () => undefined;
    }
    fireEvent.click(screen.getByTestId('migration-backup-download-btn'));
    await waitFor(() => expect(screen.getByTestId('migration-backup-done')).toBeTruthy());
    expect((screen.getByTestId('migration-backup-next-btn') as HTMLButtonElement).disabled).toBe(
      false,
    );

    fireEvent.click(screen.getByTestId('migration-backup-next-btn'));
    expect(screen.getByTestId('migration-confirm')).toBeTruthy();

    fireEvent.click(screen.getByTestId('migration-confirm-btn'));
    await waitFor(() => expect(screen.getByTestId('migration-result')).toBeTruthy());
    expect(screen.getByTestId('migration-result').textContent).toContain('voltooid');
    // Geen retry/export-knop bij een geslaagde run.
    expect(screen.queryByTestId('migration-retry-btn')).toBeNull();
  });
});

describe('ui/migration/MigrationPanel — conflict/actionNeeded (werk 1: retry/export)', () => {
  it('toont retry/export bij een settings-conflict en blijft idempotent bij een dubbele retry', async () => {
    const storage = seededStorage();
    const conflictSnapshot: CloudExistingSnapshot = {
      ...emptySnapshot(),
      settings: { present: true, hash: 'een-andere-hash-dan-lokaal' },
    };
    const inventoryGateway = new FakeInventoryGateway(conflictSnapshot);
    const writeGateway = new FakeWriteGateway();
    const settingsSpy = vi.spyOn(writeGateway, 'writeSettings');
    const coordinatorWithSpy = new MigrationCoordinator({
      writeGateway,
      inventoryGateway,
      runRepo: new FakeRunRepository(),
      cloudRunGateway: new FakeCloudRunGateway(),
      now: () => '2026-08-23T10:00:00.000Z',
    });

    render(
      <MigrationPanel
        lang="nl"
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Org"
        teamName="De Adelaars"
        callerRole="coach"
        storage={storage}
        inventoryGateway={inventoryGateway}
        coordinator={coordinatorWithSpy}
        writer={writer}
      />,
    );

    fireEvent.click(screen.getByTestId('migration-start-btn'));
    await waitFor(() => expect(screen.getByTestId('migration-preview')).toBeTruthy());
    fireEvent.click(screen.getByTestId('migration-preview-next-btn'));
    if (!('createObjectURL' in URL)) {
      // @ts-expect-error jsdom-polyfill
      URL.createObjectURL = () => 'blob:fake';
      // @ts-expect-error jsdom-polyfill
      URL.revokeObjectURL = () => undefined;
    }
    fireEvent.click(screen.getByTestId('migration-backup-download-btn'));
    await waitFor(() =>
      expect((screen.getByTestId('migration-backup-next-btn') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByTestId('migration-backup-next-btn'));
    fireEvent.click(screen.getByTestId('migration-confirm-btn'));

    await waitFor(() => expect(screen.getByTestId('migration-result')).toBeTruthy());
    expect(screen.getByTestId('migration-result').textContent).toContain('Actie nodig');
    expect(screen.getByTestId('migration-retry-btn')).toBeTruthy();
    expect(screen.getByTestId('migration-export-btn')).toBeTruthy();
    // Een conflict is nooit een write-poging (§B "nooit een overwrite").
    expect(settingsSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('migration-retry-btn'));
    await waitFor(() => expect(screen.getByTestId('migration-result')).toBeTruthy());
    // Nog steeds hetzelfde, aanhoudende conflict — nooit alsnog een write.
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('migration-result').textContent).toContain('Actie nodig');
  });
});

describe('ui/migration/MigrationPanel — corrupte bron (werk 1)', () => {
  it('toont een weigering zonder itemlijst bij corrupte lokale settings', async () => {
    const storage = fakeStorage({
      [SETTINGS_STORAGE_KEY]: '{not-json',
      [ROSTER_STORAGE_KEY]: JSON.stringify([]),
    });
    // Corrupte JSON wordt door collectLocalMigrationInventory als 'empty'
    // behandeld (leesfout != inhoudelijk oordeel) — gebruik in plaats
    // daarvan een structureel ongeldig settings-object (wél geldige JSON).
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ teamName: 123 }));
    const inventoryGateway = new FakeInventoryGateway();
    const coordinator = makeCoordinator(inventoryGateway);
    render(
      <MigrationPanel
        lang="nl"
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Org"
        teamName="De Adelaars"
        callerRole="organizationOwner"
        storage={storage}
        inventoryGateway={inventoryGateway}
        coordinator={coordinator}
        writer={writer}
      />,
    );
    fireEvent.click(screen.getByTestId('migration-start-btn'));
    await waitFor(() => expect(screen.getByTestId('migration-denied')).toBeTruthy());
    expect(screen.queryByTestId('migration-preview')).toBeNull();
  });
});
