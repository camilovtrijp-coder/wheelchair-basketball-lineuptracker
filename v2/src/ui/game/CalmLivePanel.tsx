import { useEffect, useRef, useState } from 'preact/hooks';
import type { ActiveGame, GamePlayer } from '../../domain/game/types';
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
  commitRetroactiveSwap,
  commitSwapWithProvisionalTime,
  confirmSwapTime,
  lastUndoableAction,
  pendingTimeConfirmations,
  proposeSwapTime,
  undoLastAction,
  type SwapFlowError,
  type UndoneAction,
} from '../../domain/game/swapFlow';
import {
  adoptActualLineup,
  emptyPlan,
  lineupDiff,
  nextPlannedLineup,
  plannedEndSec,
  quarterEndSec,
  quarterStartLineup,
  withQuarterCount,
  type RotationPlan,
} from '../../domain/game/rotationPlan';
import {
  clearSwapFlowState,
  confirmAllSwapTimes,
  markSwapTimeConfirmed,
  markSwapTimeUnconfirmed,
  readSwapFlowState,
  setUndoBlockedAction,
} from '../../infrastructure/game/swapFlowStore';
import {
  readAwayPreference,
  storeAwayPreference,
} from '../../infrastructure/game/compactAwayPreference';
import { translate, type StringKey } from '../../i18n/strings';
import { useGameScreenLock } from '../../application/game/useGameScreen';
import { useRotationPlan } from '../../application/game/useRotationPlan';
import { fmtSec } from './liveFormat';
import type { LiveTrackingPanelProps } from './LiveTrackingPanel';
import { CompactSegmentList } from './CompactSegmentList';
import { CompactSegmentEditor } from './CompactSegmentEditor';
import { FinishGameDialog } from './FinishGameDialog';
import { QuickScoreSheet, QuickTimeSheet, SheetFrame } from './QuickSheets';
import { QuickPlanEditor } from './QuickPlanEditor';
import {
  CalmEndCheckSheet,
  CalmRetroSheet,
  CalmTimeCard,
  errorText,
  fill,
  namesOf,
} from './CalmCards';

/**
 * Rustig wedstrijdscherm (vierde optie naast Klassiek, Compact en Snel;
 * Rustig-bouwplan R2). Zelfde props en dezelfde `ActiveGame` als de andere
 * schermen; geen wijziging van het datacontract. Doel: rustig bedienen tijdens
 * de wedstrijd, alles op één scherm, niets verspringt.
 *
 * - "Eerst wisselen, tijd achteraf": "Wissel uitvoeren" legt direct vast via
 *   `commitSwapWithProvisionalTime` (schematijd, of vorige wissel + 1:00). Een
 *   geschatte tijd staat open (lokaal, `swapFlowStore`) tot hij bevestigd is.
 * - Eén vast slot toont afwisselend de hulpkaart (tijdens wisselen), de
 *   tijdkaart, de schemakaart of een korte hint.
 * - Ongedaan maken: alleen de laatste actie (`undoLastAction`), blokkade via
 *   `swapFlowStore` zodat het ook na herladen één niveau blijft.
 * - Een schematijd telt niet als open bij Einde kwart, maar de tijdkaart
 *   verschijnt wel, zodat een eerdere/latere wissel bij te stellen is
 *   (reviewpunt 2). Dat is sessietoestand; na herladen is hij gewoon bevestigd.
 */
export type CalmLivePanelProps = LiveTrackingPanelProps;

type Team = 'for' | 'against';
type Selected = { id: string; where: 'court' | 'bench' };
type Sheet =
  | { kind: 'score'; team: Team }
  | { kind: 'quarter' }
  | { kind: 'end-check' }
  | { kind: 'segments' }
  | { kind: 'retro' };
type Notice =
  | { kind: 'swap'; text: string; segmentId: string | null }
  | { kind: 'info'; text: string }
  | { kind: 'error'; text: string };

/** Hoe lang een nieuwe speler groen omlijst blijft. */
export const CALM_HIGHLIGHT_MS = 4000;

/**
 * Huidige kloktijd voor `confirmSwapTime`/`swapTimeBounds` (reviewpunt 1:
 * altijd meegeven). De app heeft geen lopende wedstrijdklok; de enige tijd die
 * zeker niet vóór "nu" ligt, is het einde van het lopende kwart. Zodra er een
 * echte kloktijd beschikbaar is, hoort die hier.
 */
