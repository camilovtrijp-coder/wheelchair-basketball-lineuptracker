import type { GameSyncCheckpoint } from '../../domain/game/syncCheckpoint';

/**
 * Lokale poort voor het per-wedstrijd synccheckpoint (PR 7.1a,
 * docs/pr-7.1-plan.md §B/§C 7.1a). Puur lokaal, geen Firestore-afhankelijkheid
 * — spiegelt het patroon van `GameRepository` (zelfde synchrone, boolean-
 * faalcontract). De localStorage-implementatie en de eerste daadwerkelijke
 * schrijver (`GameSyncCoordinator`) volgen in PR 7.1c; deze PR levert alleen
 * de poort.
 */
export interface GameSyncCheckpointRepository {
  /** `null` als er nog geen checkpoint bestaat voor deze wedstrijd. */
  read(gameId: string): GameSyncCheckpoint | null;
  /** Retourneert `false` als de lokale opslag faalde (bijv. quota overschreden). */
  write(checkpoint: GameSyncCheckpoint): boolean;
  /** Verwijdert het checkpoint. `true` als de sleutel na de call niet meer bestaat. */
  clear(gameId: string): boolean;
}
