import type { AsyncSettingsRepository } from '../settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../roster/AsyncRosterRepository';
import type { GameRepository } from '../game/GameRepository';
import type { CompletedGameRepository } from '../game/CompletedGameRepository';
import { DEFAULT_SETTINGS, type Settings, type SettingsKey } from '../../domain/settings/types';
import type { Roster } from '../../domain/roster/types';
import { retagWithContext } from '../../domain/backup/migrateV1';
import type { BackupV2Data, ImportJournalEntry, ImportRunResult } from '../../domain/backup/types';
import type { Lang } from '../../i18n/strings';

/**
 * PR 6.6 §F 6.6b — orchestreert de daadwerkelijke import-writes NA
 * preview + expliciete bevestiging (plan §C.7-§C.10). Alle validatie is al
 * gebeurd (`domain/backup/parse.ts`); deze coordinator gaat er dus van uit
 * dat `data` al gevalideerd is. Bevat zelf geen DOM/storage-detail — die
 * blijft achter `AsyncSettingsRepository`/`GameRepository`/
 * `CompletedGameRepository` (de UI/App.tsx geeft de al-geresolvede
 * instanties door, precies zoals Settings/Roster/Stats/Trends dat al doen).
 */
export interface BackupCoordinatorDeps {
  settingsRepo: AsyncSettingsRepository;
  rosterRepo: AsyncRosterRepository;
  gameRepo: GameRepository;
  completedGameRepo: CompletedGameRepository;
  /** Dezelfde `syncStatus.saveSettings`/`saveRoster` als Settings/Roster al gebruiken —
   * respecteert zo automatisch lokale/cloudmodus (eigenaarsbesluit §E.3). */
  saveSettings: (
    payload: Settings & Record<string, unknown>,
    changedKeys?: readonly SettingsKey[],
  ) => Promise<boolean>;
  saveRoster: (payload: Roster) => Promise<boolean>;
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
  activeGame: ReturnType<GameRepository['read']>;
  completedGames: ReturnType<CompletedGameRepository['list']>;
}

/**
 * Legt de huidige doeldata vast VÓÓR er iets geschreven wordt (plan §C.10).
 * Leest rechtstreeks via de repositories i.p.v. te vertrouwen op eventueel
 * verouderde in-memory UI-state, zodat rollback altijd naar de daadwerkelijk
 * laatst-opgeslagen waarden teruggaat.
 */
export async function captureSnapshot(deps: BackupCoordinatorDeps): Promise<BackupSnapshot> {
  return {
    settings: await deps.settingsRepo.read(),
    roster: await deps.rosterRepo.read(),
    activeGame: deps.gameRepo.read(),
    completedGames: deps.completedGameRepo.list(),
  };
}

async function writeSettingsSection(
  deps: BackupCoordinatorDeps,
  settings: (Settings & Record<string, unknown>) | undefined,
): Promise<'written' | 'failed'> {
  const target = settings ?? (DEFAULT_SETTINGS as Settings & Record<string, unknown>);
  const ok = await deps.saveSettings(target);
  if (!ok) return 'failed';
  const readBack = await deps.settingsRepo.read();
  return readBack.teamName === target.teamName && readBack.quarterCount === target.quarterCount
    ? 'written'
    : 'failed';
}

async function writeRosterSection(
  deps: BackupCoordinatorDeps,
  roster: Roster | undefined,
): Promise<'written' | 'failed'> {
  const target = roster ?? [];
  const ok = await deps.saveRoster(target);
  if (!ok) return 'failed';
  const readBack = await deps.rosterRepo.read();
  return readBack.length === target.length ? 'written' : 'failed';
}

function writeActiveGameSection(
  deps: BackupCoordinatorDeps,
  activeGame: BackupV2Data['activeGame'],
): 'written' | 'failed' {
  const ok = activeGame ? deps.gameRepo.write(activeGame) : deps.gameRepo.clear();
  if (!ok) return 'failed';
  const readBack = deps.gameRepo.read();
  if (!activeGame) return readBack === null ? 'written' : 'failed';
  return readBack !== null && readBack.id === activeGame.id ? 'written' : 'failed';
}

function writeCompletedGamesSection(
  deps: BackupCoordinatorDeps,
  games: BackupV2Data['completedGames'],
): 'written' | 'failed' {
  const target = games ?? [];
  const ok = deps.completedGameRepo.replaceAll(target);
  if (!ok) return 'failed';
  const readBack = deps.completedGameRepo.list();
  return readBack.length === target.length ? 'written' : 'failed';
}

/**
 * Voert de import uit (plan §C.9): schrijft in vaste volgorde (settings →
 * roster → afgeronde wedstrijden → actieve wedstrijd → taal), verifieert
 * elke stap met een readback, en rolt bij de EERSTE fout alle al gelukte
 * stappen terug naar `snapshot` (best effort — een write die zelf ook
 * faalt tijdens de rollback wordt in het journaal als `'rolledBack'`-
 * poging vastgelegd met het onderliggende resultaat, nooit als vals
 * succes). Stopt na de eerste fout: geen "best effort"-vervolg op de
 * resterende secties (plan §B "niet in scope").
 */
export async function runImport(
  deps: BackupCoordinatorDeps,
  data: BackupV2Data,
  target: { organizationId: string; teamId: string },
  snapshot: BackupSnapshot,
): Promise<ImportRunResult> {
  const retagged = retagWithContext(data, target.organizationId, target.teamId);
  const journal: ImportJournalEntry[] = [];

  const settingsOutcome = await writeSettingsSection(deps, retagged.settings);
  journal.push({ section: 'settings', outcome: settingsOutcome });
  if (settingsOutcome === 'failed') {
    return { ok: false, journal };
  }

  const rosterOutcome = await writeRosterSection(deps, retagged.roster);
  journal.push({ section: 'roster', outcome: rosterOutcome });
  if (rosterOutcome === 'failed') {
    await writeSettingsSection(deps, snapshot.settings);
    journal.push({ section: 'settings', outcome: 'rolledBack' });
    return { ok: false, journal };
  }

  const gamesOutcome = writeCompletedGamesSection(deps, retagged.completedGames);
  journal.push({ section: 'completedGames', outcome: gamesOutcome });
  if (gamesOutcome === 'failed') {
    await writeSettingsSection(deps, snapshot.settings);
    journal.push({ section: 'settings', outcome: 'rolledBack' });
    await writeRosterSection(deps, snapshot.roster);
    journal.push({ section: 'roster', outcome: 'rolledBack' });
    return { ok: false, journal };
  }

  const activeGameOutcome = writeActiveGameSection(deps, retagged.activeGame);
  journal.push({ section: 'activeGame', outcome: activeGameOutcome });
  if (activeGameOutcome === 'failed') {
    await writeSettingsSection(deps, snapshot.settings);
    journal.push({ section: 'settings', outcome: 'rolledBack' });
    await writeRosterSection(deps, snapshot.roster);
    journal.push({ section: 'roster', outcome: 'rolledBack' });
    writeCompletedGamesSection(deps, snapshot.completedGames);
    journal.push({ section: 'completedGames', outcome: 'rolledBack' });
    return { ok: false, journal };
  }

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
