import type { ActiveGame, CompletedGame } from '../../domain/game/types';

/**
 * PR 7.2a, P1-fix (externe review PR #61): duurzame lokale outbox voor een
 * afgeronde wedstrijd die nog niet cloud-bevestigd is. Zonder dit bestond
 * het `(ActiveGame, CompletedGame)`-paar dat `GameSyncCoordinator.finalize()`
 * nodig heeft alleen in een in-memory `Ref` in `app/App.tsx` — een
 * paginareload/crash tussen "lokaal archiveren" (`handleFinishGame()`) en een
 * voltooide `finalize()` verloor dan de enige bron om te hervatten (v2 kent
 * maar één actieve-wedstrijdslot, dus `gameRepo` is op dat moment al naar een
 * verse opzet gereset).
 *
 * `App.tsx` schrijft hierheen VÓÓRDAT het actieve-wedstrijdslot wordt
 * gereset, en leest deze poort bij elke (her)start om nog openstaande
 * afrondingen automatisch aan `finalize()` aan te bieden. Een entry wordt
 * verwijderd zodra `finalize()` `status:'idle'` teruggeeft (bevestigd, of al
 * eerder bevestigd — zie `GameSyncCoordinator.finalize()`'s server-
 * kortsluitingscheck) — nooit bij een tussentijdse fout, want dan is dit
 * juist de enige overgebleven retrybron.
 */
export interface PendingFinalizeEntry {
  game: ActiveGame;
  completed: CompletedGame;
}

export interface PendingFinalizeRepository {
  /** Alle nog openstaande afrondingen voor deze organisatie/team-context. */
  list(): PendingFinalizeEntry[];
  /** Voegt toe of overschrijft (op `completed.id`) een openstaande afronding. */
  add(entry: PendingFinalizeEntry): boolean;
  /** Verwijdert een entry na een bevestigde afronding. `true` als de sleutel er daarna niet meer is. */
  remove(completedGameId: string): boolean;
}
