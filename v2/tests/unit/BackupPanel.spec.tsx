// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { BackupPanel } from '../../src/ui/backup/BackupPanel';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import type { Roster } from '../../src/domain/roster/types';
import type { CompletedGame } from '../../src/domain/game/types';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import type { GameRepository } from '../../src/application/game/GameRepository';
import type { CompletedGameRepository } from '../../src/application/game/CompletedGameRepository';
import { BACKUP_TYPE, CURRENT_BACKUP_VERSION } from '../../src/domain/backup/types';

afterEach(() => cleanup());

const SYNCED = { status: 'gesynchroniseerd' as const, fromCache: false, hasPendingWrites: false };

function fakeSettingsRepo(): AsyncSettingsRepository {
  let current: Settings & Record<string, unknown> = { ...DEFAULT_SETTINGS, teamName: 'Team A' };
  return {
    read: async () => current,
    write: async (s) => {
      current = s;
      return { ok: true, syncState: SYNCED, settled: Promise.resolve({ ok: true }) };
    },
    reset: async () => {
      current = { ...DEFAULT_SETTINGS };
      return current;
    },
    subscribe: () => () => undefined,
  };
}

function fakeRosterRepo(): AsyncRosterRepository {
  let current: Roster = [];
  return {
    read: async () => current,
    write: async (r) => {
      current = r;
      return { ok: true, syncState: SYNCED, settled: Promise.resolve({ ok: true }) };
    },
    subscribe: () => () => undefined,
  };
}

function fakeGameRepo(): GameRepository {
  return {
    read: () => null,
    safeRead: () => ({ status: 'ok', game: null }),
    write: () => true,
    clear: () => true,
    detectV1Migration: () => null,
    confirmV1Migration: () => false,
  };
}

function fakeCompletedGameRepo(): CompletedGameRepository {
  const games: CompletedGame[] = [];
  return {
    list: () => games,
    safeList: () => ({ status: 'ok', games }),
    add: () => true,
    remove: () => true,
    replaceAll: () => true,
  };
}

function baseProps(overrides: Partial<Parameters<typeof BackupPanel>[0]> = {}) {
  return {
    lang: 'nl' as const,
    canWrite: true,
    organizationId: 'org-a',
    teamId: 'team-a',
    organizationName: 'Org A',
    teamName: 'Team A',
    settings: { ...DEFAULT_SETTINGS, teamName: 'Team A' },
    roster: [] as Roster,
    settingsRepo: fakeSettingsRepo(),
    rosterRepo: fakeRosterRepo(),
    gameRepo: fakeGameRepo(),
    completedGameRepo: fakeCompletedGameRepo(),
    saveSettings: vi.fn(async () => true),
    saveRoster: vi.fn(async () => true),
    setLang: vi.fn(),
    onImported: vi.fn(),
    ...overrides,
  };
}

function validBackupFile(): File {
  const payload = {
    type: BACKUP_TYPE,
    version: CURRENT_BACKUP_VERSION,
    exportedAt: '2026-01-01T00:00:00.000Z',
    data: { settings: { ...DEFAULT_SETTINGS, teamName: 'Geïmporteerd' } },
  };
  return new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
}

describe('ui/backup/BackupPanel — bevoegdheid (eigenaarsbesluit §E.4, externe PR-6.6-review)', () => {
  it('canWrite=false disablet export-, import- en bestandsknoppen', () => {
    const { getByTestId } = render(<BackupPanel {...baseProps({ canWrite: false })} />);
    expect((getByTestId('backup-export-btn') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('backup-import-btn') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('backup-file-input') as HTMLInputElement).disabled).toBe(true);
  });

  it('canWrite=false blokkeert een export-klik (geen crash, geen side effect)', () => {
    const props = baseProps({ canWrite: false });
    const { getByTestId } = render(<BackupPanel {...props} />);
    // Zelfs een geforceerde click op de gedisablede knop mag niets doen —
    // handleExport() checkt canWrite zelf ook nog (defense in depth).
    expect(() => fireEvent.click(getByTestId('backup-export-btn'))).not.toThrow();
  });

  it('canWrite=true toont actieve export-/importknoppen', () => {
    const { getByTestId } = render(<BackupPanel {...baseProps()} />);
    expect((getByTestId('backup-export-btn') as HTMLButtonElement).disabled).toBe(false);
    expect((getByTestId('backup-import-btn') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('ui/backup/BackupPanel — preview-invalidatie bij contextwissel (plan §C.7, externe PR-6.6-review)', () => {
  it('een organisatie/teamwissel tijdens de preview annuleert deze (voorkomt bevestigen tegen de verkeerde context)', async () => {
    const props = baseProps();
    const { getByTestId, queryByTestId, rerender } = render(<BackupPanel {...props} />);

    const fileInput = getByTestId('backup-file-input') as HTMLInputElement;
    const file = validBackupFile();
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(getByTestId('backup-preview')).toBeTruthy());

    // Contextwissel: dezelfde component-instance krijgt nieuwe org/team-props
    // (precies wat AuthGate/App bij een teamwissel doet — geen remount).
    rerender(<BackupPanel {...props} organizationId="org-b" teamId="team-b" />);

    expect(queryByTestId('backup-preview')).toBeNull();
  });

  it('een canWrite-wijziging tijdens de preview annuleert deze ook', async () => {
    const props = baseProps();
    const { getByTestId, queryByTestId, rerender } = render(<BackupPanel {...props} />);

    const fileInput = getByTestId('backup-file-input') as HTMLInputElement;
    await fireEvent.change(fileInput, { target: { files: [validBackupFile()] } });
    await waitFor(() => expect(getByTestId('backup-preview')).toBeTruthy());

    rerender(<BackupPanel {...props} canWrite={false} />);

    expect(queryByTestId('backup-preview')).toBeNull();
  });
});
