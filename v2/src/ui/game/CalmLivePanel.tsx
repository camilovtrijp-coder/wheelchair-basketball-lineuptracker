import { useEffect, useRef, useState } from 'preact/hooks';
import { MAX_SCORE, type GamePlayer, type Segment } from '../../domain/game/types';
import { discardSwaps, openSegmentSummary, setScore } from '../../domain/game/liveCommands';
import { canFinishGame } from '../../domain/game/finish';
import {
  deriveGameHistory,
  isOverLimit,
  scoreDeltaAction,
  swapOnCourt,
  turnoverDeltaAction,
} from '../../domain/game/tracking';
import {
  commitSwapWithProvisionalTime,
  confirmSwapTime,
  currentClockSec,
  pendingTimeConfirmations,
  swapTimeBounds,
  type SwapFlowError,
} from '../../domain/game/swapFlow';
import {
  adoptActualLineup,
  emptyPlan,
  nextPlannedLineup,
  plannedEndSec,
  quarterStartLineup,
  resolveLineup,
  withQuarterCount,
  lineupDiff,
} from '../../domain/game/rotationPlan';
import {
  readPlayTimePreference,
  storePlayTimePreference,
} from '../../infrastructure/game/playTimePreference';
import { playTimeByPlayer } from '../../domain/game/playTime';
import { readAwayPreference } from '../../infrastructure/game/compactAwayPreference';
import {
  confirmAllSwapTimes,
  markSwapTimeConfirmed,
  markSwapTimeUnconfirmed,
  readSwapFlowState,
  setUndoBlockedAction,
  type SwapFlowState,
} from '../../infrastructure/game/swapFlowStore';
import { translate, type StringKey } from '../../i18n/strings';
import { useGameScreenLock } from '../../application/game/useGameScreen';
import { useRotationPlan } from '../../application/game/useRotationPlan';
import { fmtSec, type LiveTrackingPanelProps } from './LiveTrackingPanel';
import { CompactSegmentList } from './CompactSegmentList';
import { CompactSegmentEditor } from './CompactSegmentEditor';
import { FinishGameDialog } from './FinishGameDialog';
import { QuickTimeSheet, SheetFrame } from './QuickSheets';
import { QuickPlanEditor } from './QuickPlanEditor';
import { CalmClockField } from './CalmClockField';
import { CalmConfirmSheet, CalmRetroSheet, swapErrorKey } from './CalmSheets';

/**
 * Rustig wedstrijdscherm (vierde optie naast Klassiek, Compact en Snel; bouwplan
 * wedstrijdscherm-rustig R2). Zelfde props en dezelfde `ActiveGame`; geen
 * wijziging van het datacontract. Alles staat op één scherm, zonder scrollen:
 * stand (met −1 en een keuzelijst), turnover, de huidige vijf, één vast slot dat om beurten
 * de schemakaart, hulpkaart of tijdkaart toont, de bank met klassesom en een
 * onderbalk met Segmenten en Einde kwart.
 *
 * "Eerst wisselen, tijd achteraf": Wissel uitvoeren legt het segment direct vast
 * (`commitSwapWithProvisionalTime`); de tijd bevestig je daarna met de tijdkaart
 * (`confirmSwapTime`). Welke tijden nog een schatting zijn, staat lokaal op dit
 * apparaat (`swapFlowStore`), nooit in de wedstrijd.
 */
export type CalmLivePanelProps = LiveTrackingPanelProps;

type Team = 'for' | 'against';
type Selected = { id: string; where: 'court' | 'bench' };
type Sheet = 'segments' | 'confirm' | 'quarter' | 'retro' | null;
type Notice = { text: string };

