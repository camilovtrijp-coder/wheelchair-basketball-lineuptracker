import {
  applyAction,
  buildSegment,
  deriveGameHistory,
  isOverLimit,
  segmentEditedAction,
  segmentSavedAction,
  scoreSetAction,
  selectQuarter,
  type ClassificationConfig,
  type DerivedGameHistory,
} from './tracking';
import {
  MAX_CLOCK_MINUTES,
  MAX_CLOCK_SECONDS,
  MAX_SCORE,
  type ActiveGame,
  type Segment,
} from './types';

/**
 * Compact-bouwplan C1: pure, geteste commando's voor de live registratie
 * (voorheen verspreid over de handlers van `LiveTrackingPanel.tsx`). Elk
 * commando werkt op de LAATSTE `ActiveGame`, geeft een nieuwe game terug of
 * een getypeerde foutcode, en muteert de invoer nooit. Geen opslag, geen DOM,
 * geen netwerk; statistiekberekeningen en de reducer-semantiek van
 * `tracking.ts` blijven ongewijzigd.
 *
 * Besluiten eigenaar (docs/wedstrijdscherm-compact-bouwplan.md):
 *  1. klok 0..`MAX_CLOCK_SECONDS` (10:00) wordt hard afgedwongen;
 *  2. segmentpunten per kant 0..`MAX_SCORE` en eindstand niet onder de
 *     beginstand van het segment;
 *  3. wissel op 0 s maakt geen leeg segment, maar wordt geweigerd als de
 *     stand sinds het openen is gewijzigd.
 */

export type LiveCommandError =
  /** Begin-/eindtijd is geen geheel getal in 0..`MAX_CLOCK_SECONDS`. */
  | 'invalid-clock'
  /** Duur van het segment is niet positief (of negatief bij een wissel). */
  | 'invalid-duration'
  /** Er staan niet precies 5 spelers in de opstelling. */
  | 'invalid-lineup'
  /** Score buiten 0..`MAX_SCORE` of niet geheel. */
  | 'invalid-score'
  /** Eindstand van het segment zou onder de beginstand van dat segment liggen (besluit 2). */
  | 'score-below-segment-start'
  /** Kwartnummer is geen geheel getal binnen het toegestane bereik. */
  | 'invalid-quarter'
  /** Wissel op 0 s terwijl de stand is gewijzigd (besluit 3). */
  | 'score-changed'
  /** Er loopt geen wisselconcept. */
  | 'no-pending-swap'
  /** Het te bewerken segment bestaat niet (meer). */
  | 'unknown-segment';

export type LiveCommandResult =
  { ok: true; game: ActiveGame } | { ok: false; error: LiveCommandError };

type Team = 'for' | 'against';

