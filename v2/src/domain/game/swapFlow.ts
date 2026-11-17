import {
  clockDuration,
  confirmSwap,
  isValidClockSeconds,
  type LiveCommandError,
} from './liveCommands';
import { plannedEndSec, quarterEndSec, type RotationPlan } from './rotationPlan';
import {
  buildSegment,
  deriveGameHistory,
  scoreDeltaAction,
  segmentDeletedAction,
  segmentEditedAction,
  segmentSavedAction,
  turnoverDeltaAction,
  type ClassificationConfig,
} from './tracking';
import type { ActiveGame, GameAction, Segment } from './types';

/**
 * Rustig-bouwplan R1 (docs/wedstrijdscherm-rustig-bouwplan.md §1, §2): pure
 * domeincommando's voor "eerst wisselen, tijd achteraf", ongedaan maken van de
 * laatste actie en een wissel met terugwerkende kracht. Geen opslag, geen DOM,
 * geen netwerk, geen wijziging aan het datacontract: alles loopt via de
 * bestaande actietypes (`segment-saved`, `segment-edited`, `segment-deleted`,
 * `score-delta`, `turnover-delta`) en de draaiveld-velden van `ActiveGame`.
 * Welke tijden nog onbevestigd zijn, is lokale UI-toestand
 * (`infrastructure/game/swapFlowStore.ts`), nooit onderdeel van `ActiveGame`.
 */

export type SwapFlowError =
  | LiveCommandError
  /** Er is geen (ongedaan te maken) laatste actie. */
  | 'nothing-to-undo'
  /** De gekozen grens voor een wissel met terugwerkende kracht is niet toepasbaar. */
  | 'invalid-split';

function fail(error: SwapFlowError): { ok: false; error: SwapFlowError } {
  return { ok: false, error };
}

// ---------- 1. wissel met voorlopige tijd ----------

/** Eén minuut: stap van de voorstelwaarde buiten het schema. */
export const PROVISIONAL_SWAP_STEP_SEC = 60;

export type SwapTimeSource = 'plan' | 'estimate' | 'given';

export interface SwapTimeProposal {
  endSec: number;
  /** `plan` = geplande wisseltijd uit het schema; `estimate` = vorige wissel + 1:00 (begrensd tot kwarteinde). */
  source: 'plan' | 'estimate';
}

/**
 * Voorstelwaarde voor de wisseltijd: de geplande tijd uit het schema als die er
 * is (en na het begin van het open segment ligt), anders de tijd van de vorige
 * wissel (= `game.beginSec`) + 1:00 in de klokrichting, begrensd tot het einde
 * van het kwart. Ligt het begin al op het kwarteinde, dan is de uitkomst gelijk
 * aan het begin (duur 0; `confirmSwap` legt dan geen segment vast).
 */
export function proposeSwapTime(game: ActiveGame, plan: RotationPlan | null): SwapTimeProposal {
  if (plan != null) {
    const planned = plannedEndSec(game, plan);
    if (planned != null) return { endSec: planned, source: 'plan' };
  }
  const end = quarterEndSec(game.clockDown);
  const stepped = game.clockDown
    ? Math.max(end, game.beginSec - PROVISIONAL_SWAP_STEP_SEC)
    : Math.min(end, game.beginSec + PROVISIONAL_SWAP_STEP_SEC);
  return { endSec: stepped, source: 'estimate' };
}

export interface CommitSwapInput {
  /** Schema voor de voorstelwaarde; `null` = geen schema. */
  plan: RotationPlan | null;
  /** Expliciet gekozen eindtijd; ontbreekt = `proposeSwapTime`. */
  endSec?: number;
  scoreFor?: number;
  scoreAgainst?: number;
  scoreAtOpen?: { for: number; against: number };
  classification: ClassificationConfig;
}

export type SwapCommitResult =
  | {
      ok: true;
      game: ActiveGame;
      /** Het vastgelegde segment; `null` bij duur 0 (alleen het concept is gesloten). */
      segmentId: string | null;
      endSec: number;
      timeSource: SwapTimeSource;
      /** Alleen een schatting (`estimate`) moet nog bevestigd worden; een schematijd geldt direct. */
      needsConfirmation: boolean;
      /** Id van de laatst toegevoegde actie, voor het blokkeren van "ongedaan maken" bij herladen. */
      lastActionId: string | null;
    }
  | { ok: false; error: SwapFlowError };

