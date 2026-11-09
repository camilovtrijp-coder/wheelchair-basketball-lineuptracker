import { MAX_CLOCK_SECONDS, type ActiveGame } from './types';
import { clockDuration } from './liveCommands';
import { deriveGameHistory } from './tracking';

/**
 * Wisselschema voor het Snel-wedstrijdscherm: per kwart een lijst blokken met
 * de geplande opstelling en het geplande wisselmoment. Pure functies, geen
 * opslag, geen DOM. Het schema is uitsluitend een hulpmiddel voor de invoer en
 * geen onderdeel van `ActiveGame`, het datacontract, CSV of cloudsync: wat er
 * echt gespeeld is staat in de segmenten. Opstellingen staan als `rosterId`
 * (stabiel tussen wedstrijden), niet als game-player-id.
 *
 * Een blok loopt van het einde van het vorige blok (of het begin van het kwart)
 * tot `toSec`. De wissel naar het volgende blok gebeurt rond `toSec`; de echte
 * tijd legt de gebruiker tijdens de wedstrijd vast. Voor het LAATSTE blok van
 * een kwart is `toSec` altijd het einde van het kwart (0 bij een aflopende
 * klok, 10:00 bij een oplopende).
 */
export interface PlanBlock {
  toSec: number;
  /** Precies 5 verschillende `rosterId`'s. */
  lineup: number[];
}

export interface RotationPlan {
  /** Sleutel = kwartnummer als tekst ("1", "2", ...). */
  quarters: Record<string, PlanBlock[]>;
}

export const PLAN_LINEUP_SIZE = 5;
export const PLAN_TIME_STEP_SEC = 30;
export const PLAN_MAX_BLOCKS_PER_QUARTER = 8;
export const PLAN_MAX_QUARTERS = 12;

export function quarterStartSec(clockDown: boolean): number {
  return clockDown ? MAX_CLOCK_SECONDS : 0;
}

export function quarterEndSec(clockDown: boolean): number {
  return clockDown ? 0 : MAX_CLOCK_SECONDS;
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isValidLineup(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === PLAN_LINEUP_SIZE &&
    value.every(isInt) &&
    new Set(value).size === PLAN_LINEUP_SIZE
  );
}

/** Strikte controle van een uit opslag gelezen schema; ongeldig = `null` (geen schema). */
export function parseRotationPlan(raw: unknown): RotationPlan | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const quarters = (raw as { quarters?: unknown }).quarters;
  if (typeof quarters !== 'object' || quarters === null || Array.isArray(quarters)) return null;
  const result: Record<string, PlanBlock[]> = {};
  const entries = Object.entries(quarters as Record<string, unknown>);
  if (entries.length === 0 || entries.length > PLAN_MAX_QUARTERS) return null;
  for (const [key, blocks] of entries) {
    if (!/^[1-9]\d?$/.test(key) || Number(key) > PLAN_MAX_QUARTERS) return null;
    if (
      !Array.isArray(blocks) ||
      blocks.length < 1 ||
      blocks.length > PLAN_MAX_BLOCKS_PER_QUARTER
    ) {
      return null;
    }
    const parsed: PlanBlock[] = [];
    for (const block of blocks) {
      if (typeof block !== 'object' || block === null) return null;
      const { toSec, lineup } = block as { toSec?: unknown; lineup?: unknown };
      if (!isInt(toSec) || toSec < 0 || toSec > MAX_CLOCK_SECONDS) return null;
      if (!isValidLineup(lineup)) return null;
      parsed.push({ toSec, lineup: [...lineup] });
    }
    result[key] = parsed;
  }
  return { quarters: result };
}

// ---------- spelers ----------

/** `rosterId`'s van game-player-id's; `null` als een id niet in de wedstrijd zit. */
export function rosterIdsOf(game: ActiveGame, playerIds: string[]): number[] | null {
  const ids: number[] = [];
  for (const id of playerIds) {
    const p = game.players.find((pl) => pl.id === id);
    if (!p) return null;
    ids.push(p.rosterId);
  }
  return ids;
}