const NOTICE_MS = 8000;
const HIGHLIGHT_MS = 4000;

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`;
}

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}

function CalmChip({
  player,
  selected,
  highlight,
  disabled,
  playTime,
  playTimeTitle,
  onClick,
}: {
  player: GamePlayer;
  /** Speeltijd (m:ss) of `undefined` als de optie uit staat. */
  playTime?: string;
  playTimeTitle?: string;
  selected: boolean;
  highlight: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`chip calm-chip${selected ? ' calm-chip--selected' : ''}${highlight ? ' calm-chip--in' : ''}`}
      data-testid={`calm-chip-${player.id}`}
      aria-pressed={selected}
      disabled={disabled}
      title={playTimeTitle}
      onClick={onClick}
    >
      <span className="chip__nr">
        {player.nr}
        {playTime !== undefined ? (
          <span className="calm-chip__time" data-testid={`calm-playtime-${player.id}`}>
            {playTime}
          </span>
        ) : null}
      </span>
      <span className="chip__name">{player.naam}</span>
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
  const [sheet, setSheet] = useState<Sheet>(null);
  const [editSegmentId, setEditSegmentId] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  // Bouwplan Rustig, besluit 8: tot het eerste segment is vastgelegd opent het
  // scherm op het wisselschema; daarna, ook na herladen, op Wedstrijd. Afgeleid.
  const [view, setView] = useState<'game' | 'plan'>(() =>
    deriveGameHistory(game).segments.length === 0 ? 'plan' : 'game',
  );
  const { plan, savePlan, clearPlan, readPrevious } = useRotationPlan(game.id);

  // Lokale wisselflow-toestand (open tijden, blokkade voor ongedaan maken in andere schermen); volgt de wedstrijd-ID.
  const [flowState, setFlowState] = useState(() => ({
    id: game.id,
    flow: readSwapFlowState(game.id),
  }));
  useEffect(() => {
    if (flowState.id !== game.id) {
      setFlowState({ id: game.id, flow: readSwapFlowState(game.id) });
    }
  }, [game.id, flowState.id]);
  const flow: SwapFlowState =
    flowState.id === game.id ? flowState.flow : readSwapFlowState(game.id);
  function reloadFlow() {
    setFlowState({ id: game.id, flow: readSwapFlowState(game.id) });
  }

  // Tijdkaart: wissel waarvan de tijd nu wordt bekeken (ook bevestigde schematijden, besluit reviewpunt 2).
  const [timeTargetId, setTimeTargetId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [timeDraft, setTimeDraft] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [justIn, setJustIn] = useState<string[]>([]);
  const [error, setError] = useState<SwapFlowError | null>(null);

  // Scorekeuzelijst (R9): welke kant is open, plus de elementen voor focus en buiten-tikken.
  const [pick, setPick] = useState<Team | null>(null);
  const triggerRefs = useRef<Record<Team, HTMLButtonElement | null>>({ for: null, against: null });
  const pickerRef = useRef<HTMLDivElement | null>(null);
  function closePick() {
    const team = pick;
    setPick(null);
    if (team != null) triggerRefs.current[team]?.focus();
  }
  useEffect(() => {
    if (pick == null) return undefined;
    const grid = pickerRef.current?.querySelector<HTMLElement>('[role="listbox"]');
    const current = grid?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (grid != null && current != null) {
      grid.scrollTop = Math.max(0, current.offsetTop - grid.offsetTop - 44);
      current.focus({ preventScroll: true });
    }
    const team = pick;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setPick(null);
      triggerRefs.current[team]?.focus();
    }
    function onClick(e: MouseEvent) {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('.calm-picker') != null || el?.closest('[data-calm-pick]') != null) return;
      setPick(null);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [pick]);

  useEffect(() => {
    if (notice == null) return undefined;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (justIn.length === 0) return undefined;
    const timer = window.setTimeout(() => setJustIn([]), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [justIn]);

  const [showPlayTime, setShowPlayTime] = useState(() => readPlayTimePreference());
  function togglePlayTime() {
    const next = !showPlayTime;
    setShowPlayTime(next);
    storePlayTimePreference(next);
  }

  const pending = game.pendingSwapLineup;
  useGameScreenLock(
    canWrite && pending != null
      ? 'swap'
      : sheet != null || editSegmentId != null || finishOpen
        ? 'dialog'
        : null,
  );

  // Uitwedstrijd: alleen lezen; de schakelaar staat sinds R9 op de opzetpagina (zelfde lokale voorkeur).
  const away = readAwayPreference(game.id);

  const history = deriveGameHistory(game);
  const segments: Segment[] = history.segments;
  const segDeltaFor = history.scoreFor - history.segStartFor;
  const segDeltaAgainst = history.scoreAgainst - history.segStartAgainst;
  const segPM = segDeltaFor - segDeltaAgainst;
  const segTurnovers = history.turnovers - history.segStartTurnovers;
  const openSegment = openSegmentSummary(game);
  const ownName = teamName || t('teamFallbackLabel');
  const opponentName = t('teamOpponent');
  const period = periodLabel || t('quarterLabel');
  const bench = game.players.filter((p) => p.participate && !game.onCourt.includes(p.id));
  const playerById = (id: string) => game.players.find((p) => p.id === id);
  const names = (ids: string[]) => ids.map((id) => playerById(id)?.naam ?? '?').join(', ');
  const nowSec = currentClockSec(game);
  // Speeltijd t/m de laatste wissel (alleen vastgelegde segmenten, ook voorlopige tijden).
  const playTimes = showPlayTime ? playTimeByPlayer(segments) : null;
  const chipTime = (p: GamePlayer) =>
    playTimes != null
      ? {
          playTime: fmtSec(playTimes[p.id] ?? 0),
          playTimeTitle: fill(t('calmPlayTimeChipTitle'), {
            name: p.naam,
            time: fmtSec(playTimes[p.id] ?? 0),
          }),
        }
      : {};

  // Open schattingen (oudste eerst) en de tijdkaart-wissel.
  const openEstimates = pendingTimeConfirmations(game, flow.unconfirmedSegmentIds);
  const target =
    segments.find((s) => s.id === timeTargetId && s.quarter === game.curQuarter) ?? null;
  const focus = segments.find((sg) => sg.id === focusId) ?? null;
  const timeSegment = focus ?? openEstimates[0] ?? target;
  const timeIsEstimate = timeSegment != null && openEstimates.some((s) => s.id === timeSegment.id);
  const timeBounds = timeSegment != null ? swapTimeBounds(game, timeSegment.id, nowSec) : null;
  const timeResetKey = timeSegment != null ? `${timeSegment.id}:${timeSegment.endSec}` : '';
  useEffect(() => {
    setTimeDraft(timeSegment != null ? timeSegment.endSec : null);
    // Alleen bij een andere wissel of een nieuwe vastgelegde tijd terugzetten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeResetKey]);

  // Wisselschema (lokaal, alleen invoerhulp).
  const plannedEnd = plan != null ? plannedEndSec(game, plan) : null;
  const plannedNext = plan != null ? nextPlannedLineup(game, plan) : null;
  const planDue =
    pending == null &&
    selected == null &&
    plannedEnd != null &&
    plannedNext != null &&
    plannedNext.some((id) => !game.onCourt.includes(id));
  const lastPeriod = game.curQuarter >= quarterCount;
  const nextQuarterLineup =
    plan != null && !lastPeriod ? quarterStartLineup(game, plan, game.curQuarter + 1) : null;

  // Klassesom na de wissel onder elke bankspeler (alleen met een gekozen vloerspeler).
  const courtSelected = selected?.where === 'court' ? selected.id : null;
  function sumAfterSwap(benchId: string) {
    if (courtSelected == null) return null;
    const lineup = swapOnCourt(game.onCourt, courtSelected, benchId);
    return isOverLimit(game, lineup, classification);
  }
  const pendingLimit = pending != null ? isOverLimit(game, game.onCourt, classification) : null;

  const lineupDiffNow =
    pending != null
      ? lineupDiff(pending, game.onCourt)
      : { ins: [] as string[], outs: [] as string[] };

  // ---------- acties ----------

  function addScore(team: Team, delta: number) {
    if (!canWrite) return;
    setNotice(null);
    onGameChange({ ...game, actions: [...game.actions, scoreDeltaAction(team, delta)] });
  }

  function addTurnover(delta: number) {
    if (!canWrite) return;
    setNotice(null);
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

  /** Legt de openstaande wissel direct vast; de tijd is de schematijd of een schatting. */
  function executeSwap(base = game) {
    if (!canWrite || base.pendingSwapLineup == null) return;
    const old = base.pendingSwapLineup;
    // Het volgende geplande blok wordt wat er echt op de vloer staat (als in Snel).
    if (plan != null) savePlan(adoptActualLineup(base, plan));
    const result = commitSwapWithProvisionalTime(base, { plan, classification });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    const diff = lineupDiff(old, base.onCourt);
    onGameChange(result.game);
    setSelected(null);
    if (result.segmentId != null) {
      if (result.needsConfirmation) markSwapTimeUnconfirmed(base.id, result.segmentId);
      setTimeTargetId(result.segmentId);
    }
    reloadFlow();
    setJustIn(diff.ins);
    setNotice({
      text: fill(t('calmSwapDone'), { ins: names(diff.ins), outs: names(diff.outs) }),
    });
  }

  /** Kiest een score uit de lijst: vervangt de stand; het open segment verwerkt het verschil. */
  function chooseScore(team: Team, value: number) {
    if (!canWrite) return;
    const result = setScore(game, team, value);
    if (result.ok) {
      if (result.game !== game) {
        setNotice(null);
        onGameChange(result.game);
      }
      setError(null);
    }
    closePick();
  }

  /** Pijltjestoetsen in de lijst: ±1 (links/rechts) en ±6 (omhoog/omlaag, zes kolommen). */
  function handlePickKey(e: KeyboardEvent) {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -6,
      ArrowDown: 6,
    };
    const options = Array.from(
      pickerRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    );
    const at = options.findIndex((el) => el === document.activeElement);
    let next = -1;
    if (e.key in steps && at >= 0) next = at + (steps[e.key] ?? 0);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else return;
    e.preventDefault();
    options[Math.min(options.length - 1, Math.max(0, next))]?.focus();
  }

  /** Zet de geplande opstelling klaar; met `run` meteen vastleggen (Wissel uitvoeren). */
  function runPlannedSwap(run: boolean) {
    if (!canWrite || plannedNext == null) return;
    const next = { ...game, onCourt: [...plannedNext], pendingSwapLineup: game.onCourt };
    setSelected(null);
    if (run) executeSwap(next);
    else onGameChange(next);
  }

  function handleConfirmTime() {
    if (!canWrite || timeSegment == null || timeDraft == null) return;
    const result =
      timeDraft === timeSegment.endSec
        ? ({ ok: true, game } as const)
        : confirmSwapTime(game, timeSegment.id, timeDraft, nowSec);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    if (result.game !== game) onGameChange(result.game);
    markSwapTimeConfirmed(game.id, timeSegment.id);
    reloadFlow();
    setTimeTargetId(null);
    setFocusId(null);
  }

  function handleConfirmAll() {
    confirmAllSwapTimes(game.id);
    reloadFlow();
    setSheet('quarter');
  }

  function handleEndQuarter() {
    if (!canWrite) return;
    setSheet(openEstimates.length > 0 ? 'confirm' : 'quarter');
  }

  // Starters in het schema aangepast vóór het eerste segment (zelfde gedrag als Snel).
  function handleStartersChange(rosterIds: number[]) {
    if (!canWrite) return;
    const ids = resolveLineup(game, rosterIds);
    if (ids == null) return;
    onGameChange(
      game.pendingSwapLineup != null
        ? { ...game, pendingSwapLineup: ids }
        : { ...game, onCourt: ids },
    );
  }

  function handleCreatePlan() {
    const created = emptyPlan(game, quarterCount);
    if (created != null) savePlan(created);
  }

  function handleLoadPrevious() {
    const previous = readPrevious();
    if (previous != null) savePlan(withQuarterCount(previous, game, quarterCount));
  }

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
          previousPlan={readPrevious()}
          canWrite={canWrite}
          onPlanChange={savePlan}
          onCreate={handleCreatePlan}
          onLoadPrevious={handleLoadPrevious}
          onClear={clearPlan}
          onStartersChange={handleStartersChange}
        />
      </section>
    );
  }

  const [leftTeam, rightTeam]: [Team, Team] = away ? ['against', 'for'] : ['for', 'against'];
  const selectedPlayer = selected != null ? playerById(selected.id) : undefined;
  const courtLimit = isOverLimit(game, game.onCourt, classification);
  const errorKey = error != null ? swapErrorKey(error) : null;
  const openCount = openEstimates.length;

  function scoreSide(team: Team) {
    const name = team === 'for' ? ownName : opponentName;
    const score = team === 'for' ? history.scoreFor : history.scoreAgainst;
    return (
      <div
        className={`calm-score__side calm-score__side--${team}`}
        data-testid={`calm-score-${team}`}
      >
        <span className="calm-score__name">{name}</span>
        <button
          type="button"
          ref={(el) => {
            triggerRefs.current[team] = el;
          }}
          className={`calm-score__value${pick === team ? ' calm-score__value--open' : ''}`}
          data-testid={`calm-score-value-${team}`}
          data-calm-pick={team}
          disabled={!canWrite}
          aria-haspopup="listbox"
          aria-expanded={pick === team}
          aria-label={fill(t('calmScorePickAria'), { team: name, n: score })}
          onClick={() => canWrite && setPick(pick === team ? null : team)}
        >
          {score}
        </button>
        <div className="calm-score__buttons">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              className="calm-score__btn"
              disabled={!canWrite}
              aria-label={fill(t('calmScoreAddAria'), { n, team: name })}
              data-testid={`calm-score-plus-${team}-${n}`}
              onClick={() => addScore(team, n)}
            >
              +{n}
            </button>
          ))}
          <button
            type="button"
            className="calm-score__btn calm-score__btn--minus"
            disabled={!canWrite || score <= 0}
            aria-label={fill(t('calmScoreMinusAria'), { team: name })}
            data-testid={`calm-score-minus-${team}`}
            onClick={() => score > 0 && addScore(team, -1)}
          >
            −1
          </button>
        </div>
      </div>
    );
  }

  function scorePicker(team: Team) {
    const name = team === 'for' ? ownName : opponentName;
    const score = team === 'for' ? history.scoreFor : history.scoreAgainst;
    return (
      <div
        className={`calm-picker calm-picker--${team}`}
        ref={pickerRef}
        data-testid="calm-score-picker"
      >
        <div className="calm-picker__head">
          <span>{fill(t('calmScorePickTitle'), { team: name })}</span>
          <button
            type="button"
            className="calm-picker__close"
            data-testid="calm-score-picker-close"
            onClick={closePick}
          >
            {t('calmCloseAria')}
          </button>
        </div>
        <div
          className="calm-picker__grid"
          role="listbox"
          tabIndex={-1}
          aria-label={t('calmScoreListAria')}
          data-testid="calm-score-list"
          onKeyDown={handlePickKey}
        >
          {Array.from({ length: MAX_SCORE + 1 }, (_, value) => (
            <button
              key={value}
              type="button"
              role="option"
              className="calm-picker__opt"
              aria-selected={value === score}
              data-testid={`calm-score-option-${value}`}
              onClick={() => chooseScore(team, value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---------- vast slot ----------

  function slot() {
    if (selectedPlayer != null && selected != null) {
      return (
        <div className="calm-card calm-card--help" data-testid="calm-slot-help">
          <p className="calm-card__title">
            {fill(t(selected.where === 'court' ? 'calmHelpIn' : 'calmHelpOut'), {
              name: `#${selectedPlayer.nr} ${selectedPlayer.naam}`,
            })}
          </p>
          <p className="calm-card__meta">{t('swapHint')}</p>
        </div>
      );
    }
    if (pending != null) {
      return (
        <div className="calm-card calm-card--pending" data-testid="calm-slot-pending">
          <p className="calm-card__title">
            {fill(t('calmPendingText'), {
              ins: names(lineupDiffNow.ins),
              outs: names(lineupDiffNow.outs),
            })}
          </p>
          {classification.useClassLimit && pendingLimit?.over ? (
            <p className="calm-card__warn" role="alert" data-testid="calm-class-warning">
              {fill(t('calmClassOver'), {
                sum: pendingLimit.sum.toFixed(1),
                allowed: pendingLimit.allowed.toFixed(1),
              })}
            </p>
          ) : null}
          <div className="calm-card__actions">
            <button
              type="button"
              className="btn-primary calm-card__primary"
              disabled={!canWrite}
              data-testid="calm-swap-run"
              onClick={() => executeSwap()}
            >
              {t('quickPlanSwapRun')}
            </button>
            <button
              type="button"
              className="btn-outline"
              disabled={!canWrite}
              data-testid="calm-retro-open"
              onClick={() => canWrite && setSheet('retro')}
            >
              {t('calmForgotLink')}
            </button>
          </div>
        </div>
      );
    }
    // De melding na een wissel (R9) staat in het vaste vak: kort zichtbaar of tot je erop tikt,
    // daarna volgt weer de kaart die erbij hoort (tijdkaart, schema of hint).
    if (notice != null) {
      return (
        <button
          type="button"
          className="calm-card calm-card--notice"
          data-testid="calm-slot-notice"
          onClick={() => setNotice(null)}
        >
          <span className="calm-card__title" data-testid="calm-notice-text">
            {notice.text}
          </span>
        </button>
      );
    }
    // Open schattingen gaan voor het schema; een bevestigde wissel blijft bijstelbaar tot er iets anders te doen is.
    if (timeSegment != null && (timeIsEstimate || focus != null)) return timeCard();
    if (planDue && plannedNext != null && plannedEnd != null) {
      const diff = lineupDiff(game.onCourt, plannedNext);
      return (
        <div className="calm-card calm-card--plan" data-testid="calm-slot-plan">
          <p className="calm-card__title">
            {fill(t('quickPlanSwapCard'), {
              period,
              n: game.curQuarter,
              time: fmtSec(plannedEnd),
            })}
          </p>
          <p className="calm-card__meta" data-testid="calm-plan-diff">
            {fill(t('quickPlanInOut'), { ins: names(diff.ins), outs: names(diff.outs) })}
          </p>
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
              className="btn-primary calm-card__primary"
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
    if (timeSegment != null) return timeCard();
    return (
      <div className="calm-card calm-card--idle" data-testid="calm-slot-idle">
        <p className="calm-card__meta">{t('swapHint')}</p>
        {showPlayTime ? (
          <p className="calm-card__meta" data-testid="calm-playtime-note">
            {t('calmPlayTimeNote')}
          </p>
        ) : null}
      </div>
    );
  }

  function timeCard() {
    if (timeSegment == null) return null;
    const count =
      openCount === 1
        ? t('calmTimeCountOne')
        : openCount > 1
          ? fill(t('calmTimeCountMany'), { n: openCount })
          : '';
    return (
      <div className="calm-card calm-card--time" data-testid="calm-slot-time">
        <p className="calm-card__title" data-testid="calm-time-title">
          {fill(t('calmTimeTitle'), { time: fmtSec(timeSegment.endSec) })}
          {timeIsEstimate ? ` (${t('calmTimeEstimated')})` : ''}
        </p>
        {count !== '' ? (
          <p className="calm-card__meta" data-testid="calm-time-count">
            {count}
          </p>
        ) : null}
        <div className="calm-card__actions">
          <CalmClockField
            lang={lang}
            value={timeDraft}
            clockDown={game.clockDown}
            bounds={timeBounds}
            disabled={!canWrite}
            testId="calm-time"
            onChange={(next) => {
              setTimeDraft(next);
              setError(null);
            }}
          />
          <button
            type="button"
            className="btn-primary calm-card__primary"
            disabled={!canWrite || timeDraft == null}
            data-testid="calm-time-ok"
            onClick={handleConfirmTime}
          >
            {t('calmTimeOk')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="tracking-panel quick-panel calm-panel" aria-label={t('gameTitle')}>
      <div className="calm-top">
        {viewSwitch}
        <button
          type="button"
          className="btn-outline calm-top__playtime"
          aria-pressed={showPlayTime}
          aria-label={t('calmPlayTimeToggleAria')}
          title={t('calmPlayTimeTitle')}
          data-testid="calm-playtime-toggle"
          onClick={togglePlayTime}
        >
          ⏱
        </button>
        <button
          type="button"
          className="btn-outline calm-top__finish"
          disabled={!canWrite || !canFinishGame(game)}
          data-testid="calm-finish-game"
          onClick={() => canWrite && canFinishGame(game) && setFinishOpen(true)}
        >
          {t('finishGameBtn')}
        </button>
      </div>

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
        {pick != null ? scorePicker(pick) : null}
      </div>

      <div className="calm-segline" data-testid="calm-segline">
        <span className="calm-segline__label">{t('calmSegLine')}</span>
        <span data-testid="calm-segline-for">
          {ownName} <b>{signed(openSegment.pointsFor)}</b>
        </span>
        <span data-testid="calm-segline-against">
          {opponentName} <b>{signed(openSegment.pointsAgainst)}</b>
        </span>
      </div>

      <div className="calm-actions" data-testid="calm-actions">
        <button
          type="button"
          className="calm-actions__plus"
          disabled={!canWrite}
          aria-label={fill(t('calmTurnoverPlusAria'), { n: segTurnovers })}
          data-testid="calm-turnover-plus"
          onClick={() => addTurnover(1)}
        >
          <span>{t('turnoverPlusBtn')}</span>
          <span className="calm-actions__count">
            <b data-testid="calm-turnover-count">{segTurnovers}</b>
            <small>{t('calmTurnoverSegment')}</small>
          </span>
        </button>
        <button
          type="button"
          className="calm-actions__minus"
          disabled={!canWrite || segTurnovers <= 0}
          aria-label={t('turnoverMinusAria')}
          data-testid="calm-turnover-minus"
          onClick={() => segTurnovers > 0 && addTurnover(-1)}
        >
          −1
        </button>
      </div>

      <div className="calm-strip" data-testid="calm-strip">
        <span className="calm-strip__title" data-testid="calm-strip-title">
          {fill(t('calmStripTitle'), { time: fmtSec(game.beginSec), q: game.curQuarter })}
        </span>
        <span className="calm-strip__stats" data-testid="calm-strip-stats">
          {fill(t('calmStripPm'), { pm: signed(segPM) })}
          {' · '}
          <span className="calm-strip__tov">{fill(t('calmStripTov'), { tov: segTurnovers })}</span>
          {classification.useClassLimit ? (
            <span
              className={courtLimit.over ? 'class-badge class-badge--over' : 'class-badge'}
              data-testid="calm-class-badge"
            >
              {courtLimit.sum.toFixed(1)}/{courtLimit.allowed.toFixed(1)}
            </span>
          ) : null}
        </span>
      </div>

      <div className="calm-grid" data-testid="calm-court">
        {game.onCourt.map((id) => {
          const p = playerById(id);
          return p ? (
            <CalmChip
              key={id}
              player={p}
              selected={selected?.id === id}
              highlight={justIn.includes(id)}
              disabled={!canWrite}
              {...chipTime(p)}
              onClick={() => handleTapPlayer(id)}
            />
          ) : null;
        })}
      </div>

      <div
        className={errorKey != null ? 'calm-slot calm-slot--error' : 'calm-slot'}
        role="status"
        aria-live="polite"
        data-testid="calm-slot"
      >
        {errorKey != null ? (
          <p className="calm-slot__error" role="alert" data-testid="calm-error">
            {t(errorKey)}
          </p>
        ) : null}
        {slot()}
      </div>

      <div className="calm-grid calm-grid--bench" data-testid="calm-bench">
        {bench.map((p) => {
          const after = sumAfterSwap(p.id);
          const showSum = classification.useClassLimit && after != null;
          return (
            <div key={p.id} className="calm-bench__item">
              <CalmChip
                player={p}
                selected={selected?.id === p.id}
                highlight={justIn.includes(p.id)}
                disabled={!canWrite}
                {...chipTime(p)}
                onClick={() => handleTapPlayer(p.id)}
              />
              <span
                className={
                  showSum
                    ? after.over
                      ? 'calm-bench__sum calm-bench__sum--over'
                      : 'calm-bench__sum calm-bench__sum--ok'
                    : 'calm-bench__sum'
                }
                data-testid={`calm-bench-sum-${p.id}`}
                role={showSum ? 'img' : undefined}
                data-status={showSum ? (after.over ? 'over' : 'ok') : 'none'}
                aria-label={
                  showSum
                    ? fill(t('calmBenchClassAria'), {
                        sum: after.sum.toFixed(1),
                        status: after.over ? t('calmClassTooHigh') : t('calmClassFits'),
                      })
                    : undefined
                }
              >
                {showSum ? `${after.sum.toFixed(1)} ${after.over ? '!' : '✓'}` : ' '}
              </span>
            </div>
          );
        })}
      </div>

      <div className="calm-cancel">
        {pending != null ? (
          <button
            type="button"
            className="btn-outline calm-cancel__btn"
            disabled={!canWrite}
            data-testid="calm-swap-cancel"
            onClick={() => {
              if (canWrite) {
                setSelected(null);
                onGameChange(discardSwaps(game));
              }
            }}
          >
            {t('calmCancelSwap')}
          </button>
        ) : null}
      </div>

      <div className="calm-dock" data-testid="calm-dock">
        <button
          type="button"
          className="btn-outline calm-dock__btn"
          data-testid="calm-segments-btn"
          onClick={() => setSheet('segments')}
        >
          {fill(t('calmSegmentsBtn'), { n: segments.length })}
        </button>
        <button
          type="button"
          className="btn-primary calm-dock__btn"
          disabled={!canWrite}
          data-testid="calm-end-quarter"
          onClick={handleEndQuarter}
        >
          {fill(t('quickEndPeriodBtn'), { period: period.toLowerCase() })}
        </button>
      </div>

      {sheet === 'segments' ? (
        <SheetFrame
          title={t('calmSegmentsTitle')}
          testId="calm-segments-sheet"
          closeLabel={t('calmCloseAria')}
          onClose={() => setSheet(null)}
        >
          <CompactSegmentList
            lang={lang}
            game={game}
            periodLabel={periodLabel}
            expanded
            canWrite={canWrite}
            away={away}
            onToggle={() => undefined}
            onEdit={(id) => {
              setSheet(null);
              setEditSegmentId(id);
            }}
          />
        </SheetFrame>
      ) : null}

      {sheet === 'confirm' ? (
        <CalmConfirmSheet
          lang={lang}
          segments={openEstimates}
          onConfirmAll={handleConfirmAll}
          onAdjust={(id) => {
            setFocusId(id);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'quarter' ? (
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
            setTimeTargetId(null);
            onGameChange(next);
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'retro' ? (
        <CalmRetroSheet
          lang={lang}
          game={game}
          classification={classification}
          teamName={teamName}
          onCommit={(next, info) => {
            const diff =
              pending != null ? lineupDiff(pending, game.onCourt) : { ins: [], outs: [] };
            if (plan != null) savePlan(adoptActualLineup(game, plan));
            onGameChange(next);
            setUndoBlockedAction(game.id, info.lastActionId);
            reloadFlow();
            setSelected(null);
            setTimeTargetId(info.segmentId);
            setJustIn(diff.ins);
            setNotice({
              text: fill(t('calmSwapDoneRetro'), {
                ins: names(diff.ins),
                outs: names(diff.outs),
                time: fmtSec(info.endSec),
              }),
            });
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
