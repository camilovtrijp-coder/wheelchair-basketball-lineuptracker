import { useMemo } from 'preact/hooks';
import { fmtSeconds } from '../../domain/stats/format';
import { computeStartCloseLineups, type StartCloseRow } from '../../domain/trends/lineupExtras';
import {
  fill,
  fmtSignedInt,
  gamesText,
  lineupKey,
  lineupLabel,
  t,
  type TrendsViewProps,
} from './trendsShared';

/**
 * Kaart "Start- en sluitlineup" (T7). Per wedstrijd telt precies één segment per
 * kant (eerste van kwart 1, laatste van het laatste kwart; volgorde volgens plan
 * §F.3 in `computeStartCloseLineups`). Per lineup worden de minuten, het totaal
 * +/- en het aantal wedstrijden getoond; bewust GEEN toon of oordeel, want de
 * steekproef is per wedstrijd één segment. Is de volgorde in minstens één
 * wedstrijd onbetrouwbaar (`orderReliable === false`), dan staat er een
 * waarschuwing met het aantal betrokken wedstrijden.
 */

/** Maximaal aantal rijen per kant; de rest wordt als aantal samengevat. */
const MAX_ROWS = 5;

export function LineupStartCloseCard(props: TrendsViewProps) {
  const { lang, games, gameIds, roster } = props;
  const result = useMemo(() => computeStartCloseLineups(games, gameIds), [games, gameIds]);

  const renderSide = (side: 'start' | 'close', rows: StartCloseRow[]) => {
    const titleKey =
      side === 'start' ? 'trendsLineupsExtraStartTitle' : 'trendsLineupsExtraCloseTitle';
    const shown = rows.slice(0, MAX_ROWS);
    return (
      <div className="trends-startclose__side" data-testid={`trends-startclose-${side}`}>
        <h4 className="xs trends-extra-card__sub">{t(lang, titleKey)}</h4>
        {rows.length === 0 ? (
          <p className="xs mut2">{t(lang, 'trendsLineupsExtraStartCloseNoSide')}</p>
        ) : (
          <ol className="trends-combo-list">
            {shown.map((r) => {
              const key = lineupKey(r.rosterIds);
              const label = lineupLabel(r.rosterIds, games, roster);
              const aria = fill(t(lang, 'trendsLineupsExtraStartCloseAria'), {
                lineup: label,
                time: fmtSeconds(r.seconds),
                pm: fmtSignedInt(r.pm),
                games: gamesText(lang, r.games),
              });
              return (
                <li
                  key={key}
                  className="trends-startclose-row"
                  data-testid={`trends-startclose-${side}-${key}`}
                  aria-label={aria}
                >
                  <span className="trends-combo-row__name">{label}</span>
                  <span className="xs mut2 trends-startclose-row__meta">
                    {fmtSeconds(r.seconds)} · {t(lang, 'trendsPmLabel')} {fmtSignedInt(r.pm)} ·{' '}
                    {gamesText(lang, r.games)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {rows.length > shown.length ? (
          <p className="xs mut2">
            {fill(t(lang, 'trendsLineupsExtraStartCloseMore'), { n: rows.length - shown.length })}
          </p>
        ) : null}
      </div>
    );
  };

  const empty = result.start.length === 0 && result.close.length === 0;
  const unreliable = result.unreliableGameIds.length;

  return (
    <section className="card trends-extra-card" data-testid="trends-startclose-card">
      <h3 className="sm trends-extra-card__title">
        {t(lang, 'trendsLineupsExtraStartCloseTitle')}
      </h3>
      {!result.orderReliable ? (
        <p className="trends-warning" role="note" data-testid="trends-startclose-unreliable">
          <span aria-hidden="true">⚠ </span>
          {unreliable === 1
            ? t(lang, 'trendsLineupsExtraUnreliableOne')
            : fill(t(lang, 'trendsLineupsExtraUnreliableMany'), { n: unreliable })}
        </p>
      ) : null}
      {empty ? (
        <p className="xs mut2" data-testid="trends-startclose-empty">
          {t(lang, 'trendsLineupsExtraStartCloseEmpty')}
        </p>
      ) : (
        <>
          {renderSide('start', result.start)}
          {renderSide('close', result.close)}
        </>
      )}
      <p className="xs mut2 trends-extra-card__note" data-testid="trends-startclose-explain">
        {t(lang, 'trendsLineupsExtraStartCloseExplain')}
      </p>
    </section>
  );
}
