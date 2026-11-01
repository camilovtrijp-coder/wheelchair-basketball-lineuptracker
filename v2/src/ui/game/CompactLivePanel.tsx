import { useEffect, useState } from 'preact/hooks';
import type { GamePlayer } from '../../domain/game/types';
import { setScore } from '../../domain/game/liveCommands';
import {
  deriveGameHistory,
  isOverLimit,
  scoreDeltaAction,
  turnoverDeltaAction,
} from '../../domain/game/tracking';
import {
  readAwayPreference,
  storeAwayPreference,
} from '../../infrastructure/game/compactAwayPreference';
import { translate, type StringKey } from '../../i18n/strings';
import { fmtSec, type LiveTrackingPanelProps } from './LiveTrackingPanel';

/**
 * Compact wedstrijdscherm (bouwplan C2a): alleen het hoofdscherm. Zelfde props
 * en dezelfde `ActiveGame` als `LiveTrackingPanel`. Wisselen, segment opslaan,
 * kwart sluiten, segmentlijst en afronden volgen in C2b/C3; hier staan daarvoor
 * bewust geen (halve) knoppen. Het component is nog niet selecteerbaar.
 */
export type CompactLivePanelProps = LiveTrackingPanelProps;

type Team = 'for' | 'against';

const SCORE_DELTAS = [1, 2, 3, -1] as const;

