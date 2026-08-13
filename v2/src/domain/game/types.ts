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

/**
 * Actieve (nog niet afgeronde) wedstrijd. `phase: 'setup'` is PR 6.1-scope;
 * `phase: 'tracking'` bestaat als toestand (v1-pariteit voor de
 * fase-overgang bij `startGame`) maar krijgt pas een eigen live-scherm in
 * PR 6.2 — tot die tijd toont de UI een plaatshoudertekst.
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
  /** GamePlayer.id's; leeg tijdens `setup`, gevuld door `startGame()`. */
  onCourt: string[];
  createdAt: string;
  startedAt: string | null;
}