function lastAction(game: ActiveGame): GameAction | undefined {
  return game.actions[game.actions.length - 1];
}

/**
 * Wissel uitvoeren: legt het open segment direct vast (oude opstelling =
 * `pendingSwapLineup`) met de schematijd, de opgegeven tijd of de schatting
 * vorige wissel + 1:00. Punten en turnovers worden meteen goed toegewezen; alleen
 * de tijd is mogelijk voorlopig (`needsConfirmation`).
 */
export function commitSwapWithProvisionalTime(
  game: ActiveGame,
  input: CommitSwapInput,
): SwapCommitResult {
  const proposal = input.endSec === undefined ? proposeSwapTime(game, input.plan) : null;
  const endSec = input.endSec ?? proposal?.endSec ?? game.beginSec;
  const timeSource: SwapTimeSource = proposal?.source ?? 'given';
  const result = confirmSwap(game, {
    endSec,
    scoreFor: input.scoreFor,
    scoreAgainst: input.scoreAgainst,
    scoreAtOpen: input.scoreAtOpen,
    classification: input.classification,
  });
  if (!result.ok) return result;
  const added = result.game.actions.length > game.actions.length;
  const last = added ? lastAction(result.game) : undefined;
  return {
    ok: true,
    game: result.game,
    segmentId: last?.type === 'segment-saved' ? last.segment.id : null,
    endSec,
    timeSource,
    needsConfirmation: timeSource === 'estimate' && last?.type === 'segment-saved',
    lastActionId: last?.id ?? null,
  };
}

// ---------- 2. tijd bevestigen ----------

interface Located {
  index: number;
  segment: Segment;
  /** Volgend segment in dezelfde keten: vastgelegd, het open segment of geen. */
  successor: { kind: 'segment'; segment: Segment } | { kind: 'open' } | { kind: 'none' };
}

function locate(game: ActiveGame, segmentId: string): Located | null {
  const { segments } = deriveGameHistory(game);
  const index = segments.findIndex((s) => s.id === segmentId);
  const segment = segments[index];
  if (index < 0 || segment === undefined) return null;
  const next = segments[index + 1];
  if (next !== undefined && next.quarter === segment.quarter && next.beginSec === segment.endSec) {
    return { index, segment, successor: { kind: 'segment', segment: next } };
  }
  const isLast = index === segments.length - 1;
  if (isLast && game.curQuarter === segment.quarter && game.beginSec === segment.endSec) {
    return { index, segment, successor: { kind: 'open' } };
  }
  return { index, segment, successor: { kind: 'none' } };
}

/**
 * Toegestane eindtijden (inclusief, in seconden, `min <= max`) voor een
 * vastgelegd segment: duur > 0, niet na de huidige tijd (`nowSec`, indien
 * bekend, alleen als het open segment het volgende is) en de volgorde met het
 * volgende vastgelegde segment blijft geldig (diens duur > 0). `null` als er
 * geen geldige tijd bestaat of het segment onbekend is.
 */
export function swapTimeBounds(
  game: ActiveGame,
  segmentId: string,
  nowSec?: number,
): { min: number; max: number } | null {
  const found = locate(game, segmentId);
  if (found == null) return null;
  const { segment, successor } = found;
  const down = game.clockDown;
  let min = 0;
  let max = 600;
  // Duur van het segment zelf > 0.
  if (down) max = Math.min(max, segment.beginSec - 1);
  else min = Math.max(min, segment.beginSec + 1);
  if (successor.kind === 'segment') {
    if (down) min = Math.max(min, successor.segment.endSec + 1);
    else max = Math.min(max, successor.segment.endSec - 1);
  } else if (successor.kind === 'open' && nowSec !== undefined) {
    if (down) min = Math.max(min, nowSec);
    else max = Math.min(max, nowSec);
  }
  return min <= max ? { min, max } : null;
}

