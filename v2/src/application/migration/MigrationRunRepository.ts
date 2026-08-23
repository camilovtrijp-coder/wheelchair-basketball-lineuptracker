import type { MigrationRun } from '../../domain/migration/run';

/**
 * PR 7.4b (docs/pr-7.4-plan.md §C 7.4b werk 1/2): lokale poort voor de
 * hervatbare migratierun — spiegelt `GameSyncCheckpointRepository`/
 * `PendingFinalizeRepository`'s synchrone, boolean-faalcontract. Sleutel is
 * de DOELcontext (`organizationId`/`teamId`), niet `runId`: er is per
 * doelteam maximaal één actieve (nog niet voltooide) run tegelijk relevant
 * voor "hervat na reload" (spiegelt `GameRepository`'s "maar één actieve
 * wedstrijdslot"-aanname) — `MigrationCoordinator.resumeOrCreateRun()`
 * bewaakt zelf of een bestaande run bij dezelfde `manifestHash` hoort.
 */
export interface MigrationRunRepository {
  /** `null` als er geen lokale run bekend is voor deze doelcontext. */
  read(organizationId: string, teamId: string): MigrationRun | null;
  /** Retourneert `false` als de lokale opslag faalde (bijv. quota overschreden). */
  write(run: MigrationRun): boolean;
  /**
   * Verwijdert de lokale run. UITSLUITEND bedoeld voor een expliciete
   * "nieuwe migratie starten na een voltooide/afgebroken run"-actie
   * (7.4c-scope) — de coordinator zelf roept dit NOOIT aan (plan werk 5:
   * "verwijder de lokale bron nooit automatisch" — dit ruimt het
   * RUN-checkpoint op, nooit de gemigreerde brondata zelf, maar ook dát
   * gebeurt bewust nooit impliciet).
   */
  clear(organizationId: string, teamId: string): boolean;
}
