import { useRef, useState } from 'preact/hooks';
import { MAX_CLOCK_SECONDS, type ActiveGame, type Segment } from '../../domain/game/types';
import { retroSwapEntries, swapTimeBounds, type SwapFlowError } from '../../domain/game/swapFlow';
import { deriveGameHistory } from '../../domain/game/tracking';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import { fmtSec, liveErrorKey } from './liveFormat';
import { SheetFrame } from './QuickSheets';

/**
 * Onderdelen van het Rustig-wedstrijdscherm (Rustig-bouwplan R2): de tijdkaart
 * in het vaste slot, het blad voor een vergeten wissel en het blad "eerst de
 * open tijden" bij Einde kwart. Alles hier is UI-state; de `ActiveGame`
 * verandert alleen via de callbacks van `CalmLivePanel`, die de R1-commando's
 * (`confirmSwapTime`, `commitRetroactiveSwap`) op de laatste game-state draaien.
 */

export const CALM_STEP_SEC = 10;

export function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}

export function clampClock(sec: number): number {
  return Math.max(0, Math.min(MAX_CLOCK_SECONDS, Math.round(sec)));
}

/** "7:30", "07:30" of "10:00" → seconden; ongeldig of buiten 0:00–10:00 → `null`. */
export function parseClockText(raw: string): number | null {
  const match = /^\s*(\d{1,2}):([0-5]\d)\s*$/.exec(raw);
  if (match == null) return null;
  const sec = Number(match[1]) * 60 + Number(match[2]);
  return sec >= 0 && sec <= MAX_CLOCK_SECONDS ? sec : null;
}

/** Spelers die bij de wissel aan het einde van `segment` erin en eruit gingen. */
export function swapDiffOf(game: ActiveGame, segment: Segment): { ins: string[]; outs: string[] } {
  const segments = deriveGameHistory(game).segments;
  const i = segments.findIndex((s) => s.id === segment.id);
  const next = i >= 0 ? segments[i + 1] : undefined;
  const after =
    next != null && next.quarter === segment.quarter && next.beginSec === segment.endSec
      ? next.lineup
      : (game.pendingSwapLineup ?? game.onCourt);
  return {
    ins: after.filter((id) => !segment.lineup.includes(id)),
    outs: segment.lineup.filter((id) => !after.includes(id)),
  };
}

export function namesOf(game: ActiveGame, ids: string[]): string {
  return ids.map((id) => game.players.find((p) => p.id === id)?.naam ?? '?').join(', ');
}

/** Grenzen in wedstrijdvolgorde (eerst de vroegste kloktijd), voor de melding. */
function rangeText(game: ActiveGame, bounds: { min: number; max: number }) {
  return game.clockDown
    ? { from: fmtSec(bounds.max), to: fmtSec(bounds.min) }
    : { from: fmtSec(bounds.min), to: fmtSec(bounds.max) };
}

export function errorText(lang: Lang, error: SwapFlowError): string {
  if (error === 'invalid-split' || error === 'nothing-to-undo') {
    return translate(lang, 'calmRetroInvalidSplit');
  }
  const key = liveErrorKey(error);
  return translate(lang, key ?? 'calmTimeInvalid');
}

// ---------- tijd invoeren (−10s / mm:ss / +10s) ----------

interface ClockFieldProps {
  lang: Lang;
  text: string;
  disabled: boolean;
  testId: string;
  onText: (text: string) => void;
}

function ClockField({ lang, text, disabled, testId, onText }: ClockFieldProps) {
  const t = (key: StringKey) => translate(lang, key);
  function step(delta: number) {
    const current = parseClockText(text);
    if (current == null) return;
    onText(fmtSec(clampClock(current + delta)));
  }
  return (
    <div className="calm-clock" role="group" aria-label={t('calmTimeInputAria')}>
      <button
        type="button"
        className="btn-outline calm-clock__step"
        disabled={disabled}
        aria-label={t('calmTimeMinusAria')}
        data-testid={`${testId}-minus`}
        onClick={() => step(-CALM_STEP_SEC)}
      >
        −10s
      </button>
      <input
        type="text"
        inputMode="numeric"
        className="calm-clock__input"
        value={text}
        disabled={disabled}
        aria-label={t('calmTimeInputAria')}
        data-testid={`${testId}-input`}
        onInput={(e) => onText((e.target as HTMLInputElement).value)}
      />
      <button
        type="button"
        className="btn-outline calm-clock__step"
        disabled={disabled}
        aria-label={t('calmTimePlusAria')}
        data-testid={`${testId}-plus`}
        onClick={() => step(CALM_STEP_SEC)}
      >
        +10s
      </button>
    </div>
  );
}