/** Game-player-id's van een geplande opstelling; `null` als iemand niet meedoet of ontbreekt. */
export function resolveLineup(game: ActiveGame, rosterIds: number[]): string[] | null {
  const ids: string[] = [];
  for (const rosterId of rosterIds) {
    const p = game.players.find((pl) => pl.rosterId === rosterId && pl.participate);
    if (!p) return null;
    ids.push(p.id);
  }
  return new Set(ids).size === PLAN_LINEUP_SIZE && ids.length === PLAN_LINEUP_SIZE ? ids : null;
}

// ---------- schema maken ----------

/**
 * Leeg startschema: in elk kwart één blok (geen wissels gepland) met de huidige
 * opstelling. `null` als de huidige opstelling niet naar `rosterId`'s te
 * vertalen is.
 */
export function emptyPlan(game: ActiveGame, quarterCount: number): RotationPlan | null {
  const lineup = rosterIdsOf(game, game.onCourt);
  if (lineup == null || lineup.length !== PLAN_LINEUP_SIZE) return null;
  const quarters: Record<string, PlanBlock[]> = {};
  const count = Math.max(1, Math.min(PLAN_MAX_QUARTERS, Math.floor(quarterCount)));
  for (let q = 1; q <= count; q++) {
    quarters[String(q)] = [{ toSec: quarterEndSec(game.clockDown), lineup: [...lineup] }];
  }
  return { quarters };
}

/** Vult ontbrekende kwarten aan (bijv. na een hoger periodeaantal), laat bestaande kwarten ongemoeid. */
export function withQuarterCount(
  plan: RotationPlan,
  game: ActiveGame,
  quarterCount: number,
): RotationPlan {
  const fallback = plan.quarters['1']?.[0]?.lineup ?? rosterIdsOf(game, game.onCourt);
  if (fallback == null) return plan;
  const quarters = { ...plan.quarters };
  const count = Math.max(1, Math.min(PLAN_MAX_QUARTERS, Math.floor(quarterCount)));
  for (let q = 1; q <= count; q++) {
    if (quarters[String(q)] == null) {
      quarters[String(q)] = [{ toSec: quarterEndSec(game.clockDown), lineup: [...fallback] }];
    }
  }
  return { quarters };
}

// ---------- positie in de wedstrijd ----------

/** Begintijd van blok `i` in kwart `q` (einde van het vorige blok, of begin van het kwart). */
export function blockStartSec(
  plan: RotationPlan,
  q: number,
  i: number,
  clockDown: boolean,
): number {
  const blocks = plan.quarters[String(q)];
  const previous = i > 0 ? blocks?.[i - 1] : undefined;
  return previous != null ? previous.toSec : quarterStartSec(clockDown);
}

/** Welk blok loopt nu: het aantal al vastgelegde segmenten in dit kwart (begrensd op het laatste blok). */
export function currentBlockIndex(game: ActiveGame, blockCount: number): number {
  const done = deriveGameHistory(game).segments.filter((s) => s.quarter === game.curQuarter).length;
  return Math.max(0, Math.min(done, blockCount - 1));
}

/** Aantal blokken van kwart `q` dat niet meer te bewerken is (gespeeld of bezig). */
export function lockedBlockCount(game: ActiveGame, q: number, blockCount: number): number {
  if (q < game.curQuarter) return blockCount;
  if (q > game.curQuarter) return 0;
  return Math.min(blockCount, currentBlockIndex(game, blockCount) + 1);
}

/** Geplande eindtijd van het lopende blok; `null` als er in dit kwart geen wissel meer gepland is. */
export function plannedEndSec(game: ActiveGame, plan: RotationPlan): number | null {
  const blocks = plan.quarters[String(game.curQuarter)];
  if (blocks == null) return null;
  const i = currentBlockIndex(game, blocks.length);
  if (i >= blocks.length - 1) return null;
  const to = blocks[i]?.toSec;
  if (to === undefined) return null;
  return clockDuration(game.clockDown, game.beginSec, to) > 0 ? to : null;
}

