import type { BackupEnvelope, BackupV2Data } from '../backup/types';
import { buildBackupPayload } from '../backup/export';
import type { LocalMigrationInventory } from './types';

/**
 * PR 7.4b (docs/pr-7.4-plan.md §C 7.4b werk 1: "Maak eerst een downloadbare
 * lokale herstelback-up"). Hergebruikt letterlijk PR 6.6's back-upformaat
 * (`domain/backup/export.ts` `buildBackupPayload()`) i.p.v. een tweede,
 * migratie-eigen exportformaat — plan §A: "Deze PR is geen tweede algemene
 * back-upimporter", maar de HERSTELBACK-UP is expliciet wél gewoon een
 * gewone v2-back-up (importeerbaar via de bestaande back-upflow, geen
 * migratie-specifieke kennis nodig om 'm terug te lezen).
 *
 * Neemt UITSLUITEND `status: 'ok'`-secties mee (spiegelt `BackupV2Data`'s
 * eigen "ontbrekende sectie = niet meenemen"-contract) — een `'corrupt'`-
 * sectie bereikt deze functie sowieso nooit (`preview.ts` weigert de HELE
 * preview al vóór 7.4b een run mag starten zodra íets corrupt is), en een
 * `'empty'`-sectie hoort niet thuis in de back-up (niets om te herstellen).
 * `activeGame: null` (expliciet geen actieve wedstrijd) wordt WEL
 * meegenomen als de sectie `'ok'` is — spiegelt `BackupV2Data`'s eigen
 * onderscheid tussen "afwezig" (niet meenemen) en "expliciet leeg"
 * (meenemen als `null`).
 */
export function buildMigrationRecoveryBackupData(inventory: LocalMigrationInventory): BackupV2Data {
  const data: BackupV2Data = {};
  if (inventory.settings.status === 'ok' && inventory.settings.value) {
    data.settings = inventory.settings.value;
  }
  if (inventory.roster.status === 'ok' && inventory.roster.value) {
    data.roster = inventory.roster.value;
  }
  if (inventory.activeGame.status === 'ok') {
    data.activeGame = inventory.activeGame.value;
  }
  if (inventory.completedGames.status === 'ok' && inventory.completedGames.value) {
    data.completedGames = inventory.completedGames.value;
  }
  return data;
}

/** Bouwt de volledige downloadbare envelop — `infrastructure/backup/downloadBackupFile.ts`
 * (ongewijzigd hergebruikt) verzorgt de daadwerkelijke `<a download>`-DOM-actie. */
export function buildMigrationRecoveryBackup(
  inventory: LocalMigrationInventory,
  now: Date = new Date(),
): BackupEnvelope {
  return buildBackupPayload(buildMigrationRecoveryBackupData(inventory), now, {
    organizationId: inventory.organizationId,
    teamId: inventory.teamId,
  });
}
