// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
import type { LangWritePort } from '../../src/application/i18n/LangRepository';
import type { WriteResult } from '../../src/domain/syncState';
import type { Lang } from '../../src/i18n/strings';

const SYNCED = { status: 'gesynchroniseerd' as const, fromCache: false, hasPendingWrites: false };
const PENDING = {
  status: 'wacht-op-synchronisatie' as const,
  fromCache: true,
  hasPendingWrites: true,
};
const FAILED = { status: 'actie-nodig' as const, fromCache: false, hasPendingWrites: false };

/**
 * Schrijfmodus per sectie (externe PR-6.6-review, aug. 2026: "mutate-then-
 * false", readback-mismatch, "lokaal geaccepteerd maar door de server
 * afgewezen" en "settled blijft onbepaald hangen" zijn vier apart te
 * onderscheiden faalscenario's, niet hetzelfde als een simpele
 * always-fails-vlag):
 * - `'ok'`: normale write, muteert en `settled` resolvet meteen `{ok:true}`.
 * - `'failAlways'`: `write()` retourneert `ok:false`, muteert niets.
 * - `'mutateThenFalse'`: muteert de onderliggende opslag WEL, maar meldt
 *   toch `ok:false` — een adapter/wrapper-bug die de coordinator alleen via
 *   een expliciete rollback van de sectie zelf kan herstellen.
 * - `'staleReadback'`: `write()`/`settled` melden succes, maar de opslag
 *   levert bij lezen de OUDE waarde terug.
 * - `'serverReject'`: exact het cloudcontract uit `useSyncStatus`/
 *   `FirestoreSettingsRepository` — `write()` retourneert meteen `ok:true`
 *   (lokale acceptatie via latency compensation) en muteert de opslag ook
 *   meteen, maar `settled` resolvet pas ÁSYNCHROON alsnog `{ok:false}`
 *   (serverafwijzing) — de coordinator mag dan nooit vroeg succes melden.
 * - `'settleTimeout'`: `settled` resolvet NOOIT (het gedocumenteerde issue
 *   #27-gate: offline blijft settled voor precies dit document onbepaald
 *   hangen) — de coordinator moet dit begrensd (nooit oneindig) als
 *   `'failed'` behandelen, niet stilzwijgend blijven wachten.
 */
type WriteMode =
  'ok' | 'failAlways' | 'mutateThenFalse' | 'staleReadback' | 'serverReject' | 'settleTimeout';

