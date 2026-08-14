import type { AsyncSettingsRepository } from '../settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../roster/AsyncRosterRepository';
import type { GameRepository } from '../game/GameRepository';
import type { CompletedGameRepository } from '../game/CompletedGameRepository';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/settings/types';
import type { Roster } from '../../domain/roster/types';
import { retagWithContext } from '../../domain/backup/migrateV1';
import type { BackupV2Data, ImportJournalEntry, ImportRunResult } from '../../domain/backup/types';
import type { ActiveGame, CompletedGame } from '../../domain/game/types';
import type { Lang } from '../../i18n/strings';

/**
 * PR 6.6 §F 6.6b — orchestreert de daadwerkelijke import-writes NA
 * preview + expliciete bevestiging (plan §C.7-§C.10). Alle validatie is al
 * gebeurd (`domain/backup/parse.ts`); deze coordinator gaat er dus van uit
 * dat `data` al gevalideerd is. Bevat zelf geen DOM/storage-detail — die
 * blijft achter `AsyncSettingsRepository`/`GameRepository`/
 * `CompletedGameRepository` (de UI/App.tsx geeft de al-geresolvede
 * instanties door, precies zoals Settings/Roster/Stats/Trends dat al doen).
 *
 * Externe PR-6.6-review (aug. 2026): schrijft settings/roster bewust
 * RECHTSTREEKS via `settingsRepo.write()`/`rosterRepo.write()` — niet meer
 * via `useSyncStatus`'s `saveSettings`/`saveRoster`. Die laatste twee zijn
 * doelbewust optimistisch (zie hun eigen documentatie in
 * `application/sync/useSyncStatus.ts`): ze retourneren `true` zodra een
 * cloudwrite LOKAAL is geaccepteerd, zonder op serverbevestiging
 * (`settled`) te wachten — geschikt voor interactieve Settings/Roster-UI,
 * maar niet voor een back-up-import: een latere Firestore Rules-/
 * serverafwijzing zou dan een net gemelde "import geslaagd" alsnog
 * gedeeltelijk ongedaan maken zonder dat de coordinator dat kan
 * detecteren. Zie `writeSettingsSection`/`writeRosterSection` hieronder.
 */
export interface BackupCoordinatorDeps {
  settingsRepo: AsyncSettingsRepository;
  rosterRepo: AsyncRosterRepository;
  gameRepo: GameRepository;
  completedGameRepo: CompletedGameRepository;
  setLang: (lang: Lang) => void;
}

/**
 * In-memory snapshot van de huidige doeldata, vóór er iets geschreven wordt
 * (plan §C.10: hersteljournal/rollback bij gedeeltelijk falen). Bevat
 * uitsluitend de secties die deze coordinator zelf kan schrijven.
 */
export interface BackupSnapshot {
  settings: Settings & Record<string, unknown>;
  roster: Roster;
  activeGame: ActiveGame | null;
  completedGames: CompletedGame[];
}

type SectionName = 'settings' | 'roster' | 'completedGames' | 'activeGame';

export type CaptureSnapshotResult =
  { ok: true; snapshot: BackupSnapshot } | { ok: false; failedSection: SectionName };

/**
 * Wacht bewust hooguit `IMPORT_SETTLE_TIMEOUT_MS` op een write's
 * serverbevestiging (`settled`, zie `domain/syncState.ts`) — nooit
 * onbepaald (externe PR-6.6-review, aug. 2026: `FirestoreSettingsRepository`
 * documenteert zelf een bekend gate — issue #27 — waarbij `settled` voor
 * PRECIES het beschreven document offline nooit meer resolvet). Een import
 * mag daardoor nooit onbeperkt in `running` blijven hangen: bij een timeout
 * behandelt de coordinator de stap als mislukt (`'failed'`) en start de
 * bestaande rollback — hetzelfde eerlijke, nooit-vals-succes-pad als een
 * expliciete serverafwijzing. `settled` zelf reject per contract nooit, dus
 * hier is geen aparte catch nodig.
 */
const IMPORT_SETTLE_TIMEOUT_MS = 15_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function safeListStrict(repo: CompletedGameRepository): {
  status: 'ok' | 'missing' | 'error';
  games: CompletedGame[];
} {
  if (repo.safeListStrict) return repo.safeListStrict();
  if (repo.safeList) return repo.safeList();
  return { status: 'ok', games: repo.list() };
}

