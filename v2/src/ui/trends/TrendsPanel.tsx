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
  expanded,
  setExpanded,
}: {
  player: TrendPlayerViewModel;
  lang: Lang;
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
        <span className="xs mut2 trends-card__avg">
          {t(lang, 'trendsMinLabel')}{' '}
          <b data-testid={`trends-avgmin-${player.rosterId}`}>{player.avgMinutes.toFixed(1)}</b>
          &nbsp;{t(lang, 'trendsPmLabel')}{' '}
          <b
            className={`trends-avg-pm trends-avg-pm--${pmClassOf(player.avgPlusMinus)}`}
            data-testid={`trends-avgpm-${player.rosterId}`}
          >
            {fmtPM(player.avgPlusMinus)}
          </b>
        </span>
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

function pmClassOf(n: number): 'pos' | 'neg' | 'flat' {
  if (n > 0) return 'pos';
  if (n < 0) return 'neg';
  return 'flat';
}

/**
 * Toegankelijke SVG-lijngrafiek (plan §C.3): een `<title>`/`<desc>` geven de
 * grafiek een naam; de exacte waarden staan daarnaast altijd in de
 * uitklaplijst (`trends-games-list-*`), zodat kleur nooit het enige
 * onderscheid is.
 */
function PlusMinusLineChart({ player, lang }: { player: TrendPlayerViewModel; lang: Lang }) {
  const { width, height, zeroY, points } = player.lineChart;
  const polyline = points.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const titleId = `trends-line-title-${player.rosterId}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-labelledby={titleId}
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
  );
}

function MinutesBarChart({ player, lang }: { player: TrendPlayerViewModel; lang: Lang }) {
  const titleId = `trends-bar-title-${player.rosterId}`;
  return (
    <div
      className="row trends-bar-chart"
      role="img"
      aria-labelledby={titleId}
      data-testid={`trends-bar-chart-${player.rosterId}`}
    >
      <span id={titleId} className="sr-only">
        {t(lang, 'trendsMinChartLabel')} — #{player.nr} {player.naam}
      </span>
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
