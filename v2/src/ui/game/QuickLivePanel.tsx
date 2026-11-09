import { useEffect, useState } from 'preact/hooks';
import type { GamePlayer } from '../../domain/game/types';
import { discardSwaps } from '../../domain/game/liveCommands';
import { canFinishGame } from '../../domain/game/finish';
import {
  deriveGameHistory,
  isOverLimit,
  scoreDeltaAction,
  swapOnCourt,
  turnoverDeltaAction,
} from '../../domain/game/tracking';
import {
  readAwayPreference,
  storeAwayPreference,
} from '../../infrastructure/game/compactAwayPreference';
import { translate, type StringKey } from '../../i18n/strings';
import { useGameScreenLock } from '../../application/game/useGameScreen';
import { fmtSec, type LiveTrackingPanelProps } from './LiveTrackingPanel';
import { CompactSegmentList } from './CompactSegmentList';
import { CompactSegmentEditor } from './CompactSegmentEditor';
import { FinishGameDialog } from './FinishGameDialog';
import { QuickScoreSheet, QuickTimeSheet, type QuickTimeMode } from './QuickSheets';
import { QuickPlanEditor } from './QuickPlanEditor';
import { useRotationPlan } from '../../application/game/useRotationPlan';
import {
  adoptActualLineup,
  deviationPairs,
  emptyPlan,
  lineupDiff,
  nextPlannedLineup,
  plannedEndSec,
  propagateDeviation,
  quarterStartLineup,
  withQuarterCount,
} from '../../domain/game/rotationPlan';

/**
 * Snel wedstrijdscherm (derde optie naast Klassiek en Compact). Zelfde props en
 * dezelfde `ActiveGame` als de andere schermen; geen wijziging van het
 * datacontract. Doel: tijdens de wedstrijd zo min mogelijk tikken.
 *
 * - Stand: groot getal; tik erop en kies met een wiel. +1/+2/+3/−1 blijven
 *   beschikbaar (zelfde score-acties als Klassiek).
 * - Wisselen: zoals Klassiek (tik vloer + bank, opgeslagen `pendingSwapLineup`);
 *   "Klaar met wisselen" opent het tijdwiel en legt via `confirmSwap` vast.
 * - Opslaan: tijdwiel met bijstelknoppen, daarna `commitSegment`.
 * - Einde kwart/periode: tijdwiel op het einde van het kwart, daarna
 *   `closeQuarter` (nooit automatisch afronden).
 */
export type QuickLivePanelProps = LiveTrackingPanelProps;

type Team = 'for' | 'against';
type Selected = { id: string; where: 'court' | 'bench' };
type Sheet = { kind: 'score'; team: Team } | { kind: 'time'; mode: QuickTimeMode };

function playerTag(player: GamePlayer, tag1Label: string, tag2Label: string): string {
  const tag1 = tag1Label.charAt(0).toUpperCase();
  const tag2 = tag2Label.charAt(0).toUpperCase();
  return player.vrouw ? (player.jeugd ? `${tag1}${tag2}` : tag1) : player.jeugd ? tag2 : '';
}

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`;
}

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}

function QuickChip({
  player,
  selected,
  useClassLimit,
  tag1Label,
  tag2Label,
  disabled,
  onClick,
}: {
  player: GamePlayer;
  selected: boolean;
  useClassLimit: boolean;
  tag1Label: string;
  tag2Label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const tag = playerTag(player, tag1Label, tag2Label);
  return (
    <button
      type="button"
      className={`chip quick-chip${selected ? ' chip--selected' : ''}`}
      data-testid={`quick-chip-${player.id}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="chip__nr">{player.nr}</span>
      <span className="chip__name">{player.naam}</span>
      {useClassLimit ? (
        <span className="chip__class">
          {player.kl}
          {tag ? ` ${tag}` : ''}
        </span>
      ) : null}
    </button>
  );
}

