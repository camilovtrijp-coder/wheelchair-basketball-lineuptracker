import { useMemo } from 'preact/hooks';
import { fmtPlusMinus, fmtSeconds } from '../../domain/stats/format';
import { selectGames } from '../../domain/trends/trendsScope';
import { computeTurnoverSummary, type TurnoverSummary } from '../../domain/trends/turnoverSummary';
import { fill, fmtOne, fmtSignedInt, gamesText, t, type TrendsViewProps } from './trendsShared';

/**
 * Weergave "Overzicht" (T3): de teamkaart "Totaal turnovers" (ongewijzigd,
 * testids `trends-tov-*`) en kaartjes met team +/-, Voor, Tegen en turnovers
 * per 10 min (of totaal, volgens de chip "Per 10 min"), plus speeltijd en
 * aantal wedstrijden. Alles komt uit `props.lineups.team` en
 * `computeTurnoverSummary`; er is geen eigen rekenlogica.
 *
 * Invoer: `TrendsViewProps` (zie `trendsShared.ts`). Deze weergave leest
 * `lang`, `games`, `gameIds`, `per10` en `lineups`.
 */
export function OverviewView(props: TrendsViewProps) {
  const { lang, games, gameIds, per10, lineups } = props;
  const team = lineups.team;
  const gameCount = useMemo(() => selectGames(games, gameIds).length, [games, gameIds]);
  const summary = useMemo(() => computeTurnoverSummary(games, gameIds), [games, gameIds]);
  const hasTime = team.seconds > 0;

  const unit = per10 ? t(lang, 'trendsUnitPer10') : t(lang, 'trendsUnitTotal');
  const otherUnit = per10 ? t(lang, 'trendsUnitTotal') : t(lang, 'trendsUnitPer10');

  return (
    <div className="trends-overview" data-testid="trends-overview">
      <TurnoverSummaryBanner summary={summary} lang={lang} />

      <div className="card trends-team" data-testid="trends-team-card">
        <div className="sm trends-team__title">{t(lang, 'trendsOverviewTeamTitle')}</div>
        <div className="xs mut2" data-testid="trends-team-meta">
          {gamesText(lang, gameCount)} ·{' '}
          {fill(t(lang, 'trendsOverviewPlayTime'), { time: fmtSeconds(team.seconds) })}
        </div>
        {hasTime ? (
          <div className="trends-kpis">
            <Kpi
              testId="trends-team-pm"
              label={`${t(lang, 'trendsOverviewPm')} ${unit}`}
              value={per10 ? fmtPlusMinus(team.pmPer10 ?? 0) : fmtSignedInt(team.pm)}
              sub={`${otherUnit} ${per10 ? fmtSignedInt(team.pm) : fmtPlusMinus(team.pmPer10 ?? 0)}`}
            />
            <Kpi
              testId="trends-team-for"
              label={`${t(lang, 'trendsFor')} ${unit}`}
              value={per10 ? fmtOne(team.pfPer10 ?? 0) : String(team.pf)}
              sub={`${otherUnit} ${per10 ? team.pf : fmtOne(team.pfPer10 ?? 0)}`}
            />
            <Kpi
              testId="trends-team-against"
              label={`${t(lang, 'trendsAgainst')} ${unit}`}
              value={per10 ? fmtOne(team.paPer10 ?? 0) : String(team.pa)}
              sub={`${otherUnit} ${per10 ? team.pa : fmtOne(team.paPer10 ?? 0)}`}
            />
            {summary.tracked ? (
              <Kpi
                testId="trends-team-tov"
                label={`${t(lang, 'trendsOverviewTov')} ${unit}`}
                value={per10 ? fmtOne(team.tovPer10 ?? 0) : String(team.tov)}
                sub={`${otherUnit} ${per10 ? team.tov : fmtOne(team.tovPer10 ?? 0)}`}
              />
            ) : null}
          </div>
        ) : (
          <p className="xs mut2" data-testid="trends-team-empty">
            {t(lang, 'trendsOverviewNoTime')}
          </p>
        )}
      </div>

      {/* T6: classificatieprofiel en datakwaliteitswaarschuwingen komen hier. */}
    </div>
  );
}

function Kpi({
  testId,
  label,
  value,
  sub,
}: {
  testId: string;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="trends-kpi">
      <div className="trends-kpi__k">{label}</div>
      <div className="trends-kpi__n" data-testid={testId}>
        {value}
      </div>
      <div className="trends-kpi__sub">{sub}</div>
    </div>
  );
}

function TurnoverSummaryBanner({
  summary,
  lang,
}: {
  summary: TurnoverSummary;
  lang: TrendsViewProps['lang'];
}) {
  const gamesTextValue =
    summary.games === 1
      ? t(lang, 'trendsTovGamesOne')
      : t(lang, 'trendsTovGamesMany').replace('{n}', String(summary.games));
  return (
    <div className="trends-tov-summary" data-testid="trends-tov-summary" role="status">
      <span>
        {t(lang, 'trendsTovTotalLabel')}
        <br />
        <b data-testid="trends-tov-total">{summary.turnovers}</b> {gamesTextValue}
      </span>
      <span className="trends-tov-summary__right">
        {t(lang, 'statsPer10')}
        <br />
        <b data-testid="trends-tov-per10">{summary.per10 === null ? '–' : fmtOne(summary.per10)}</b>
      </span>
    </div>
  );
}
