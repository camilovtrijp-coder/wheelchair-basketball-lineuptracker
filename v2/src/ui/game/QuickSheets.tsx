import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { MAX_CLOCK_SECONDS, MAX_SCORE, type ActiveGame } from '../../domain/game/types';
import {
  clockDuration,
  closeQuarter,
  commitSegment,
  confirmSwap,
  setScore,
  type LiveCommandError,
} from '../../domain/game/liveCommands';
import { deriveGameHistory, type ClassificationConfig } from '../../domain/game/tracking';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import { useFocusTrap } from '../../application/a11y/useFocusTrap';
import { fmtSec, liveErrorKey } from './LiveTrackingPanel';
import { WheelPicker } from './WheelPicker';

/**
 * Onderbladen van het Snel-wedstrijdscherm: stand kiezen met een wiel en
 * eindtijd kiezen met een minuten-/secondenwiel plus bijstelknoppen. Alles hier
 * is UI-state; de `ActiveGame` verandert pas bij bevestigen, via één
 * `onCommit(next)` met het resultaat van een bestaand `liveCommands`-commando op
 * de LAATSTE game-state. Geweigerde commando's tonen een melding en veranderen
 * niets.
 */

const SCORE_VALUES = Array.from({ length: MAX_SCORE + 1 }, (_, i) => String(i));
const MINUTE_VALUES = Array.from({ length: MAX_CLOCK_SECONDS / 60 + 1 }, (_, i) => String(i));
const SECOND_VALUES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
const NUDGE_SECONDS = [10, 5, 1] as const;

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`;
}

function clampClock(sec: number): number {
  return Math.max(0, Math.min(MAX_CLOCK_SECONDS, Math.round(sec)));
}

export interface SheetFrameProps {
  title: string;
  testId: string;
  closeLabel: string;
  onClose: () => void;
  children: ComponentChildren;
}

export function SheetFrame({ title, testId, closeLabel, onClose, children }: SheetFrameProps) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return (
    <div className="modal-overlay">
      <button
        type="button"
        className="modal-overlay__backdrop"
        aria-label={closeLabel}
        onClick={onClose}
      />
      <div
        className="modal quick-sheet"
        role="dialog"
        aria-label={title}
        data-testid={testId}
        ref={trapRef}
      >
        <h2 className="quick-sheet__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ---------- stand ----------

export interface QuickScoreSheetProps {
  lang: Lang;
  game: ActiveGame;
  team: 'for' | 'against';
  teamName: string;
  onCommit: (next: ActiveGame) => void;
  onClose: () => void;
}

export function QuickScoreSheet({
  lang,
  game,
  team,
  teamName,
  onCommit,
  onClose,
}: QuickScoreSheetProps) {
  const t = (key: StringKey) => translate(lang, key);
  const history = deriveGameHistory(game);
  const current = team === 'for' ? history.scoreFor : history.scoreAgainst;
  const segStart = team === 'for' ? history.segStartFor : history.segStartAgainst;
  const [value, setValue] = useState(current);
  const [error, setError] = useState<LiveCommandError | null>(null);
  const delta = value - segStart;
  const belowStart = delta < 0;
  const name = team === 'for' ? teamName || t('teamFallbackLabel') : t('teamOpponent');

  function handleDone() {
    if (belowStart) {
      setError('score-below-segment-start');
      return;
    }
    const result = setScore(game, team, value);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.game !== game) onCommit(result.game);
    onClose();
  }

  const errorKey = error != null ? liveErrorKey(error) : null;
  return (
    <SheetFrame
      title={fill(t('quickScoreSheetTitle'), { team: name })}
      testId="quick-score-sheet"
      closeLabel={t('quickCloseAria')}
      onClose={onClose}
    >
      <p className="quick-sheet__meta" data-testid="quick-score-meta">
        {fill(t('quickScoreSegmentLine'), { points: signed(delta) })}
      </p>
      <div className="quick-wheels">
        <WheelPicker
          values={SCORE_VALUES}
          index={value}
          onChange={(i) => {
            setValue(i);
            setError(null);
          }}
          ariaLabel={t('quickScoreWheelAria')}
          testId="quick-score-wheel"
        />
      </div>
      {belowStart || errorKey != null ? (
        <p className="settings-error" role="alert" data-testid="quick-score-error">
          {fill(t(errorKey ?? 'liveErrorScoreBelowSegmentStart'), {
            start: String(segStart),
          })}
        </p>
      ) : null}
      <button
        type="button"
        className="btn-primary quick-sheet__confirm"
        data-testid="quick-score-done"
        onClick={handleDone}
      >
        {t('quickDoneBtn')}
      </button>
    </SheetFrame>
  );
}

// ---------- eindtijd ----------

export type QuickTimeMode = 'segment' | 'swap' | 'quarter';

export interface QuickTimeSheetProps {
  lang: Lang;
  game: ActiveGame;
  mode: QuickTimeMode;
  quarterCount: number;
  periodLabel: string;
  classification: ClassificationConfig;
  /** Voorgestelde eindtijd (bijv. uit het wisselschema); anders afgeleid van het vorige segment. */
  suggestedEndSec?: number;
  /** Opstelling waarmee het volgende kwart begint (alleen bij `mode: 'quarter'`). */
  nextOnCourt?: string[];
  onCommit: (next: ActiveGame) => void;
  onClose: () => void;
}

/** Standaardvoorstel: dezelfde duur als het vorige segment van dit kwart, anders 1 minuut. */
export function defaultEndSec(game: ActiveGame): number {
  const last = [...deriveGameHistory(game).segments]
    .reverse()
    .find((s) => s.quarter === game.curQuarter && s.durSec > 0);
  const dur = last != null ? last.durSec : 60;
  return clampClock(game.clockDown ? game.beginSec - dur : game.beginSec + dur);
}

export function QuickTimeSheet({
  lang,
  game,
  mode,
  quarterCount,
  periodLabel,
  classification,
  suggestedEndSec,
  nextOnCourt,
  onCommit,
  onClose,
}: QuickTimeSheetProps) {
  const t = (key: StringKey) => translate(lang, key);
  const history = deriveGameHistory(game);
  const [endSec, setEndSec] = useState(() =>
    mode === 'quarter'
      ? game.clockDown
        ? 0
        : MAX_CLOCK_SECONDS
      : clampClock(suggestedEndSec ?? defaultEndSec(game)),
  );
  const [error, setError] = useState<LiveCommandError | null>(null);
  const submitted = useRef(false);

  const period = periodLabel || t('quarterLabel');
  const lastPeriod = game.curQuarter >= quarterCount;
  const nextQuarter = lastPeriod ? game.curQuarter : game.curQuarter + 1;
  const lineup = game.pendingSwapLineup ?? game.onCourt;
  const lineupText = lineup.map((id) => game.players.find((p) => p.id === id)?.nr ?? '?').join('-');
  const segPm =
    history.scoreFor - history.segStartFor - (history.scoreAgainst - history.segStartAgainst);
  const dur = clockDuration(game.clockDown, game.beginSec, endSec);
  const valid = mode === 'quarter' ? true : mode === 'swap' ? dur >= 0 : dur > 0;

  function setEnd(next: number) {
    setEndSec(clampClock(next));
    setError(null);
  }
  // "Eerder" = eerder in de wedstrijd: bij een aflopende klok een hogere kloktijd.
  function nudge(seconds: number, earlier: boolean) {
    const sign = (earlier ? 1 : -1) * (game.clockDown ? 1 : -1);
    // Functionele update: twee snelle tikken vlak na elkaar tellen beide mee.
    setEndSec((current) => clampClock(current + sign * seconds));
    setError(null);
  }

  function handleConfirm() {
    if (submitted.current || !valid) return;
    const result =
      mode === 'segment'
        ? commitSegment(game, { endSec, classification })
        : mode === 'swap'
          ? confirmSwap(game, { endSec, classification })
          : closeQuarter(game, {
              endSec,
              nextQuarter,
              quarterCount,
              classification,
              ...(nextOnCourt !== undefined ? { nextOnCourt } : {}),
            });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    submitted.current = true;
    onCommit(result.game);
    onClose();
  }

  const title =
    mode === 'segment'
      ? t('quickTimeTitleSegment')
      : mode === 'swap'
        ? t('quickTimeTitleSwap')
        : fill(t('quickTimeTitleQuarter'), { period, n: game.curQuarter });
  const confirmLabel =
    mode === 'segment'
      ? t('quickConfirmSegment')
      : mode === 'swap'
        ? t('quickConfirmSwap')
        : t('quickConfirmQuarter');
  const meta = fill(t(game.clockDown ? 'quickTimeMetaDown' : 'quickTimeMetaUp'), {
    period,
    n: game.curQuarter,
    begin: fmtSec(game.beginSec),
  });
  const errorKey = error != null ? liveErrorKey(error) : null;
  const minutes = Math.floor(endSec / 60);
  const seconds = endSec % 60;

  return (
    <SheetFrame
      title={title}
      testId="quick-time-sheet"
      closeLabel={t('cancelBtn')}
      onClose={onClose}
    >
      <p className="quick-sheet__meta" data-testid="quick-time-meta">
        {meta}
      </p>
      <div className="quick-wheels">
        <WheelPicker
          values={MINUTE_VALUES}
          index={minutes}
          onChange={(i) => setEnd(i * 60 + seconds)}
          ariaLabel={t('quickMinutesAria')}
          testId="quick-minutes-wheel"
        />
        <span className="quick-wheels__colon" aria-hidden="true">
          :
        </span>
        <WheelPicker
          values={SECOND_VALUES}
          index={seconds}
          onChange={(i) => setEnd(minutes * 60 + i)}
          ariaLabel={t('quickSecondsAria')}
          testId="quick-seconds-wheel"
        />
      </div>
      <p className="quick-sheet__time" data-testid="quick-time-value" aria-live="polite">
        {fmtSec(endSec)}
      </p>

      <div className="quick-nudge" role="group" aria-label={t('quickNudgeGroupAria')}>
        {[true, false].map((earlier) => (
          <div key={String(earlier)} className="quick-nudge__group">
            <span className="quick-nudge__caption">
              {earlier ? t('quickNudgeEarlier') : t('quickNudgeLater')}
            </span>
            <span className="quick-nudge__buttons">
              {(earlier ? NUDGE_SECONDS : [...NUDGE_SECONDS].reverse()).map((n) => (
                <button
                  key={n}
                  type="button"
                  className="btn-outline quick-nudge__btn"
                  data-testid={`quick-nudge-${earlier ? 'earlier' : 'later'}-${n}`}
                  aria-label={fill(t('quickNudgeAria'), {
                    direction: earlier ? t('quickNudgeEarlierWord') : t('quickNudgeLaterWord'),
                    n,
                  })}
                  onClick={() => nudge(n, earlier)}
                >
                  {n}s
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>

      {suggestedEndSec !== undefined && mode !== 'quarter' ? (
        <button
          type="button"
          className="btn-outline quick-sheet__plan"
          disabled={endSec === clampClock(suggestedEndSec)}
          data-testid="quick-time-plan"
          onClick={() => setEnd(suggestedEndSec)}
        >
          {fill(t('quickTimeResetToPlan'), { time: fmtSec(suggestedEndSec) })}
        </button>
      ) : null}

      {mode !== 'quarter' ? (
        <p className="quick-sheet__meta" data-testid="quick-played-line">
          {valid && dur > 0
            ? `${fill(t('quickPlayedLine'), { dur: fmtSec(dur), lineup: lineupText })} · ${signed(segPm)}`
            : valid
              ? t('compactReviewNoSegment')
              : t('endAfterBegin')}
        </p>
      ) : (
        <p className="quick-sheet__meta" data-testid="quick-quarter-note">
          {lastPeriod
            ? t('compactLastPeriodNote')
            : fill(t('compactNextPeriodNote'), { period, n: nextQuarter })}
          {!lastPeriod && nextOnCourt !== undefined
            ? ` ${fill(t('quickPlanNextQuarterLineup'), { period, n: nextQuarter })}`
            : ''}
        </p>
      )}

      {errorKey != null ? (
        <p className="settings-error" role="alert" data-testid="quick-time-error">
          {fill(t(errorKey), {
            start: `${history.segStartFor}-${history.segStartAgainst}`,
          })}
        </p>
      ) : null}

      <button
        type="button"
        className="btn-primary quick-sheet__confirm"
        disabled={!valid}
        data-testid="quick-time-confirm"
        onClick={handleConfirm}
      >
        {confirmLabel}
      </button>
      {mode === 'swap' ? (
        <button
          type="button"
          className="btn-outline quick-sheet__adjust"
          data-testid="quick-time-adjust"
          onClick={onClose}
        >
          {t('quickTimeAdjustPlayers')}
        </button>
      ) : null}
    </SheetFrame>
  );
}
