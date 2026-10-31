import type { LineupRow } from '../../domain/trends/lineupInsights';

/**
 * Presentatievolgorde voor modus "Totaal" (review-fix M1): de rijen staan op
 * de GETOONDE waarde, het totaal +/- (voor min tegen), hoogste eerst. Tiebreak
 * conform §E.4: meer minuten eerst, daarna de canonieke sleutel. Een nieuwe
 * array; `computeLineupInsights` en zijn per-10-volgorde blijven ongewijzigd.
 */
export function orderByTotalPm(rows: readonly LineupRow[]): LineupRow[] {
  return [...rows].sort((a, b) => {
    if (a.pm !== b.pm) return b.pm - a.pm;
    if (a.seconds !== b.seconds) return b.seconds - a.seconds;
    const ak = a.rosterIds.join(',');
    const bk = b.rosterIds.join(',');
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
}
