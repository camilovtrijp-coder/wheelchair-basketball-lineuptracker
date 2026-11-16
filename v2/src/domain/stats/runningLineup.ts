import { openSegmentSummary } from '../game/liveCommands';
import { segDur } from '../game/tracking';
import type { ActiveGame } from '../game/types';
import { LOW_MINUTES_SEC, plusMinusPer10, turnoverRatePer10 } from './computeLineupStats';

/**
 * R5 — de lopende lineup van een actieve wedstrijd, afgeleid uit het open
 * segment (punten/turnovers sinds het laatste vastgelegde segment, duur uit de
 * begin-/eindklok). Alleen weergave: er wordt niets opgeslagen en het is altijd
 * voorlopig, want het segment is nog niet vastgelegd.
 */
export interface RunningLineup {
  /** Gesorteerde `rosterId`'s van de vijf spelers. */
  rosterIds: number[];
  durSec: number;
  pf: number;
  pa: number;
  tov: number;
  /** Plus/min per 10 min; `null` zonder speeltijd. */
  pmPer10: number | null;
  /** Turnovers per 10 min; `null` zonder speeltijd. */
  tovPer10: number | null;
  /** Minder dan 5:00 speeltijd in het open segment. */
  lowMinutes: boolean;
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
  const durSec = Math.max(0, segDur(game));
  return {
    rosterIds,
    durSec,
    pf: open.pointsFor,
    pa: open.pointsAgainst,
    tov: open.turnovers,
    pmPer10: plusMinusPer10(open.pointsFor - open.pointsAgainst, durSec),
    tovPer10: turnoverRatePer10(open.turnovers, durSec),
    lowMinutes: durSec < LOW_MINUTES_SEC,
  };
}
