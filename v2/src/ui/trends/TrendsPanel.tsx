import { useMemo, useState } from 'preact/hooks';
import type { CompletedGameRepository } from '../../application/game/CompletedGameRepository';
import { buildAnalysisScope } from '../../application/stats/buildAnalysisScope';
import {
  buildTrendViewModels,
  type TrendPlayerViewModel,
} from '../../application/trends/buildTrendViewModels';
import type { ActiveGame } from '../../domain/game/types';
import type { RosterPlayer } from '../../domain/roster/types';
import type { TrendsFilter, TrendsSortBy } from '../../domain/trends/types';
import type { LineupTurnoverRanking, TurnoverSummary } from '../../domain/trends/turnoverSummary';
import type { AnalysisGame } from '../../domain/stats/types';
import { fmtSeconds } from '../../domain/stats/format';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import { GamesFilterModal, toggleGameIdInSet } from '../shared/GamesFilterModal';

/**
 * PR 6.5 §D 6.5c — Trends-tab. Deelt de wedstrijdselectie (`gameIds`) met
 * Stats via props uit `app/App.tsx` (plan §C.2/§F); `per10` en de
 * sorteercyclus zijn eigen, niet-gedeelde tab-state (plan §B).
 */
export interface TrendsPanelProps {
  lang: Lang;
  repository: CompletedGameRepository;
  activeGame: ActiveGame | null;
  roster: RosterPlayer[];
  gameIds: Set<string> | null;
  onGameIdsChange: (next: Set<string> | null) => void;
}

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

function formatDate(iso: string, lang: Lang): string {
  try {
    return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'nl-NL');
  } catch {
    return '';
  }
}

