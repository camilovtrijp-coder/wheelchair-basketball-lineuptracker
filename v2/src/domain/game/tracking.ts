import {
  MAX_CLOCK_SECONDS,
  MAX_SCORE,
  type ActiveGame,
  type GameAction,
  type GamePlayer,
  type Segment,
} from './types';

function newId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Classificatie-instellingen die de tracking-domeinlaag nodig heeft — een smalle
 * projectie van `Settings`, zodat dit domein niet van `domain/settings` afhangt. */
export interface ClassificationConfig {
  useClassLimit: boolean;
  classBaseLimit: number;
  maxBonus: number;
  bonusTag1Only: number;
  bonusTag2Only: number;
  bonusBoth: number;
}

/** v1: `playerBonus()`. */
export function playerBonus(player: GamePlayer | undefined, config: ClassificationConfig): number {
  if (!config.useClassLimit || !player) return 0;
  if (player.vrouw) return player.jeugd ? config.bonusBoth : config.bonusTag1Only;
  return player.jeugd ? config.bonusTag2Only : 0;
}

/** v1: `limitVal()`. */
export function limitVal(game: ActiveGame, config: ClassificationConfig): number {
  if (!config.useClassLimit) return 0;
  const v = parseFloat(game.limitStr);
  return Number.isNaN(v) ? config.classBaseLimit : v;
}

/** v1: `sumClass()`. */
export function sumClass(game: ActiveGame, lineup: string[], config: ClassificationConfig): number {
  if (!config.useClassLimit) return 0;
  return lineup.reduce((sum, id) => {
    const p = game.players.find((pl) => pl.id === id);
    const v = p ? parseFloat(p.kl) : NaN;
    return sum + (Number.isNaN(v) ? 0 : v);
  }, 0);
}

/** v1: `sumBonus()`. */
export function sumBonus(game: ActiveGame, lineup: string[], config: ClassificationConfig): number {
  if (!config.useClassLimit) return 0;
  const total = lineup.reduce((sum, id) => {
    const p = game.players.find((pl) => pl.id === id);
    return sum + playerBonus(p, config);
  }, 0);
  return Math.min(config.maxBonus, total);
}

/** Overschrijdt de opstelling de classificatiegrens? v1: `courtOver`/segment `over`. */
export function isOverLimit(
  game: ActiveGame,
  lineup: string[],
  config: ClassificationConfig,
): { sum: number; allowed: number; over: boolean } {
  const sum = sumClass(game, lineup, config);
  const allowed = limitVal(game, config) + sumBonus(game, lineup, config);
  return { sum, allowed, over: sum > allowed + 0.001 };
}

function clampScore(v: number): number {
  return Math.max(0, Math.min(MAX_SCORE, v));
}

/** v1: het gedeelte van `startGame()`/`selectQuarter()` dat begin/eind reset. */
export function initialClockSeconds(clockDown: boolean): number {
  return clockDown ? MAX_CLOCK_SECONDS : 0;
}

/**
 * v1: `selectQuarter()`. Wisselt het kwart; reset begin/eind naar het
 * startpunt van de klok alleen als het kwart daadwerkelijk verandert (bij
 * opnieuw hetzelfde kwart kiezen blijft de lopende segmenttijd staan).
 */
export function selectQuarter(
  game: ActiveGame,
  quarter: number,
): Pick<ActiveGame, 'curQuarter' | 'beginSec' | 'endSec'> {
  if (quarter === game.curQuarter) {
    return { curQuarter: game.curQuarter, beginSec: game.beginSec, endSec: game.endSec };
  }
  const begin = initialClockSeconds(game.clockDown);
  return { curQuarter: quarter, beginSec: begin, endSec: begin };
}

/**
 * Uit de actielog afgeleide wedstrijdhistorie (v1: `state.segments`/
 * `state.scoreFor`/`state.scoreAgainst`/`state.segStartFor`/
 * `state.segStartAgainst`). Het huidige kwart en de begin/eind-kloktijd van
 * het nog-open segment zijn bewust GEEN onderdeel hiervan — die blijven
 * gewone, direct gemuteerde velden op `ActiveGame` (zie types.ts).
 */
export interface DerivedGameHistory {
  scoreFor: number;
  scoreAgainst: number;
  segStartFor: number;
  segStartAgainst: number;
  segments: Segment[];
}

/** Geëxporteerd voor hergebruik door `deriveGameStateFromCloud.ts` (PR 7.3b)
 * — de viewer vouwt cloud-actionenvelopes samen met dezelfde `applyAction()`-
 * reducer vanaf hetzelfde startpunt, geen tweede afgeleide leegstartwaarde. */
export const EMPTY_HISTORY: DerivedGameHistory = {
  scoreFor: 0,
  scoreAgainst: 0,
  segStartFor: 0,
  segStartAgainst: 0,
  segments: [],
};

