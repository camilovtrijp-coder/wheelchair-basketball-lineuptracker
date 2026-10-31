import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CompletedGameRepository } from '../../application/game/CompletedGameRepository';
import { buildAnalysisScope } from '../../application/stats/buildAnalysisScope';
import type { ActiveGame } from '../../domain/game/types';
import type { RosterPlayer } from '../../domain/roster/types';
import { computeLineupInsights } from '../../domain/trends/lineupInsights';
import type { Lang } from '../../i18n/strings';
import { GamesFilterModal, toggleGameIdInSet } from '../shared/GamesFilterModal';
import { useSanitizedGameIds } from '../shared/useSanitizedGameIds';
import { LineupsView } from './LineupsView';
import { OverviewView } from './OverviewView';
import { PlayersView } from './PlayersView';
import { QuartersView } from './QuartersView';
import { FILTER_PANEL_ID, TrendsFilterBar, TrendsFilterSummary } from './TrendsFilterBar';
import { panelId, tabId, TrendsViewTabs } from './TrendsViewTabs';
import {
  DEFAULT_MIN_SEC,
  fill,
  nextThreshold,
  t,
  TRENDS_VIEW_IDS,
  type TrendsViewId,
  type TrendsViewProps,
} from './trendsShared';

/**
 * Trends-tab (PR 6.5, herindeeld in T2/T3). Dit bestand is alleen de SCHIL:
 *
 * - segmentbediening (`TrendsViewTabs`): Overzicht | Lineups | Spelers | Kwarten;
 * - vaste kop (sticky) = segmentbediening + samenvattingsregel met de knop
 *   "Filters" (`TrendsFilterSummary`); het chipspaneel (`TrendsFilterBar`: Per 10
 *   min, Wedstrijden (n), Drempel, Laatste 5 / Deze wedstrijd) staat in de
 *   normale paginastroom eronder en is standaard ingeklapt (state per mount);
 * - de gekozen weergave (`OverviewView`, `LineupsView`, `PlayersView`,
 *   `QuartersView`), elk in een eigen bestand met dezelfde `TrendsViewProps`.
 *
 * Het wedstrijdfilter (`gameIds`) wordt gedeeld met Statistieken via props uit
 * `app/App.tsx`; `per10`, de drempel (`minSec`, standaard 5:00) en de gekozen
 * weergave zijn eigen sessiestate en worden NIET opgeslagen (besluit eigenaar).
 */
export interface TrendsPanelProps {
  lang: Lang;
  repository: CompletedGameRepository;
  activeGame: ActiveGame | null;
  roster: RosterPlayer[];
  gameIds: Set<string> | null;
  onGameIdsChange: (next: Set<string> | null) => void;
  /** Instelling "klassegrens" van de lopende wedstrijd; standaard `false`. */
  useClassLimit?: boolean;
  /** Beginweergave (standaard Overzicht); bedoeld voor tests, nooit uit opslag. */
  initialView?: TrendsViewId;
}

export function TrendsPanel({
  lang,
  repository,
  activeGame,
  roster,
  gameIds: gameIdsProp,
  onGameIdsChange,
  useClassLimit = false,
  initialView = 'overview',
}: TrendsPanelProps) {
  const scope = useMemo(
    () => buildAnalysisScope(repository, activeGame, useClassLimit),
    [repository, activeGame, useClassLimit],
  );
  // Verouderde selectie (bijv. "Deze wedstrijd" na het afronden) opschonen.
  const gameIds = useSanitizedGameIds(
    gameIdsProp,
    scope.games,
    scope.historyRead.status === 'ok',
    onGameIdsChange,
  );
  const [view, setView] = useState<TrendsViewId>(initialView);
  const [per10, setPer10] = useState(false);
  const [minSec, setMinSec] = useState(DEFAULT_MIN_SEC);
  const [gamesModalOpen, setGamesModalOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const stickyRef = useRef<HTMLDivElement | null>(null);

  // Basis-lineupinzichten, gedeeld door de weergaven (zie `TrendsViewProps.lineups`).
  const lineups = useMemo(
    () => computeLineupInsights(scope.games, gameIds, { size: 5, minSec, metric: 'pm' }),
    [scope.games, gameIds, minSec],
  );

  const showError = scope.historyRead.status === 'error';
  const showNoData = !showError && scope.games.length === 0;
  const partialSegments = lineups.partialSegments;
  const partialMessage =
    partialSegments === 1
      ? t(lang, 'statsPartialSingular')
      : partialSegments > 1
        ? fill(t(lang, 'statsPartialPlural'), { count: partialSegments })
        : null;

  // Escape sluit het chipspaneel (als de focus op de knop "Filters" of in het paneel staat) en
  // zet de focus terug op de knop. Niet terwijl de wedstrijdenmodaal open is: die sluit zichzelf.
  useEffect(() => {
    if (!filtersOpen || gamesModalOpen) return undefined;
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      const toggle = stickyRef.current?.querySelector<HTMLButtonElement>(
        '[data-testid="trends-filters-toggle"]',
      );
      const panel = document.getElementById(FILTER_PANEL_ID);
      const active = document.activeElement;
      if (active === null || !(active === toggle || panel?.contains(active))) return;
      e.preventDefault();
      setFiltersOpen(false);
      toggle?.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [filtersOpen, gamesModalOpen]);

  const viewProps: TrendsViewProps = {
    lang,
    scope,
    games: scope.games,
    gameIds,
    per10,
    minSec,
    roster,
    useClassLimit,
    lineups,
  };

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

      {showNoData ? (
        <p className="stats-empty" data-testid="trends-no-data">
          {t(lang, 'trendsNoData')}
        </p>
      ) : null}

      {/* Vaste kop: tabbalk + samenvattingsregel. De filterbalk staat er altijd (ook zonder wedstrijden of bij een leesfout). */}
      <div className="trends-sticky" data-testid="trends-sticky" ref={stickyRef}>
        {!showError && !showNoData ? (
          <TrendsViewTabs lang={lang} view={view} onChange={setView} />
        ) : null}
        <TrendsFilterSummary
          lang={lang}
          games={scope.games}
          gameIds={gameIds}
          per10={per10}
          minSec={minSec}
          open={filtersOpen}
          onToggle={() => setFiltersOpen(!filtersOpen)}
        />
      </div>
      {filtersOpen ? (
        <TrendsFilterBar
          lang={lang}
          games={scope.games}
          gameIds={gameIds}
          onGameIdsChange={onGameIdsChange}
          per10={per10}
          onTogglePer10={() => setPer10(!per10)}
          minSec={minSec}
          onCycleMinSec={() => setMinSec(nextThreshold(minSec))}
          onOpenGames={() => setGamesModalOpen(true)}
        />
      ) : null}
      {!showError && !showNoData
        ? TRENDS_VIEW_IDS.map((id) => (
            <div
              key={id}
              role="tabpanel"
              id={panelId(id)}
              aria-labelledby={tabId(id)}
              className="trends-tabpanel"
              data-testid={`trends-tabpanel-${id}`}
              hidden={id !== view}
              tabIndex={id === view ? 0 : undefined}
            >
              {id !== view ? null : id === 'overview' ? (
                <OverviewView {...viewProps} />
              ) : id === 'lineups' ? (
                <LineupsView {...viewProps} />
              ) : id === 'players' ? (
                <PlayersView {...viewProps} />
              ) : (
                <QuartersView {...viewProps} />
              )}
            </div>
          ))
        : null}

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
