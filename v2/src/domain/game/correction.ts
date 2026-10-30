import { segmentTurnovers } from './tracking';
import {
  MAX_CLOCK_SECONDS,
  MAX_CORRECTIONS,
  MAX_SCORE,
  type CompletedGame,
  type CompletedGameCorrection,
  type CorrectableSegmentFields,
  type Segment,
} from './types';

/**
 * PR 7.5a (docs/pr-7.5-plan.md §D.1/§D.2): zuivere correctie van één segment
 * van een afgeronde wedstrijd. Geen opslag, geen DOM, geen netwerk; muteert
 * de invoer nooit en geeft bij ongeldige invoer een expliciet foutresultaat.
 */

export type CorrectSegmentError =
  | 'game-deleted'
  | 'unknown-segment'
  | 'no-change'
  | 'log-full'
  | 'invalid-quarter'
  | 'invalid-time'
  | 'invalid-duration'
  | 'invalid-score'
  | 'invalid-turnovers';

export type CorrectSegmentResult =
  | { ok: true; game: CompletedGame; correction: CompletedGameCorrection }
  | { ok: false; error: CorrectSegmentError };

/** Optionele injectie voor deterministische tests; productie gebruikt de defaults. */
export interface CorrectSegmentOptions {
  now?: Date;
  id?: string;
}

