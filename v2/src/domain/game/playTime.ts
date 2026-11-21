import type { Segment } from './types';

/**
 * Speeltijd per speler (Rustig, R7): de som van `durSec` van alle vastgelegde
 * segmenten waarin de speler in de lineup stond. Alleen weergave; de
 * statistiekberekeningen blijven ongewijzigd. Het open segment heeft geen
 * lopende klok en telt dus niet mee ("t/m de laatste wissel"). Voorlopige
 * (onbevestigde) tijden zijn gewone opgeslagen segmenten en tellen wel mee.
 */
export function playTimeByPlayer(segments: Segment[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const segment of segments) {
    for (const id of new Set(segment.lineup)) {
      totals[id] = (totals[id] ?? 0) + segment.durSec;
    }
  }
  return totals;
}