/**
 * Tijd bevestigen/bijstellen: past `endSec` van het vastgelegde segment aan en
 * tegelijk de begintijd van het volgende segment in de keten (het open segment
 * via `game.beginSec`, of een volgend vastgelegd segment via `segment-edited`),
 * zodat er geen gat of overlap ontstaat. Punten, turnovers en opstellingen
 * blijven ongemoeid. Grenzen: zie `swapTimeBounds`. Dezelfde tijd = geen
 * wijziging (zelfde `game`-referentie).
 */
export function confirmSwapTime(
  game: ActiveGame,
  segmentId: string,
  newEndSec: number,
  nowSec?: number,
): { ok: true; game: ActiveGame } | { ok: false; error: SwapFlowError } {
  const found = locate(game, segmentId);
  if (found == null) return fail('unknown-segment');
  if (!isValidClockSeconds(newEndSec)) return fail('invalid-clock');
  const { segment, successor } = found;
  if (newEndSec === segment.endSec) return { ok: true, game };

  const bounds = swapTimeBounds(game, segmentId, nowSec);
  if (bounds == null || newEndSec < bounds.min || newEndSec > bounds.max) {
    return fail('invalid-duration');
  }

  const updated: Segment = {
    ...segment,
    endSec: newEndSec,
    durSec: Math.abs(newEndSec - segment.beginSec),
  };
  const actions: GameAction[] = [segmentEditedAction(segment.id, updated)];
  let next: ActiveGame = game;
  if (successor.kind === 'segment') {
    const following: Segment = {
      ...successor.segment,
      beginSec: newEndSec,
      durSec: Math.abs(successor.segment.endSec - newEndSec),
    };
    actions.push(segmentEditedAction(following.id, following));
  } else if (successor.kind === 'open') {
    next = {
      ...game,
      beginSec: newEndSec,
      endSec: game.endSec === game.beginSec ? newEndSec : game.endSec,
    };
  }
  return { ok: true, game: { ...next, actions: [...game.actions, ...actions] } };
}

/**
 * Welke van de opgeslagen onbevestigde segment-id's nog bestaan, in
 * wedstrijdvolgorde (oudste eerst). Na herladen, een verwijderd segment of een
 * ongedaan gemaakte wissel vallen verdwenen id's stilzwijgend af.
 */
export function pendingTimeConfirmations(game: ActiveGame, segmentIds: string[]): Segment[] {
  const wanted = new Set(segmentIds);
  return deriveGameHistory(game).segments.filter((s) => wanted.has(s.id));
}

// ---------- 3. ongedaan maken (één niveau) ----------

export type UndoneAction =
  | { kind: 'score'; team: 'for' | 'against'; delta: number }
  | { kind: 'turnover'; delta: number }
  | { kind: 'swap'; segmentId: string; ins: string[]; outs: string[] };

export type UndoResult =
  | { ok: true; game: ActiveGame; undone: UndoneAction; lastActionId: string }
  | { ok: false; error: SwapFlowError };

/**
 * Wat `undoLastAction` nu zou terugdraaien, of `null`. Alleen de LAATSTE actie
 * van het log komt in aanmerking: score-delta, turnover-delta, of een
 * `segment-saved` van een wissel (open segment begint precies op de eindtijd
 * van dat segment, in hetzelfde kwart). Een eerder teruggedraaide actie
 * (`blockedActionId` = `lastActionId` van de vorige undo) telt niet opnieuw.
 */
export function lastUndoableAction(
  game: ActiveGame,
  blockedActionId?: string | null,
): GameAction | null {
  const last = lastAction(game);
  if (last === undefined) return null;
  if (blockedActionId != null && last.id === blockedActionId) return null;
  if (last.type === 'score-delta' || last.type === 'turnover-delta') return last;
  if (last.type === 'segment-saved') {
    const present = deriveGameHistory(game).segments.some((s) => s.id === last.segment.id);
    const isSwap =
      game.curQuarter === last.segment.quarter && game.beginSec === last.segment.endSec;
    return present && isSwap ? last : null;
  }
  return null;
}

/**
 * Draait de laatste live actie terug door een compenserende actie toe te voegen
 * (het log is append-only). Score/turnover: tegengestelde delta. Wissel:
 * `segment-deleted`, daarna de punten en turnovers van dat segment als deltas
 * terug in het open segment (`segment-deleted` haalt ze anders uit de stand),
 * en `onCourt`, `curQuarter`, `beginSec` terug naar vóór de wissel.
 *
 * Eén niveau: de aanroeper bewaart `lastActionId` en geeft die als
 * `blockedActionId` mee tot er een nieuwe actie is.
 */
