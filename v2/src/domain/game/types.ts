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
 * lopende kwart, de begin/eind-kloktijd van het nog-open segment en de
 * pre-wissel-snapshot (`pendingSwapLineup`). Elk segment slaat zijn eigen
 * kwart/tijden al vast zodra het wordt opgeslagen — dat historische feit
 * staat dus al in `Segment`, ongeacht wat er daarna met het "huidige" kwart/
 * de klok gebeurt.
 *
 * `pendingSwapLineup` wijkt hierin bewust af van v1: in v1 is dit een puur
 * ongepersisteerde JS-variabele, dus een reload/crash tijdens een nog niet
 * bevestigd blokje wissels verliest de grens tussen "vóór" en "ná" de wissel
 * — het eerstvolgende opgeslagen segment gebruikt dan stilzwijgend de al
 * gewisselde opstelling voor de hele duur. v2 bewaart deze snapshot wél
 * (direct gemuteerd, net als `onCourt`), zodat zo'n crash geen bevestigde
 * segmentgrens meer kan verminken — alleen het lopende tikken/selecteren zelf
 * (`selected`, welke speler op dit moment is aangetikt) blijft ongepersisteerde
 * UI-state, want dat is nooit meer dan een cursor zonder betekenis op zichzelf.
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
  /**
   * Snapshot van `onCourt` van vóór het huidige, nog niet bevestigde blokje
   * wissels (v1: `pendingSwapLineup`) — `null` zolang er geen wissel loopt.
   * Zie de toelichting bij `GameAction` hierboven voor waarom dit veld, in
   * tegenstelling tot v1, wél gepersisteerd wordt.
   */
  pendingSwapLineup: string[] | null;
  /** Append-only; leeg tot de eerste `tracking`-handeling. */
  actions: GameAction[];
  createdAt: string;
  startedAt: string | null;
}

/**
 * Afgeronde, standaard onveranderlijke wedstrijd (v1: een entry in `games`,
 * index.html `finishGame()`). PR 6.3 kiest bewust de v2-natuurlijke vorm
 * (UUID, organisatie/teamcontext, volledige `GamePlayer`-snapshot) in plaats
 * van v1's exacte vorm (`"g"+Date.now()`-string-ID, 6-veld-spelersnapshot,
 * geen organisatie/teamcontext) — zie docs/pr-6.3-plan.md §E.2. `segments`/
 * `scoreFor`/`scoreAgainst` zijn de bevroren uitkomst van
 * `deriveGameHistory()` op het moment van afronden (`domain/game/finish.ts`);
 * `quarterCount`/`periodLabel`/`useClassLimit` zijn op dat moment overgenomen
 * uit de toen actuele instellingen, want `ActiveGame` bewaart die zelf niet
 * (zie hierboven) — zo blijft een CSV/detailweergave van een oude wedstrijd
 * ongewijzigd als de instellingen later veranderen (v1-pariteit).
 */
export interface CompletedGame {
  id: string;
  organizationId: string;
  teamId: string;
  /**
   * `ActiveGame.id` waaruit deze snapshot is afgerond (externe PR-6.3-review,
   * aug. 2026). Nodig om afronden crash-/fout-idempotent te maken: zonder dit
   * veld kan dezelfde `ActiveGame` — als de reset naar een verse opzet na het
   * archiveren niet lukt of de app tussentijds crasht — bij een volgende
   * poging tot afronden een tweede, dubbele `CompletedGame` opleveren. Zie
   * `app/App.tsx` (`handleFinishGame`, en de resume-check die een al
   * gearchiveerde `ActiveGame` nooit opnieuw als 'tracking' hervat).
   */
  sourceGameId: string;
  opponent: string;
  competition: string;
  /** ISO-tijdstip van afronden (v1: `date`). */
  date: string;
  players: GamePlayer[];
  segments: Segment[];
  scoreFor: number;
  scoreAgainst: number;
  quarterCount: number;
  periodLabel: string;
  useClassLimit: boolean;
  /**
   * PR 7.2c (docs/pr-7.2-plan.md §C 7.2c): optimistische-concurrencyteller
   * voor de tombstone-fieldpatch, spiegelt `ActiveGame`/`GameDocument`'s
   * `revision`. `0` bij aanmaken (create); een tombstone-patch verhoogt 'm
   * met exact 1. Alleen relevant in cloud-modus — een puur lokale
   * `CompletedGame` (nooit geüpload) heeft geen serverrevisie nodig, maar
   * draagt dit veld toch al vanaf aanmaak zodat een latere cloud-upload geen
   * apart migratiepad nodig heeft.
   */
  revision: number;
  /**
   * PR 7.2c: `null` tot een owner/admin/coach de wedstrijd verwijdert. Een
   * tombstone-patch zet dit (en `deletedBy`) op de server; de bevroren
   * wedstrijdinhoud zelf blijft ongewijzigd (§B: "een historie-item is na
   * afronding inhoudelijk onveranderlijk"). Een getombstoned item verdwijnt
   * uit Historie/Stats/Trends (`CompositeCompletedGameRepository`), maar het
   * document zelf wordt nooit hard verwijderd of automatisch gepurged vóór
   * PR 8.3 — dit veld blijft dus de enige plek waar "verwijderd" vastligt,
   * exporteerbaar/auditbaar zolang het document bestaat.
   */
  deletedAt: string | null;
  /** PR 7.2c: uid van de gebruiker die de tombstone-patch zette; `null` tot dan. */
  deletedBy: string | null;
}