export function calmNowSec(game: ActiveGame): number {
  return quarterEndSec(game.clockDown);
}

function playerTag(player: GamePlayer, tag1Label: string, tag2Label: string): string {
  const tag1 = tag1Label.charAt(0).toUpperCase();
  const tag2 = tag2Label.charAt(0).toUpperCase();
  return player.vrouw ? (player.jeugd ? `${tag1}${tag2}` : tag1) : player.jeugd ? tag2 : '';
}

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`;
}

interface ChipProps {
  player: GamePlayer;
  selected: boolean;
  fresh: boolean;
  useClassLimit: boolean;
  tag1Label: string;
  tag2Label: string;
  disabled: boolean;
  /** Klassesom van de opstelling na deze wissel (alleen tijdens wisselen). */
  after: { sum: number; over: boolean; label: string } | null;
  onClick: () => void;
}

function CalmChip({
  player,
  selected,
  fresh,
  useClassLimit,
  tag1Label,
  tag2Label,
  disabled,
  after,
  onClick,
}: ChipProps) {
  const tag = playerTag(player, tag1Label, tag2Label);
  const cls = ['chip', 'calm-chip'];
  if (selected) cls.push('calm-chip--selected');
  if (fresh) cls.push('calm-chip--new');
  return (
    <button
      type="button"
      className={cls.join(' ')}
      data-testid={`calm-chip-${player.id}`}
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
      {after != null ? (
        <span
          className={after.over ? 'calm-chip__after calm-chip__after--over' : 'calm-chip__after'}
          data-testid={`calm-after-${player.id}`}
          data-over={after.over}
          aria-label={after.label}
        >
          {after.sum.toFixed(1)}
        </span>
      ) : null}
    </button>
  );
}

export function CalmLivePanel({
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
}: CalmLivePanelProps) {
  const t = (key: StringKey) => translate(lang, key);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [editSegmentId, setEditSegmentId] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  // Besluit 8 (zelfde als Snel na R0b): tot het eerste segment opent het scherm op het schema.
  const [view, setView] = useState<'game' | 'plan'>(() =>
    deriveGameHistory(game).segments.length === 0 ? 'plan' : 'game',
  );
  const [retroMode, setRetroMode] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  // Tijdkaart verborgen ("Later") tot de volgende wissel; open tijden blijven open.
  const [timeCardHidden, setTimeCardHidden] = useState(false);
  // Wissel op schematijd: telt niet als open, maar is nog bij te stellen (reviewpunt 2).
  const [planTimeSegmentId, setPlanTimeSegmentId] = useState<string | null>(null);
  // Na elke wijziging in `swapFlowStore` opnieuw lezen.
  const [, setFlowVersion] = useState(0);
  const bumpFlow = () => setFlowVersion((v) => v + 1);
  // Schema van vóór een wissel, om het bij ongedaan maken terug te zetten.
  const planBackup = useRef(new Map<string, RotationPlan>());
  const { plan, savePlan, readPrevious } = useRotationPlan(game.id);
  const pending = game.pendingSwapLineup;

  useEffect(() => {
    if (fresh.length === 0) return;
    const timer = setTimeout(() => setFresh([]), CALM_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [fresh]);

  useGameScreenLock(
    canWrite && pending != null
      ? 'swap'
      : sheet != null || editSegmentId != null || finishOpen
        ? 'dialog'
        : null,
  );

  // Uitwedstrijd: zelfde lokale voorkeur als Compact/Snel, nooit op ActiveGame.
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
  const flow = readSwapFlowState(game.id);
  const openTimes = pendingTimeConfirmations(game, flow.unconfirmedSegmentIds);
  const planTimeSegment =
    planTimeSegmentId != null
      ? (history.segments.find((s) => s.id === planTimeSegmentId) ?? null)
      : null;
  const undoTarget = canWrite ? lastUndoableAction(game, flow.undoBlockedActionId) : null;
  const nowSec = calmNowSec(game);

  const segDeltaFor = history.scoreFor - history.segStartFor;
  const segDeltaAgainst = history.scoreAgainst - history.segStartAgainst;
  const segPM = segDeltaFor - segDeltaAgainst;
  const segTurnovers = history.turnovers - history.segStartTurnovers;
  const ownName = teamName || t('teamFallbackLabel');
  const opponentName = t('teamOpponent');
  const period = periodLabel || t('quarterLabel');
  const lastPeriod = game.curQuarter >= quarterCount;
  const bench = game.players.filter((p) => p.participate && !game.onCourt.includes(p.id));
  const playerById = (id: string) => game.players.find((p) => p.id === id);
  const playerText = (id: string) => {
    const p = playerById(id);
    return p ? `#${p.nr} ${p.naam}` : '#?';
  };

  const plannedEnd = plan != null ? plannedEndSec(game, plan) : null;
  const plannedNext = plan != null ? nextPlannedLineup(game, plan) : null;
  const planDue =
    plannedEnd != null &&
    plannedNext != null &&
    plannedNext.some((id) => !game.onCourt.includes(id));
  const nextQuarterLineup =
    plan != null && !lastPeriod ? quarterStartLineup(game, plan, game.curQuarter + 1) : null;

  const swapping = selected != null || pending != null || retroMode;
  const timeTarget = timeCardHidden ? null : (openTimes[0] ?? planTimeSegment);

  // ---------- acties ----------

  function apply(next: ActiveGame) {
    onGameChange(next);
  }

  function addScore(team: Team, delta: number) {
    if (!canWrite) return;
    setNotice(null);
    apply({ ...game, actions: [...game.actions, scoreDeltaAction(team, delta)] });
  }

  function addTurnover() {
    if (!canWrite) return;
    setNotice(null);
    apply({ ...game, actions: [...game.actions, turnoverDeltaAction(1)] });
  }

  function undoText(undone: UndoneAction): string {
    if (undone.kind === 'score') {
      return fill(t('calmUndoneScore'), {
        points: signed(undone.delta),
        team: undone.team === 'for' ? ownName : opponentName,
      });
    }
    if (undone.kind === 'turnover') return t('calmUndoneTurnover');
    return fill(t('calmUndoneSwap'), {
      outs: namesOf(game, undone.outs),
      ins: namesOf(game, undone.ins),
    });
  }

  function handleUndo() {
    if (!canWrite) return;
    const result = undoLastAction(game, flow.undoBlockedActionId);
    if (!result.ok) return;
    setUndoBlockedAction(game.id, result.lastActionId);
    if (result.undone.kind === 'swap') {
      const id = result.undone.segmentId;
      markSwapTimeConfirmed(game.id, id);
      if (planTimeSegmentId === id) setPlanTimeSegmentId(null);
      const backup = planBackup.current.get(id);
      if (backup != null) {
        savePlan(backup);
        planBackup.current.delete(id);
      }
      setFresh([]);
    }
    setSelected(null);
    setRetroMode(false);
    setNotice({ kind: 'info', text: undoText(result.undone) });
    bumpFlow();
    apply(result.game);
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
    setNotice(null);
    apply({
      ...game,
      onCourt: swapOnCourt(game.onCourt, courtId, benchId),
      pendingSwapLineup: pending ?? game.onCourt,
    });
    setSelected(null);
  }

  function cancelSwap() {
    setSelected(null);
    setRetroMode(false);
    if (canWrite && pending != null) apply(discardSwaps(game));
  }

  /** Na een vastgelegde wissel: schema bijwerken, melding, nieuwe spelers omlijsten. */
  function afterSwap(concept: ActiveGame, segmentId: string | null, text: string) {
    const before = concept.pendingSwapLineup ?? [];
    if (plan != null) {
      const adopted = adoptActualLineup(concept, plan);
      if (segmentId != null) planBackup.current.set(segmentId, plan);
      if (adopted !== plan) savePlan(adopted);
    }
    setFresh(concept.onCourt.filter((id) => !before.includes(id)));
    setNotice({ kind: 'swap', text, segmentId });
    setSelected(null);
    setRetroMode(false);
    setTimeCardHidden(false);
    bumpFlow();
  }

  function commitConcept(concept: ActiveGame) {
    if (!canWrite || concept.pendingSwapLineup == null) return;
    const result = commitSwapWithProvisionalTime(concept, { plan, classification });
    if (!result.ok) {
      setNotice({ kind: 'error', text: errorText(lang, result.error) });
      return;
    }
    if (result.needsConfirmation && result.segmentId != null) {
      markSwapTimeUnconfirmed(game.id, result.segmentId);
    }
    setPlanTimeSegmentId(result.timeSource === 'plan' ? result.segmentId : null);
    const before = concept.pendingSwapLineup;
    const text = fill(t('calmSwapDone'), {
      ins: namesOf(
        concept,
        concept.onCourt.filter((id) => !before.includes(id)),
      ),
      outs: namesOf(
        concept,
        before.filter((id) => !concept.onCourt.includes(id)),
      ),
    });
    afterSwap(concept, result.segmentId, text);
    apply(result.game);
  }

  /** Schemakaart: zet de geplande opstelling klaar; `run` legt ook meteen vast. */
  function runPlannedSwap(run: boolean) {
    if (!canWrite || plannedNext == null) return;
    const concept: ActiveGame = {
      ...game,
      onCourt: [...plannedNext],
      pendingSwapLineup: game.onCourt,
    };
    setSelected(null);
    setNotice(null);
    if (run) commitConcept(concept);
    else apply(concept);
  }

  function handleConfirmTime(segmentId: string, endSec: number): SwapFlowError | null {
    const result = confirmSwapTime(game, segmentId, endSec, nowSec);
    if (!result.ok) return result.error;
    markSwapTimeConfirmed(game.id, segmentId);
    if (planTimeSegmentId === segmentId) setPlanTimeSegmentId(null);
    setNotice({ kind: 'info', text: fill(t('calmTimeConfirmed'), { time: fmtSec(endSec) }) });
    bumpFlow();
    if (result.game !== game) apply(result.game);
    return null;
  }

  function handleRetroCommit(endSec: number, lastOldActionId: string | null): SwapFlowError | null {
    const result = commitRetroactiveSwap(game, { endSec, lastOldActionId, classification });
    if (!result.ok) return result.error;
    // Een vergeten wissel is in één stap niet terug te draaien (R1): blokkeren.
    setUndoBlockedAction(game.id, result.lastActionId);
    setPlanTimeSegmentId(null);
    afterSwap(game, result.segmentId, fill(t('calmRetroDone'), { time: fmtSec(endSec) }));
    setSheet(null);
    apply(result.game);
    return null;
  }

  function handleEndPeriod() {
    if (!canWrite) return;
    setSelected(null);
    setSheet(openTimes.length > 0 ? { kind: 'end-check' } : { kind: 'quarter' });
  }

  function handleCreatePlan() {
    const created = emptyPlan(game, quarterCount);
    if (created != null) savePlan(created);
  }

  function handleLoadPrevious() {
    const previous = readPrevious();
    if (previous != null) savePlan(withQuarterCount(previous, game, quarterCount));
  }

  // ---------- weergave ----------

  const viewSwitch = (
    <div className="quick-view calm-view" role="group" aria-label={t('quickViewAria')}>
      {(['plan', 'game'] as const).map((value) => (
        <button
          key={value}
          type="button"
          className={view === value ? 'quick-view__btn quick-view__btn--on' : 'quick-view__btn'}
          aria-pressed={view === value}
          data-testid={`calm-view-${value}`}
          onClick={() => setView(value)}
        >
          {value === 'game' ? t('quickViewGame') : t('quickViewPlan')}
        </button>
      ))}
    </div>
  );

  if (view === 'plan') {
    return (
      <section className="tracking-panel quick-panel calm-panel" aria-label={t('quickPlanTitle')}>
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

  function scoreSide(team: Team) {
    const name = team === 'for' ? ownName : opponentName;
    const score = team === 'for' ? history.scoreFor : history.scoreAgainst;
    return (
      <div
        className={`calm-score__side quick-score__side quick-score__side--${team}`}
        data-testid={`calm-score-${team}`}
      >
        <div className="calm-score__top">
          <span className="quick-score__name">{name}</span>
          <button
            type="button"
            className="calm-score__value"
            disabled={!canWrite}
            data-testid={`calm-score-value-${team}`}
            aria-label={fill(t('quickScoreAdjustAria'), { team: name, score })}
            onClick={() => canWrite && setSheet({ kind: 'score', team })}
          >
            {score}
          </button>
        </div>
        <div className="calm-score__buttons">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              className="quick-score__btn"
              disabled={!canWrite}
              data-testid={`calm-score-plus-${team}-${n}`}
              onClick={() => addScore(team, n)}
            >
              +{n}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function afterFor(id: string): ChipProps['after'] {
    if (!classification.useClassLimit || selected == null) return null;
    const where: 'court' | 'bench' = game.onCourt.includes(id) ? 'court' : 'bench';
    if (where === selected.where) return null;
    const courtId = where === 'court' ? id : selected.id;
    const benchId = where === 'bench' ? id : selected.id;
    const limit = isOverLimit(game, swapOnCourt(game.onCourt, courtId, benchId), classification);
    return {
      sum: limit.sum,
      over: limit.over,
      label: fill(t('calmClassAfterAria'), {
        sum: limit.sum.toFixed(1),
        status: limit.over ? t('calmClassTooHigh') : t('calmClassFits'),
      }),
    };
  }

  function chip(p: GamePlayer) {
    return (
      <CalmChip
        key={p.id}
        player={p}
        selected={selected?.id === p.id}
        fresh={fresh.includes(p.id)}
        useClassLimit={classification.useClassLimit}
        tag1Label={tag1Label}
        tag2Label={tag2Label}
        disabled={!canWrite}
        after={afterFor(p.id)}
        onClick={() => handleTapPlayer(p.id)}
      />
    );
  }

  const conceptLimit = isOverLimit(game, game.onCourt, classification);

  function slot() {
    if (swapping) {
      const sel = selected != null ? playerText(selected.id) : '';
      const title =
        selected != null
          ? fill(t(selected.where === 'court' ? 'calmHelpWhoIn' : 'calmHelpWhoOut'), {
              player: sel,
            })
          : pending != null
            ? t('calmHelpReady')
            : t('calmHelpRetroStart');
      const diff = pending != null ? lineupDiff(pending, game.onCourt) : null;
      return (
        <div className="calm-card calm-card--help" data-testid="calm-help-card">
          <p className="calm-card__title" data-testid="calm-help-title">
            {title}
          </p>
          <p className="calm-card__line" data-testid="calm-help-line">
            {diff != null
              ? fill(t('quickPlanInOut'), {
                  ins: namesOf(game, diff.ins),
                  outs: namesOf(game, diff.outs),
                })
              : ''}
          </p>
          <p className="calm-card__warn" role="status" data-testid="calm-help-warn">
            {classification.useClassLimit && pending != null && conceptLimit.over
              ? fill(t('calmClassOverWarn'), {
                  sum: conceptLimit.sum.toFixed(1),
                  allowed: conceptLimit.allowed.toFixed(1),
                })
              : pending != null && selected == null
                ? t('calmHelpMore')
                : ''}
          </p>
          <div className="calm-card__actions">
            {pending != null && selected == null ? (
              retroMode ? (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!canWrite}
                  data-testid="calm-retro-next"
                  onClick={() => setSheet({ kind: 'retro' })}
                >
                  {t('calmRetroNext')}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!canWrite}
                  data-testid="calm-swap-run"
                  onClick={() => commitConcept(game)}
                >
                  {t('quickPlanSwapRun')}
                </button>
              )
            ) : null}
            <button
              type="button"
              className="btn-outline"
              data-testid="calm-swap-cancel"
              onClick={cancelSwap}
            >
              {t('calmSwapCancel')}
            </button>
          </div>
        </div>
      );
    }
    if (timeTarget != null) {
      const isPlan = openTimes[0] == null;
      return (
        <CalmTimeCard
          key={`${timeTarget.id}:${timeTarget.endSec}`}
          lang={lang}
          game={game}
          segment={timeTarget}
          openCount={openTimes.length}
          source={isPlan ? 'plan' : 'estimate'}
          nowSec={nowSec}
          canWrite={canWrite}
          onConfirm={handleConfirmTime}
          onLater={() => {
            setTimeCardHidden(true);
            if (isPlan) setPlanTimeSegmentId(null);
          }}
        />
      );
    }
    if (planDue && plannedNext != null && plannedEnd != null) {
      const diff = lineupDiff(game.onCourt, plannedNext);
      return (
        <div className="calm-card calm-card--plan" data-testid="calm-plan-card">
          <p className="calm-card__title">
            {fill(t('quickPlanSwapCard'), {
              period,
              n: game.curQuarter,
              time: fmtSec(plannedEnd),
            })}
          </p>
          <p className="calm-card__line" data-testid="calm-plan-diff">
            {fill(t('quickPlanInOut'), {
              ins: namesOf(game, diff.ins),
              outs: namesOf(game, diff.outs),
            })}
          </p>
          <p className="calm-card__warn" />
          <div className="calm-card__actions">
            <button
              type="button"
              className="btn-outline"
              disabled={!canWrite}
              data-testid="calm-plan-adjust"
              onClick={() => runPlannedSwap(false)}
            >
              {t('quickPlanSwapAdjust')}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!canWrite}
              data-testid="calm-plan-run"
              onClick={() => runPlannedSwap(true)}
            >
              {t('quickPlanSwapRun')}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="calm-card calm-card--idle" data-testid="calm-idle-card">
        <p className="calm-card__title">{t('calmSlotHint')}</p>
        <p className="calm-card__line" />
        <p className="calm-card__warn" />
        <div className="calm-card__actions">
          {openTimes.length > 0 ? (
            <button
              type="button"
              className="btn-outline"
              data-testid="calm-open-times"
              onClick={() => setTimeCardHidden(false)}
            >
              {openTimes.length === 1
                ? t('calmOpenTimesOne')
                : fill(t('calmOpenTimesMany'), { n: openTimes.length })}
            </button>
          ) : null}
          <button
            type="button"
            className="btn-outline"
            disabled={!canWrite}
            data-testid="calm-forgot-swap"
            onClick={() => {
              setNotice(null);
              setRetroMode(true);
            }}
          >
            {t('calmForgotSwapBtn')}
          </button>
        </div>
      </div>
    );
  }

  const [leftTeam, rightTeam]: [Team, Team] = away ? ['against', 'for'] : ['for', 'against'];
  const canUndoNoticeSwap =
    notice?.kind === 'swap' &&
    undoTarget?.type === 'segment-saved' &&
    notice.segmentId != null &&
    undoTarget.segment.id === notice.segmentId;

  return (
    <section className="tracking-panel calm-panel" aria-label={t('gameTitle')}>
      {viewSwitch}
      <header className="calm-header">
        <strong data-testid="calm-period">
          {period} {game.curQuarter}/{quarterCount}
        </strong>
        <label className="compact-away calm-header__away">
          <input
            type="checkbox"
            checked={away}
            data-testid="calm-away"
            onChange={(e) => handleAwayChange((e.target as HTMLInputElement).checked)}
          />
          <span>{t('compactAwayGame')}</span>
        </label>
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

      <div className="calm-score" data-testid="calm-score" data-away={away}>
        {scoreSide(leftTeam)}
        {scoreSide(rightTeam)}
      </div>

      <div className="calm-actions">
        <button
          type="button"
          className="turnover-btn calm-actions__btn"
          disabled={!canWrite}
          data-testid="calm-turnover"
          onClick={addTurnover}
        >
          {t('calmTurnoverBtn')}
        </button>
        <button
          type="button"
          className="btn-outline calm-actions__btn"
          disabled={undoTarget == null}
          data-testid="calm-undo"
          onClick={handleUndo}
        >
          ↶ {t('calmUndoBtn')}
        </button>
      </div>

      <div
        className={`calm-notice${notice != null ? ` calm-notice--${notice.kind}` : ''}`}
        role="status"
        aria-live="polite"
        data-testid="calm-notice"
      >
        {notice != null ? <span data-testid="calm-notice-text">{notice.text}</span> : null}
        {canUndoNoticeSwap ? (
          <button
            type="button"
            className="calm-link"
            data-testid="calm-notice-undo"
            onClick={handleUndo}
          >
            {t('calmUndoBtn')}
          </button>
        ) : null}
      </div>

      <div className="calm-strip" data-testid="calm-strip">
        <span data-testid="calm-strip-since">
          {fill(t('calmStripCurrent'), { time: fmtSec(game.beginSec) })}
        </span>
        <span className="calm-strip__stats">
          <strong
            className={segPM > 0 ? 'live-pm--pos' : segPM < 0 ? 'live-pm--neg' : ''}
            aria-label={t('calmStripPmAria')}
            data-testid="calm-strip-pm"
          >
            {signed(segPM)}
          </strong>
          <span aria-label={t('calmStripToAria')} data-testid="calm-strip-to">
            TO {segTurnovers}
          </span>
          {classification.useClassLimit ? (
            <span
              className={conceptLimit.over ? 'class-badge class-badge--over' : 'class-badge'}
              data-testid="class-badge"
            >
              {conceptLimit.sum.toFixed(1)} / {conceptLimit.allowed.toFixed(1)}
            </span>
          ) : null}
        </span>
      </div>

      <div className="calm-grid" data-testid="calm-court" aria-label={t('onCourtLabel')}>
        {game.onCourt.map((id) => {
          const p = playerById(id);
          return p ? chip(p) : null;
        })}
      </div>

      <div className="calm-slot" data-testid="calm-slot">
        {slot()}
      </div>

      <div className="calm-grid" data-testid="calm-bench" aria-label={t('benchLabel')}>
        {bench.map((p) => chip(p))}
      </div>

      <div className="calm-bottombar" data-testid="calm-bottombar">
        <button
          type="button"
          className="btn-outline"
          data-testid="calm-segments"
          onClick={() => setSheet({ kind: 'segments' })}
        >
          {fill(t('calmSegmentsBtn'), { n: history.segments.length })}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!canWrite}
          data-testid="calm-end-period"
          onClick={handleEndPeriod}
        >
          {fill(t('calmEndPeriodBtn'), { period: period.toLowerCase() })}
        </button>
        {lastPeriod ? (
          <button
            type="button"
            className="btn-outline"
            disabled={!canWrite || !canFinishGame(game)}
            data-testid="calm-finish-game"
            onClick={() => canWrite && canFinishGame(game) && setFinishOpen(true)}
          >
            {t('finishGameBtn')}
          </button>
        ) : null}
      </div>

      {sheet?.kind === 'score' ? (
        <QuickScoreSheet
          lang={lang}
          game={game}
          team={sheet.team}
          teamName={teamName}
          onCommit={apply}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet?.kind === 'quarter' ? (
        <QuickTimeSheet
          lang={lang}
          game={game}
          mode="quarter"
          quarterCount={quarterCount}
          periodLabel={periodLabel}
          classification={classification}
          {...(nextQuarterLineup != null ? { nextOnCourt: nextQuarterLineup } : {})}
          onCommit={(next) => {
            setSelected(null);
            setRetroMode(false);
            setPlanTimeSegmentId(null);
            setNotice(null);
            apply(next);
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet?.kind === 'end-check' ? (
        <CalmEndCheckSheet
          lang={lang}
          game={game}
          periodLabel={periodLabel}
          open={openTimes}
          onAllCorrect={() => {
            confirmAllSwapTimes(game.id);
            bumpFlow();
            setSheet({ kind: 'quarter' });
          }}
          onOneByOne={() => {
            setTimeCardHidden(false);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet?.kind === 'retro' ? (
        <CalmRetroSheet
          lang={lang}
          game={game}
          teamName={teamName}
          initialEndSec={proposeSwapTime(game, null).endSec}
          onCommit={handleRetroCommit}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet?.kind === 'segments' ? (
        <SheetFrame
          title={t('calmSegmentsTitle')}
          testId="calm-segments-sheet"
          closeLabel={t('quickCloseAria')}
          onClose={() => setSheet(null)}
        >
          <CompactSegmentList
            lang={lang}
            game={game}
            periodLabel={periodLabel}
            expanded
            canWrite={canWrite}
            away={away}
            onToggle={() => setSheet(null)}
            onEdit={(id) => {
              setSheet(null);
              setEditSegmentId(id);
            }}
          />
          <button
            type="button"
            className="btn-primary quick-sheet__confirm"
            disabled={!canWrite || !canFinishGame(game)}
            data-testid="calm-segments-finish"
            onClick={() => {
              if (!canWrite || !canFinishGame(game)) return;
              setSheet(null);
              setFinishOpen(true);
            }}
          >
            {t('finishGameBtn')}
          </button>
        </SheetFrame>
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
          onCommit={apply}
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
          onGameChange={apply}
          onFinishGame={(latest) => {
            const finished = onFinishGame(latest);
            // Afgerond: de lokale wisselflow-toestand van deze wedstrijd is niet meer nodig.
            if (finished !== false) clearSwapFlowState(game.id);
            return finished;
          }}
          onClose={() => setFinishOpen(false)}
        />
      ) : null}
    </section>
  );
}