function fmtPM(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)}`;
}

/** Geheel getal met expliciet teken, zoals de +/--tegel ("+7", "0", "-3"). */
function fmtSignedInt(n: number): string {
  const rounded = Math.round(n);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function fmtOne(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** Rugnummer van een speler: actuele roster eerst, anders de nieuwste spelerssnapshot, anders '?'. */
function nrFor(rosterId: number, games: AnalysisGame[], roster: RosterPlayer[]): string {
  const fromRoster = roster.find((p) => p.id === rosterId);
  if (fromRoster) return String(fromRoster.nr);
  for (const g of games) {
    const p = g.players.find((pl) => pl.rosterId === rosterId);
    if (p) return String(p.nr);
  }
  return '?';
}

function nextSortBy(current: TrendsSortBy): TrendsSortBy {
  return current === 'nr' ? 'minutes' : current === 'minutes' ? 'plusMinus' : 'nr';
}

function sortLabel(lang: Lang, sortBy: TrendsSortBy): string {
  if (sortBy === 'minutes') return t(lang, 'trendsMinLabel');
  if (sortBy === 'plusMinus') return t(lang, 'trendsPmLabel');
  return t(lang, 'trendsSortNr');
}

export function TrendsPanel({
  lang,
  repository,
  activeGame,
  roster,
  gameIds,
  onGameIdsChange,
}: TrendsPanelProps) {
  const scope = useMemo(() => buildAnalysisScope(repository, activeGame), [repository, activeGame]);
  const [per10, setPer10] = useState(false);
  const [sortBy, setSortBy] = useState<TrendsSortBy>('nr');
  const [gamesModalOpen, setGamesModalOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const filter: TrendsFilter = useMemo(
    () => ({ per10, sortBy, gameIds }),
    [per10, sortBy, gameIds],
  );

  const viewModel = useMemo(
    () => buildTrendViewModels(scope, roster, filter),
    [scope, roster, filter],
  );

  const showError = viewModel.dataOrigin === 'error';
  const showNoData = !showError && viewModel.players.length === 0;
  const partialMessage =
    viewModel.partialSegments === 1
      ? t(lang, 'statsPartialSingular')
      : viewModel.partialSegments > 1
        ? t(lang, 'statsPartialPlural').replace('{count}', String(viewModel.partialSegments))
        : null;

  return (
    <section className="trends-panel" aria-label={t(lang, 'trendsTitle')}>
      <h2>{t(lang, 'trendsTitle')}</h2>
      {showError ? (
        <p className="stats-empty stats-empty--error" data-testid="trends-read-error" role="alert">
          {t(lang, 'statsReadError')}
        </p>
      ) : null}
      {partialMessage !== null ? (
        <p className="stats-empty stats-empty--partial" data-testid="trends-partial" role="status">
          {partialMessage}
        </p>
      ) : null}

      <div className="stats-controls">
        <div className="stats-controls__row stats-controls__row--wrap">
          <button
            type="button"
            className={`btn-outline${per10 ? ' stats-toggle--active' : ''}`}
            data-testid="trends-per10-toggle"
            onClick={() => setPer10(!per10)}
            aria-pressed={per10}
          >
            {t(lang, 'statsPer10')}
          </button>
          <button
            type="button"
            className="btn-outline"
            data-testid="trends-games-btn"
            onClick={() => setGamesModalOpen(true)}
          >
            {t(lang, 'statsGamesBtn')} ({gameIds === null ? scope.games.length : gameIds.size})
          </button>
          <button
            type="button"
            className="btn-outline"
            data-testid="trends-sort-toggle"
            onClick={() => setSortBy(nextSortBy(sortBy))}
          >
            {t(lang, 'trendsSortLabel')}: {sortLabel(lang, sortBy)}
          </button>
        </div>
      </div>

      {!showNoData && !showError ? (
        <>
          {/* De totaalregel staat er altijd (ook bij 0); de lineup-ranglijst alleen als er turnovers zijn. */}
          <TurnoverSummaryBanner summary={viewModel.turnoverSummary} lang={lang} />
          {viewModel.turnoverSummary.tracked ? (
            <LineupTurnoverCard
              ranking={viewModel.lineupRanking}
              games={scope.games}
              roster={roster}
              lang={lang}
            />
          ) : null}
        </>
      ) : null}

      {showNoData ? (
        <p className="stats-empty" data-testid="trends-no-data">
          {t(lang, 'trendsNoData')}
        </p>
      ) : showError ? null : (
        <div className="trends-list" data-testid="trends-list">
          {viewModel.players.map((p) => (
            <PlayerTrendCard
              key={p.rosterId}
              player={p}
              lang={lang}
              per10={per10}
              showTurnovers={viewModel.turnoverSummary.tracked}
              expanded={expanded}
              setExpanded={setExpanded}
            />
          ))}
        </div>
      )}

      {gamesModalOpen ? (
        <GamesFilterModal
          lang={lang}
          scope={scope.games}
          selected={gameIds}
          onClose={() => setGamesModalOpen(false)}
          onToggle={(id) => {
            onGameIdsChange(
              toggleGameIdInSet(
                gameIds,
                id,
                scope.games.map((g) => g.id),
              ),
            );
          }}
          onClear={() => onGameIdsChange(new Set())}
          modalTestId="trends-games-modal"
          rowTestIdPrefix="trends-game-row"
          checkTestIdPrefix="trends-game-check"
        />
      ) : null}
    </section>
  );
}

function PlayerTrendCard({
  player,
  lang,
  per10,
  showTurnovers,
  expanded,
  setExpanded,
}: {
  player: TrendPlayerViewModel;
  lang: Lang;
  per10: boolean;
  showTurnovers: boolean;
  expanded: Set<number>;
  setExpanded: (updater: (prev: Set<number>) => Set<number>) => void;
}) {
  const isOpen = expanded.has(player.rosterId);

  return (
    <div className="card trends-card" data-testid={`trends-card-${player.rosterId}`}>
      <div className="row between trends-card__header">
        <span className="sm trends-card__name">
          #{player.nr} {player.naam}
        </span>
      </div>

      <div className="trends-tiles" data-testid={`trends-tiles-${player.rosterId}`}>
        <div className="trends-tile">
          <div className="trends-tile__k">{t(lang, 'trendsPmLabel')}</div>
          <div
            className={`trends-tile__n trends-avg-pm trends-avg-pm--${pmClassOf(player.totalPlusMinus)}`}
            data-testid={`trends-totalpm-${player.rosterId}`}
          >
            {fmtSignedInt(player.totalPlusMinus)}
          </div>
          <div className="trends-tile__sub">
            {t(lang, 'trendsAvgShort')}{' '}
            <b
              className={`trends-avg-pm trends-avg-pm--${pmClassOf(player.avgPlusMinus)}`}
              data-testid={`trends-avgpm-${player.rosterId}`}
            >
              {fmtPM(player.avgPlusMinus)}
            </b>
            {per10 ? '/10′' : ''}
          </div>
        </div>
        {showTurnovers ? (
          <div className="trends-tile trends-tile--tov">
            <div className="trends-tile__k">{t(lang, 'trendsTovLabel')}</div>
            <div className="trends-tile__n" data-testid={`trends-tov-${player.rosterId}`}>
              {player.totalTurnovers}
            </div>
            <div className="trends-tile__sub">
              {t(lang, 'trendsAvgShort')}{' '}
              <b data-testid={`trends-avgtov-${player.rosterId}`}>{fmtOne(player.avgTurnovers)}</b>
              {per10 ? '/10′' : ''}
            </div>
          </div>
        ) : null}
        <div className="trends-tile">
          <div className="trends-tile__k">{t(lang, 'trendsMinLabel')}</div>
          <div className="trends-tile__n" data-testid={`trends-avgmin-${player.rosterId}`}>
            {player.avgMinutes.toFixed(1)}
          </div>
        </div>
      </div>

      <div className="xs mut2" style={{ marginBottom: '0.2rem' }}>
        {t(lang, 'trendsPmChartLabel')}
      </div>
      <PlusMinusLineChart player={player} lang={lang} />

      <div className="xs mut2" style={{ margin: '0.5rem 0 0.2rem' }}>
        {t(lang, 'trendsMinChartLabel')}
      </div>
      <MinutesBarChart player={player} lang={lang} />

      <button
        type="button"
        className="btn-outline xs trends-card__toggle"
        data-testid={`trends-toggle-games-${player.rosterId}`}
        onClick={() =>
          setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(player.rosterId)) next.delete(player.rosterId);
            else next.add(player.rosterId);
            return next;
          })
        }
        aria-expanded={isOpen}
      >
        {isOpen
          ? t(lang, 'trendsHideGames')
          : t(lang, 'trendsShowGames').replace('{n}', String(player.points.length))}
      </button>

      {isOpen ? (
        <ul className="trends-card__games" data-testid={`trends-games-list-${player.rosterId}`}>
          {player.points
            .slice()
            .reverse()
            .map((pt) => (
              <li key={pt.gameId} className="row between xs mut trends-card__game-row">
                <span className="trends-card__game-opp">
                  {pt.provisional
                    ? t(lang, 'statsCurrentGame')
                    : pt.opponent || t(lang, 'teamOpponent')}
                  {pt.provisional ? (
                    <span
                      className="trends-provisional-badge"
                      data-testid={`trends-provisional-${player.rosterId}-${pt.gameId}`}
                    >
                      {t(lang, 'trendsProvisional')}
                    </span>
                  ) : null}
                  <span className="mut2 xs" style={{ marginLeft: '0.4rem' }}>
                    {formatDate(pt.date, lang)}
                  </span>
                </span>
                <span className="row tab trends-card__game-values">
                  <span>{fmtSeconds(pt.sec)}</span>
                  <span className={`trends-avg-pm trends-avg-pm--${pmClassOf(pt.pm)}`}>
                    {pt.pm >= 0 ? '+' : ''}
                    {pt.pm}
                  </span>
                </span>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

function TurnoverSummaryBanner({ summary, lang }: { summary: TurnoverSummary; lang: Lang }) {
  const gamesText =
    summary.games === 1
      ? t(lang, 'trendsTovGamesOne')
      : t(lang, 'trendsTovGamesMany').replace('{n}', String(summary.games));
  return (
    <div className="trends-tov-summary" data-testid="trends-tov-summary" role="status">
      <span>
        {t(lang, 'trendsTovTotalLabel')}
        <br />
        <b data-testid="trends-tov-total">{summary.turnovers}</b> {gamesText}
      </span>
      <span className="trends-tov-summary__right">
        {t(lang, 'statsPer10')}
        <br />
        <b data-testid="trends-tov-per10">{summary.per10 === null ? '–' : fmtOne(summary.per10)}</b>
      </span>
    </div>
  );
}

function LineupTurnoverCard({
  ranking,
  games,
  roster,
  lang,
}: {
  ranking: LineupTurnoverRanking;
  games: AnalysisGame[];
  roster: RosterPlayer[];
  lang: Lang;
}) {
  const maxPer10 = Math.max(0.1, ...ranking.rows.map((r) => r.per10));
  return (
    <div className="card trends-tov-lineups" data-testid="trends-tov-lineups">
      <div className="sm trends-tov-lineups__title">{t(lang, 'trendsTovLineupsTitle')}</div>
      <div className="xs mut2">{t(lang, 'trendsTovLineupsHint')}</div>
      {ranking.rows.length === 0 ? (
        <p className="xs mut2" data-testid="trends-tov-lineups-empty">
          {t(lang, 'trendsTovLineupsEmpty')}
        </p>
      ) : (
        ranking.rows.map((row) => {
          const nrs = row.rosterIds
            .map((id) => nrFor(id, games, roster))
            .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))
            .join('-');
          const key = row.rosterIds.join('-');
          return (
            <div
              key={key}
              className="trends-tov-row"
              data-testid={`trends-tov-lineup-${key}`}
              data-tone={row.tone}
            >
              <div className="trends-tov-row__top">
                <span>
                  {nrs} <span className="mut2">· {fmtSeconds(row.seconds)}</span>
                </span>
                <b
                  className={`trends-tov-row__v trends-tov-row__v--${row.tone}`}
                  data-testid={`trends-tov-lineup-value-${key}`}
                >
                  {fmtOne(row.per10)}
                </b>
              </div>
              <div className="trends-tov-bar" aria-hidden="true">
                <div
                  className={`trends-tov-bar__fill trends-tov-bar__fill--${row.tone}`}
                  style={{ width: `${Math.max(4, (row.per10 / maxPer10) * 100)}%` }}
                />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function pmClassOf(n: number): 'pos' | 'neg' | 'flat' {
  if (n > 0) return 'pos';
  if (n < 0) return 'neg';
  return 'flat';
}

/**
 * Toegankelijke SVG-lijngrafiek (plan §C.3): een `<title>` geeft de grafiek
 * een naam, en een altijd-aanwezige (niet van de uitklapstaat afhankelijke)
 * screenreader-only lijst met per-punt datum/tegenstander/waarde/voorlopig
 * (`aria-describedby`) is de vereiste tekstalternatief per punt — vóór PR
 * 6.5-review stonden die exacte waarden alleen in de conditioneel
 * gerenderde uitklaplijst, dus niet bereikbaar zonder eerst uit te klappen.
 * Kleur (rood/groen) is zo nooit het enige onderscheid.
 */
function pointSummaryText(
  lang: Lang,
  opponent: string,
  date: string,
  provisional: boolean,
  valueText: string,
): string {
  const oppLabel = provisional ? t(lang, 'statsCurrentGame') : opponent || t(lang, 'teamOpponent');
  const dateLabel = formatDate(date, lang);
  const suffix = provisional ? `, ${t(lang, 'trendsProvisional')}` : '';
  return `${dateLabel} ${oppLabel}: ${valueText}${suffix}`;
}

function PlusMinusLineChart({ player, lang }: { player: TrendPlayerViewModel; lang: Lang }) {
  const { width, height, zeroY, points } = player.lineChart;
  const polyline = points.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const titleId = `trends-line-title-${player.rosterId}`;
  const pointsId = `trends-line-points-${player.rosterId}`;
  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={pointsId}
        style={{ width: '100%', height: '4.75rem', display: 'block' }}
        preserveAspectRatio="none"
        data-testid={`trends-line-chart-${player.rosterId}`}
      >
        <title id={titleId}>
          {t(lang, 'trendsPmChartLabel')} — #{player.nr} {player.naam}
        </title>
        <line
          x1={0}
          y1={zeroY}
          x2={width}
          y2={zeroY}
          stroke="var(--line-bright)"
          strokeWidth={1}
          strokeDasharray="3,3"
        />
        {points.length > 1 ? (
          <polyline
            points={polyline}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {points.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={c.provisional ? 4.5 : 3.5}
            fill={c.value >= 0 ? 'var(--emerald)' : 'var(--rose)'}
            stroke="var(--card)"
            strokeWidth={c.provisional ? 2 : 1.5}
          />
        ))}
      </svg>
      <ul id={pointsId} className="sr-only" data-testid={`trends-line-points-${player.rosterId}`}>
        {player.points.map((pt, i) => (
          <li key={pt.gameId}>
            {pointSummaryText(
              lang,
              pt.opponent,
              pt.date,
              pt.provisional,
              fmtPM(player.lineChart.points[i]!.value),
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function MinutesBarChart({ player, lang }: { player: TrendPlayerViewModel; lang: Lang }) {
  const titleId = `trends-bar-title-${player.rosterId}`;
  const pointsId = `trends-bar-points-${player.rosterId}`;
  return (
    <div
      className="row trends-bar-chart"
      role="img"
      aria-labelledby={titleId}
      aria-describedby={pointsId}
      data-testid={`trends-bar-chart-${player.rosterId}`}
    >
      <span id={titleId} className="sr-only">
        {t(lang, 'trendsMinChartLabel')} — #{player.nr} {player.naam}
      </span>
      <ul id={pointsId} className="sr-only" data-testid={`trends-bar-points-${player.rosterId}`}>
        {player.points.map((pt, i) => (
          <li key={pt.gameId}>
            {pointSummaryText(
              lang,
              pt.opponent,
              pt.date,
              pt.provisional,
              `${player.barChart.bars[i]!.minutes.toFixed(1)} ${t(lang, 'trendsMinLabel')}`,
            )}
          </li>
        ))}
      </ul>
      {player.barChart.bars.map((b, i) => (
        <div key={i} className="trends-bar-chart__col">
          <span className="mut2 tab trends-bar-chart__value">{b.minutes.toFixed(0)}</span>
          <div className="trends-bar-chart__track">
            <div
              className={`trends-bar-chart__bar${b.provisional ? ' trends-bar-chart__bar--provisional' : ''}`}
              style={{ height: `${b.pct.toFixed(0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
