import type { ActiveGame } from '../../domain/game/types';

export interface GameRepository {
  /** `null` als er (nog) geen actieve wedstrijd is voor deze organisatie/team. */
  read(): ActiveGame | null;
  /** Retourneert `false` als de opslag faalde (bijv. quota overschreden). */
  write(game: ActiveGame): boolean;
  /**
   * Detecteert — zonder iets te schrijven of te markeren — een nog niet
   * bevestigd geadopteerde v1-actieve-wedstrijd, alvast getagd met de huidige
   * organisatie/teamcontext als vóórgesteld doel (zie
   * docs/IMPLEMENTATION_PLAN.md §11, PR 6.1-review, aug. 2026: v1 kende geen
   * organisatie/teamcontext, dus de code kan zelf niet bewijzen welk team het
   * juiste doel is — daarom eerst tonen/laten bevestigen, i.p.v. stilzwijgend
   * aan het eerst-geopende team toewijzen). `null` als er niets is, de
   * wedstrijd niet hervatbaar was (zie `migrateV1ActiveGame`), of de migratie
   * al eerder (door willekeurig welk team) bevestigd is.
   */
  detectV1Migration(): ActiveGame | null;
  /**
   * Bevestigt een eerder gedetecteerde v1-migratie: schrijft 'm onder de
   * huidige organisatie/teamsleutel en markeert de migratie globaal als
   * afgehandeld (vastlegt óók het doel, voor diagnose) zodat geen ander team
   * 'm nog kan claimen. Retourneert `false` als de opslag faalde — dan blijft
   * de migratie onbevestigd en kan een latere poging het opnieuw proberen.
   */
  confirmV1Migration(game: ActiveGame): boolean;
}