export function undoLastAction(game: ActiveGame, blockedActionId?: string | null): UndoResult {
  const target = lastUndoableAction(game, blockedActionId);
  if (target == null) return fail('nothing-to-undo');

  if (target.type === 'score-delta') {
    const action = scoreDeltaAction(target.team, -target.delta);
    return {
      ok: true,
      game: { ...game, actions: [...game.actions, action] },
      undone: { kind: 'score', team: target.team, delta: target.delta },
      lastActionId: action.id,
    };
  }
  if (target.type === 'turnover-delta') {
    const action = turnoverDeltaAction(-target.delta);
    return {
      ok: true,
      game: { ...game, actions: [...game.actions, action] },
      undone: { kind: 'turnover', delta: target.delta },
      lastActionId: action.id,
    };
  }
  if (target.type !== 'segment-saved') return fail('nothing-to-undo');

  const segment = target.segment;
  const added: GameAction[] = [segmentDeletedAction(segment.id)];
  if (segment.pf !== 0) added.push(scoreDeltaAction('for', segment.pf));
  if (segment.pa !== 0) added.push(scoreDeltaAction('against', segment.pa));
  const tov = typeof segment.tov === 'number' ? segment.tov : 0;
  if (tov > 0) added.push(turnoverDeltaAction(tov));
  const lastId = added[added.length - 1]?.id ?? '';
  return {
    ok: true,
    game: {
      ...game,
      actions: [...game.actions, ...added],
      onCourt: [...segment.lineup],
      curQuarter: segment.quarter,
      beginSec: segment.beginSec,
      endSec: segment.beginSec,
      pendingSwapLineup: null,
    },
    undone: {
      kind: 'swap',
      segmentId: segment.id,
      ins: segment.lineup.filter((id) => !game.onCourt.includes(id)),
      outs: game.onCourt.filter((id) => !segment.lineup.includes(id)),
    },
    lastActionId: lastId,
  };
}

// ---------- 4. wissel met terugwerkende kracht ----------

export interface RetroSwapEntry {
  actionId: string;
  kind: 'score' | 'turnover';
  team?: 'for' | 'against';
  delta: number;
  at: string;
}

interface RetroWindow {
  entries: RetroSwapEntry[];
  liveFor: number;
  liveAgainst: number;
  liveTov: number;
}

function retroWindow(game: ActiveGame): RetroWindow | null {
  let from = -1;
  game.actions.forEach((a, i) => {
    if (a.type === 'segment-saved') from = i;
  });
  const slice = game.actions.slice(from + 1);
  const entries: RetroSwapEntry[] = [];
  for (const a of slice) {
    if (a.type === 'score-delta') {
      entries.push({ actionId: a.id, kind: 'score', team: a.team, delta: a.delta, at: a.at });
    } else if (a.type === 'turnover-delta') {
      entries.push({ actionId: a.id, kind: 'turnover', delta: a.delta, at: a.at });
    } else if (a.type === 'score-set' || a.type === 'segment-deleted') {
      return null;
    }
  }
  const h = deriveGameHistory(game);
  const liveFor = h.scoreFor - h.segStartFor;
  const liveAgainst = h.scoreAgainst - h.segStartAgainst;
  const liveTov = h.turnovers - h.segStartTurnovers;
  const sum = (pred: (e: RetroSwapEntry) => boolean) =>
    entries.filter(pred).reduce((acc, e) => acc + e.delta, 0);
  const consistent =
    sum((e) => e.kind === 'score' && e.team === 'for') === liveFor &&
    sum((e) => e.kind === 'score' && e.team === 'against') === liveAgainst &&
    sum((e) => e.kind === 'turnover') === liveTov;
  return consistent ? { entries, liveFor, liveAgainst, liveTov } : null;
}

/**
 * De score- en turnoveracties sinds de vorige wissel (laatste `segment-saved`),
 * in volgorde van invoer: de lijst waarin de gebruiker de grens aantikt. `null`
 * als het open segment niet uit eenvoudige deltas is opgebouwd (bijv. na een
 * `score-set` of een ongedaan gemaakte wissel); dan is een gesplitste wissel
 * niet beschikbaar.
 */
