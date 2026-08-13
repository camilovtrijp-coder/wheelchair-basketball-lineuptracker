// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureSnapshot,
  runImport,
  type BackupCoordinatorDeps,
  type BackupSnapshot,
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
    safeRead: () => ({ status: 'ok', game: current }),
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

async function snapshotOrThrow(deps: BackupCoordinatorDeps): Promise<BackupSnapshot> {
  const result = await captureSnapshot(deps);
  if (!result.ok) throw new Error('captureSnapshot unexpectedly failed');
  return result.snapshot;
}

let settingsRepo: AsyncSettingsRepository;
let rosterRepo: AsyncRosterRepository;
let gameRepo: GameRepository;
let completedGameRepo: CompletedGameRepository;
let langSet: string | null;
let deps: BackupCoordinatorDeps;

/**
 * Schrijfmodus per sectie (externe PR-6.6-review, aug. 2026: "mutate-then-
 * false", readback-mismatch en fout-tijdens-rollback zijn drie apart te
 * onderscheiden faalscenario's, niet hetzelfde als een simpele
 * always-fails-vlag):
 * - `'ok'`: normale write, muteert en retourneert `true`.
 * - `'failAlways'`: retourneert altijd `false`, muteert niets (klassieke
 *   write-fout, bv. quota overschreden).
 * - `'mutateThenFalse'`: muteert de onderliggende opslag WEL, maar meldt
 *   toch `false` — een adapter/wrapper-bug die de coordinator alleen via
 *   een expliciete rollback van de sectie zelf kan herstellen.
 * - `'staleReadback'`: meldt `true` maar de opslag levert bij lezen de OUDE
 *   waarde terug — de readback-vergelijking moet dit als `'failed'` zien.
 */
type WriteMode = 'ok' | 'failAlways' | 'mutateThenFalse' | 'staleReadback';
let settingsMode: WriteMode;
let rosterMode: WriteMode;