function fakeSettingsRepo(
  initial: Settings & Record<string, unknown>,
  getMode: () => WriteMode,
): AsyncSettingsRepository {
  let current = initial;
  return {
    read: async () => current,
    write: async (s): Promise<WriteResult> => {
      const mode = getMode();
      if (mode === 'failAlways') {
        return { ok: false, syncState: FAILED, settled: Promise.resolve({ ok: false }) };
      }
      if (mode === 'mutateThenFalse') {
        current = s;
        return { ok: false, syncState: FAILED, settled: Promise.resolve({ ok: false }) };
      }
      if (mode === 'staleReadback') {
        // "Succes", maar de storage wordt bewust NIET gemuteerd.
        return { ok: true, syncState: SYNCED, settled: Promise.resolve({ ok: true }) };
      }
      if (mode === 'serverReject') {
        current = s;
        return {
          ok: true,
          syncState: PENDING,
          settled: Promise.resolve().then(() => ({ ok: false, error: 'rules-denied' })),
        };
      }
      if (mode === 'settleTimeout') {
        current = s;
        return { ok: true, syncState: PENDING, settled: new Promise(() => undefined) };
      }
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

function fakeRosterRepo(initial: Roster, getMode: () => WriteMode): AsyncRosterRepository {
  let current = initial;
  return {
    read: async () => current,
    write: async (r): Promise<WriteResult> => {
      const mode = getMode();
      if (mode === 'failAlways') {
        return { ok: false, syncState: FAILED, settled: Promise.resolve({ ok: false }) };
      }
      if (mode === 'mutateThenFalse') {
        current = r;
        return { ok: false, syncState: FAILED, settled: Promise.resolve({ ok: false }) };
      }
      if (mode === 'staleReadback') {
        return { ok: true, syncState: SYNCED, settled: Promise.resolve({ ok: true }) };
      }
      if (mode === 'serverReject') {
        current = r;
        return {
          ok: true,
          syncState: PENDING,
          settled: Promise.resolve().then(() => ({ ok: false, error: 'rules-denied' })),
        };
      }
      if (mode === 'settleTimeout') {
        current = r;
        return { ok: true, syncState: PENDING, settled: new Promise(() => undefined) };
      }
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
    safeListStrict: () => ({ status: 'ok', games: current }),
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

type LangMode = 'ok' | 'failAlways' | 'staleReadback';

function fakeLangRepo(initial: Lang, getMode: () => LangMode): LangWritePort {
  let current: Lang | null = initial;
  return {
    read: () => current,
    write: (l) => {
      const mode = getMode();
      if (mode === 'failAlways') return false;
      if (mode === 'staleReadback') return true; // "succes", niet echt geschreven
      current = l;
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
let langRepo: LangWritePort;
let langSet: string | null;
let deps: BackupCoordinatorDeps;
let settingsMode: WriteMode;
let rosterMode: WriteMode;
let langMode: LangMode;

beforeEach(() => {
  settingsMode = 'ok';
  rosterMode = 'ok';
  langMode = 'ok';
  settingsRepo = fakeSettingsRepo(
    { ...DEFAULT_SETTINGS, teamName: 'Bestaand team' },
    () => settingsMode,
  );
  rosterRepo = fakeRosterRepo(
    [{ id: 9, nr: '9', naam: 'Oude speler', kl: '3.0', vrouw: false, jeugd: false }],
    () => rosterMode,
  );
  gameRepo = fakeGameRepo(null);
  completedGameRepo = fakeCompletedGameRepo([completedGame('existing')]);
  langRepo = fakeLangRepo('nl', () => langMode);
  langSet = null;
  deps = {
    settingsRepo,
    rosterRepo,
    gameRepo,
    completedGameRepo,
    langRepo,
    currentLang: 'nl',
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
    // een tijdelijke quotafout): zet settingsMode terug op 'ok' zodra de
    // eerste (mislukte) write is geweest — de rollback-write die de
    // coordinator daarna intern doet, moet dan gewoon slagen.
    const originalWrite = settingsRepo.write.bind(settingsRepo);
    let callCount = 0;
    settingsRepo.write = async (payload, changedKeys) => {
      callCount += 1;
      if (callCount === 1) return originalWrite(payload, changedKeys);
      settingsMode = 'ok';
      return originalWrite(payload, changedKeys);
    };
    deps = { ...deps, settingsRepo };
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
    // De rollbackpoging gebruikt dezelfde kapotte adapter (blijft
    // mutateThenFalse) en moet dat dus ook eerlijk als rollbackFailed
    // melden, niet als rolledBack.
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
      safeListStrict: () => ({ status: 'ok', games: [completedGame('never-changed')] }),
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

describe('application/backup/BackupCoordinator — cloud: nooit succes vóór serverbevestiging (externe PR-6.6-review)', () => {
  it('meldt geen succes wanneer settings lokaal geaccepteerd wordt maar de server de write daarna afwijst', async () => {
    const snapshot = await snapshotOrThrow(deps);
    settingsMode = 'serverReject';
    const data: BackupV2Data = { settings: { ...DEFAULT_SETTINGS, teamName: 'Server-wijst-af' } };
    const result = await runImport(deps, data, TARGET, snapshot);
    expect(result.ok).toBe(false);
    expect(result.journal[0]!.outcome).toBe('failed');
    // De rollback gebruikt dezelfde repo, die na settled ook weer
    // 'serverReject' teruggeeft voor de herstelwrite — dus ook die faalt
    // eerlijk, nooit stilzwijgend geveinsd succes.
    expect(result.journal[1]!.outcome).toBe('rollbackFailed');
  });

  it('meldt geen succes en hangt niet oneindig wanneer settled offline onbepaald blijft hangen (issue #27-gate)', async () => {
    vi.useFakeTimers();
    try {
      const snapshot = await snapshotOrThrow(deps);
      settingsMode = 'settleTimeout';
      const data: BackupV2Data = { settings: { ...DEFAULT_SETTINGS, teamName: 'Offline' } };
      const resultPromise = runImport(deps, data, TARGET, snapshot);
      // Zowel de initiële write ALS de daaropvolgende rollback-poging
      // (dezelfde kapotte/offline adapter) wachten elk begrensd
      // (IMPORT_SETTLE_TIMEOUT_MS) — nooit oneindig, en de coordinator
      // mag ondertussen geen vals succes melden.
      await vi.advanceTimersByTimeAsync(40_000);
      const result = await resultPromise;
      expect(result.ok).toBe(false);
      expect(result.journal[0]!.outcome).toBe('failed');
    } finally {
      vi.useRealTimers();
    }
  }, 10_000);
});

describe('application/backup/BackupCoordinator — taal: write+readback+rollback, geen onfeilbare write (externe PR-6.6-review)', () => {
  it('meldt failed en rolt alle secties terug wanneer de taal-storage-write faalt (bv. een throwende setItem)', async () => {
    const throwingLangRepo: LangWritePort = {
      read: () => 'nl',
      write: () => {
        throw new Error('QuotaExceededError');
      },
    };
    deps = { ...deps, langRepo: throwingLangRepo };
    const snapshot = await snapshotOrThrow(deps);
    const data: BackupV2Data = {
      settings: { ...DEFAULT_SETTINGS, teamName: 'X' },
      lang: 'en',
    };
    const result = await runImport(deps, data, TARGET, snapshot);
    expect(result.ok).toBe(false);
    expect(result.journal.map((j) => `${j.section}:${j.outcome}`)).toEqual([
      'settings:written',
      'roster:written',
      'completedGames:written',
      'activeGame:written',
      'lang:failed',
      // De rollbackpoging van taal gebruikt dezelfde blijvend-throwende
      // adapter, dus faalt ook eerlijk — nooit stilzwijgend als rolledBack.
      'lang:rollbackFailed',
      'activeGame:rolledBack',
      'completedGames:rolledBack',
      'roster:rolledBack',
      'settings:rolledBack',
    ]);
    // Settings is teruggerold ondanks dat die stap zelf prima gelukt was —
    // een falende taal-write mag geen gedeeltelijk succes achterlaten.
    expect((await settingsRepo.read()).teamName).toBe('Bestaand team');
    // setLang() is NIET aangeroepen: de React-state mag nooit een taal
    // tonen die niet daadwerkelijk is opgeslagen.
    expect(langSet).toBeNull();
  });

  it('meldt failed bij een taal-readback-mismatch (write meldt succes, storage geeft de oude waarde terug)', async () => {
    langMode = 'staleReadback';
    const snapshot = await snapshotOrThrow(deps);
    const data: BackupV2Data = { lang: 'en' };
    const result = await runImport(deps, data, TARGET, snapshot);
    expect(result.ok).toBe(false);
    expect(result.journal[4]).toEqual({ section: 'lang', outcome: 'failed' });
    // setLang() is nooit met de MISLUKTE waarde 'en' aangeroepen — de
    // readback-mismatch bewijst dat die storage-write niet echt doorkwam,
    // dus mag de React-state niet naar 'en' springen. De rollback-poging
    // erna herstelt (schrijft/leest 'nl', de snapshot-waarde) wél normaal.
    expect(langSet).not.toBe('en');
  });

  it('schrijft taal pas naar de React-state (setLang) NA een bevestigde storage-write', async () => {
    const snapshot = await snapshotOrThrow(deps);
    const data: BackupV2Data = { lang: 'en' };
    const result = await runImport(deps, data, TARGET, snapshot);
    expect(result.ok).toBe(true);
    expect(langSet).toBe('en');
    expect(langRepo.read()).toBe('en');
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
  it('geeft ok:false terug wanneer completedGameRepo.safeListStrict() een leesfout meldt, i.p.v. een lege snapshot', async () => {
    const brokenCompletedGameRepo: CompletedGameRepository = {
      ...completedGameRepo,
      safeListStrict: () => ({ status: 'error', games: [] }),
    };
    const result = await captureSnapshot({ ...deps, completedGameRepo: brokenCompletedGameRepo });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedSection).toBe('completedGames');
  });

  it('geeft ok:false terug wanneer een individueel item wél leesbaar maar mistagged/corrupt is (safeListStrict, i.t.t. safeList dat zoiets filtert)', async () => {
    // safeList() blijft het permissieve UI-contract (één beschadigd item
    // verbergt de rest niet) — safeListStrict() is de striktere variant
    // die specifiek voor back-up-doeleinden alles-of-niets is.
    const brokenCompletedGameRepo: CompletedGameRepository = {
      ...completedGameRepo,
      safeList: () => ({ status: 'ok', games: [completedGame('existing')] }),
      safeListStrict: () => ({ status: 'error', games: [] }),
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

  it('geeft ok:false terug wanneer settingsRepo.read() reject (i.p.v. de UI in "running" te laten hangen)', async () => {
    const brokenSettingsRepo: AsyncSettingsRepository = {
      ...settingsRepo,
      read: async () => {
        throw new Error('storage kapot');
      },
    };
    const result = await captureSnapshot({ ...deps, settingsRepo: brokenSettingsRepo });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedSection).toBe('settings');
  });
});
