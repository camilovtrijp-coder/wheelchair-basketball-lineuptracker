import type { CompletedGame } from '../../domain/game/types';
import { buildLineupOverview, formatLineupClassNotation } from '../../domain/game/lineupOverview';
import { translate, type Lang, type StringKey } from '../../i18n/strings';

export interface LineupOverviewProps {
  lang: Lang;
  game: CompletedGame;
  tag1Label: string;
  tag2Label: string;
}

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

function fmtSec(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** R8: per gespeelde lineup tijd, stints, +/-, TO en kwarten — alleen weergave. */
export function LineupOverview({ lang, game, tag1Label, tag2Label }: LineupOverviewProps) {
  const rows = buildLineupOverview(game);
  return (
    <section className="lineup-overview" data-testid="history-lineup-overview">
      <h3 className="lineup-overview__title">{t(lang, 'lineupOverviewTitle')}</h3>
      <p className="segment-list__hint">{t(lang, 'lineupOverviewHint')}</p>
      {rows.length === 0 ? (
        <p className="history-empty" data-testid="history-lineup-overview-empty">
          {t(lang, 'lineupOverviewEmpty')}
        </p>
      ) : (
        <ol className="lineup-overview__list">
          {rows.map((row, i) => {
            const notation = formatLineupClassNotation(row, tag1Label, tag2Label);
            const pm = row.plusMinus;
            return (
              <li
                key={row.key}
                className="lineup-overview__item"
                data-testid={`history-lineup-${i}`}
                aria-label={t(lang, 'lineupOverviewAria').replace(
                  '{lineup}',
                  row.players.map((p) => p.nr).join('-'),
                )}
              >
                <div className="lineup-overview__head">
                  <span
                    className="lineup-overview__notation"
                    data-testid={`history-lineup-class-${i}`}
                  >
                    {notation}
                  </span>
                  <span
                    className={`lineup-overview__pm ${pm > 0 ? 'live-pm--pos' : pm < 0 ? 'live-pm--neg' : 'live-pm--flat'}`}
                    data-testid={`history-lineup-pm-${i}`}
                  >
                    {pm >= 0 ? '+' : ''}
                    {pm}
                  </span>
                </div>
                <ul className="lineup-overview__players">
                  {row.players.map((p) => (
                    <li key={p.id}>
                      <span className="lineup-overview__nr">{p.nr}</span> {p.naam}{' '}
                      <span className="lineup-overview__class">{p.kl}</span>
                    </li>
                  ))}
                </ul>
                <p className="lineup-overview__stats">
                  <span>
                    {t(lang, 'lineupOverviewPlayTime')} {fmtSec(row.sec)}
                  </span>
                  <span>
                    {row.stints} {t(lang, 'lineupOverviewStints')}
                  </span>
                  <span>
                    {row.pf}-{row.pa}
                  </span>
                  <span>
                    {t(lang, 'lineupOverviewTurnovers')} {row.turnovers}
                  </span>
                </p>
                <p
                  className="lineup-overview__quarters"
                  data-testid={`history-lineup-quarters-${i}`}
                >
                  {row.quarters.map((q) => `Q${q.quarter} ${fmtSec(q.sec)}`).join(' · ')}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
