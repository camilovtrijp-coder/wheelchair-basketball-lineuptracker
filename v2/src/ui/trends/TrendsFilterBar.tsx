import type { AnalysisGame } from '../../domain/stats/types';
import { fmtSeconds } from '../../domain/stats/format';
import type { Lang } from '../../i18n/strings';
import {
  currentGameId,
  fill,
  gamesText,
  latestCompletedGameIds,
  selectionEquals,
  t,
} from './trendsShared';

/**
 * Filters van Trends, in twee delen (inklapbaar, standaard ingeklapt):
 *
 * - `TrendsFilterSummary`: de samenvattingsregel met de huidige keuzes en de
 *   knop "Filters" (`aria-expanded`/`aria-controls`). Samen met de tabbalk het
 *   VASTE (sticky) deel; de chips staan daar bewust niet in, zodat de vaste kop
 *   op een telefoon klein blijft.
 * - `TrendsFilterBar`: het chipspaneel (Per 10 min, Wedstrijden (n), Drempel,
 *   Laatste 5, Deze wedstrijd, hint en notitie). Staat in de normale
 *   paginastroom direct onder de vaste kop en bestaat alleen in de DOM als het
 *   paneel open is.
 *
 * De snelfilters zetten het GEDEELDE wedstrijdfilter (dezelfde state als
 * Statistieken, via `onGameIdsChange`); zolang dat filter niet "alles" is, staat
 * er een zichtbare notitie bij. "Laatste 5" en "Deze wedstrijd" zijn alleen
 * ingedrukt bij een EXPLICIETE selectie (`gameIds !== null`) die gelijk is aan
 * hun doel; "geen selectie" (alles) telt nooit als ingedrukt, ook niet bij
 * minder dan 5 wedstrijden. De spelers-sorteerchip hoort bij de weergave Spelers.
 */
export const LAST_N_GAMES = 5;

/** `id` van het chipspaneel; `aria-controls` van de knop "Filters" wijst hiernaar. */
export const FILTER_PANEL_ID = 'trends-filter-panel';

/** Afgeleide staat van de snelfilters (gedeeld door samenvatting en paneel). */
function quickFilterState(games: AnalysisGame[], gameIds: Set<string> | null) {
  const last5 = latestCompletedGameIds(games, LAST_N_GAMES);
  const last5Pressed = gameIds !== null && selectionEquals(gameIds, last5, games);
  const currentId = currentGameId(games);
  const currentTarget = new Set(currentId === null ? [] : [currentId]);
  const currentPressed =
    gameIds !== null && currentId !== null && selectionEquals(gameIds, currentTarget, games);
  return { last5, last5Pressed, currentId, currentTarget, currentPressed };
}

export interface TrendsFilterSummaryProps {
  lang: Lang;
  games: AnalysisGame[];
  gameIds: Set<string> | null;
  per10: boolean;
  minSec: number;
  open: boolean;
  onToggle: () => void;
}

/** Samenvattingsregel + knop "Filters" (het filterdeel van de vaste kop). */
export function TrendsFilterSummary({
  lang,
  games,
  gameIds,
  per10,
  minSec,
  open,
  onToggle,
}: TrendsFilterSummaryProps) {
  const { last5Pressed, currentPressed } = quickFilterState(games, gameIds);
  // "Gefilterd": expliciete selectie die niet alle wedstrijden omvat.
  const filtered = gameIds !== null && gameIds.size < games.length;
  const gamesPart = filtered
    ? fill(t(lang, 'trendsFilterSummaryGamesOf'), { n: gameIds.size, total: games.length })
    : gamesText(lang, gameIds === null ? games.length : gameIds.size);
  const parts = [
    t(lang, per10 ? 'trendsFilterSummaryPer10' : 'trendsFilterSummaryTotal'),
    gamesPart,
    fill(t(lang, 'trendsFilterSummaryThreshold'), {
      value: minSec === 0 ? t(lang, 'trendsFilterThresholdOff') : fmtSeconds(minSec),
    }),
  ];
  if (last5Pressed) parts.push(t(lang, 'trendsFilterLast5'));
  if (currentPressed) parts.push(t(lang, 'trendsFilterThisGame'));
  if (filtered) parts.push(t(lang, 'trendsFilterSummaryFiltered'));
  return (
    <div className="trends-filter-summary" data-testid="trends-filter-summary-row">
      <p
        className={`trends-filter-summary__text${filtered ? ' trends-filter-summary__text--filtered' : ''}`}
        data-testid="trends-filter-summary"
      >
        {parts.join(' · ')}
      </p>
      <button
        type="button"
        className={`btn-outline trends-filter-summary__btn${open ? ' stats-toggle--active' : ''}`}
        data-testid="trends-filters-toggle"
        title={t(lang, 'trendsFilterSummaryButtonTitle')}
        aria-expanded={open}
        aria-controls={FILTER_PANEL_ID}
        onClick={onToggle}
      >
        {t(lang, 'trendsFilterSummaryButton')} <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
    </div>
  );
}

