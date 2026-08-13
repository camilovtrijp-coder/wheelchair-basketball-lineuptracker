import type { ActiveGame } from '../../domain/game/types';
import {
  duplicateStartNumbers,
  startBlockReason,
  startCount,
  startGame,
  setClockDown,
  setCompetition,
  setLimitStr,
  setOpponent,
  toggleParticipate,
  toggleStart,
  validPlayers,
} from '../../domain/game/setup';
import { translate, type Lang, type StringKey } from '../../i18n/strings';

export interface GameSetupPanelProps {
  lang: Lang;
  game: ActiveGame | null;
  useClassLimit: boolean;
  /** Persisteert meteen (spiegelt v1: elke wijziging op dit tabblad slaat direct op, geen aparte save-knop). */
  onGameChange: (next: ActiveGame) => void;
  onGoToRoster: () => void;
  canWrite: boolean;
  saveError: boolean;
}

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

function startButtonLabel(lang: Lang, game: ActiveGame): string {
  switch (startBlockReason(game)) {
    case 'needFivePlayers':
      return t(lang, 'startNeedFive');
    case 'duplicateNumbers':
      return t(lang, 'startFixDup');
    case 'needFiveParticipants':
      return t(lang, 'startNeedFiveParticipating');
    case 'chooseFiveStarters':
      return t(lang, 'startChooseFive');
    case null:
      return t(lang, 'startGameBtn');
  }
}

export function GameSetupPanel({
  lang,
  game,
  useClassLimit,
  onGameChange,
  onGoToRoster,
  canWrite,
  saveError,
}: GameSetupPanelProps) {
  if (game === null || game.phase === 'tracking') return null;

  const vp = validPlayers(game);
  const dupNrs = duplicateStartNumbers(game);
  const sc = startCount(game);
  const canStartNow = startBlockReason(game) === null;

  if (vp.length === 0) {
    return (
      <section className="settings-panel" aria-label={t(lang, 'gameTitle')}>
        <header className="settings-panel__header">
          <h2>{t(lang, 'gameTitle')}</h2>
        </header>
        <p data-testid="game-no-players">{t(lang, 'noPlayersYet')}</p>
        <button
          type="button"
          className="btn-outline"
          data-testid="game-go-to-roster"
          onClick={onGoToRoster}
        >
          {t(lang, 'goToTeamBtn')}
        </button>
      </section>
    );
  }

  return (
    <section className="settings-panel" aria-label={t(lang, 'gameTitle')}>
      <header className="settings-panel__header">
        <h2>{t(lang, 'gameTitle')}</h2>
      </header>
      <p className="settings-explainer">{t(lang, 'preGameIntro')}</p>

      <ul className="roster-list">
        {vp.map((p) => (
          <li key={p.id} className="roster-player-card">
            <div className="roster-player-row">
              <span className="settings-field__label" style={{ opacity: p.participate ? 1 : 0.5 }}>
                #{p.nr} {p.naam}
              </span>
              <div className="settings-actions">
                <button
                  type="button"
                  className={`toggle-btn${p.participate ? ' toggle-btn--on' : ''}`}
                  aria-pressed={p.participate}
                  disabled={!canWrite}
                  data-testid={`game-participate-${p.id}`}
                  onClick={() => onGameChange(toggleParticipate(game, p.id))}
                >
                  {t(lang, 'participateToggle')}
                </button>
                {p.participate ? (
                  <button
                    type="button"
                    className={`toggle-btn${p.start ? ' toggle-btn--on' : ''}`}
                    aria-pressed={p.start}
                    disabled={!canWrite}
                    data-testid={`game-start-${p.id}`}
                    onClick={() => onGameChange(toggleStart(game, p.id))}
                  >
                    {t(lang, 'toggleStart')}
                  </button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {dupNrs.length > 0 ? (
        <p className="settings-error" role="alert" data-testid="game-dup-warning">
          {t(lang, 'dupNumberWarningLabel')} {dupNrs.join(', ')}
        </p>
      ) : (
        <p className="settings-explainer" data-testid="game-starters-info">
          {sc === 0
            ? t(lang, 'noStarters')
            : `${sc}/5 ${t(lang, 'startersChosenSuffix')}${sc === 5 ? ' ✓' : ''}`}
        </p>
      )}

      <label className="settings-field">
        <span className="settings-field__label">{t(lang, 'teamOpponent')}</span>
        <input
          type="text"
          value={game.opponent}
          placeholder={t(lang, 'opponentPlaceholder')}
          readOnly={!canWrite}
          data-testid="game-opponent"
          onChange={(e) => onGameChange(setOpponent(game, (e.target as HTMLInputElement).value))}
        />
      </label>

      <label className="settings-field">
        <span className="settings-field__label">{t(lang, 'competitionLabel')}</span>
        <input
          type="text"
          value={game.competition}
          placeholder={t(lang, 'competitionPlaceholder')}
          readOnly={!canWrite}
          data-testid="game-competition"
          onChange={(e) => onGameChange(setCompetition(game, (e.target as HTMLInputElement).value))}
        />
      </label>

      {useClassLimit ? (
        <label className="settings-field">
          <span className="settings-field__label">
            {t(lang, 'classLimitLabel')} <span>{t(lang, 'classLimitHint')}</span>
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={game.limitStr}
            readOnly={!canWrite}
            data-testid="game-class-limit"
            onChange={(e) => onGameChange(setLimitStr(game, (e.target as HTMLInputElement).value))}
          />
        </label>
      ) : null}

      <label className="settings-field settings-field--row">
        <input
          type="checkbox"
          checked={game.clockDown}
          disabled={!canWrite}
          data-testid="game-clock-down"
          onChange={(e) => onGameChange(setClockDown(game, (e.target as HTMLInputElement).checked))}
        />
        <span className="settings-field__label">
          {t(lang, 'clockDownLabel')} <span>{t(lang, 'clockDownHint')}</span>
        </span>
      </label>

      {saveError ? (
        <p className="settings-error" role="alert" data-testid="game-save-error">
          {t(lang, 'gameSaveError')}
        </p>
      ) : null}

      <div className="settings-actions">
        <button
          type="button"
          className="btn-primary"
          data-testid="game-start-btn"
          disabled={!canWrite || !canStartNow}
          onClick={() => {
            const started = startGame(game);
            if (started) onGameChange(started);
          }}
        >
          {startButtonLabel(lang, game)}
        </button>
      </div>
    </section>
  );
}
