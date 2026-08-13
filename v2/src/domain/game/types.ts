/**
 * Spiegelt v1's per-wedstrijd `start`/`participate`-keuzes (index.html
 * `state.players`), maar met een eigen stabiele UUID (`id`) los van het
 * roster-ID (`rosterId`) — PR 6.1 vereist stabiele game-player-UUID's zodat
 * een latere roster-wijziging (naam/rugnummer/verwijderen) deze historische
 * snapshot niet aantast.
 */
export interface GamePlayer {
  id: string;
  rosterId: number;
  nr: string;
  naam: string;
  kl: string;
  vrouw: boolean;
  jeugd: boolean;
  /** "Meedoen"-toggle (v1: `participate`). */
  participate: boolean;
  /** "Start"-toggle (v1: `start`). */
  start: boolean;
}

export type GamePhase = 'setup' | 'tracking';

/** v1: `MAX_SCORE`/`MAX_MIN` (index.html regel 362). */
export const MAX_SCORE = 150;
export const MAX_CLOCK_MINUTES = 10;
export const MAX_CLOCK_SECONDS = MAX_CLOCK_MINUTES * 60;

/**
 * Eén afgesloten speelperiode (v1: een entry in `state.segments`). Heeft, in
 * tegenstelling tot v1, een eigen stabiele UUID — nodig om een segment in de
 * append-only actielog te kunnen identificeren (bewerken/verwijderen
 * refereren naar dit ID, niet naar een arrayindex zoals v1's `editSegIdx`,
 * wat instabiel zou zijn zodra acties uit volgorde verwerkt worden).
 */
export interface Segment {
  id: string;
  quarter: number;
  beginSec: number;
  endSec: number;
  durSec: number;
  /** GamePlayer.id's — exact 5. */
  lineup: string[];
  /** Punten voor/tegen tijdens dit segment (v1: `pf`/`pa`). */
  pf: number;
  pa: number;
  classSum: number;
  allowed: number;
  over: boolean;
}

/**
 * Elke bevestigde historische live-handeling als append-only actie met uniek
 * ID (docs/IMPLEMENTATION_PLAN.md §11, PR 6.2) — score en segmenten moeten
 * reproduceerbaar zijn uit deze acties (zie `domain/game/tracking.ts`
 * `deriveGameHistory()`), en dit is het lokale fundament voor de
 * Firestore-actielog van PR 7.1 (`games/{gameId}/actions/{actionId}`).
 *
 * Bewust NIET in deze log (blijven, net als in v1, direct gemuteerde en
 * meteen gepersisteerde "huidige stand"-velden op `ActiveGame` zelf, geen
 * actielog-entries — zie hieronder): de huidige opstelling (`onCourt`), het
 * lopende kwart en de begin/eind-kloktijd van het nog-open segment. Elk
 * segment slaat zijn eigen kwart/tijden al vast zodra het wordt opgeslagen —
 * dat historische feit staat dus al in `Segment`, ongeacht wat er daarna met
 * het "huidige" kwart/de klok gebeurt. Ook het live tikken/wisselen vóór
 * "Klaar met wisselen" (v1's `pendingSwapLineup`/`selected`) is bewust
 * ongepersisteerde, ongeconfirmde UI-state — pas het afsluiten van een
 * segment is een bevestigde handeling.
 */
export type GameAction =
  | { type: 'score-delta'; id: string; team: 'for' | 'against'; delta: number; at: string }
  | { type: 'score-set'; id: string; team: 'for' | 'against'; value: number; at: string }
  | { type: 'segment-saved'; id: string; segment: Segment; at: string }
  | { type: 'segment-edited'; id: string; segmentId: string; segment: Segment; at: string }
  | { type: 'segment-deleted'; id: string; segmentId: string; at: string };

/**
 * Actieve (nog niet afgeronde) wedstrijd. `phase: 'setup'` is PR 6.1-scope;
 * `phase: 'tracking'` (live scoren/wisselen/segmenten) is PR 6.2-scope.
 */
export interface ActiveGame {
  /** Stabiele wedstrijd-UUID (v1 had geen ID vóór afronding). */
  id: string;
  organizationId: string;
  teamId: string;
  phase: GamePhase;
  /** Historische spelersnapshot vanaf het moment van opzetten. */
  players: GamePlayer[];
  opponent: string;
  competition: string;
  clockDown: boolean;
  limitStr: string;
  /**
   * GamePlayer.id's van de huidige opstelling. Gevuld door `startGame()`;
   * daarna direct gemuteerd bij elke wissel (v1-pariteit: geen actielog-entry).
   */
  onCourt: string[];
  /** Huidig kwart (v1: `state.curQuarter`) — draaiveld, geen actielog-entry. */
  curQuarter: number;
  /**
   * Begin/eind (in seconden) van het nog-open segment (v1:
   * `state.beginMin`+`state.beginSec` / `state.endMin`+`state.endSec`).
   * Direct instelbaar door de gebruiker vóórdat een segment wordt
   * opgeslagen — draaiveld, geen actielog-entry.
   */
  beginSec: number;
  endSec: number;
  /** Append-only; leeg tot de eerste `tracking`-handeling. */
  actions: GameAction[];
  createdAt: string;
  startedAt: string | null;
}
