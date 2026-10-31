import { useMemo, useState } from 'preact/hooks';
import {
  buildTrendViewModels,
  type TrendPlayerViewModel,
} from '../../application/trends/buildTrendViewModels';
import { fmtSeconds } from '../../domain/stats/format';
import { computeStints, type PlayerStints } from '../../domain/trends/lineupExtras';
import { computeOnOffImpact, type OnOffRow } from '../../domain/trends/onOffImpact';
import type { TrendsFilter, TrendsSortBy } from '../../domain/trends/types';
import type { Lang } from '../../i18n/strings';
import { OnOffBlock, OnOffRowSummary, StintsBlock, offMinSecFor } from './PlayersOnOff';
import { fmtOne, fmtSignedInt, formatDate, t, type TrendsViewProps } from './trendsShared';

/**
 * Weergave "Spelers" (T3): de bestaande spelerkaarten als compacte rijen die
 * uitklappen tot de volledige kaart. De spelertrendgetallen komen ONGEWIJZIGD
 * uit `buildTrendViewModels`/`computePlayerTrends` (v1-contract: per punt
 * eerst genormaliseerd, dan gemiddeld). De rij vat samen: naam/rugnummer,
 * gemiddelde minuten, totaal +/- en (indien bijgehouden) turnovers van het
 * team terwijl de speler speelde. De sorteerchip "Sorteer: Nr" hoort bij deze
 * weergave en is alleen hier state.
 *
 * Testids: `trends-list`, `trends-card-{rosterId}` (rij + kaart), de rijtoggle
 * `trends-row-toggle-{rosterId}` en daarbinnen de bestaande kaarttestids
 * (`trends-totalpm-*`, `trends-avgpm-*`, `trends-tov-*`, `trends-avgmin-*`,
 * `trends-toggle-games-*`, ...), zichtbaar zodra de rij is uitgeklapt.
 *
 * Invoer: `TrendsViewProps` (zie `trendsShared.ts`); gelezen worden `lang`,
 * `scope`, `gameIds`, `per10` en `roster`.
 */

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

export function PlayersView(props: TrendsViewProps) {
  const { lang, scope, games, gameIds, per10, minSec, roster } = props;
  const [sortBy, setSortBy] = useState<TrendsSortBy>('nr');
  const [openRows, setOpenRows] = useState<Set<number>>(new Set());

  const filter: TrendsFilter = useMemo(
    () => ({ per10, sortBy, gameIds }),
    [per10, sortBy, gameIds],
  );
  const viewModel = useMemo(
    () => buildTrendViewModels(scope, roster, filter),
    [scope, roster, filter],
  );
  const showTurnovers = viewModel.turnoverSummary.tracked;

  // T4/T7: pure berekeningen op de gedeelde, al ingelezen wedstrijden (geen extra reads of opslag).
  const onOffById = useMemo(() => {
    const m = new Map<number, OnOffRow>();
    // Besluit I.3: on-kant = filterbalkdrempel, off-kant minstens 10:00 (tenzij de drempel uit staat).
    const thresholds = { onMinSec: minSec, offMinSec: offMinSecFor(minSec) };
    for (const r of computeOnOffImpact(games, gameIds, roster, thresholds)) m.set(r.rosterId, r);
    return m;
  }, [games, gameIds, roster, minSec]);
  const stintsResult = useMemo(
    () => computeStints(games, gameIds, roster),
    [games, gameIds, roster],
  );
  const stintsById = useMemo(() => {
    const m = new Map<number, PlayerStints>();
    for (const p of stintsResult.players) m.set(p.rosterId, p);
    return m;
  }, [stintsResult]);

  function toggleRow(rosterId: number): void {
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(rosterId)) next.delete(rosterId);
      else next.add(rosterId);
      return next;
    });
  }

  return (
    <div className="trends-players" data-testid="trends-players">
      <div className="stats-controls">
        <div className="stats-controls__row stats-controls__row--wrap">
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

      {viewModel.players.length === 0 ? (
        <p className="stats-empty" data-testid="trends-no-data">
          {t(lang, 'trendsNoData')}
        </p>
      ) : (
        <div
          className="trends-list"
          data-testid="trends-list"
          role="list"
          aria-label={t(lang, 'trendsPlayersListLabel')}
        >
          {viewModel.players.map((p) => (
            <PlayerRow
              key={p.rosterId}
              player={p}
              lang={lang}
              per10={per10}
              showTurnovers={showTurnovers}
              onOff={onOffById.get(p.rosterId)}
              stints={stintsById.get(p.rosterId)}
              orderReliable={stintsResult.orderReliable}
              minSec={minSec}
              open={openRows.has(p.rosterId)}
              onToggle={() => toggleRow(p.rosterId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerRow({
  player,
  lang,
  per10,
  showTurnovers,
  onOff,
  stints,
  orderReliable,
  minSec,
  open,
  onToggle,
}: {
  player: TrendPlayerViewModel;
  lang: Lang;
  per10: boolean;
  showTurnovers: boolean;
  onOff: OnOffRow | undefined;
  stints: PlayerStints | undefined;
  orderReliable: boolean;
  minSec: number;
  open: boolean;
  onToggle: () => void;
}) {
  const id = player.rosterId;
  const bodyId = `trends-card-body-${id}`;
  return (
    <div className="card trends-card trends-row" role="listitem" data-testid={`trends-card-${id}`}>
      <button
        type="button"
        className="trends-row__toggle"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        data-testid={`trends-row-toggle-${id}`}
        onClick={onToggle}
      >
        <span className="trends-row__name">
          #{player.nr} {player.naam}
        </span>
        <span className="trends-row__stats">
          <span>
            <span className="trends-row__k">{t(lang, 'trendsMinLabel')}</span>{' '}
            <b data-testid={`trends-row-min-${id}`}>{player.avgMinutes.toFixed(1)}</b>
          </span>
          <span>
            <span className="trends-row__k">{t(lang, 'trendsPmLabel')}</span>{' '}
            <b
              className={`trends-avg-pm trends-avg-pm--${pmClassOf(player.totalPlusMinus)}`}
              data-testid={`trends-row-pm-${id}`}
            >
              {fmtSignedInt(player.totalPlusMinus)}
            </b>
          </span>
          {showTurnovers ? (
            <span>
              <span className="trends-row__k">{t(lang, 'trendsPlayerRowTov')}</span>{' '}
              <b data-testid={`trends-row-tov-${id}`}>{player.totalTurnovers}</b>
            </span>
          ) : null}
        </span>
        <span className="trends-row__chev" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <OnOffRowSummary row={onOff} lang={lang} id={id} />
      </button>
      {open ? (
        <div id={bodyId} className="trends-card__body">
          <PlayerTrendBody
            player={player}
            lang={lang}
            per10={per10}
            showTurnovers={showTurnovers}
          />
          <OnOffBlock row={onOff} lang={lang} id={id} naam={player.naam} minSec={minSec} />
          <StintsBlock
            stints={stints}
            orderReliable={orderReliable}
            lang={lang}
            id={id}
            naam={player.naam}
          />
        </div>
      ) : null}
    </div>
  );
}

/** De bestaande spelerkaart (tegels, grafieken, wedstrijdlijst), ongewijzigd van inhoud. */
function PlayerTrendBody({
  player,
  lang,
  per10,
  showTurnovers,
}: {
  player: TrendPlayerViewModel;
  lang: Lang;
  per10: boolean;
  showTurnovers: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
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
        onClick={() => setIsOpen(!isOpen)}
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
    </>
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
