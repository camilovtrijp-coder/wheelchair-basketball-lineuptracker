import type { AnalysisGame } from '../../domain/stats/types';
import { fmtSeconds } from '../../domain/stats/format';
import type { Lang } from '../../i18n/strings';
import {
  currentGameId,
  latestCompletedGameIds,
  selectionEquals,
  selectionFromTarget,
  t,
} from './trendsShared';

/**
 * Vaste (sticky) filterbalk boven alle Trends-weergaven. Bevat de chips
 * "Per 10 min", "Wedstrijden (n)", "Drempel: 5:00" en de snelfilters
 * "Laatste 5" / "Deze wedstrijd". De snelfilters zetten het GEDEELDE
 * wedstrijdfilter (dezelfde state als Statistieken, via `onGameIdsChange`);
 * zolang dat filter niet "alles" is, staat er een zichtbare notitie bij.
 * De spelers-sorteerchip hoort bij de weergave Spelers, niet hier.
 */
export const LAST_N_GAMES = 5;

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
  const last5 = latestCompletedGameIds(games, LAST_N_GAMES);
  const last5Pressed = selectionEquals(gameIds, last5, games);
  const currentId = currentGameId(games);
  const currentTarget = new Set(currentId === null ? [] : [currentId]);
  const currentPressed = currentId !== null && selectionEquals(gameIds, currentTarget, games);

  const thresholdText = minSec === 0 ? t(lang, 'trendsFilterThresholdOff') : fmtSeconds(minSec);

  function toggleQuick(target: ReadonlySet<string>, pressed: boolean): void {
    onGameIdsChange(pressed ? null : selectionFromTarget(target, games));
  }

  return (
    <div
      className="trends-filterbar"
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