function fail(error: LiveCommandError): { ok: false; error: LiveCommandError } {
  return { ok: false, error };
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

// ---------- klok ----------

/** Geheel aantal seconden in 0..`MAX_CLOCK_SECONDS` (10:00). */
export function isValidClockSeconds(sec: unknown): sec is number {
  return isInt(sec) && sec >= 0 && sec <= MAX_CLOCK_SECONDS;
}

/** Maximaal te kiezen seconden bij een gegeven aantal minuten (bij 10 min alleen 0). */
export function maxSecondsForMinutes(minutes: number): number {
  return minutes >= MAX_CLOCK_MINUTES ? 0 : 59;
}

/** Duur tussen begin en eind, in de klokrichting van de wedstrijd (negatief = ongeldig). */
export function clockDuration(clockDown: boolean, beginSec: number, endSec: number): number {
  return clockDown ? beginSec - endSec : endSec - beginSec;
}

// ---------- begin-/eindstand per segment (pure afleiding) ----------

export interface SegmentScoreBounds {
  beginFor: number;
  beginAgainst: number;
  endFor: number;
  endAgainst: number;
}

/**
 * Begin- en eindstand per segment als cumulatieve som van `pf`/`pa` in
 * arrayvolgorde — dezelfde definitie als `recalcRunningScore()` in
 * `tracking.ts`. Er wordt niets opgeslagen.
 */
export function segmentScoreBounds(segments: Segment[]): SegmentScoreBounds[] {
  let runFor = 0;
  let runAgainst = 0;
  return segments.map((s) => {
    const bounds = {
      beginFor: runFor,
      beginAgainst: runAgainst,
      endFor: runFor + s.pf,
      endAgainst: runAgainst + s.pa,
    };
    runFor = bounds.endFor;
    runAgainst = bounds.endAgainst;
    return bounds;
  });
}

// ---------- score ----------

function foldActions(game: ActiveGame, from: number, history: DerivedGameHistory) {
  return game.actions.slice(from).reduce(applyAction, history);
}

/**
 * Zet de score van één kant. Geeft dezelfde `game`-referentie terug als de
 * waarde niet verandert (geen overbodige actie of sync); weigert waarden die
 * geen geheel getal in 0..`MAX_SCORE` zijn.
 */
export function setScore(game: ActiveGame, team: Team, value: number): LiveCommandResult {
  if (!isInt(value) || value < 0 || value > MAX_SCORE) return fail('invalid-score');
  const history = deriveGameHistory(game);
  const current = team === 'for' ? history.scoreFor : history.scoreAgainst;
  if (value === current) return { ok: true, game };
  return { ok: true, game: { ...game, actions: [...game.actions, scoreSetAction(team, value)] } };
}

/**
 * Past een optionele score-set voor beide kanten toe op de actielog (alleen
 * bij een andere waarde) en geeft de bijgewerkte log terug. Vooraf gevalideerd
 * door de aanroeper.
 */
function withScores(
  game: ActiveGame,
  scoreFor: number | undefined,
  scoreAgainst: number | undefined,
): { game: ActiveGame; history: DerivedGameHistory } {
  const base = deriveGameHistory(game);
  const added = [];
  if (scoreFor !== undefined && scoreFor !== base.scoreFor) {
    added.push(scoreSetAction('for', scoreFor));
  }
  if (scoreAgainst !== undefined && scoreAgainst !== base.scoreAgainst) {
    added.push(scoreSetAction('against', scoreAgainst));
  }
  if (added.length === 0) return { game, history: base };
  const next = { ...game, actions: [...game.actions, ...added] };
  return { game: next, history: foldActions(next, game.actions.length, base) };
}

function validScoreInput(value: number | undefined): boolean {
  return value === undefined || (isInt(value) && value >= 0 && value <= MAX_SCORE);
}

// ---------- segment vastleggen ----------

export interface CommitSegmentInput {
  /** Eindtijd van het segment in seconden (klokrichting van de wedstrijd). */
  endSec: number;
  /** Optionele nieuwe stand, in dezelfde overgang vóór het segment toegepast. */
  scoreFor?: number;
  scoreAgainst?: number;
  /** Opstelling van het segment; standaard `pendingSwapLineup ?? onCourt`. */
  lineup?: string[];
  classification: ClassificationConfig;
}

/**
 * Legt het open segment vast op de laatste game-state: (optioneel) eerst de
 * score-set(s), dan het segment met de daaruit volgende delta's (pf/pa/tov) in
 * één overgang. Zet `beginSec = endSec` en `pendingSwapLineup = null`;
 * `onCourt` blijft ongewijzigd. Bij een fout blijft de invoer ongemoeid.
 */
export function commitSegment(game: ActiveGame, input: CommitSegmentInput): LiveCommandResult {
  const { endSec, scoreFor, scoreAgainst, classification } = input;
  if (!isValidClockSeconds(game.beginSec) || !isValidClockSeconds(endSec)) {
    return fail('invalid-clock');
  }
  if (!validScoreInput(scoreFor) || !validScoreInput(scoreAgainst)) return fail('invalid-score');

  const lineup = input.lineup ?? game.pendingSwapLineup ?? game.onCourt;
  if (lineup.length !== 5) return fail('invalid-lineup');
  if (!(clockDuration(game.clockDown, game.beginSec, endSec) > 0)) return fail('invalid-duration');

  const scored = withScores(game, scoreFor, scoreAgainst);
  const pf = scored.history.scoreFor - scored.history.segStartFor;
  const pa = scored.history.scoreAgainst - scored.history.segStartAgainst;
  // Besluit 2: eindstand mag niet onder de beginstand van het segment liggen.
  if (pf < 0 || pa < 0) return fail('score-below-segment-start');
  const tov = scored.history.turnovers - scored.history.segStartTurnovers;

  const segment = buildSegment(
    game,
    game.curQuarter,
    game.beginSec,
    endSec,
    lineup,
    pf,
    pa,
    classification,
    tov,
  );
  return {
    ok: true,
    game: {
      ...scored.game,
      beginSec: endSec,
      endSec,
      pendingSwapLineup: null,
      actions: [...scored.game.actions, segmentSavedAction(segment)],
    },
  };
}

// ---------- wissel bevestigen / verwerpen ----------

export interface ConfirmSwapInput {
  /** Kloktijd waarop de wissel(s) plaatsvinden. */
  endSec: number;
  scoreFor?: number;
  scoreAgainst?: number;
  /**
   * Stand op het moment dat het wisselconcept werd geopend. Standaard de
   * beginstand van het open segment. Bij een duur van 0 s wordt geweigerd als
   * de stand hiervan afwijkt (besluit 3).
   */
  scoreAtOpen?: { for: number; against: number };
  classification: ClassificationConfig;
}

/**
 * Bevestigt het openstaande wisselconcept. Duur > 0: het open segment wordt
 * met de oude opstelling (`pendingSwapLineup`) vastgelegd. Duur 0: geen leeg
 * segment, alleen `pendingSwapLineup = null` — maar geweigerd (`score-changed`)
 * als de stand is gewijzigd, omdat die punten anders aan de nieuwe opstelling
 * zouden worden toegekend. Negatieve duur is ongeldig.
 */
export function confirmSwap(game: ActiveGame, input: ConfirmSwapInput): LiveCommandResult {
  const pending = game.pendingSwapLineup;
  if (pending == null) return fail('no-pending-swap');
  const { endSec, scoreFor, scoreAgainst, classification } = input;
  if (!isValidClockSeconds(game.beginSec) || !isValidClockSeconds(endSec)) {
    return fail('invalid-clock');
  }
  if (!validScoreInput(scoreFor) || !validScoreInput(scoreAgainst)) return fail('invalid-score');

  const dur = clockDuration(game.clockDown, game.beginSec, endSec);
  if (dur < 0) return fail('invalid-duration');
  if (dur > 0) {
    return commitSegment(game, { endSec, scoreFor, scoreAgainst, lineup: pending, classification });
  }

  const history = deriveGameHistory(game);
  const open = input.scoreAtOpen ?? { for: history.segStartFor, against: history.segStartAgainst };
  const nextFor = scoreFor ?? history.scoreFor;
  const nextAgainst = scoreAgainst ?? history.scoreAgainst;
  if (nextFor !== open.for || nextAgainst !== open.against) return fail('score-changed');
  return { ok: true, game: { ...game, pendingSwapLineup: null } };
}

/** Verwerpt het wisselconcept: de opstelling van vóór de wissel(s) is weer actief. */
export function discardSwaps(game: ActiveGame): ActiveGame {
  if (game.pendingSwapLineup == null) return game;
  return { ...game, onCourt: game.pendingSwapLineup, pendingSwapLineup: null };
}

// ---------- kwart afsluiten ----------

export interface CloseQuarterInput extends CommitSegmentInput {
  /** Kwart dat na het afsluiten wordt geselecteerd. */
  nextQuarter: number;
  /** Optioneel: bovengrens voor `nextQuarter`. */
  quarterCount?: number;
}

/**
 * Sluit het lopende kwart af: segment vastleggen (zoals `commitSegment`) en
 * `selectQuarter(nextQuarter)` in één overgang. Rondt de wedstrijd NOOIT af,
 * ook niet in het laatste kwart. Is er niets open (duur 0 en geen open
 * punten/turnovers), dan wordt geen leeg segment gemaakt en wordt alleen het
 * kwart gekozen.
 */
export function closeQuarter(game: ActiveGame, input: CloseQuarterInput): LiveCommandResult {
  const { nextQuarter, quarterCount } = input;
  if (
    !isInt(nextQuarter) ||
    nextQuarter < 1 ||
    (quarterCount !== undefined && nextQuarter > quarterCount)
  ) {
    return fail('invalid-quarter');
  }
  if (!isValidClockSeconds(game.beginSec) || !isValidClockSeconds(input.endSec)) {
    return fail('invalid-clock');
  }
  if (!validScoreInput(input.scoreFor) || !validScoreInput(input.scoreAgainst)) {
    return fail('invalid-score');
  }

  const dur = clockDuration(game.clockDown, game.beginSec, input.endSec);
  const scored = withScores(game, input.scoreFor, input.scoreAgainst);
  const h = scored.history;
  const nothingOpen =
    h.scoreFor === h.segStartFor &&
    h.scoreAgainst === h.segStartAgainst &&
    h.turnovers === h.segStartTurnovers;

  let committed: ActiveGame;
  if (dur === 0 && nothingOpen) {
    committed = { ...game, pendingSwapLineup: null };
  } else {
    const result = commitSegment(game, input);
    if (!result.ok) return result;
    committed = result.game;
  }
  return { ok: true, game: { ...committed, ...selectQuarter(committed, nextQuarter) } };
}

// ---------- segment bewerken ----------

export interface SegmentEditDraft {
  quarter: number;
  beginSec: number;
  endSec: number;
  lineup: string[];
  pf: number;
  pa: number;
  tov: number;
}

/**
 * Valideert en legt een segmentbewerking vast (segment-edited-actie). Weigert:
 * klok buiten 0..10:00, duur <= 0, lineup <> 5, punten die geen geheel getal
 * 0..150 zijn (negatief = eindstand onder de beginstand van het segment) of de
 * totale stand boven 150 brengen. Turnovers blijven mild: negatief of
 * ontbrekend telt als 0 (bestaande semantiek).
 */
export function editSegment(
  game: ActiveGame,
  segmentId: string,
  draft: SegmentEditDraft,
  classification: ClassificationConfig,
  quarterCount?: number,
): LiveCommandResult {
  const history = deriveGameHistory(game);
  const index = history.segments.findIndex((s) => s.id === segmentId);
  const old = history.segments[index];
  if (index < 0 || old === undefined) return fail('unknown-segment');

  // Het bestaande kwart van het segment blijft altijd toegestaan, ook als het
  // periodeaantal na registratie is verlaagd.
  if (
    !isInt(draft.quarter) ||
    draft.quarter < 1 ||
    (draft.quarter !== old.quarter && quarterCount !== undefined && draft.quarter > quarterCount)
  ) {
    return fail('invalid-quarter');
  }
  if (!isValidClockSeconds(draft.beginSec) || !isValidClockSeconds(draft.endSec)) {
    return fail('invalid-clock');
  }
  const durSec = clockDuration(game.clockDown, draft.beginSec, draft.endSec);
  if (!(durSec > 0)) return fail('invalid-duration');
  if (draft.lineup.length !== 5) return fail('invalid-lineup');

  for (const pts of [draft.pf, draft.pa]) {
    if (!isInt(pts) || pts < 0 || pts > MAX_SCORE) return fail('invalid-score');
  }
  const totalFor = history.scoreFor + (draft.pf - old.pf);
  const totalAgainst = history.scoreAgainst + (draft.pa - old.pa);
  if (totalFor > MAX_SCORE || totalAgainst > MAX_SCORE) return fail('invalid-score');

  const { sum, allowed, over } = isOverLimit(game, draft.lineup, classification);
  const updated: Segment = {
    id: segmentId,
    quarter: draft.quarter,
    beginSec: draft.beginSec,
    endSec: draft.endSec,
    durSec,
    lineup: [...draft.lineup],
    pf: draft.pf,
    pa: draft.pa,
    classSum: sum,
    allowed,
    over,
    tov: Math.max(0, Math.floor(draft.tov) || 0),
  };
  return {
    ok: true,
    game: { ...game, actions: [...game.actions, segmentEditedAction(segmentId, updated)] },
  };
}
