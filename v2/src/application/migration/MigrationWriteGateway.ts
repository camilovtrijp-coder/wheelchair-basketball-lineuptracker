import type { Settings } from '../../domain/settings/types';
import type { Roster } from '../../domain/roster/types';
import type { CompletedGame } from '../../domain/game/types';

/**
 * PR 7.4b (docs/pr-7.4-plan.md §C 7.4b werk 2/3): application-poort voor de
 * DAADWERKELIJKE itemwrite van één migratie-item. Werk 3 eist expliciet
 * "Hergebruik settings/roster-contracten uit 5.3, completed-gameflow uit 7.2
 * en writeradoptie uit 7.3. Maak geen tweede afwijkend Firestorepad." — de
 * implementatie hiervan (`infrastructure/migration/FirestoreMigrationWriteGateway.ts`)
 * componeert daarom UITSLUITEND bestaande gateways/repositories
 * (`FirestoreSettingsRepository`/`FirestoreRosterRepository`/
 * `GameCloudGateway`), zij schrijft zelf geen enkele nieuwe rauwe
 * `setDoc()`/`updateDoc()`-aanroep.
 *
 * Elke methode doet zelf de "server readback" (werk 2: "na elke stap
 * serverreadback en checkpoint") en geeft de BEVESTIGDE payloadhash terug —
 * de coordinator schrijft die pas naar het checkpoint ná deze bevestiging,
 * nooit optimistisch vooraf.
 */
export interface MigrationItemWriteResult {
  ok: boolean;
  /** Aanwezig bij `ok: true`: de server-bevestigde payloadhash (`domain/migration/payload.ts`-formaat). */
  confirmedHash?: string;
  error?: unknown;
}

export interface MigrationWriteGateway {
  /**
   * Schrijft settings naar `target`. GEEN Firestore create-only-bescherming
   * bestaat voor dit pad (settings/roster kennen, anders dan games/
   * completedGames, geen optimistische-concurrencyveld in firestore.rules —
   * zie de docstring van `MigrationCoordinator`'s werk-4-recheck voor de
   * volledige toelichting van dit bewuste, bestaande gat). De aanroeper
   * (coordinator) MOET daarom altijd EERST een verse `existingHash`-recheck
   * doen (via `CloudMigrationInventoryGateway.readTargetSnapshot()`) en
   * alleen bij `'create'`/`'alreadyPresentIdentical'` hierheen schrijven —
   * deze methode zelf doet geen eigen conflictdetectie, dat is bewust
   * exclusief coordinator-verantwoordelijkheid (één plek, geen dubbele
   * beslisboom).
   */
  writeSettings(
    organizationId: string,
    teamId: string,
    settings: Settings & Record<string, unknown>,
  ): Promise<MigrationItemWriteResult>;
  writeRoster(
    organizationId: string,
    teamId: string,
    roster: Roster,
  ): Promise<MigrationItemWriteResult>;
  /**
   * Schrijft één afgeronde wedstrijd naar `target` — hergebruikt de 7.2-
   * completed-gameflow (`GameCloudGateway.ensureGame()` +
   * (indien nodig) `claimWriter()` + `finalizeCompletedGame()`), NIET
   * `GameSyncCoordinator.finalize()` zelf (die verwacht een volledige
   * `ActiveGame` met een actielog om te synchroniseren — een migratie-bron
   * is altijd al een BEVROREN `CompletedGame`, zonder actielog om te
   * uploaden). De synthetische `games/{sourceGameId}`-parent die hiervoor
   * ontstaat is bewust GEEN nieuw Firestorepad: het is exact hetzelfde
   * `games/{gameId}`-document dat 7.1/7.2 al kennen, alleen met een door
   * `projectMigratedGameParentSnapshot()` (deze module) afgeleide
   * inhoud i.p.v. een levende `ActiveGame` — nodig omdat
   * firestore.rules' `completedGames`-createregel een parentdocument met
   * DEZE aanroeper als writer eist (punt 16/17), ongeacht of de wedstrijd
   * ooit live via 7.1/7.3 is getrackt.
   */
  writeCompletedGame(
    organizationId: string,
    teamId: string,
    game: CompletedGame,
    writer: { authorUid: string; deviceId: string },
    now: string,
  ): Promise<MigrationItemWriteResult>;
  /**
   * Compenseert een reeds geschreven `completedGame`-item (§B: "reeds
   * geschreven migratie-items worden veilig gecompenseerd of getombstoned")
   * — dunne doorgeefluik naar `GameCloudGateway.tombstoneCompletedGame()`
   * (PR 7.2c-precedent, exact dezelfde tombstone-fieldpatch, geen tweede
   * verwijdermechanisme).
   */
  compensateCompletedGame(
    organizationId: string,
    teamId: string,
    completedGameId: string,
    deletedBy: string,
  ): Promise<MigrationItemWriteResult>;
}
