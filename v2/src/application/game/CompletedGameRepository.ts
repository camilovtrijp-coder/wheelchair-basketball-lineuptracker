import type { CompletedGame } from '../../domain/game/types';

export interface CompletedGameRepository {
  /** Nieuwste eerst (v1-pariteit: `games.unshift(...)`). Lege array als er nog niets is. */
  list(): CompletedGame[];
  /**
   * Voegt een net afgeronde wedstrijd vooraan toe. `false` als de opslag
   * faalde (bijv. quota overschreden) of `game` niet bij deze
   * organisatie/team hoort.
   */
  add(game: CompletedGame): boolean;
  /**
   * Verwijdert de wedstrijd met dit ID (v1: direct, geen tombstone — zie
   * docs/pr-6.3-plan.md §D). `false` als de opslag faalde; ontbreekt het ID
   * al, dan is dit een no-op die `true` teruggeeft.
   */
  remove(id: string): boolean;
}
