import { useMemo } from 'preact/hooks';
import { computeConsistency, type ConsistencyRow } from '../../domain/trends/lineupExtras';
import type { Lang } from '../../i18n/strings';
import { fill, lineupKey, t, type TrendsViewProps } from './trendsShared';

/**
 * Kleine bouwstenen van de +/--lineupkaart (T7): de sorteeroptie "waarde |
 * voorzichtig" en de consistentieregel "x van n wedstrijden positief".
 * Beide zijn alleen presentatie bovenop `lineups.rows`; er wordt niets opgeslagen.
 */

export type LineupSort = 'value' | 'careful';

/** Sorteerkeuze (sessiestate in de aanroeper) plus de vaste uitleg bij "voorzichtig". */
export function LineupSortControl({
  lang,
  sort,
  onChange,
}: {
  lang: Lang;
  sort: LineupSort;
  onChange: (next: LineupSort) => void;
}) {
  return (
    <div className="trends-lineup-sort" data-testid="trends-lineup-sort">
      <div
        className="trends-metric"
        role="group"
        aria-label={t(lang, 'trendsLineupsExtraSortLabel')}
      >
        <span className="xs mut2 trends-lineup-sort__label" aria-hidden="true">
          {t(lang, 'trendsLineupsExtraSortLabel')}:
        </span>
        {(['value', 'careful'] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={`trends-metric__btn${sort === id ? ' trends-metric__btn--active' : ''}`}
            data-testid={`trends-lineup-sort-${id}`}
            aria-pressed={sort === id}
            onClick={() => onChange(id)}
          >
            {t(
              lang,
              id === 'value' ? 'trendsLineupsExtraSortValue' : 'trendsLineupsExtraSortCareful',
            )}
          </button>
        ))}
      </div>
      {sort === 'careful' ? (
        <>
          <span className="trends-lineup-sort__badge xs" data-testid="trends-lineup-sort-badge">
            {t(lang, 'trendsLineupsExtraSortBadge')}
          </span>
          <p className="xs mut2" data-testid="trends-lineup-sort-explain">
            {t(lang, 'trendsLineupsExtraSortExplain')} {t(lang, 'trendsLineupsExtraSortShown')}
          </p>
        </>
      ) : null}
    </div>
  );
}

/**
 * Consistentie per vijftal (`computeConsistency`, size 5, zelfde drempel als de
 * lijst). Sleutel = `lineupKey(rosterIds)`, gelijk aan de lijstrijen.
 */
export function useLineupConsistency(
  props: TrendsViewProps,
  enabled: boolean,
): Map<string, ConsistencyRow> {
  const { games, gameIds, minSec } = props;
  return useMemo(() => {
    const map = new Map<string, ConsistencyRow>();
    if (!enabled) return map;
    for (const row of computeConsistency(games, gameIds, 5, minSec)) {
      map.set(lineupKey(row.rosterIds), row);
    }
    return map;
  }, [enabled, games, gameIds, minSec]);
}

/** "x van n wedstrijden positief (n klein)"; geen SD en geen percentage. */
export function LineupConsistencyLine({
  lang,
  row,
  testId,
}: {
  lang: Lang;
  row: ConsistencyRow | undefined;
  testId: string;
}) {
  if (!row) return null;
  const text =
    row.gamesPlayed === 1
      ? fill(t(lang, 'trendsLineupsExtraConsistencyOne'), { x: row.gamesPositive })
      : fill(t(lang, 'trendsLineupsExtraConsistency'), {
          x: row.gamesPositive,
          n: row.gamesPlayed,
        });
  return (
    <div className="xs mut2 trends-lineup-consistency" data-testid={testId}>
      {text} {t(lang, 'trendsLineupsExtraSmallN')}
    </div>
  );
}