// ---------- tijdkaart (in het vaste slot) ----------

export interface CalmTimeCardProps {
  lang: Lang;
  game: ActiveGame;
  segment: Segment;
  /** Aantal open (geschatte) tijden; > 1 toont "n tijden nog bevestigen". */
  openCount: number;
  source: 'plan' | 'estimate';
  /** Huidige kloktijd, altijd meegegeven aan `swapTimeBounds`/`confirmSwapTime` (reviewpunt 1). */
  nowSec: number;
  canWrite: boolean;
  /** Past de tijd toe; geeft een fout terug als het domein weigert. */
  onConfirm: (segmentId: string, endSec: number) => SwapFlowError | null;
  onLater: () => void;
}

export function CalmTimeCard({
  lang,
  game,
  segment,
  openCount,
  source,
  nowSec,
  canWrite,
  onConfirm,
  onLater,
}: CalmTimeCardProps) {
  const t = (key: StringKey) => translate(lang, key);
  const [text, setText] = useState(() => fmtSec(segment.endSec));
  const [error, setError] = useState<string | null>(null);
  const diff = swapDiffOf(game, segment);

  function handleConfirm() {
    const sec = parseClockText(text);
    if (sec == null) {
      setError(t('calmTimeInvalid'));
      return;
    }
    const bounds = swapTimeBounds(game, segment.id, nowSec);
    if (sec !== segment.endSec && (bounds == null || sec < bounds.min || sec > bounds.max)) {
      setError(
        bounds != null
          ? fill(t('calmTimeOutOfRange'), rangeText(game, bounds))
          : t('endAfterBegin'),
      );
      return;
    }
    const result = onConfirm(segment.id, sec);
    if (result != null) setError(errorText(lang, result));
  }

  return (
    <div className="calm-card calm-card--time" data-testid="calm-time-card">
      <p className="calm-card__title" data-testid="calm-time-title">
        {openCount > 1 ? fill(t('calmTimeTitleMany'), { n: openCount }) : t('calmTimeTitle')}
      </p>
      <p className="calm-card__line" data-testid="calm-time-line">
        {fill(t('calmTimeLine'), {
          time: fmtSec(segment.endSec),
          source: source === 'plan' ? t('calmTimeSourcePlan') : t('calmTimeSourceEstimate'),
          ins: namesOf(game, diff.ins),
          outs: namesOf(game, diff.outs),
        })}
      </p>
      <div className="calm-card__row">
        <ClockField
          lang={lang}
          text={text}
          disabled={!canWrite}
          testId="calm-time"
          onText={(next) => {
            setText(next);
            setError(null);
          }}
        />
        <button
          type="button"
          className="btn-primary calm-card__confirm"
          disabled={!canWrite}
          data-testid="calm-time-confirm"
          onClick={handleConfirm}
        >
          {t('calmTimeConfirm')}
        </button>
      </div>
      <div className="calm-card__foot">
        <span className="calm-card__error" role="alert" data-testid="calm-time-error">
          {error ?? ''}
        </span>
        <button type="button" className="calm-link" data-testid="calm-time-later" onClick={onLater}>
          {t('calmTimeLater')}
        </button>
      </div>
    </div>
  );
}

// ---------- Einde kwart: eerst de open tijden ----------

export interface CalmEndCheckSheetProps {
  lang: Lang;
  game: ActiveGame;
  periodLabel: string;
  open: Segment[];
  onAllCorrect: () => void;
  onOneByOne: () => void;
  onClose: () => void;
}