function playerTag(player: GamePlayer, tag1Label: string, tag2Label: string): string {
  const tag1 = tag1Label.charAt(0).toUpperCase();
  const tag2 = tag2Label.charAt(0).toUpperCase();
  return player.vrouw ? (player.jeugd ? `${tag1}${tag2}` : tag1) : player.jeugd ? tag2 : '';
}

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`;
}

export function CompactLivePanel({
  lang,
  game,
  quarterCount,
  periodLabel,
  classification,
  teamName,
  tag1Label,
  tag2Label,
  onGameChange,
  canWrite,
  saveError,
}: CompactLivePanelProps) {
  const t = (key: StringKey) => translate(lang, key);

  // Uitwedstrijd: lokale voorkeur per apparaat en wedstrijd-ID, nooit op ActiveGame.
  const [awayState, setAwayState] = useState(() => ({
    id: game.id,
    away: readAwayPreference(game.id),
  }));
  useEffect(() => {
    if (awayState.id !== game.id) {
      setAwayState({ id: game.id, away: readAwayPreference(game.id) });
    }
  }, [game.id, awayState.id]);
  const away = awayState.id === game.id ? awayState.away : readAwayPreference(game.id);

  function handleAwayChange(next: boolean) {
    setAwayState({ id: game.id, away: next });
    storeAwayPreference(game.id, next);
  }

  const history = deriveGameHistory(game);
  const courtLimit = isOverLimit(game, game.onCourt, classification);
  const segDeltaFor = history.scoreFor - history.segStartFor;
  const segDeltaAgainst = history.scoreAgainst - history.segStartAgainst;
  const segPM = segDeltaFor - segDeltaAgainst;
  const scoreTouched = segDeltaFor !== 0 || segDeltaAgainst !== 0;
  const segTurnovers = history.turnovers - history.segStartTurnovers;
  const ownName = teamName || t('teamFallbackLabel');
  const opponentName = t('teamOpponent');
  const period = periodLabel || t('quarterLabel');
  const periodText = t('compactPeriodOf')
    .replace('{period}', period)
    .replace('{n}', String(game.curQuarter))
    .replace('{total}', String(quarterCount));

  function addAction(action: ReturnType<typeof scoreDeltaAction>) {
    if (!canWrite) return;
    onGameChange({ ...game, actions: [...game.actions, action] });
  }

  function scoreSide(team: Team) {
    const name = team === 'for' ? ownName : opponentName;
    const score = team === 'for' ? history.scoreFor : history.scoreAgainst;
    return (
      <div
        className={`compact-score__side compact-score__side--${team}`}
        data-testid={`compact-score-${team}`}
      >
        <span className="compact-score__name">{name}</span>
        <select
          className="compact-score__select"
          value={score}
          disabled={!canWrite}
          data-testid={`compact-score-select-${team}`}
          aria-label={t('scoreSelectLabel').replace('{team}', name)}
          onChange={(e) => {
            const result = setScore(game, team, Number((e.target as HTMLSelectElement).value));
            if (result.ok && result.game !== game && canWrite) onGameChange(result.game);
          }}
        >
          {Array.from({ length: 151 }, (_, n) => n).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <div className="compact-score__buttons">
          {SCORE_DELTAS.map((delta) => (
            <button
              key={delta}
              type="button"
              className={
                delta > 0
                  ? `compact-score__btn compact-score__btn--${team}`
                  : 'btn-outline compact-score__btn'
              }
              disabled={!canWrite}
              data-testid={`compact-score-${delta > 0 ? `plus${delta}` : 'minus1'}-${team}`}
              aria-label={t('compactScoreAdjustAria')
                .replace('{team}', name)
                .replace('{delta}', delta > 0 ? `+${delta}` : '−1')}
              onClick={() => addAction(scoreDeltaAction(team, delta))}
            >
              {delta > 0 ? `+${delta}` : '−1'}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const [leftTeam, rightTeam]: [Team, Team] = away ? ['against', 'for'] : ['for', 'against'];

  return (
    <section className="tracking-panel compact-panel" aria-label={t('gameTitle')}>
      <header className="compact-panel__header">
        <h2 className="compact-panel__title">{t('gameTitle')}</h2>
        <p className="compact-panel__period" data-testid="compact-period">
          <strong>{periodText}</strong>
          <span className="compact-panel__since" data-testid="compact-begin">
            {t('compactLineupSince')} {fmtSec(game.beginSec)}{' '}
            {game.clockDown ? t('compactClockRemaining') : t('compactClockElapsed')}
          </span>
        </p>
      </header>

      {saveError ? (
        <p className="settings-error" role="alert" data-testid="game-save-error">
          {t('gameSaveError')}
        </p>
      ) : null}

      {canWrite ? null : (
        <p className="settings-read-only" data-testid="game-read-only" role="status">
          {t('gameReadOnly')}
        </p>
      )}

      <div className="compact-court">
        <div className="compact-court__header">
          <span className="compact-court__title">{t('onCourtLabel')}</span>
          {classification.useClassLimit ? (
            <span
              className={courtLimit.over ? 'class-badge class-badge--over' : 'class-badge'}
              data-testid="class-badge"
            >
              {courtLimit.sum.toFixed(1)} / {courtLimit.allowed.toFixed(1)}
            </span>
          ) : null}
        </div>
        <ul className="compact-court__list" aria-label={t('onCourtLabel')}>
          {game.onCourt.map((id) => {
            const p = game.players.find((pl) => pl.id === id);
            if (!p) return null;
            const tag = playerTag(p, tag1Label, tag2Label);
            return (
              <li
                key={id}
                className="compact-player"
                data-testid={`compact-player-${id}`}
                title={`#${p.nr} ${p.naam}`}
              >
                <span className="compact-player__nr">{p.nr}</span>
                <span className="compact-player__name">{p.naam}</span>
                {classification.useClassLimit ? (
                  <span className="compact-player__class">
                    {p.kl}
                    {tag ? ` ${tag}` : ''}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        {classification.useClassLimit && courtLimit.over ? (
          <p className="tracking-warning" role="alert" data-testid="class-warning">
            {t('tooManyClassPointsPrefix')} ({courtLimit.sum.toFixed(1)} &gt;{' '}
            {courtLimit.allowed.toFixed(1)})
          </p>
        ) : null}
        {game.pendingSwapLineup != null ? (
          <p className="compact-panel__note" role="status" data-testid="compact-swap-pending">
            {t('compactSwapPendingNote')}
          </p>
        ) : null}
      </div>

      <div className="compact-turnovers" data-testid="compact-turnovers">
        <div className="compact-turnovers__summary">
          <span className="compact-turnovers__title">{t('turnoversLabel')}</span>
          <span
            className="compact-turnovers__open"
            data-testid="compact-turnover-open"
            role="status"
            aria-label={`${t('segmentTurnoversLabel')} ${segTurnovers}`}
          >
            {segTurnovers}
          </span>
          <span className="compact-turnovers__caption">{t('correctRowTurnovers')}</span>
          <span className="compact-turnovers__total" data-testid="compact-turnover-total">
            {t('compactTurnoversTotalLabel')} <strong>{history.turnovers}</strong>
          </span>
        </div>
        <div className="compact-turnovers__actions">
          <button
            type="button"
            className="turnover-btn compact-turnovers__plus"
            disabled={!canWrite}
            data-testid="compact-turnover-plus"
            onClick={() => addAction(turnoverDeltaAction(1))}
          >
            {t('turnoverPlusBtn')}
          </button>
          <button
            type="button"
            className="btn-outline compact-turnovers__minus"
            disabled={!canWrite || segTurnovers <= 0}
            data-testid="compact-turnover-minus"
            aria-label={t('turnoverMinusAria')}
            onClick={() => addAction(turnoverDeltaAction(-1))}
          >
            −1
          </button>
        </div>
      </div>

      <div className="compact-score" data-testid="compact-score">
        <div className="compact-score__top">
          <span className="compact-score__caption" data-testid="compact-score-caption">
            {t('compactScoreLastRecorded')}
          </span>
          <label className="compact-away">
            <input
              type="checkbox"
              checked={away}
              data-testid="compact-away"
              onChange={(e) => handleAwayChange((e.target as HTMLInputElement).checked)}
            />
            <span>{t('compactAwayGame')}</span>
          </label>
        </div>
        <div className="compact-score__sides" data-testid="compact-score-sides" data-away={away}>
          {scoreSide(leftTeam)}
          {scoreSide(rightTeam)}
        </div>
        <p className="compact-score__pm" data-testid="compact-segment-pm">
          {scoreTouched ? (
            <>
              {t('compactSegmentPm')}{' '}
              <strong className={segPM > 0 ? 'live-pm--pos' : segPM < 0 ? 'live-pm--neg' : ''}>
                {signed(segPM)}
              </strong>
            </>
          ) : (
            t('compactScoreNotUpdated')
          )}
        </p>
      </div>
    </section>
  );
}
