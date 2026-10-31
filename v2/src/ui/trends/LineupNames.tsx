import type { RosterPlayer } from '../../domain/roster/types';
import type { AnalysisGame } from '../../domain/stats/types';
import { lineupNames } from './trendsShared';

/** Namen op een eigen, kleinere regel onder het nummerlabel van een lineup. */
export function LineupNames({
  rosterIds,
  games,
  roster,
}: {
  rosterIds: readonly number[];
  games: AnalysisGame[];
  roster: RosterPlayer[];
}) {
  const names = lineupNames(rosterIds, games, roster);
  if (names === '') return null;
  return (
    <span className="trends-lineup-names xs mut2" data-testid="trends-lineup-names">
      {names}
    </span>
  );
}
