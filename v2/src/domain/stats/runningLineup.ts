import { openSegmentSummary } from '../game/liveCommands';
import type { ActiveGame } from '../game/types';

/**
 * R5 — de lopende lineup van een actieve wedstrijd, afgeleid uit het open
 * segment (punten/turnovers sinds het laatste vastgelegde segment, begin uit de
 * beginklok). Alleen weergave: er wordt niets opgeslagen en het is altijd
 * voorlopig, want het segment is nog niet vastgelegd. Bewust zonder duur,
 * per-10-waarden of weinig-minuten-markering: er is geen live klok, dus de duur
 * van het lopende segment is meestal 0 en zulke cijfers zouden niet kloppen.
 */
export interface RunningLineup {
  /** Gesorteerde `rosterId`'s van de vijf spelers. */
  rosterIds: number[];
  /** Klokstand (seconden) waarop het open segment begon: "sinds mm:ss". */
  sinceSec: number;
  pf: number;
  pa: number;
  tov: number;
}

/**
 * `null` buiten de trackingfase, zonder precies vijf bekende spelers of zonder
 * bruikbare spelerssnapshot. Bij een nog niet bevestigde wissel
 * (`pendingSwapLineup`) horen de punten van het open segment nog bij de lineup
 * van vóór de wissel; die tonen we dan, zodat getal en spelers kloppen.
 */
export function deriveRunningLineup(game: ActiveGame): RunningLineup | null {
  if (game.phase !== 'tracking') return null;
  const lineup = game.pendingSwapLineup ?? game.onCourt;
  if (lineup.length !== 5) return null;
  const byId = new Map(game.players.map((p) => [p.id, p.rosterId]));
  const rosterIds: number[] = [];
  for (const id of lineup) {
    const rosterId = byId.get(id);
    if (rosterId === undefined) return null;
    rosterIds.push(rosterId);
  }
  rosterIds.sort((a, b) => a - b);

  const open = openSegmentSummary(game);
  return {
    rosterIds,
    sinceSec: game.beginSec,
    pf: open.pointsFor,
    pa: open.pointsAgainst,
    tov: open.turnovers,
  };
}