/**
 * v1: `recalcRunningScore()`. Herberekent de lopende score na een
 * segmentbewerking/-verwijdering: het al opgebouwde (nog niet in een segment
 * vastgelegde) scoreverschil sinds het laatste segment blijft behouden, de
 * som van alle segmenten wordt opnieuw de basis.
 */
function recalcRunningScore(state: DerivedGameHistory): DerivedGameHistory {
  const liveFor = state.scoreFor - state.segStartFor;
  const liveAgainst = state.scoreAgainst - state.segStartAgainst;
  const sumFor = state.segments.reduce((a, s) => a + s.pf, 0);
  const sumAgainst = state.segments.reduce((a, s) => a + s.pa, 0);
  return {
    ...state,
    segStartFor: sumFor,
    segStartAgainst: sumAgainst,
    scoreFor: sumFor + liveFor,
    scoreAgainst: sumAgainst + liveAgainst,
  };
}

/** Pure reducer: past één bevestigde actie toe op de afgeleide historie (v1-pariteit, zie GameAction). */
export function applyAction(state: DerivedGameHistory, action: GameAction): DerivedGameHistory {
  switch (action.type) {
    case 'score-delta': {
      const cur = action.team === 'for' ? state.scoreFor : state.scoreAgainst;
      const next = clampScore(cur + action.delta);
      return action.team === 'for'
        ? { ...state, scoreFor: next }
        : { ...state, scoreAgainst: next };
    }
    case 'score-set': {
      const next = clampScore(action.value);
      return action.team === 'for'
        ? { ...state, scoreFor: next }
        : { ...state, scoreAgainst: next };
    }
    case 'segment-saved':
      return {
        ...state,
        segments: [...state.segments, action.segment],
        segStartFor: state.scoreFor,
        segStartAgainst: state.scoreAgainst,
      };
    case 'segment-edited':
      return recalcRunningScore({
        ...state,
        segments: state.segments.map((s) => (s.id === action.segmentId ? action.segment : s)),
      });
    case 'segment-deleted':
      return recalcRunningScore({
        ...state,
        segments: state.segments.filter((s) => s.id !== action.segmentId),
      });
  }
}

/** Vouwt alle acties van een wedstrijd samen tot de huidige historie. */
export function deriveGameHistory(game: ActiveGame): DerivedGameHistory {
  return game.actions.reduce(applyAction, EMPTY_HISTORY);
}

/** v1: `segDur()` — duur van het nog-open segment, in seconden. */
export function segDur(game: ActiveGame): number {
  return game.clockDown ? game.beginSec - game.endSec : game.endSec - game.beginSec;
}

/** v1: de guard binnen `saveSegment()`: positieve duur + exact 5 spelers. */
export function canSaveSegment(dur: number, lineup: string[]): boolean {
  return dur > 0 && lineup.length === 5;
}

// ---------- actiebouwers (elk met eigen UUID + tijdstip) ----------

export function scoreDeltaAction(team: 'for' | 'against', delta: number): GameAction {
  return { type: 'score-delta', id: newId(), team, delta, at: nowIso() };
}

export function scoreSetAction(team: 'for' | 'against', value: number): GameAction {
  return { type: 'score-set', id: newId(), team, value: clampScore(value), at: nowIso() };
}

/**
 * Bouwt een nieuw, af te sluiten segment (v1: het object dat `saveSegment()`
 * naar `state.segments` pusht). `pf`/`pa` zijn de scoredelta's sinds het
 * vorige segment — de aanroeper geeft `history.scoreFor - history.segStartFor`
 * etc. mee, zodat deze functie zelf geen `DerivedGameHistory` hoeft te kennen.
 */
export function buildSegment(
  game: ActiveGame,
  quarter: number,
  beginSec: number,
  endSec: number,
  lineup: string[],
  pf: number,
  pa: number,
  config: ClassificationConfig,
): Segment {
  const { sum, allowed, over } = isOverLimit(game, lineup, config);
  return {
    id: newId(),
    quarter,
    beginSec,
    endSec,
    durSec: Math.abs(endSec - beginSec),
    lineup: [...lineup],
    pf,
    pa,
    classSum: sum,
    allowed,
    over,
  };
}

export function segmentSavedAction(segment: Segment): GameAction {
  return { type: 'segment-saved', id: newId(), segment, at: nowIso() };
}

export function segmentEditedAction(segmentId: string, segment: Segment): GameAction {
  return { type: 'segment-edited', id: newId(), segmentId, segment, at: nowIso() };
}

export function segmentDeletedAction(segmentId: string): GameAction {
  return { type: 'segment-deleted', id: newId(), segmentId, at: nowIso() };
}

// ---------- opstelling (blijft, net als v1, direct gemuteerd — geen actie) ----------

/** v1: de wisselstap in `tapPlayer()` — verwisselt precies één court/bank-paar. */
export function swapOnCourt(
  onCourt: string[],
  courtPlayerId: string,
  benchPlayerId: string,
): string[] {
  return onCourt.map((id) => (id === courtPlayerId ? benchPlayerId : id));
}
