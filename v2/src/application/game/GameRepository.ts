import type { ActiveGame } from '../../domain/game/types';

export interface GameRepository {
  /** `null` als er (nog) geen actieve wedstrijd is voor deze organisatie/team. */
  read(): ActiveGame | null;
  /** Retourneert `false` als de opslag faalde (bijv. quota overschreden). */
  write(game: ActiveGame): boolean;
}