/** De zes bewerkbare velden van een segment (ontbrekende `tov` telt als 0). */
export function correctableFieldsOf(segment: Segment): CorrectableSegmentFields {
  return {
    quarter: segment.quarter,
    beginSec: segment.beginSec,
    endSec: segment.endSec,
    pf: segment.pf,
    pa: segment.pa,
    tov: segmentTurnovers(segment),
  };
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Corrigeert `segmentId` van `game` met `patch` (alleen de meegegeven velden
 * wijzigen). De klokrichting wordt afgeleid uit het bestaande segment
 * (`beginSec > endSec` = aftellend, docs/pr-7.5-plan.md §H.4). Bij succes:
 * `durSec` herberekend, `scoreFor`/`scoreAgainst` met het verschil in
 * `pf`/`pa`, `revision` +1, `correctedAt` gezet en één logitem toegevoegd.
 * `lineup`/`classSum`/`allowed`/`over` blijven ongewijzigd.
 */
export function correctSegment(
  game: CompletedGame,
  segmentId: string,
  patch: Partial<CorrectableSegmentFields>,
  by: string | null,
  options: CorrectSegmentOptions = {},
): CorrectSegmentResult {
  if (game.deletedAt != null) return { ok: false, error: 'game-deleted' };
  const index = game.segments.findIndex((s) => s.id === segmentId);
  if (index < 0) return { ok: false, error: 'unknown-segment' };
  if ((game.corrections?.length ?? 0) >= MAX_CORRECTIONS) {
    return { ok: false, error: 'log-full' };
  }

  const old = game.segments[index];
  if (old === undefined) return { ok: false, error: 'unknown-segment' };
  const before = correctableFieldsOf(old);
  const after: CorrectableSegmentFields = { ...before };
  for (const key of Object.keys(before) as (keyof CorrectableSegmentFields)[]) {
    const value = patch[key];
    if (value !== undefined) after[key] = value;
  }

  if (
    (Object.keys(before) as (keyof CorrectableSegmentFields)[]).every((k) => before[k] === after[k])
  ) {
    return { ok: false, error: 'no-change' };
  }

  // Alleen gewijzigde velden worden op bereik gecontroleerd, zodat een
  // correctie van bv. alleen de score niet faalt op een ongewijzigd, ouder
  // tijdsveld. Type en hele-getalcontrole geldt voor elk meegegeven veld.
  if (patch.quarter !== undefined && !isIntegerInRange(after.quarter, 1, game.quarterCount)) {
    return { ok: false, error: 'invalid-quarter' };
  }
  for (const key of ['beginSec', 'endSec'] as const) {
    if (patch[key] !== undefined && !isIntegerInRange(after[key], 0, MAX_CLOCK_SECONDS)) {
      return { ok: false, error: 'invalid-time' };
    }
  }
  for (const key of ['pf', 'pa'] as const) {
    if (patch[key] !== undefined && !isIntegerInRange(after[key], 0, MAX_SCORE)) {
      return { ok: false, error: 'invalid-score' };
    }
  }
  if (patch.tov !== undefined && !isIntegerInRange(after.tov, 0, Number.MAX_SAFE_INTEGER)) {
    return { ok: false, error: 'invalid-turnovers' };
  }

  // Klokrichting uit het bestaande segment; bij gelijke begin/eind (kan niet
  // afgeleid worden) volstaat een positieve absolute duur.
  const durSec =
    old.beginSec > old.endSec
      ? after.beginSec - after.endSec
      : old.beginSec < old.endSec
        ? after.endSec - after.beginSec
        : Math.abs(after.endSec - after.beginSec);
  if (!(durSec > 0)) return { ok: false, error: 'invalid-duration' };

  const scoreFor = game.scoreFor + (after.pf - before.pf);
  const scoreAgainst = game.scoreAgainst + (after.pa - before.pa);
  if (!isIntegerInRange(scoreFor, 0, MAX_SCORE) || !isIntegerInRange(scoreAgainst, 0, MAX_SCORE)) {
    return { ok: false, error: 'invalid-score' };
  }

  const at = (options.now ?? new Date()).toISOString();
  const correction: CompletedGameCorrection = {
    id: options.id ?? crypto.randomUUID(),
    segmentId,
    at,
    by,
    before,
    after,
  };
  const corrected: Segment = {
    ...old,
    quarter: after.quarter,
    beginSec: after.beginSec,
    endSec: after.endSec,
    durSec,
    pf: after.pf,
    pa: after.pa,
    tov: after.tov,
  };
  return {
    ok: true,
    correction,
    game: {
      ...game,
      segments: game.segments.map((s, i) => (i === index ? corrected : s)),
      scoreFor,
      scoreAgainst,
      revision: (Number.isInteger(game.revision) ? game.revision : 0) + 1,
      corrections: [...(game.corrections ?? []), correction],
      correctedAt: at,
    },
  };
}

function sameFields(a: CorrectableSegmentFields, b: CorrectableSegmentFields): boolean {
  return (Object.keys(a) as (keyof CorrectableSegmentFields)[]).every((k) => a[k] === b[k]);
}

function isFieldsShape(value: unknown): value is CorrectableSegmentFields {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return ['quarter', 'beginSec', 'endSec', 'pf', 'pa', 'tov'].every(
    (k) => typeof v[k] === 'number',
  );
}

/** Vergelijkt de zes bewerkbare velden plus id/segmentId/at/by; extra (cloud-only) velden tellen niet mee. */
export function sameCorrectionEntry(
  a: CompletedGameCorrection,
  b: CompletedGameCorrection,
): boolean {
  return (
    a.id === b.id &&
    a.segmentId === b.segmentId &&
    a.at === b.at &&
    a.by === b.by &&
    isFieldsShape(a.before) &&
    isFieldsShape(b.before) &&
    isFieldsShape(a.after) &&
    isFieldsShape(b.after) &&
    sameFields(a.before, b.before) &&
    sameFields(a.after, b.after)
  );
}

/**
 * PR 7.5a (review): speelt de logitems `log[from..]` een voor een af op `base`
 * via `correctSegment()` (dus met exact dezelfde validatieregels) en geeft het
 * resultaat terug, of `null` als een item niet geldig is: onbekend segment,
 * `before` wijkt af van de toen actuele waarden, ongeldige waarden/bereik,
 * ongeldig tijdstip, of een vol/ongewijzigd log. Zo kan niets anders dan de
 * gelogde segmenten wijzigen en volgen score en revisie uit het log.
 */
export function replayCorrectionLog(
  base: CompletedGame,
  log: readonly CompletedGameCorrection[],
  from: number,
): CompletedGame | null {
  let current: CompletedGame = { ...base, corrections: log.slice(0, from) };
  for (const entry of log.slice(from)) {
    if (typeof entry !== 'object' || entry === null) return null;
    if (typeof entry.id !== 'string' || entry.id === '' || typeof entry.segmentId !== 'string') {
      return null;
    }
    if (entry.by !== null && typeof entry.by !== 'string') return null;
    if (typeof entry.at !== 'string' || Number.isNaN(new Date(entry.at).getTime())) return null;
    if (!isFieldsShape(entry.before) || !isFieldsShape(entry.after)) return null;
    const result = correctSegment(current, entry.segmentId, entry.after, entry.by, {
      now: new Date(entry.at),
      id: entry.id,
    });
    if (!result.ok) return null;
    if (!sameFields(result.correction.before, entry.before)) return null;
    // Bewaar het origineel van het item (incl. eventuele extra velden) in het log.
    current = { ...result.game, corrections: [...(current.corrections ?? []), entry] };
  }
  return current;
}