/**
 * Legt de huidige doeldata vast VÓÓR er iets geschreven wordt (plan §C.10 /
 * startvoorwaarde A.2). Leest rechtstreeks via de repositories i.p.v. te
 * vertrouwen op eventueel verouderde in-memory UI-state.
 *
 * Externe PR-6.6-review (aug. 2026): gebruikt bewust `safeListStrict()`/
 * `safeRead()` i.p.v. `list()`/`read()` — die laatste twee vertalen een
 * echte storage-/parsefout (of een individueel corrupt/mistagged item)
 * stilzwijgend naar "leeg"/`null`/"gefilterd", waardoor een corrupte opslag
 * als lege of onvolledige snapshot behandeld zou worden. Een download of
 * import gebaseerd op zo'n valse snapshot kan bestaande, wél aanwezige
 * historie of een actieve wedstrijd stilzwijgend overschrijven/leegmaken —
 * precies het scenario dat startvoorwaarde A.2 uitsluit. Bij een leesfout
 * (inclusief een onverwachte reject van `settingsRepo.read()`/
 * `rosterRepo.read()`) geeft deze functie `ok: false` terug; de aanroeper
 * mag dan NIETS downloaden of schrijven.
 */
export async function captureSnapshot(deps: BackupCoordinatorDeps): Promise<CaptureSnapshotResult> {
  let completedResult: ReturnType<typeof safeListStrict>;
  try {
    completedResult = safeListStrict(deps.completedGameRepo);
  } catch {
    return { ok: false, failedSection: 'completedGames' };
  }
  if (completedResult.status === 'error') {
    return { ok: false, failedSection: 'completedGames' };
  }

  let activeResult: ReturnType<GameRepository['safeRead']>;
  try {
    activeResult = deps.gameRepo.safeRead();
  } catch {
    return { ok: false, failedSection: 'activeGame' };
  }
  if (activeResult.status === 'error') {
    return { ok: false, failedSection: 'activeGame' };
  }

  let settings: Settings & Record<string, unknown>;
  try {
    settings = await deps.settingsRepo.read();
  } catch {
    return { ok: false, failedSection: 'settings' };
  }

  let roster: Roster;
  try {
    roster = await deps.rosterRepo.read();
  } catch {
    return { ok: false, failedSection: 'roster' };
  }

  return {
    ok: true,
    snapshot: {
      settings,
      roster,
      activeGame: activeResult.game,
      completedGames: completedResult.games,
    },
  };
}

/**
 * Canonieke, sleutel-gesorteerde JSON-serialisatie voor diepe
 * gelijkheidscontroles (externe PR-6.6-review, aug. 2026: de vorige
 * readback vergeleek maar 1-2 velden of alleen een lengte/ID, waardoor
 * verkeerd geschreven inhoud met toevallig dezelfde lengte als volledig
 * succes gemeld kon worden). Onze domeinobjecten zijn allemaal platte JSON-
 * compatibele data (geen Dates/functies), dus sleutelvolgorde is de enige
 * bron van valse ongelijkheid tussen twee inhoudelijk identieke objecten.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

async function writeSettingsSection(
  deps: BackupCoordinatorDeps,
  settings: (Settings & Record<string, unknown>) | undefined,
): Promise<'written' | 'failed'> {
  const target = settings ?? (DEFAULT_SETTINGS as Settings & Record<string, unknown>);
  try {
    const writeResult = await deps.settingsRepo.write(target);
    if (!writeResult.ok) return 'failed';
    const settled = await withTimeout(writeResult.settled, IMPORT_SETTLE_TIMEOUT_MS);
    if (settled === 'timeout' || !settled.ok) return 'failed';
    const readBack = await deps.settingsRepo.read();
    return deepEqual(readBack, target) ? 'written' : 'failed';
  } catch {
    return 'failed';
  }
}

async function writeRosterSection(
  deps: BackupCoordinatorDeps,
  roster: Roster | undefined,
): Promise<'written' | 'failed'> {
  const target = roster ?? [];
  try {
    const writeResult = await deps.rosterRepo.write(target);
    if (!writeResult.ok) return 'failed';
    const settled = await withTimeout(writeResult.settled, IMPORT_SETTLE_TIMEOUT_MS);
    if (settled === 'timeout' || !settled.ok) return 'failed';
    const readBack = await deps.rosterRepo.read();
    return deepEqual(readBack, target) ? 'written' : 'failed';
  } catch {
    return 'failed';
  }
}

function writeActiveGameSection(
  deps: BackupCoordinatorDeps,
  activeGame: BackupV2Data['activeGame'],
): 'written' | 'failed' {
  try {
    const ok = activeGame ? deps.gameRepo.write(activeGame) : deps.gameRepo.clear();
    if (!ok) return 'failed';
    const readBack = deps.gameRepo.safeRead();
    if (readBack.status === 'error') return 'failed';
    return deepEqual(readBack.game, activeGame ?? null) ? 'written' : 'failed';
  } catch {
    return 'failed';
  }
}

function writeCompletedGamesSection(
  deps: BackupCoordinatorDeps,
  games: BackupV2Data['completedGames'],
): 'written' | 'failed' {
  const target = games ?? [];
  try {
    const ok = deps.completedGameRepo.replaceAll(target);
    if (!ok) return 'failed';
    const readBack = safeListStrict(deps.completedGameRepo);
    if (readBack.status === 'error') return 'failed';
    return deepEqual(readBack.games, target) ? 'written' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * Herstelt één sectie terug naar de snapshot-waarde (plan §C.10). Wordt
 * aangeroepen voor ELKE sectie die deze run heeft AANGERAAKT — inclusief de
 * sectie die zelf faalde (externe PR-6.6-review, aug. 2026: een adapter die
 * eerst muteert en daarna `false` retourneert, of een readback-mismatch ná
 * een write, mag de sectie nooit gewijzigd achterlaten, ook niet als het de
 * EERSTE stap was). Retourneert `'rollbackFailed'` (nooit stilzwijgend
 * `'rolledBack'`) wanneer de herstelwrite zelf ook faalt of de readback na
 * herstel niet overeenkomt met de snapshot — een vals hersteld-rapport zou
 * de gebruiker een garantie geven die niet waar is.
 */