export function CalmEndCheckSheet({
  lang,
  game,
  periodLabel,
  open,
  onAllCorrect,
  onOneByOne,
  onClose,
}: CalmEndCheckSheetProps) {
  const t = (key: StringKey) => translate(lang, key);
  const period = periodLabel || t('quarterLabel');
  return (
    <SheetFrame
      title={t('calmEndCheckTitle')}
      testId="calm-end-check"
      closeLabel={t('cancelBtn')}
      onClose={onClose}
    >
      <p className="quick-sheet__meta">{t('calmEndCheckIntro')}</p>
      <ul className="calm-list">
        {open.map((s) => (
          <li key={s.id} data-testid={`calm-end-check-${s.id}`}>
            {fill(t('calmEndCheckItem'), {
              period,
              n: s.quarter,
              time: fmtSec(s.endSec),
              ins: namesOf(game, swapDiffOf(game, s).ins),
            })}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn-primary quick-sheet__confirm"
        data-testid="calm-end-check-all"
        onClick={onAllCorrect}
      >
        {t('calmEndCheckAll')}
      </button>
      <button
        type="button"
        className="btn-outline quick-sheet__adjust"
        data-testid="calm-end-check-one"
        onClick={onOneByOne}
      >
        {t('calmEndCheckOneByOne')}
      </button>
    </SheetFrame>
  );
}

// ---------- vergeten wissel (terugwerkende kracht) ----------

export interface CalmRetroSheetProps {
  lang: Lang;
  game: ActiveGame;
  teamName: string;
  /** Voorstel voor de kloktijd. */
  initialEndSec: number;
  onCommit: (endSec: number, lastOldActionId: string | null) => SwapFlowError | null;
  onClose: () => void;
}

/** Keuze "geen enkele actie" (alles telt voor de nieuwe vijf). */
const NONE = '';

export function CalmRetroSheet({
  lang,
  game,
  teamName,
  initialEndSec,
  onCommit,
  onClose,
}: CalmRetroSheetProps) {
  const t = (key: StringKey) => translate(lang, key);
  const entries = retroSwapEntries(game);
  const [text, setText] = useState(() => fmtSec(initialEndSec));
  // Zonder acties is er niets te kiezen: alles hoort bij de nieuwe vijf.
  const [boundary, setBoundary] = useState<string | null>(() =>
    entries != null && entries.length === 0 ? NONE : null,
  );
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef(false);
  const pending = game.pendingSwapLineup ?? [];
  const ins = game.onCourt.filter((id) => !pending.includes(id));
  const outs = pending.filter((id) => !game.onCourt.includes(id));

  function handleCommit() {
    if (submitted.current || entries == null || boundary == null) return;
    const sec = parseClockText(text);
    if (sec == null) {
      setError(t('calmTimeInvalid'));
      return;
    }
    const result = onCommit(sec, boundary === NONE ? null : boundary);
    if (result != null) {
      setError(errorText(lang, result));
      return;
    }
    submitted.current = true;
  }

  const own = teamName || t('teamFallbackLabel');
  return (
    <SheetFrame
      title={t('calmRetroTitle')}
      testId="calm-retro-sheet"
      closeLabel={t('cancelBtn')}
      onClose={onClose}
    >
      <p className="quick-sheet__meta" data-testid="calm-retro-lineup">
        {fill(t('quickPlanInOut'), { ins: namesOf(game, ins), outs: namesOf(game, outs) })}
      </p>
      {entries == null ? (
        <p className="settings-error" role="alert" data-testid="calm-retro-unavailable">
          {t('calmRetroUnavailable')}
        </p>
      ) : (
        <>
          <p className="calm-sheet__label">{t('calmRetroTimeLabel')}</p>
          <ClockField
            lang={lang}
            text={text}
            disabled={false}
            testId="calm-retro-time"
            onText={(next) => {
              setText(next);
              setError(null);
            }}
          />
          <p className="calm-sheet__label">
            {entries.length === 0 ? t('calmRetroEmpty') : t('calmRetroBoundaryLabel')}
          </p>
          {entries.length > 0 ? (
            <div className="calm-boundary" role="group" aria-label={t('calmRetroBoundaryLabel')}>
              <button
                type="button"
                className="calm-boundary__item"
                aria-pressed={boundary === NONE}
                data-testid="calm-retro-boundary-none"
                onClick={() => setBoundary(NONE)}
              >
                {t('calmRetroNone')}
              </button>
              {entries.map((e, i) => (
                <button
                  key={e.actionId}
                  type="button"
                  className="calm-boundary__item"
                  aria-pressed={boundary === e.actionId}
                  data-testid={`calm-retro-boundary-${i + 1}`}
                  onClick={() => setBoundary(e.actionId)}
                >
                  {e.kind === 'score'
                    ? fill(t('calmRetroScore'), {
                        n: i + 1,
                        points: `${e.delta > 0 ? '+' : ''}${e.delta}`,
                        team: e.team === 'for' ? own : t('teamOpponent'),
                      })
                    : fill(t('calmRetroTurnover'), {
                        n: i + 1,
                        delta: `${e.delta > 0 ? '+' : ''}${e.delta}`,
                      })}
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
      {error != null ? (
        <p className="settings-error" role="alert" data-testid="calm-retro-error">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="btn-primary quick-sheet__confirm"
        disabled={entries == null || boundary == null}
        data-testid="calm-retro-commit"
        onClick={handleCommit}
      >
        {t('calmRetroCommit')}
      </button>
    </SheetFrame>
  );
}