/** Geplande opstelling van het volgende blok (game-player-id's); `null` bij geen/ongeldig blok. */
export function nextPlannedLineup(game: ActiveGame, plan: RotationPlan): string[] | null {
  const blocks = plan.quarters[String(game.curQuarter)];
  if (blocks == null) return null;
  const i = currentBlockIndex(game, blocks.length);
  const next = blocks[i + 1];
  return next != null ? resolveLineup(game, next.lineup) : null;
}

/** Geplande beginopstelling van een kwart; `null` bij geen schema voor dat kwart of ongeldige spelers. */
export function quarterStartLineup(
  game: ActiveGame,
  plan: RotationPlan,
  quarter: number,
): string[] | null {
  const first = plan.quarters[String(quarter)]?.[0];
  return first != null ? resolveLineup(game, first.lineup) : null;
}

export function lineupDiff(from: string[], to: string[]): { ins: string[]; outs: string[] } {
  return {
    ins: to.filter((id) => !from.includes(id)),
    outs: from.filter((id) => !to.includes(id)),
  };
}

// ---------- afwijking van het schema ----------

export interface DeviationPair {
  /** Gepland, maar niet op de vloer gezet (game-player-id). */
  plannedId: string;
  /** Niet gepland, maar wel op de vloer gezet (game-player-id). */
  actualId: string;
}

/** Verschillen tussen de volgende geplande opstelling en wat er nu op de vloer staat. */
export function deviationPairs(game: ActiveGame, plan: RotationPlan): DeviationPair[] {
  const next = nextPlannedLineup(game, plan);
  if (next == null) return [];
  const planned = next.filter((id) => !game.onCourt.includes(id));
  const actual = game.onCourt.filter((id) => !next.includes(id));
  return actual.map((actualId, k) => ({ actualId, plannedId: planned[k] ?? '' }));
}

function swapInLineup(lineup: number[], a: number, b: number): number[] {
  const hasA = lineup.includes(a);
  const hasB = lineup.includes(b);
  if (hasA && !hasB) return lineup.map((r) => (r === a ? b : r));
  if (hasB && !hasA) return lineup.map((r) => (r === b ? a : r));
  return lineup;
}

/**
 * Past de afwijking toe op alle blokken NA het volgende blok (dit kwart en de
 * latere kwarten): waar de geplande speler stond, komt de speler die nu echt
 * speelt, en andersom. Het eerstvolgende blok zelf wordt bij het vastleggen van
 * de wissel overgenomen (`adoptActualLineup`).
 */
export function propagateDeviation(game: ActiveGame, plan: RotationPlan): RotationPlan {
  const pairs = deviationPairs(game, plan)
    .map((p) => {
      const planned = game.players.find((pl) => pl.id === p.plannedId)?.rosterId;
      const actual = game.players.find((pl) => pl.id === p.actualId)?.rosterId;
      return planned !== undefined && actual !== undefined ? { planned, actual } : null;
    })
    .filter((p): p is { planned: number; actual: number } => p != null);
  if (pairs.length === 0) return plan;
  const current = currentBlockIndex(game, plan.quarters[String(game.curQuarter)]?.length ?? 1);
  const quarters: Record<string, PlanBlock[]> = {};
  for (const [key, blocks] of Object.entries(plan.quarters)) {
    const q = Number(key);
    quarters[key] = blocks.map((block, j) => {
      if (q < game.curQuarter || (q === game.curQuarter && j <= current + 1)) return block;
      const lineup = pairs.reduce(
        (l, pair) => swapInLineup(l, pair.planned, pair.actual),
        block.lineup,
      );
      return lineup === block.lineup ? block : { ...block, lineup };
    });
  }
  return { quarters };
}

/** Het volgende blok wordt de opstelling die nu echt op de vloer staat (na het vastleggen van een wissel). */
export function adoptActualLineup(game: ActiveGame, plan: RotationPlan): RotationPlan {
  const key = String(game.curQuarter);
  const blocks = plan.quarters[key];
  if (blocks == null) return plan;
  const i = currentBlockIndex(game, blocks.length);
  const next = blocks[i + 1];
  const actual = rosterIdsOf(game, game.onCourt);
  if (next == null || actual == null || actual.length !== PLAN_LINEUP_SIZE) return plan;
  const updated = blocks.map((b, j) => (j === i + 1 ? { ...b, lineup: actual } : b));
  return { quarters: { ...plan.quarters, [key]: updated } };
}