async function rollbackSection(
  section: SectionName,
  deps: BackupCoordinatorDeps,
  snapshot: BackupSnapshot,
): Promise<'rolledBack' | 'rollbackFailed'> {
  switch (section) {
    case 'settings': {
      const outcome = await writeSettingsSection(deps, snapshot.settings);
      return outcome === 'written' ? 'rolledBack' : 'rollbackFailed';
    }
    case 'roster': {
      const outcome = await writeRosterSection(deps, snapshot.roster);
      return outcome === 'written' ? 'rolledBack' : 'rollbackFailed';
    }
    case 'completedGames': {
      const outcome = writeCompletedGamesSection(deps, snapshot.completedGames);
      return outcome === 'written' ? 'rolledBack' : 'rollbackFailed';
    }
    case 'activeGame': {
      const outcome = writeActiveGameSection(deps, snapshot.activeGame);
      return outcome === 'written' ? 'rolledBack' : 'rollbackFailed';
    }
  }
}

/**
 * Voert de import uit (plan §C.9): schrijft in vaste volgorde (settings →
 * roster → afgeronde wedstrijden → actieve wedstrijd → taal), verifieert
 * elke stap met een diepe readback-vergelijking NA serverbevestiging (zie
 * `writeSettingsSection`/`writeRosterSection` — nooit vroeg succes in
 * cloudmodus), en rolt bij de EERSTE fout ALLE tot dan toe aangeraakte
 * secties terug naar `snapshot` — inclusief de net gefaalde sectie zelf, in
 * omgekeerde volgorde. Elke rollbackpoging krijgt een eigen,
 * nooit-geveinsd journaalresultaat (`rolledBack` of `rollbackFailed`).
 * Stopt na de eerste fout: geen "best effort"-vervolg op de resterende
 * secties (plan §B "niet in scope").
 */
export async function runImport(
  deps: BackupCoordinatorDeps,
  data: BackupV2Data,
  target: { organizationId: string; teamId: string },
  snapshot: BackupSnapshot,
): Promise<ImportRunResult> {
  const retagged = retagWithContext(data, target.organizationId, target.teamId);
  const journal: ImportJournalEntry[] = [];
  const attempted: SectionName[] = [];

  async function rollbackAttempted(): Promise<ImportRunResult> {
    for (const section of [...attempted].reverse()) {
      const outcome = await rollbackSection(section, deps, snapshot);
      journal.push({ section, outcome });
    }
    return { ok: false, journal };
  }

  attempted.push('settings');
  const settingsOutcome = await writeSettingsSection(deps, retagged.settings);
  journal.push({ section: 'settings', outcome: settingsOutcome });
  if (settingsOutcome === 'failed') return rollbackAttempted();

  attempted.push('roster');
  const rosterOutcome = await writeRosterSection(deps, retagged.roster);
  journal.push({ section: 'roster', outcome: rosterOutcome });
  if (rosterOutcome === 'failed') return rollbackAttempted();

  attempted.push('completedGames');
  const gamesOutcome = writeCompletedGamesSection(deps, retagged.completedGames);
  journal.push({ section: 'completedGames', outcome: gamesOutcome });
  if (gamesOutcome === 'failed') return rollbackAttempted();

  attempted.push('activeGame');
  const activeGameOutcome = writeActiveGameSection(deps, retagged.activeGame);
  journal.push({ section: 'activeGame', outcome: activeGameOutcome });
  if (activeGameOutcome === 'failed') return rollbackAttempted();

  // Taal is apparaatvoorkeur, geen teamdata (plan §D) — alleen toegepast als
  // aanwezig, nooit "geleegd" bij afwezigheid, en geen onderdeel van
  // rollback (een write hier kan niet falen: het is een synchrone
  // in-memory/localStorage-taalkeuze, geen repository-write met readback).
  if (retagged.lang !== undefined) {
    deps.setLang(retagged.lang);
    journal.push({ section: 'lang', outcome: 'written' });
  } else {
    journal.push({ section: 'lang', outcome: 'skipped' });
  }

  return { ok: true, journal };
}