export function retroSwapEntries(game: ActiveGame): RetroSwapEntry[] | null {
  return retroWindow(game)?.entries ?? null;
}

export interface RetroSwapInput {
  /** Kloktijd in het verleden waarop de wissel echt plaatsvond. */
  endSec: number;
  /**
   * Grens: id van de LAATSTE actie die nog voor de oude opstelling telt;
   * `null` = alle acties sinds de vorige wissel horen bij de nieuwe opstelling.
   */
  lastOldActionId: string | null;
  classification: ClassificationConfig;
}

export type RetroSwapResult =
  | { ok: true; game: ActiveGame; segmentId: string; lastActionId: string }
  | { ok: false; error: SwapFlowError };

/**
 * Wissel met terugwerkende kracht: één segment met de oude opstelling
 * (`pendingSwapLineup`) over [`beginSec`, `endSec`] met alleen de acties tot en
 * met de gekozen grens; de acties daarna blijven in het open segment van de
 * nieuwe opstelling. Het log is append-only, dus de latere acties worden
 * tijdelijk teruggenomen (compenserende deltas), waarna het segment wordt
 * vastgelegd en dezelfde deltas het open segment weer vullen. Eindstand en
 * totalen blijven gelijk. Na afloop hoort de aanroeper `lastActionId` als
 * undo-blokkade te bewaren: de wissel is hier niet met één stap terug te draaien.
 */
export function commitRetroactiveSwap(game: ActiveGame, input: RetroSwapInput): RetroSwapResult {
  const pending = game.pendingSwapLineup;
  if (pending == null) return fail('no-pending-swap');
  const { endSec, lastOldActionId, classification } = input;
  if (!isValidClockSeconds(game.beginSec) || !isValidClockSeconds(endSec)) {
    return fail('invalid-clock');
  }
  if (pending.length !== 5) return fail('invalid-lineup');
  if (!(clockDuration(game.clockDown, game.beginSec, endSec) > 0)) return fail('invalid-duration');

  const window = retroWindow(game);
  if (window == null) return fail('invalid-split');
  let keep = 0;
  if (lastOldActionId !== null) {
    const at = window.entries.findIndex((e) => e.actionId === lastOldActionId);
    if (at < 0) return fail('invalid-split');
    keep = at + 1;
  }
  const kept = window.entries.slice(0, keep);
  const part = (pred: (e: RetroSwapEntry) => boolean) =>
    kept.filter(pred).reduce((acc, e) => acc + e.delta, 0);
  const pf = part((e) => e.kind === 'score' && e.team === 'for');
  const pa = part((e) => e.kind === 'score' && e.team === 'against');
  const tov = part((e) => e.kind === 'turnover');
  if (pf < 0 || pa < 0) return fail('score-below-segment-start');
  if (tov < 0) return fail('invalid-split');

  const restFor = window.liveFor - pf;
  const restAgainst = window.liveAgainst - pa;
  const restTov = window.liveTov - tov;

  const take: GameAction[] = [];
  const give: GameAction[] = [];
  if (restFor !== 0) {
    take.push(scoreDeltaAction('for', -restFor));
    give.push(scoreDeltaAction('for', restFor));
  }
  if (restAgainst !== 0) {
    take.push(scoreDeltaAction('against', -restAgainst));
    give.push(scoreDeltaAction('against', restAgainst));
  }
  if (restTov !== 0) {
    take.push(turnoverDeltaAction(-restTov));
    give.push(turnoverDeltaAction(restTov));
  }

  const segment = buildSegment(
    game,
    game.curQuarter,
    game.beginSec,
    endSec,
    pending,
    pf,
    pa,
    classification,
    tov,
  );
  const saved = segmentSavedAction(segment);
  const all = [...take, saved, ...give];
  const lastId = all[all.length - 1]?.id ?? saved.id;
  return {
    ok: true,
    game: {
      ...game,
      actions: [...game.actions, ...all],
      beginSec: endSec,
      endSec,
      pendingSwapLineup: null,
    },
    segmentId: segment.id,
    lastActionId: lastId,
  };
}
