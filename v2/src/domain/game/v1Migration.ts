import { scoreDeltaAction, segmentSavedAction } from './tracking';
import {
  MAX_CLOCK_MINUTES,
  type ActiveGame,
  type GameAction,
  type GamePlayer,
  type Segment,
} from './types';

/**
 * v1's enige actieve-wedstrijd-sleutel (index.html: `STORAGE_KEY`) — anders
 * dan settings/roster (die dezelfde key als v1 hergebruiken, zie
 * domain/settings/types.ts / domain/roster/types.ts), kreeg de wedstrijd in
 * PR 6.1 een nieuwe, per-organisatie/team-sleutel (v1 kende geen org/team-
 * context). Zonder deze fallback zou een nog actieve v1-wedstrijd bij een
 * upgrade naar v2 nergens meer verschijnen — docs/IMPLEMENTATION_PLAN.md
 * §11 (PR 6.1) eist expliciet dat de v1-sleutel "tijdens de
 * compatibiliteitsperiode leesbaar blijft".
 */
export const V1_ACTIVE_GAME_STORAGE_KEY = 'lineup-tracker-v1';

/**
 * Precies v1's `init()`-hervattingsvoorwaarde (index.html, IIFE onderaan):
 * `saved.players && (saved.phase === "tracking" || (saved.segments &&
 * saved.segments.length > 0))`. Een nog-niet-gestarte v1-opzet wordt bewust
 * NIET geadopteerd — net zoals v2 zelf een `phase: 'setup'`-wedstrijd nooit
 * hervat (zie App.tsx), zou dat alleen de huidige roster-opzet verdringen.
 */
function isV1Resumable(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.players)) return false;
  const segments = Array.isArray(v.segments) ? v.segments : [];
  return v.phase === 'tracking' || segments.length > 0;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Bouwt een remap-functie van v1's rugnummerloze speler-`id` (het enige
 * ID dat v1 kent — tegelijk roster-ID én "wie staat er op het veld"-ID,
 * zie index.html `tapPlayer()`/`state.onCourt`) naar v2's stabiele
 * `GamePlayer.id`-UUID (zie domain/game/types.ts). Onbekende ID's (zou bij
 * consistente v1-data nooit voorkomen) worden stilzwijgend overgeslagen in
 * plaats van een halve/ongeldige lineup te produceren.
 */
function remapIds(ids: unknown, idMap: Map<number, string>): string[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .map((id) => (typeof id === 'number' ? idMap.get(id) : undefined))
    .filter((id): id is string => id !== undefined);
}

function migratedTimestamp(value: unknown): string {
  // v1: `state.savedAt` is `Date.now()` (ms epoch), niet ISO — de dichtstbijzijnde
  // benadering die v1 bijhoudt van "wanneer is hieraan gewerkt"; v1 kent geen
  // aparte aanmaak-/starttijd, dus zowel createdAt als startedAt gebruiken dit.
  return typeof value === 'number' ? new Date(value).toISOString() : new Date().toISOString();
}

/**
 * Migreert v1's opgeslagen `state`-blob (localStorage-key `lineup-tracker-v1`)
 * naar v2's `ActiveGame`-schema, of `null` als er niets bruikbaars is om te
 * adopteren (zie `isV1Resumable`). v1 kent geen actielog: elk opgeslagen
 * segment wordt gereconstrueerd als een `score-delta`(pf/pa) gevolgd door een
 * `segment-saved`-actie — exact de acties die `deriveGameHistory()` nodig
 * heeft om v1's `segStartFor`/`segStartAgainst`-invariant te reproduceren
 * (zie domain/game/tracking.ts `applyAction`'s `segment-saved`-tak: die
 * bevriest de dan-actuele score als nieuwe segmentbasis, telt zelf niets op).
 * De nog niet in een segment vastgelegde "lopende" score-toename
 * (`scoreFor - segStartFor` in v1) wordt als laatste met een extra
 * `score-delta` toegevoegd, zodat de eindstand exact overeenkomt.
 */
export function migrateV1ActiveGame(
  raw: unknown,
  organizationId: string,
  teamId: string,
): ActiveGame | null {
  if (!isV1Resumable(raw)) return null;
  const v = raw;

  const idMap = new Map<number, string>();
  const players: GamePlayer[] = (v.players as unknown[]).map((rawPlayer) => {
    const p = (typeof rawPlayer === 'object' && rawPlayer !== null ? rawPlayer : {}) as Record<
      string,
      unknown
    >;
    const rosterId = num(p.id, 0);
    const gamePlayerId = crypto.randomUUID();
    idMap.set(rosterId, gamePlayerId);
    return {
      id: gamePlayerId,
      rosterId,
      nr: str(p.nr, ''),
      naam: str(p.naam, ''),
      kl: str(p.kl, ''),
      vrouw: p.vrouw === true,
      jeugd: p.jeugd === true,
      participate: p.participate !== false,
      start: p.start === true,
    };
  });

  const onCourt = remapIds(v.onCourt, idMap);

  const v1Segments = Array.isArray(v.segments) ? v.segments : [];
  const segments: Segment[] = v1Segments.map((rawSegment) => {
    const s = (typeof rawSegment === 'object' && rawSegment !== null ? rawSegment : {}) as Record<
      string,
      unknown
    >;
    return {
      id: crypto.randomUUID(),
      quarter: num(s.quarter, 1),
      beginSec: num(s.beginSec, 0),
      endSec: num(s.endSec, 0),
      durSec: num(s.durSec, 0),
      lineup: remapIds(s.lineup, idMap),
      pf: num(s.pf, 0),
      pa: num(s.pa, 0),
      classSum: num(s.classSum, 0),
      allowed: num(s.allowed, 0),
      over: s.over === true,
    };
  });

  const actions: GameAction[] = [];
  for (const segment of segments) {
    if (segment.pf !== 0) actions.push(scoreDeltaAction('for', segment.pf));
    if (segment.pa !== 0) actions.push(scoreDeltaAction('against', segment.pa));
    actions.push(segmentSavedAction(segment));
  }
  const scoreFor = num(v.scoreFor, 0);
  const scoreAgainst = num(v.scoreAgainst, 0);
  const liveFor = scoreFor - num(v.segStartFor, 0);
  const liveAgainst = scoreAgainst - num(v.segStartAgainst, 0);
  if (liveFor !== 0) actions.push(scoreDeltaAction('for', liveFor));
  if (liveAgainst !== 0) actions.push(scoreDeltaAction('against', liveAgainst));

  const clockDown = v.clockDown !== false;
  const beginMin = num(v.beginMin, clockDown ? MAX_CLOCK_MINUTES : 0);
  const endMin = num(v.endMin, beginMin);
  const timestamp = migratedTimestamp(v.savedAt);

  return {
    id: crypto.randomUUID(),
    organizationId,
    teamId,
    phase: 'tracking',
    players,
    opponent: str(v.opponent, ''),
    competition: str(v.competition, ''),
    clockDown,
    limitStr: str(v.limitStr, ''),
    onCourt,
    curQuarter: num(v.curQuarter, 1),
    beginSec: beginMin * 60 + num(v.beginSec, 0),
    endSec: endMin * 60 + num(v.endSec, 0),
    pendingSwapLineup: null,
    actions,
    createdAt: timestamp,
    startedAt: timestamp,
  };
}