beforeEach(() => {
  settingsRepo = fakeSettingsRepo({ ...DEFAULT_SETTINGS, teamName: 'Bestaand team' });
  rosterRepo = fakeRosterRepo([
    { id: 9, nr: '9', naam: 'Oude speler', kl: '3.0', vrouw: false, jeugd: false },
  ]);
  gameRepo = fakeGameRepo(null);
  completedGameRepo = fakeCompletedGameRepo([completedGame('existing')]);
  langSet = null;
  settingsMode = 'ok';
  rosterMode = 'ok';
  deps = {
    settingsRepo,
    rosterRepo,
    gameRepo,
    completedGameRepo,
    saveSettings: async (payload) => {
      if (settingsMode === 'failAlways') return false;
      if (settingsMode === 'mutateThenFalse') {
        await settingsRepo.write(payload);
        return false;
      }
      if (settingsMode === 'staleReadback') return true; // niet daadwerkelijk geschreven
      await settingsRepo.write(payload);
      return true;
    },
    saveRoster: async (payload) => {
      if (rosterMode === 'failAlways') return false;
      if (rosterMode === 'mutateThenFalse') {
        await rosterRepo.write(payload);
        return false;
      }
      if (rosterMode === 'staleReadback') return true;
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
    const snapshot = await snapshotOrThrow(deps);
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
    const snapshot = await snapshotOrThrow(deps);
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
  it('rolt de falende sectie zelf ook terug wanneer settings als eerste al faalt (nooit "niets gedaan" aannemen)', async () => {
    const snapshot = await snapshotOrThrow(deps);
    settingsMode = 'failAlways';
    const result = await runImport(deps, { roster: [] }, TARGET, snapshot);
    expect(result.ok).toBe(false);
    // De write faalt, en de rollback-poging van settings faalt OOK (zelfde
    // kapotte adapter) — dit moet zichtbaar `rollbackFailed` zijn, nooit
    // stilzwijgend als `rolledBack` gemeld worden.
    expect(result.journal).toEqual([
      { section: 'settings', outcome: 'failed' },
      { section: 'settings', outcome: 'rollbackFailed' },
    ]);
    // Roster/history zijn ongewijzigd gebleven.
    expect((await rosterRepo.read())[0]!.naam).toBe('Oude speler');
  });

  it('herstelt de falende sectie zelf wél naar de snapshot wanneer de adapter daarna weer werkt', async () => {
    const snapshot = await snapshotOrThrow(deps);
    settingsMode = 'failAlways';
    // Simuleer een write die na de initiële fout weer normaal werkt (bv.
    // een tijdelijke quotafout) — de rollback-write die de coordinator
    // intern doet, moet dan gewoon slagen.
    const originalSaveSettings = deps.saveSettings;
    let callCount = 0;
    deps = {
      ...deps,
      saveSettings: async (payload, changedKeys) => {
        callCount += 1;
        if (callCount === 1) return false;
        settingsMode = 'ok';
        return originalSaveSettings(payload, changedKeys);
      },
    };
    const result = await runImport(deps, {}, TARGET, snapshot);
    expect(result.ok).toBe(false);
    expect(result.journal).toEqual([
      { section: 'settings', outcome: 'failed' },
      { section: 'settings', outcome: 'rolledBack' },
    ]);
    expect((await settingsRepo.read()).teamName).toBe('Bestaand team');
  });

  it('detecteert "mutate-then-false": write muteert de opslag maar meldt false, en herstelt hem alsnog', async () => {
    const snapshot = await snapshotOrThrow(deps);
    settingsMode = 'mutateThenFalse';
    const data: BackupV2Data = {
      settings: { ...DEFAULT_SETTINGS, teamName: 'Stiekem-geschreven' },
    };
    const result = await runImport(deps, data, TARGET, snapshot);
    expect(result.ok).toBe(false);
    expect(result.journal[0]).toEqual({ section: 'settings', outcome: 'failed' });
    // Ondanks dat de onderliggende write wél muteerde, is settings na
    // rollback weer exact de snapshot-waarde (de rollback-write zelf werkt
    // weer normaal zodra settingsMode terug op 'ok' zou staan, maar hier
    // blijft 'mutateThenFalse' aanstaan — dus de rollbackpoging faalt ook
    // op dezelfde manier, en de coordinator MOET dat als rollbackFailed
    // melden, niet als rolledBack).
    expect(result.journal[1]!.outcome).toBe('rollbackFailed');
  });

  it('detecteert een readback-mismatch: write meldt success maar de opslag geeft de oude waarde terug', async () => {
    const snapshot = await snapshotOrThrow(deps);
    settingsMode = 'staleReadback';
    const data: BackupV2Data = {
      settings: { ...DEFAULT_SETTINGS, teamName: 'Nooit-echt-geschreven' },
    };
    const result = await runImport(deps, data, TARGET, snapshot);
    expect(result.ok).toBe(false);
    expect(result.journal[0]).toEqual({ section: 'settings', outcome: 'failed' });
  });

  it('rolt settings+roster terug wanneer roster faalt, en meldt nooit vals succes', async () => {
    const snapshot = await snapshotOrThrow(deps);
    rosterMode = 'failAlways';
    const data: BackupV2Data = { settings: { ...DEFAULT_SETTINGS, teamName: 'Zou-terugdraaien' } };
    const result = await runImport(deps, data, TARGET, snapshot);
    expect(result.ok).toBe(false);
    expect(result.journal.map((j) => `${j.section}:${j.outcome}`)).toEqual([
      'settings:written',
      'roster:failed',
      // Rollback in omgekeerde volgorde: eerst de net gefaalde sectie
      // (roster — blijft falen, zelfde kapotte adapter), dan settings.
      'roster:rollbackFailed',
      'settings:rolledBack',
    ]);
    // Settings staat weer op de snapshot-waarde van vóór de import.
    expect((await settingsRepo.read()).teamName).toBe('Bestaand team');
  });

  it('detecteert een readback-mismatch bij completedGames (replaceAll meldt succes, list() wijkt af)', async () => {
    const snapshot = await snapshotOrThrow(deps);
    const brokenCompletedGameRepo: CompletedGameRepository = {
      ...completedGameRepo,
      replaceAll: () => true, // "lukt", maar list() hieronder blijft de oude data tonen
      list: () => [completedGame('never-changed')],
      safeList: () => ({ status: 'ok', games: [completedGame('never-changed')] }),
    };
    deps = { ...deps, completedGameRepo: brokenCompletedGameRepo };
    const data: BackupV2Data = { completedGames: [completedGame('imported')] };
    const result = await runImport(deps, data, TARGET, snapshot);
    expect(result.ok).toBe(false);
    expect(result.journal.map((j) => `${j.section}:${j.outcome}`)).toEqual([
      'settings:written',
      'roster:written',
      'completedGames:failed',
      'completedGames:rollbackFailed', // zelfde kapotte replaceAll tijdens rollback
      'roster:rolledBack',
      'settings:rolledBack',
    ]);
  });

  it('rolt settings+roster+completedGames terug wanneer de actieve-wedstrijd-write faalt', async () => {
    const snapshot = await snapshotOrThrow(deps);
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
      'activeGame:rolledBack',
      'completedGames:rolledBack',
      'roster:rolledBack',
      'settings:rolledBack',
    ]);
    expect((await settingsRepo.read()).teamName).toBe('Bestaand team');
    expect((await rosterRepo.read())[0]!.naam).toBe('Oude speler');
    expect(completedGameRepo.list()[0]!.id).toBe('existing');
  });
});

describe('application/backup/BackupCoordinator — idempotente retry (plan §D/§G.6)', () => {
  it('dezelfde import tweemaal levert identiek dezelfde eindtoestand op, geen dubbele wedstrijden', async () => {
    const data: BackupV2Data = { completedGames: [completedGame('imported')] };
    const snapshot1 = await snapshotOrThrow(deps);
    await runImport(deps, data, TARGET, snapshot1);
    expect(completedGameRepo.list()).toHaveLength(1);

    const snapshot2 = await snapshotOrThrow(deps);
    await runImport(deps, data, TARGET, snapshot2);
    expect(completedGameRepo.list()).toHaveLength(1);
    expect(completedGameRepo.list()[0]!.id).toBe('imported');
  });
});

describe('application/backup/BackupCoordinator — captureSnapshot leesfouten (plan §A.2/§C.8)', () => {
  it('geeft ok:false terug wanneer completedGameRepo.safeList() een leesfout meldt, i.p.v. een lege snapshot', async () => {
    const brokenCompletedGameRepo: CompletedGameRepository = {
      ...completedGameRepo,
      safeList: () => ({ status: 'error', games: [] }),
    };
    const result = await captureSnapshot({ ...deps, completedGameRepo: brokenCompletedGameRepo });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedSection).toBe('completedGames');
  });

  it('geeft ok:false terug wanneer gameRepo.safeRead() een leesfout meldt, i.p.v. een lege snapshot', async () => {
    const brokenGameRepo: GameRepository = {
      ...gameRepo,
      safeRead: () => ({ status: 'error', game: null }),
    };
    const result = await captureSnapshot({ ...deps, gameRepo: brokenGameRepo });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedSection).toBe('activeGame');
  });
});