export function QuickLivePanel({
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
}: QuickLivePanelProps) {
  const t = (key: StringKey) => translate(lang, key);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [segmentsOpen, setSegmentsOpen] = useState(false);
  const [editSegmentId, setEditSegmentId] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [view, setView] = useState<'game' | 'plan'>('game');
  const [propagated, setPropagated] = useState(false);
  const { plan, savePlan, readPrevious } = useRotationPlan(game.id);
  const pending = game.pendingSwapLineup;
  useEffect(() => {
    if (pending == null) setPropagated(false);
  }, [pending]);
  // Schermwisselguard (zelfde als Compact): een onbevestigde wissel of een open
  // venster blokkeert de schakelaar in het apparaatmenu.
  useGameScreenLock(
    canWrite && pending != null
      ? 'swap'
      : sheet != null || editSegmentId != null || finishOpen
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
  const segTurnovers = history.turnovers - history.segStartTurnovers;
  const ownName = teamName || t('teamFallbackLabel');
  const opponentName = t('teamOpponent');
  const period = periodLabel || t('quarterLabel');
  const bench = game.players.filter((p) => p.participate && !game.onCourt.includes(p.id));
  const playerById = (id: string) => game.players.find((p) => p.id === id);

  // Wisselschema (lokaal, alleen invoerhulp): wat is er gepland voor het lopende blok?
  const plannedEnd = plan != null ? plannedEndSec(game, plan) : null;
  const plannedNext = plan != null ? nextPlannedLineup(game, plan) : null;
  const planDue =
    pending == null &&
    selected == null &&
    plannedEnd != null &&
    plannedNext != null &&
    plannedNext.some((id) => !game.onCourt.includes(id));
  const deviations = pending != null && plan != null ? deviationPairs(game, plan) : [];
  const lastPeriod = game.curQuarter >= quarterCount;
  const nextQuarterLineup =
    plan != null && !lastPeriod ? quarterStartLineup(game, plan, game.curQuarter + 1) : null;

  // Zet de geplande opstelling klaar (als openstaande wissel). Met `withTime` opent meteen het
  // tijdwiel; zonder blijft het wedstrijdscherm staan om eerst spelers aan te passen.
  function runPlannedSwap(withTime: boolean) {
    if (!canWrite || plannedNext == null) return;
    onGameChange({ ...game, onCourt: [...plannedNext], pendingSwapLineup: game.onCourt });
    setSelected(null);
    if (withTime) setSheet({ kind: 'time', mode: 'swap' });
  }

  function handlePropagate() {
    if (!canWrite || plan == null) return;
    savePlan(propagateDeviation(game, plan));
    setPropagated(true);
  }

  function addScore(team: Team, delta: number) {
    if (!canWrite) return;
    onGameChange({ ...game, actions: [...game.actions, scoreDeltaAction(team, delta)] });
  }

  function addTurnover(delta: number) {
    if (!canWrite) return;
    onGameChange({ ...game, actions: [...game.actions, turnoverDeltaAction(delta)] });
  }

  function handleTapPlayer(id: string) {
    if (!canWrite) return;
    const where: 'court' | 'bench' = game.onCourt.includes(id) ? 'court' : 'bench';
    if (selected == null) {
      setSelected({ id, where });
      return;
    }
    if (selected.id === id) {
      setSelected(null);
      return;
    }
    if (selected.where === where) {
      setSelected({ id, where });
      return;
    }
    const courtId = where === 'court' ? id : selected.id;
    const benchId = where === 'bench' ? id : selected.id;
    onGameChange({
      ...game,
      onCourt: swapOnCourt(game.onCourt, courtId, benchId),
      pendingSwapLineup: pending ?? game.onCourt,
    });
    setSelected(null);
  }

  function openTime(mode: QuickTimeMode) {
    if (canWrite) setSheet({ kind: 'time', mode });
  }

  function scoreSide(team: Team) {
    const name = team === 'for' ? ownName : opponentName;
    const score = team === 'for' ? history.scoreFor : history.scoreAgainst;
    const open = team === 'for' ? segDeltaFor : segDeltaAgainst;
    return (
      <div
        className={`quick-score__side quick-score__side--${team}`}
        data-testid={`quick-score-${team}`}
      >
        <span className="quick-score__name">{name}</span>
        <button
          type="button"
          className="quick-score__value"
          disabled={!canWrite}
          data-testid={`quick-score-value-${team}`}
          aria-label={fill(t('quickScoreAdjustAria'), { team: name, score })}
          onClick={() => canWrite && setSheet({ kind: 'score', team })}
        >
          <span>{score}</span>
          <span className="quick-score__chevrons" aria-hidden="true">
            ⇅
          </span>
        </button>
        <span className="quick-score__open" data-testid={`quick-score-open-${team}`}>
          {signed(open)}
        </span>
        <div className="quick-score__buttons">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              className="quick-score__btn"
              disabled={!canWrite}
              data-testid={`quick-score-plus-${team}-${n}`}
              onClick={() => addScore(team, n)}
            >
              +{n}
            </button>
          ))}
          <button
            type="button"
            className="btn-outline quick-score__btn quick-score__btn--minus"
            disabled={!canWrite}
            data-testid={`quick-score-minus-${team}`}
            aria-label={fill(t('quickScoreBackAria'), { team: name })}
            onClick={() => addScore(team, -1)}
          >
            −1
          </button>
        </div>
      </div>
    );
  }

  const [leftTeam, rightTeam]: [Team, Team] = away ? ['against', 'for'] : ['for', 'against'];
  const bannerSelected = selected != null ? playerById(selected.id) : undefined;

  function handleCreatePlan() {
    const created = emptyPlan(game, quarterCount);
    if (created != null) savePlan(created);
  }

  function handleLoadPrevious() {
    const previous = readPrevious();
    if (previous != null) savePlan(withQuarterCount(previous, game, quarterCount));
  }

  const viewSwitch = (
    <div className="quick-view" role="group" aria-label={t('quickViewAria')}>
      {(['game', 'plan'] as const).map((value) => (
        <button
          key={value}
          type="button"
          className={view === value ? 'quick-view__btn quick-view__btn--on' : 'quick-view__btn'}
          aria-pressed={view === value}
          data-testid={`quick-view-${value}`}
          onClick={() => setView(value)}
        >
          {value === 'game' ? t('quickViewGame') : t('quickViewPlan')}
        </button>
      ))}
    </div>
  );

  if (view === 'plan') {
    return (
      <section className="tracking-panel quick-panel" aria-label={t('quickPlanTitle')}>
        {viewSwitch}
        <QuickPlanEditor
          lang={lang}
          game={game}
          quarterCount={quarterCount}
          periodLabel={periodLabel}
          classification={classification}
          plan={plan}
          hasPrevious={readPrevious() != null}
          canWrite={canWrite}
          onPlanChange={savePlan}
          onCreate={handleCreatePlan}
          onLoadPrevious={handleLoadPrevious}
        />
      </section>
    );
  }

  return (
    <section className="tracking-panel quick-panel" aria-label={t('gameTitle')}>
      {viewSwitch}
      <header className="quick-panel__header">
        <h2 className="quick-panel__title">{t('gameTitle')}</h2>
        <p className="quick-panel__period" data-testid="quick-period">
          <strong>
            {period} {game.curQuarter}/{quarterCount}
          </strong>
          <span className="quick-panel__since" data-testid="quick-begin">
            {fill(t('quickBeginSince'), {
              time: fmtSec(game.beginSec),
              clock: game.clockDown ? t('compactClockRemaining') : t('compactClockElapsed'),
            })}
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

      <div className="quick-score" data-testid="quick-score">
        <label className="compact-away quick-score__away">
          <input
            type="checkbox"
            checked={away}
            data-testid="quick-away"
            onChange={(e) => handleAwayChange((e.target as HTMLInputElement).checked)}
          />
          <span>{t('compactAwayGame')}</span>
        </label>
        <div className="quick-score__sides" data-away={away}>
          {scoreSide(leftTeam)}
          {scoreSide(rightTeam)}
        </div>
        <p className="quick-score__pm" data-testid="quick-segment-pm">
          {t('quickSegmentLabel')}:{' '}
          <strong className={segPM > 0 ? 'live-pm--pos' : segPM < 0 ? 'live-pm--neg' : ''}>
            {signed(segPM)}
          </strong>
        </p>
        <div className="quick-turnovers" data-testid="quick-turnovers">
          <span className="quick-turnovers__count">
            {t('turnoversLabel')} <strong>{segTurnovers}</strong>
          </span>
          <span className="quick-turnovers__buttons">
            <button
              type="button"
              className="turnover-btn quick-turnovers__btn"
              disabled={!canWrite}
              data-testid="quick-turnover-plus"
              onClick={() => addTurnover(1)}
            >
              {t('turnoverPlusBtn')}
            </button>
            <button
              type="button"
              className="btn-outline quick-turnovers__btn"
              disabled={!canWrite || segTurnovers <= 0}
              data-testid="quick-turnover-minus"
              aria-label={t('turnoverMinusAria')}
              onClick={() => addTurnover(-1)}
            >
              −1
            </button>
          </span>
        </div>
      </div>

      <section className="quick-lineup" data-testid="quick-court">
        <div className="quick-lineup__header">
          <h3 className="quick-lineup__title">{t('onCourtLabel')}</h3>
          {classification.useClassLimit ? (
            <span
              className={courtLimit.over ? 'class-badge class-badge--over' : 'class-badge'}
              data-testid="class-badge"
            >
              {courtLimit.sum.toFixed(1)} / {courtLimit.allowed.toFixed(1)}
            </span>
          ) : null}
        </div>
        <div className="quick-grid">
          {game.onCourt.map((id) => {
            const p = playerById(id);
            return p ? (
              <QuickChip
                key={id}
                player={p}
                selected={selected?.id === id}
                useClassLimit={classification.useClassLimit}
                tag1Label={tag1Label}
                tag2Label={tag2Label}
                disabled={!canWrite}
                onClick={() => handleTapPlayer(id)}
              />
            ) : null;
          })}
        </div>
        {classification.useClassLimit && courtLimit.over ? (
          <p className="tracking-warning" role="alert" data-testid="class-warning">
            {t('tooManyClassPointsPrefix')} ({courtLimit.sum.toFixed(1)} &gt;{' '}
            {courtLimit.allowed.toFixed(1)})
          </p>
        ) : null}
      </section>

      <div
        className={
          pending != null
            ? 'quick-swapbar quick-swapbar--pending'
            : selected != null
              ? 'quick-swapbar quick-swapbar--active'
              : 'quick-swapbar'
        }
        data-testid="quick-swapbar"
      >
        {pending != null ? (
          <>
            <span className="quick-swapbar__text" data-testid="quick-swap-pending">
              {t('quickSwapPendingText')}
              {deviations.length > 0 && !propagated ? (
                <small className="quick-swapbar__deviation" data-testid="quick-plan-deviation">
                  {fill(t('quickPlanDeviation'), {
                    pairs: deviations
                      .map((d) =>
                        fill(t('quickPlanDeviationPair'), {
                          actual: playerById(d.actualId)?.naam ?? '?',
                          planned: playerById(d.plannedId)?.naam ?? '?',
                        }),
                      )
                      .join(', '),
                  })}
                </small>
              ) : null}
            </span>
            <span className="quick-swapbar__actions">
              <button
                type="button"
                className="btn-primary"
                disabled={!canWrite}
                data-testid="quick-swap-done"
                onClick={() => openTime('swap')}
              >
                {t('quickSwapDoneBtn')}
              </button>
              <button
                type="button"
                className="btn-outline"
                disabled={!canWrite}
                data-testid="quick-swap-cancel"
                onClick={() => {
                  if (canWrite) {
                    setSelected(null);
                    onGameChange(discardSwaps(game));
                  }
                }}
              >
                {t('cancelBtn')}
              </button>
              {deviations.length > 0 && !propagated ? (
                <button
                  type="button"
                  className="btn-outline quick-swapbar__propagate"
                  disabled={!canWrite}
                  data-testid="quick-plan-propagate"
                  onClick={handlePropagate}
                >
                  {t('quickPlanPropagate')}
                </button>
              ) : null}
            </span>
          </>
        ) : planDue && plannedNext != null && plannedEnd != null ? (
          <>
            <span className="quick-swapbar__text" data-testid="quick-plan-card">
              <span>
                {fill(t('quickPlanSwapCard'), {
                  period,
                  n: game.curQuarter,
                  time: fmtSec(plannedEnd),
                })}
              </span>
              <small className="quick-swapbar__deviation" data-testid="quick-plan-card-diff">
                {(() => {
                  const diff = lineupDiff(game.onCourt, plannedNext);
                  const names = (ids: string[]) =>
                    ids.map((id) => playerById(id)?.naam ?? '?').join(', ');
                  return fill(t('quickPlanInOut'), {
                    ins: names(diff.ins),
                    outs: names(diff.outs),
                  });
                })()}
              </small>
            </span>
            <span className="quick-swapbar__actions">
              <button
                type="button"
                className="btn-outline"
                disabled={!canWrite}
                data-testid="quick-plan-adjust"
                onClick={() => runPlannedSwap(false)}
              >
                {t('quickPlanSwapAdjust')}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!canWrite}
                data-testid="quick-plan-run"
                onClick={() => runPlannedSwap(true)}
              >
                {t('quickPlanSwapRun')}
              </button>
            </span>
          </>
        ) : bannerSelected != null ? (
          <span className="quick-swapbar__text" data-testid="swap-selected">
            <strong>
              #{bannerSelected.nr} {bannerSelected.naam}
            </strong>
            {t('swapChosenSuffix')}
          </span>
        ) : (
          <span className="quick-swapbar__text">{t('swapHint')}</span>
        )}
      </div>

      <section className="quick-lineup" data-testid="quick-bench">
        <h3 className="quick-lineup__title">{t('benchLabel')}</h3>
        <div className="quick-grid">
          {bench.map((p) => (
            <QuickChip
              key={p.id}
              player={p}
              selected={selected?.id === p.id}
              useClassLimit={classification.useClassLimit}
              tag1Label={tag1Label}
              tag2Label={tag2Label}
              disabled={!canWrite}
              onClick={() => handleTapPlayer(p.id)}
            />
          ))}
        </div>
      </section>

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

      <div className="quick-dock" data-testid="quick-dock">
        <button
          type="button"
          className="btn-outline quick-dock__period"
          disabled={!canWrite}
          data-testid="quick-end-period"
          onClick={() => openTime('quarter')}
        >
          {fill(t('quickEndPeriodBtn'), { period: period.toLowerCase() })}
        </button>
        <button
          type="button"
          className="btn-primary quick-dock__primary"
          disabled={!canWrite}
          data-testid="quick-primary"
          onClick={() => openTime(pending != null ? 'swap' : 'segment')}
        >
          <span>{pending != null ? t('quickSaveSwapBtn') : t('quickSaveSegmentBtn')}</span>
          <span className="quick-dock__pill" data-testid="quick-primary-pm">
            {signed(segPM)}
          </span>
        </button>
      </div>

      <button
        type="button"
        className="btn-primary quick-finish"
        disabled={!canWrite || !canFinishGame(game)}
        data-testid="quick-finish-game"
        onClick={() => canWrite && canFinishGame(game) && setFinishOpen(true)}
      >
        {t('finishGameBtn')}
      </button>

      {sheet?.kind === 'score' ? (
        <QuickScoreSheet
          lang={lang}
          game={game}
          team={sheet.team}
          teamName={teamName}
          onCommit={onGameChange}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet?.kind === 'time' ? (
        <QuickTimeSheet
          lang={lang}
          game={game}
          mode={sheet.mode}
          quarterCount={quarterCount}
          periodLabel={periodLabel}
          classification={classification}
          {...(sheet.mode !== 'quarter' && plannedEnd != null
            ? { suggestedEndSec: plannedEnd }
            : {})}
          {...(sheet.mode === 'quarter' && nextQuarterLineup != null
            ? { nextOnCourt: nextQuarterLineup }
            : {})}
          onCommit={(next) => {
            setSelected(null);
            // De wissel is vastgelegd: het volgende geplande blok wordt wat er echt op de vloer staat.
            if (plan != null && sheet.mode === 'swap') savePlan(adoptActualLineup(game, plan));
            onGameChange(next);
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}

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
    </section>
  );
}