export interface TrendsFilterBarProps {
  lang: Lang;
  /** Alle wedstrijden in de scope (ongefilterd). */
  games: AnalysisGame[];
  gameIds: Set<string> | null;
  onGameIdsChange: (next: Set<string> | null) => void;
  per10: boolean;
  onTogglePer10: () => void;
  minSec: number;
  onCycleMinSec: () => void;
  onOpenGames: () => void;
}

export function TrendsFilterBar({
  lang,
  games,
  gameIds,
  onGameIdsChange,
  per10,
  onTogglePer10,
  minSec,
  onCycleMinSec,
  onOpenGames,
}: TrendsFilterBarProps) {
  const { last5, last5Pressed, currentId, currentTarget, currentPressed } = quickFilterState(
    games,
    gameIds,
  );

  const thresholdText = minSec === 0 ? t(lang, 'trendsFilterThresholdOff') : fmtSeconds(minSec);

  // Een snelfilter zet altijd een EXPLICIETE selectie (ook als die alle wedstrijden omvat),
  // zodat de chip ingedrukt is; nogmaals tikken zet terug naar "alles" (`null`).
  function toggleQuick(target: ReadonlySet<string>, pressed: boolean): void {
    onGameIdsChange(pressed ? null : new Set(target));
  }

  return (
    <div
      className="trends-filterbar"
      id={FILTER_PANEL_ID}
      role="group"
      aria-label={t(lang, 'trendsFilterLabel')}
      data-testid="trends-filterbar"
    >
      <div className="stats-controls__row stats-controls__row--wrap trends-filterbar__chips">
        <button
          type="button"
          className={`btn-outline${per10 ? ' stats-toggle--active' : ''}`}
          data-testid="trends-per10-toggle"
          onClick={onTogglePer10}
          aria-pressed={per10}
        >
          {t(lang, 'statsPer10')}
        </button>
        <button
          type="button"
          className="btn-outline"
          data-testid="trends-games-btn"
          onClick={onOpenGames}
        >
          {t(lang, 'statsGamesBtn')} ({gameIds === null ? games.length : gameIds.size})
        </button>
        <button
          type="button"
          className={`btn-outline${minSec > 0 ? ' stats-toggle--active' : ''}`}
          data-testid="trends-threshold-btn"
          title={t(lang, 'trendsFilterThresholdTitle')}
          onClick={onCycleMinSec}
        >
          {t(lang, 'trendsFilterThreshold')}: {thresholdText}
        </button>
        <button
          type="button"
          className={`btn-outline${last5Pressed ? ' stats-toggle--active' : ''}`}
          data-testid="trends-quick-last5"
          title={t(lang, last5.size === 0 ? 'trendsFilterNoCompleted' : 'trendsFilterLast5Title')}
          aria-pressed={last5Pressed}
          disabled={last5.size === 0}
          onClick={() => toggleQuick(last5, last5Pressed)}
        >
          {t(lang, 'trendsFilterLast5')}
        </button>
        <button
          type="button"
          className={`btn-outline${currentPressed ? ' stats-toggle--active' : ''}`}
          data-testid="trends-quick-current"
          title={t(
            lang,
            currentId === null ? 'trendsFilterThisGameDisabled' : 'trendsFilterThisGameTitle',
          )}
          aria-pressed={currentPressed}
          aria-describedby={currentId === null ? 'trends-quick-current-hint' : undefined}
          aria-disabled={currentId === null ? 'true' : undefined}
          onClick={() => {
            if (currentId !== null) toggleQuick(currentTarget, currentPressed);
          }}
        >
          {t(lang, 'trendsFilterThisGame')}
        </button>
      </div>
      {currentId === null ? (
        <p
          id="trends-quick-current-hint"
          className="xs mut2 trends-filterbar__note"
          data-testid="trends-quick-current-hint"
        >
          {t(lang, 'trendsFilterNoCurrentHint')}
        </p>
      ) : null}
      {gameIds !== null ? (
        <p className="xs mut2 trends-filterbar__note" data-testid="trends-filter-shared-note">
          {t(lang, 'trendsFilterSharedNote')}
        </p>
      ) : null}
    </div>
  );
}
