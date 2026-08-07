import type { Roster } from '../../domain/roster/types';
import type { RosterRepository } from './RosterRepository';
import type { AsyncRosterRepository } from './AsyncRosterRepository';
import type { KeyValueStorage } from '../../i18n/persistence';
import { markCloudImported } from '../../infrastructure/cloudImportFlag';

export function getRoster(repo: RosterRepository): Roster {
  return repo.read();
}

export function saveRoster(repo: RosterRepository, players: Roster): boolean {
  return repo.write(players);
}

export interface CloudMigrationResult {
  ok: boolean;
  imported: boolean;
  errors: string[];
}

/**
 * Kopieert de v1-roster uit `local` (sync localStorage) één keer naar de
 * Firestore-adapter `cloud`, zonder de v1-key aan te raken. Strikt
 * éénrichtingsverkeer (zie docs/pr-5.3-plan.md §C/5.3b): geen automatische
 * v1→cloud-resync, geen terugschrijven van cloud naar v1, geen delete van
 * `lineup-tracker-roster` — de lokale kopie blijft beschikbaar als vangnet
 * (zie AGENTS.md §3).
 *
 * Bij geslaagde cloud-write wordt een aparte UI-hint-vlag gezet
 * (`lineup-tracker-cloud-imported-roster`) zodat de banner niet opnieuw
 * verschijnt. Die vlag raakt de v1-data niet.
 */
/**
 * Async tegenhangers van getRoster/saveRoster (PR 5.3c-1) — zie de
 * uitgebreidere toelichting bij application/settings/usecases.ts. Roster
 * heeft geen reset-usecase (RosterRepository/AsyncRosterRepository kennen
 * geen reset(), RosterPanel heeft geen resetknop).
 */
export async function getRosterAsync(repo: AsyncRosterRepository): Promise<Roster> {
  return repo.read();
}

export async function saveRosterAsync(
  repo: AsyncRosterRepository,
  players: Roster,
): Promise<boolean> {
  const result = await repo.write(players);
  return result.ok;
}

export async function migrateLocalStorageToCloud(
  local: RosterRepository,
  cloud: AsyncRosterRepository,
  storage: KeyValueStorage,
): Promise<CloudMigrationResult> {
  const players = local.read();
  const result = await cloud.write(players);
  if (!result.ok) {
    return { ok: false, imported: false, errors: [`syncState: ${result.syncState.status}`] };
  }
  // Zie de uitgebreidere toelichting bij application/settings/usecases.ts:
  // een eenmalige migratie moet op `settled` wachten, niet op het meteen-
  // geaccepteerde write()-resultaat (PR 5.3d-schrijfcontract).
  const settled = await result.settled;
  if (settled.ok) {
    markCloudImported(storage, 'roster');
  }
  return {
    ok: settled.ok,
    imported: settled.ok,
    errors: settled.ok ? [] : [`settled: actie-nodig`],
  };
}
