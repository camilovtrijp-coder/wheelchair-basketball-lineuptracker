import type { CloudExistingSnapshot } from '../../domain/migration/types';

/**
 * PR 7.4a (docs/pr-7.4-plan.md §C 7.4a): application-poort — leest
 * UITSLUITEND (nooit schrijven, zie plan §D "geen automatische migratie")
 * het bestaande clouditemsnapshot van de DOELcontext, zodat
 * `domain/migration/preview.ts` conflicten/duplicaten kan herkennen.
 * Geïmplementeerd door
 * `infrastructure/migration/FirestoreCloudMigrationInventoryGateway.ts`.
 * Rules-toegang is ongewijzigd `canReadTeam` (settings/roster/games/
 * completedGames staan al vóór PR 7.4a voor elke teamrol — inclusief
 * 'viewer' — open, zie firebase/firestore.rules) — geen nieuwe Rules nodig.
 *
 * `activeGameId` is optioneel: alleen bekend als de brон een `setup`- of
 * `tracking`-fase actieve wedstrijd heeft (het bron-`ActiveGame.id`, dat
 * ook het beoogde doel-ID is, zie `domain/migration/fingerprint.ts`) —
 * zonder lokale actieve wedstrijd is er niets om op te zoeken.
 */
export interface CloudMigrationInventoryGateway {
  readTargetSnapshot(
    organizationId: string,
    teamId: string,
    completedGameIds: readonly string[],
    activeGameId: string | null,
  ): Promise<CloudExistingSnapshot>;
}
