import { useEffect, useState } from 'preact/hooks';
import type { GamePlayer } from '../../domain/game/types';
import { discardSwaps } from '../../domain/game/liveCommands';
import { canFinishGame } from '../../domain/game/finish';
import { deriveGameHistory, isOverLimit, turnoverDeltaAction } from '../../domain/game/tracking';
import {
  readAwayPreference,
  storeAwayPreference,
} from '../../infrastructure/game/compactAwayPreference';
import { translate, type StringKey } from '../../i18n/strings';
import { useGameScreenLock } from '../../application/game/useGameScreen';
import { fmtSec, type LiveTrackingPanelProps } from './LiveTrackingPanel';
import { CompactLiveDialog, type CompactDialogMode } from './CompactLiveDialog';
import { CompactSegmentList } from './CompactSegmentList';
import { CompactSegmentEditor } from './CompactSegmentEditor';
import { FinishGameDialog } from './FinishGameDialog';

/**
 * Compact wedstrijdscherm (bouwplan C2a/C2b). Zelfde props en dezelfde
 * `ActiveGame` als `LiveTrackingPanel`. Wisselen, Segment opslaan en
 * Kwart/periode afsluiten lopen via een concept-dialoog (alleen UI-state) en
 * leggen bij bevestigen één coherente overgang vast via `liveCommands`.
 * C3: inklapbaar segmentoverzicht met bewerken/verwijderen op segment-ID en
 * Wedstrijd afronden (met afrondkeuze) onder het overzicht.
 */
export type CompactLivePanelProps = LiveTrackingPanelProps;

type Team = 'for' | 'against';

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
  onFinishGame,
  canWrite,
  saveError,
}: CompactLivePanelProps) {
  const t = (key: StringKey) => translate(lang, key);
  const [dialog, setDialog] = useState<CompactDialogMode | null>(null);
  const [segmentsOpen, setSegmentsOpen] = useState(false);
  const [editSegmentId, setEditSegmentId] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  // Schermwisselguard: een opgeslagen onbevestigde wissel of een open concept
  // blokkeert de schakelaar Klassiek/Compact (alleen als er geschreven mag worden).
  useGameScreenLock(
    canWrite && game.pendingSwapLineup != null
      ? 'swap'
      : dialog != null || editSegmentId != null || finishOpen
        ? 'dialog'
        : null,
  );

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

  function addAction(action: ReturnType<typeof turnoverDeltaAction>) {
    if (!canWrite) return;
    onGameChange({ ...game, actions: [...game.actions, action] });
  }

  // Compact: de stand is alleen-lezen; ze wordt uitsluitend bijgewerkt via de
  // dialogen (Segment opslaan, Wisselen, Kwart afsluiten). Uitwedstrijd draait
  // alleen de weergavevolgorde om.
  function scoreSide(team: Team) {
    const name = team === 'for' ? ownName : opponentName;
    const score = team === 'for' ? history.scoreFor : history.scoreAgainst;
    return (
      <div
        className={`compact-score__side compact-score__side--${team}`}
        data-testid={`compact-score-${team}`}
      >
        <span className="compact-score__name">{name}</span>
        <output
          className="compact-score__value"
          data-testid={`compact-score-value-${team}`}
          aria-label={t('compactScoreOfTeam').replace('{team}', name)}
        >
          {score}
        </output>
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

      <div className="compact-court" data-testid="compact-court">
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
        {scoreTouched ? (
          <p className="compact-score__pm" data-testid="compact-segment-pm">
            <span data-testid="compact-open-points">
              {t('finishOpenPoints')
                .replace('{for}', String(away ? segDeltaAgainst : segDeltaFor))
                .replace('{against}', String(away ? segDeltaFor : segDeltaAgainst))}
            </span>{' '}
            {t('compactSegmentPm')}{' '}
            <strong className={segPM > 0 ? 'live-pm--pos' : segPM < 0 ? 'live-pm--neg' : ''}>
              {signed(segPM)}
            </strong>
          </p>
        ) : null}
      </div>

      {game.pendingSwapLineup != null ? (
        <div className="compact-pending" data-testid="compact-pending-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={!canWrite}
            data-testid="compact-pending-confirm"
            onClick={() => canWrite && setDialog('confirm-pending')}
          >
            {t('compactPendingConfirmBtn')}
          </button>
          <button
            type="button"
            className="btn-outline"
            disabled={!canWrite}
            data-testid="compact-pending-discard"
            onClick={() => {
              if (canWrite) onGameChange(discardSwaps(game));
            }}
          >
            {t('compactPendingDiscardBtn')}
          </button>
        </div>
      ) : null}

      <div className="compact-actions" data-testid="compact-actions">
        <button
          type="button"
          className="btn-primary compact-actions__swap"
          disabled={!canWrite || game.pendingSwapLineup != null}
          data-testid="compact-swap-open"
          onClick={() => canWrite && setDialog('swap')}
        >
          {t('compactSwapBtn')}
        </button>
        <button
          type="button"
          className="btn-outline compact-actions__btn"
          disabled={!canWrite || game.pendingSwapLineup != null}
          data-testid="compact-save-segment"
          onClick={() => canWrite && setDialog('segment')}
        >
          {t('compactSaveSegmentBtn')}
        </button>
        <button
          type="button"
          className="btn-outline compact-actions__btn"
          disabled={!canWrite || game.pendingSwapLineup != null}
          data-testid="compact-close-quarter"
          onClick={() => canWrite && setDialog('quarter')}
        >
          {t('compactCloseQuarterBtn')}
        </button>
      </div>

      <CompactSegmentList
        lang={lang}
        game={game}
        periodLabel={periodLabel}
        expanded={segmentsOpen}
        canWrite={canWrite}
        away={away}
        onToggle={() => setSegmentsOpen((open) => !open)}
        onEdit={(id) => setEditSegmentId(id)}
      />

      <button
        type="button"
        className="btn-primary compact-finish"
        disabled={!canWrite || !canFinishGame(game)}
        data-testid="compact-finish-game"
        onClick={() => canWrite && canFinishGame(game) && setFinishOpen(true)}
      >
        {t('finishGameBtn')}
      </button>

      {editSegmentId != null ? (
        <CompactSegmentEditor
          lang={lang}
          game={game}
          segmentId={editSegmentId}
          quarterCount={quarterCount}
          periodLabel={periodLabel}
          classification={classification}
          teamName={teamName}
          tag1Label={tag1Label}
          tag2Label={tag2Label}
          canWrite={canWrite}
          onCommit={onGameChange}
          onClose={() => setEditSegmentId(null)}
        />
      ) : null}

      {finishOpen ? (
        <FinishGameDialog
          lang={lang}
          game={game}
          classification={classification}
          canWrite={canWrite}
          away={away}
          onGameChange={onGameChange}
          onFinishGame={onFinishGame}
          onClose={() => setFinishOpen(false)}
        />
      ) : null}

      {dialog != null ? (
        <CompactLiveDialog
          lang={lang}
          game={game}
          mode={dialog}
          quarterCount={quarterCount}
          periodLabel={periodLabel}
          classification={classification}
          teamName={teamName}
          tag1Label={tag1Label}
          tag2Label={tag2Label}
          canWrite={canWrite}
          away={away}
          onCommit={onGameChange}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}