// ---------- bewerken ----------

function replaceBlocks(plan: RotationPlan, q: number, blocks: PlanBlock[]): RotationPlan {
  return { quarters: { ...plan.quarters, [String(q)]: blocks } };
}

export function setBlockLineup(
  plan: RotationPlan,
  q: number,
  i: number,
  lineup: number[],
): RotationPlan {
  const blocks = plan.quarters[String(q)];
  if (blocks == null || blocks[i] == null || !isValidLineup(lineup)) return plan;
  return replaceBlocks(
    plan,
    q,
    blocks.map((b, j) => (j === i ? { ...b, lineup: [...lineup] } : b)),
  );
}

/** Toegestane bandbreedte voor het wisselmoment van blok `i` (met 30 s marge aan beide kanten). */
export function blockTimeBounds(
  plan: RotationPlan,
  q: number,
  i: number,
  clockDown: boolean,
): { min: number; max: number } | null {
  const blocks = plan.quarters[String(q)];
  if (blocks == null || i < 0 || i >= blocks.length - 1) return null;
  const from = blockStartSec(plan, q, i, clockDown);
  const until = blocks[i + 1]?.toSec ?? quarterEndSec(clockDown);
  return {
    min: Math.min(from, until) + PLAN_TIME_STEP_SEC,
    max: Math.max(from, until) - PLAN_TIME_STEP_SEC,
  };
}

/** Verschuift het wisselmoment met `deltaSec` seconden; negeert een verschuiving buiten de grenzen. */
export function moveBlockTime(
  plan: RotationPlan,
  q: number,
  i: number,
  deltaSec: number,
  clockDown: boolean,
): RotationPlan {
  const blocks = plan.quarters[String(q)];
  const bounds = blockTimeBounds(plan, q, i, clockDown);
  const block = blocks?.[i];
  if (blocks == null || bounds == null || block == null) return plan;
  const next = block.toSec + deltaSec;
  if (next < bounds.min || next > bounds.max) return plan;
  return replaceBlocks(
    plan,
    q,
    blocks.map((b, j) => (j === i ? { ...b, toSec: next } : b)),
  );
}

/** Splitst het laatste blok van een kwart in twee (zelfde opstelling); `null` als er geen ruimte is. */
export function addBlock(plan: RotationPlan, q: number, clockDown: boolean): RotationPlan | null {
  const blocks = plan.quarters[String(q)];
  if (blocks == null || blocks.length >= PLAN_MAX_BLOCKS_PER_QUARTER) return null;
  const last = blocks[blocks.length - 1];
  if (last == null) return null;
  const from = blockStartSec(plan, q, blocks.length - 1, clockDown);
  const until = quarterEndSec(clockDown);
  const mid = Math.round((from + until) / 2 / PLAN_TIME_STEP_SEC) * PLAN_TIME_STEP_SEC;
  const lo = Math.min(from, until) + PLAN_TIME_STEP_SEC;
  const hi = Math.max(from, until) - PLAN_TIME_STEP_SEC;
  if (lo > hi) return null;
  const toSec = Math.max(lo, Math.min(hi, mid));
  return replaceBlocks(plan, q, [
    ...blocks.slice(0, -1),
    { toSec, lineup: [...last.lineup] },
    last,
  ]);
}

/** Verwijdert blok `i`; het vorige blok loopt dan door tot het einde van het verwijderde blok. */
export function removeBlock(plan: RotationPlan, q: number, i: number): RotationPlan {
  const blocks = plan.quarters[String(q)];
  const target = blocks?.[i];
  if (blocks == null || target == null || blocks.length < 2) return plan;
  const rest = blocks.filter((_, j) => j !== i);
  if (i === 0) return replaceBlocks(plan, q, rest);
  return replaceBlocks(
    plan,
    q,
    rest.map((b, j) => (j === i - 1 ? { ...b, toSec: target.toSec } : b)),
  );
}
