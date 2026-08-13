// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureSnapshot,
  runImport,
  type BackupCoordinatorDeps,
} from '../../src/application/backup/BackupCoordinator';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import type { Roster } from '../../src/domain/roster/types';
import type { ActiveGame, CompletedGame } from '../../src/domain/game/types';
import type { BackupV2Data } from '../../src/domain/backup/types';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import type { GameRepository } from '../../src/application/game/GameRepository';
import type { CompletedGameRepository } from '../../src/application/game/CompletedGameRepository';

const SYNCED = { status: 'gesynchroniseerd' as const, fromCache: false, hasPendingWrites: false };

function fakeSettingsRepo(initial: Settings & Record<string, unknown>): AsyncSettingsRepository {
  let current = initial;
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

function fakeRosterRepo(initial: Roster): AsyncRosterRepository {
  let current = initial;
  return {
    read: async () => current,
    write: async (r) => {
      current = r;
      return { ok: true, syncState: SYNCED, settled: Promise.resolve({ ok: true }) };
    },
    subscribe: () => () => undefined,
  };
}

function fakeGameRepo(initial: ActiveGame | null): GameRepository {
  let current = initial;
  return {
    read: () => current,
    write: (g) => {
      current = g;
      return true;
    },
    clear: () => {
      current = null;
      return true;
    },
    detectV1Migration: () => null,
    confirmV1Migration: () => false,
  };
}

function fakeCompletedGameRepo(initial: CompletedGame[]): CompletedGameRepository {
  let current = initial;
  return {
    list: () => current,
    safeList: () => ({ status: 'ok', games: current }),
    add: (g) => {
      current = [g, ...current];
      return true;
    },
    remove: (id) => {
      current = current.filter((g) => g.id !== id);
      return true;
    },
    replaceAll: (games) => {
      current = games;
      return true;
    },
  };
}

function completedGame(id: string): CompletedGame {
  return {
    id,
    organizationId: '',
    teamId: '',
    sourceGameId: `src-${id}`,
    opponent: 'A',
    competition: '',
    date: '2026-01-01T10:00:00.000Z',
    players: [],
    segments: [],
    scoreFor: 0,
    scoreAgainst: 0,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
  };
}

let settingsRepo: AsyncSettingsRepository;
let rosterRepo: AsyncRosterRepository;
let gameRepo: GameRepository;
let completedGameRepo: CompletedGameRepository;
let langSet: string | null;
let deps: BackupCoordinatorDeps;
let saveSettingsShouldFail: boolean;
let saveRosterShouldFail: boolean;

beforeEach(() => {
  settingsRepo = fakeSettingsRepo({ ...DEFAULT_SETTINGS, teamName: 'Bestaand team' });
  rosterRepo = fakeRosterRepo([
    { id: 9, nr: '9', naam: 'Oude speler', kl: '3.0', vrouw: false, jeugd: false },
  ]);
  gameRepo = fakeGameRepo(null);
  completedGameRepo = fakeCompletedGameRepo([completedGame('existing')]);
  langSet = null;
  saveSettingsShouldFail = false;
  saveRosterShouldFail = false;
  deps = {
    settingsRepo,
    rosterRepo,
    gameRepo,
    completedGameRepo,
    saveSettings: async (payload) => {
      if (saveSettingsShouldFail) return false;
      await settingsRepo.write(payload);
      return true;
    },
    saveRoster: async (payload) => {
      if (saveRosterShouldFail) return false;
      await rosterRepo.write(payload);
      return true;
    },
    setLang: (l) => {
      langSet = l;
    },
  };
});

const TARGET = { organizationId: 'org-x', teamId: 'team-y' };

describe('application/backup/BackupCoordinator — succesvolle import (plan §C.9)', () => {
  it('schrijft alle secties in volgorde, retagt org/team, en meldt written per sectie', async () => {
    const snapshot = await captureSnapshot(deps);
    const data: BackupV2Data = {
      settings: { ...DEFAULT_SETTINGS, teamName: 'Nieuw team' },
      roster: [{ id: 1, nr: '1', naam: 'Anna', kl: '3.0', vrouw: false, jeugd: false }],
      completedGames: [completedGame('imported')],
      activeGame: null,
      lang: 'en',
    };
    const result = await runImport(deps, data, TARGET, snapshot);
    expect(result.ok).toBe(true);
    expect(result.journal.map((j) => j.outcome)).toEqual([
      'written',
      'written',
      'written',
      'written',
      'written',
    ]);
    expect((await settingsRepo.read()).teamName).toBe('Nieuw team');
    expect((await rosterRepo.read())[0]!.naam).toBe('Anna');
    expect(completedGameRepo.list()[0]!.organizationId).toBe('org-x');
    expect(completedGameRepo.list()[0]!.teamId).toBe('team-y');
    expect(gameRepo.read()).toBeNull();
    expect(langSet).toBe('en');
  });

  it('een afwezige sectie leegt het doel (replace-per-onderdeel, eigenaarsbesluit §E.2)', async () => {
    const snapshot = await captureSnapshot(deps);
    const result = await runImport(deps, {}, TARGET, snapshot);
    expect(result.ok).toBe(true);
    expect((await settingsRepo.read()).teamName).toBe(DEFAULT_SETTINGS.teamName);
    expect(await rosterRepo.read()).toEqual([]);
    expect(completedGameRepo.list()).toEqual([]);
    expect(gameRepo.read()).toBeNull();
    // taal wordt NIET geleegd bij afwezigheid (apparaatvoorkeur, plan §D).
    expect(langSet).toBeNull();
  });
});

describe('application/backup/BackupCoordinator — falen en rollback (plan §C.10/§G.7)', () => {
  it('rolt niets terug wanneer settings als eerste al faalt (nog niets geschreven)', async () => {
    const snapshot = await captureSnapshot(deps);
    saveSettingsShouldFail = true;
    const result = await runImport(deps, { roster: [] }, TARGET, snapshot);
    expect(result.ok).toBe(false);
    expect(result.journal).toEqual([{ section: 'settings', outcome: 'failed' }]);
    // Roster/history zijn ongewijzigd gebleven.
    expect((await rosterRepo.read())[0]!.naam).toBe('Oude speler');
  });

  it('rolt settings terug wanneer roster faalt, en meldt nooit vals succes', async () => {
    const snapshot = await captureSnapshot(deps);
    saveRosterShouldFail = true;
    const data: BackupV2Data = { settings: { ...DEFAULT_SETTINGS, teamName: 'Zou-terugdraaien' } };
    const result = await runImport(deps, data, TARGET, snapshot);
    expect(result.ok).toBe(false);
    expect(result.journal.map((j) => `${j.section}:${j.outcome}`)).toEqual([
      'settings:written',
      'roster:failed',
      'settings:rolledBack',
    ]);
    // Settings staat weer op de snapshot-waarde van vóór de import.
    expect((await settingsRepo.read()).teamName).toBe('Bestaand team');
  });

  it('rolt settings+roster terug wanneer de actieve-wedstrijd-write faalt', async () => {
    const snapshot = await captureSnapshot(deps);
    const failingGameRepo: GameRepository = {
      ...gameRepo,
      write: () => false,
    };
    deps = { ...deps, gameRepo: failingGameRepo };
    const data: BackupV2Data = {
      settings: { ...DEFAULT_SETTINGS, teamName: 'X' },
      roster: [{ id: 2, nr: '2', naam: 'B', kl: '3.0', vrouw: false, jeugd: false }],
      activeGame: {
        id: 'g1',
        organizationId: '',
        teamId: '',
        phase: 'tracking',
        players: [],
        opponent: 'Live',
        competition: '',
        clockDown: true,
        limitStr: '',
        onCourt: [],
        curQuarter: 1,
        beginSec: 600,
        endSec: 600,
        pendingSwapLineup: null,
        actions: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        startedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    const result = await runImport(deps, data, TARGET, snapshot);
    expect(result.ok).toBe(false);
    expect(result.journal.map((j) => `${j.section}:${j.outcome}`)).toEqual([
      'settings:written',
      'roster:written',
      'completedGames:written',
      'activeGame:failed',
      'settings:rolledBack',
      'roster:rolledBack',
      'completedGames:rolledBack',
    ]);
    expect((await settingsRepo.read()).teamName).toBe('Bestaand team');
    expect((await rosterRepo.read())[0]!.naam).toBe('Oude speler');
    expect(completedGameRepo.list()[0]!.id).toBe('existing');
  });
});

describe('application/backup/BackupCoordinator — idempotente retry (plan §D/§G.6)', () => {
  it('dezelfde import tweemaal levert identiek dezelfde eindtoestand op, geen dubbele wedstrijden', async () => {
    const data: BackupV2Data = { completedGames: [completedGame('imported')] };
    const snapshot1 = await captureSnapshot(deps);
    await runImport(deps, data, TARGET, snapshot1);
    expect(completedGameRepo.list()).toHaveLength(1);

    const snapshot2 = await captureSnapshot(deps);
    await runImport(deps, data, TARGET, snapshot2);
    expect(completedGameRepo.list()).toHaveLength(1);
    expect(completedGameRepo.list()[0]!.id).toBe('imported');
  });
});
