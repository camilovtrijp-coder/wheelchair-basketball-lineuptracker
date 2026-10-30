import { useState } from 'preact/hooks';
import { useFocusTrap } from '../../application/a11y/useFocusTrap';
import {
  correctableFieldsOf,
  correctSegment,
  type CorrectSegmentError,
} from '../../domain/game/correction';
import { sumTurnovers } from '../../domain/game/turnoverStats';
import type { CompletedGame, CorrectableSegmentFields, Segment } from '../../domain/game/types';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import {
  fmtSec,
  minutesOf,
  secondsOf,
  TimeSelect,
  withMinutes,
  withSeconds,
} from './LiveTrackingPanel';

/**
 * PR 7.5b (docs/pr-7.5-plan.md §D.5): bewerkscherm + bevestiging voor het
 * corrigeren van één segment van een afgeronde wedstrijd. Alle validatie en
 * alle rekenwerk (duur, eindscore, revisie, logitem) komt uit
 * `correctSegment()`; deze UI mapt alleen invoer naar een patch en een
 * `CorrectSegmentError` naar een tekstsleutel. Geen lineup-selectie.
 */

export const CORRECT_ERROR_KEYS: Record<CorrectSegmentError, StringKey> = {
  'game-deleted': 'correctErrorGameDeleted',
  'unknown-segment': 'correctErrorUnknownSegment',
  'no-change': 'correctErrorNoChange',
  'log-full': 'correctErrorLogFull',
  'invalid-quarter': 'correctErrorInvalidQuarter',
  'invalid-time': 'correctErrorInvalidTime',
  'invalid-duration': 'correctErrorInvalidDuration',
  'invalid-score': 'correctErrorInvalidScore',
  'invalid-turnovers': 'correctErrorInvalidTurnovers',
};

/** Compacte, taalonafhankelijke weergave van de zes bewerkbare velden. */
export function describeCorrectableFields(f: CorrectableSegmentFields): string {
  return `Q${f.quarter} · ${fmtSec(f.beginSec)} → ${fmtSec(f.endSec)} · ${f.pf}-${f.pa} · TO ${f.tov}`;
}

interface Draft {
  quarter: number;
  beginSec: number;
  endSec: number;
  pf: string;
  pa: string;
  tov: string;
}

function toNumber(raw: string): number {
  return raw.trim() === '' ? Number.NaN : Number(raw);
}

export interface CorrectSegmentDialogProps {
  lang: Lang;
  game: CompletedGame;
  segment: Segment;
  /** uid van de corrigerende gebruiker; `null` zonder cloudcontext. */
  by: string | null;
  /** Slaat de gecorrigeerde wedstrijd op; `false` = opslaan mislukt. */
  onSave: (corrected: CompletedGame) => boolean;
  onClose: () => void;
}

export function CorrectSegmentDialog({
  lang,
  game,
  segment,
  by,
  onSave,
  onClose,
}: CorrectSegmentDialogProps) {
  const t = (key: StringKey): string => translate(lang, key);
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const original = correctableFieldsOf(segment);
  const [draft, setDraft] = useState<Draft>({
    quarter: original.quarter,
    beginSec: original.beginSec,
    endSec: original.endSec,
    pf: String(original.pf),
    pa: String(original.pa),
    tov: String(original.tov),
  });
  const [errorKey, setErrorKey] = useState<StringKey | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [review, setReview] = useState<ReturnType<typeof correctSegment> | null>(null);

  function buildPatch(): Partial<CorrectableSegmentFields> {
    const candidate: CorrectableSegmentFields = {
      quarter: draft.quarter,
      beginSec: draft.beginSec,
      endSec: draft.endSec,
      pf: toNumber(draft.pf),
      pa: toNumber(draft.pa),
      tov: toNumber(draft.tov),
    };
    const patch: Partial<CorrectableSegmentFields> = {};
    for (const key of Object.keys(candidate) as (keyof CorrectableSegmentFields)[]) {
      // Number.isNaN: een leeg/ongeldig veld telt als gewijzigd zodat de
      // domeinvalidatie het afkeurt in plaats van stil de oude waarde te houden.
      if (candidate[key] !== original[key]) patch[key] = candidate[key];
    }
    return patch;
  }

  function handleReview() {
    const result = correctSegment(game, segment.id, buildPatch(), by);
    if (!result.ok) {
      setErrorKey(CORRECT_ERROR_KEYS[result.error]);
      return;
    }
    setErrorKey(null);
    setSaveFailed(false);
    setReview(result);
  }

  function handleConfirm() {
    if (review == null || !review.ok) return;
    if (onSave(review.game)) {
      onClose();
    } else {
      setSaveFailed(true);
    }
  }

  const title = t('correctSegmentTitle');
  const reviewOk = review != null && review.ok ? review : null;

  return (
    <div className="modal-overlay">
      <button
        type="button"
        className="modal-overlay__backdrop"
        aria-label={t('cancelBtn')}
        onClick={onClose}
      />
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="correct-segment-modal"
        ref={trapRef}
      >
        <div className="modal__title-row">
          <h2>{reviewOk ? t('correctSummaryTitle') : title}</h2>
          <button
            type="button"
            className="modal__close"
            aria-label={t('cancelBtn')}
            data-testid="correct-segment-close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {reviewOk ? (
          <CorrectionSummary lang={lang} before={game} after={reviewOk} />
        ) : (
          <>
            <div className="quarter-row">
              <span className="quarter-row__label">{game.periodLabel || t('quarterLabel')}</span>
              {Array.from({ length: game.quarterCount }, (_, i) => i + 1).map((q) => (
                <button
                  key={q}
                  type="button"
                  className={
                    q === draft.quarter ? 'quarter-btn quarter-btn--active' : 'quarter-btn'
                  }
                  aria-pressed={q === draft.quarter}
                  data-testid={`correct-quarter-${q}`}
                  onClick={() => setDraft({ ...draft, quarter: q })}
                >
                  {q}
                </button>
              ))}
            </div>
            <div className="time-row">
              <span className="time-row__label">{t('beginLabel')}</span>
              <TimeSelect
                value={minutesOf(draft.beginSec)}
                max={10}
                pad={false}
                disabled={false}
                testId="correct-begin-min"
                ariaLabel={`${t('beginLabel')} ${t('minutesUnitLabel')}`}
                onChange={(v) => setDraft({ ...draft, beginSec: withMinutes(draft.beginSec, v) })}
              />
              <span>:</span>
              <TimeSelect
                value={secondsOf(draft.beginSec)}
                max={59}
                pad
                disabled={false}
                testId="correct-begin-sec"
                ariaLabel={`${t('beginLabel')} ${t('secondsUnitLabel')}`}
                onChange={(v) => setDraft({ ...draft, beginSec: withSeconds(draft.beginSec, v) })}
              />
            </div>
            <div className="time-row">
              <span className="time-row__label">{t('endLabel')}</span>
              <TimeSelect
                value={minutesOf(draft.endSec)}
                max={10}
                pad={false}
                disabled={false}
                testId="correct-end-min"
                ariaLabel={`${t('endLabel')} ${t('minutesUnitLabel')}`}
                onChange={(v) => setDraft({ ...draft, endSec: withMinutes(draft.endSec, v) })}
              />
              <span>:</span>
              <TimeSelect
                value={secondsOf(draft.endSec)}
                max={59}
                pad
                disabled={false}
                testId="correct-end-sec"
                ariaLabel={`${t('endLabel')} ${t('secondsUnitLabel')}`}
                onChange={(v) => setDraft({ ...draft, endSec: withSeconds(draft.endSec, v) })}
              />
            </div>
            <div className="edit-points-row">
              <label className="settings-field">
                <span className="settings-field__label">{t('pointsForLabel')}</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={draft.pf}
                  data-testid="correct-pf"
                  onInput={(e) => setDraft({ ...draft, pf: (e.target as HTMLInputElement).value })}
                />
              </label>
              <label className="settings-field">
                <span className="settings-field__label">{t('pointsAgainstLabel')}</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={draft.pa}
                  data-testid="correct-pa"
                  onInput={(e) => setDraft({ ...draft, pa: (e.target as HTMLInputElement).value })}
                />
              </label>
            </div>
            <label className="settings-field">
              <span className="settings-field__label">{t('turnoversLabel')}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={draft.tov}
                data-testid="correct-tov"
                onInput={(e) => setDraft({ ...draft, tov: (e.target as HTMLInputElement).value })}
              />
            </label>
          </>
        )}

        {errorKey ? (
          <p className="settings-error" role="alert" data-testid="correct-segment-error">
            {t(errorKey)}
          </p>
        ) : null}
        {saveFailed ? (
          <p className="settings-error" role="alert" data-testid="correct-segment-save-error">
            {t('gameSaveError')}
          </p>
        ) : null}

        {reviewOk ? (
          <>
            <p data-testid="correct-segment-confirm-text">{t('confirmCorrectSegment')}</p>
            <button
              type="button"
              className="btn-primary"
              data-testid="correct-segment-confirm"
              onClick={handleConfirm}
            >
              {t('confirmBtn')}
            </button>
            <button
              type="button"
              className="btn-outline"
              data-testid="correct-segment-back"
              onClick={() => {
                setReview(null);
                setSaveFailed(false);
              }}
            >
              {t('backBtn')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-primary"
              data-testid="correct-segment-review"
              onClick={handleReview}
            >
              {t('correctReviewBtn')}
            </button>
            <button
              type="button"
              className="btn-outline"
              data-testid="correct-segment-cancel"
              onClick={onClose}
            >
              {t('cancelBtn')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CorrectionSummary({
  lang,
  before,
  after,
}: {
  lang: Lang;
  before: CompletedGame;
  after: {
    game: CompletedGame;
    correction: {
      segmentId: string;
      before: CorrectableSegmentFields;
      after: CorrectableSegmentFields;
    };
  };
}) {
  const t = (key: StringKey): string => translate(lang, key);
  const b = after.correction.before;
  const a = after.correction.after;
  const newSegment = after.game.segments.find((s) => s.id === after.correction.segmentId);
  const timeText = (f: CorrectableSegmentFields, dur?: number): string =>
    `Q${f.quarter} · ${fmtSec(f.beginSec)} → ${fmtSec(f.endSec)}${dur != null ? ` (${fmtSec(dur)})` : ''}`;
  const oldSegment = before.segments.find((s) => s.id === after.correction.segmentId);
  const rows: { label: string; from: string; to: string; testId: string }[] = [
    {
      label: t('correctRowTime'),
      from: timeText(b, oldSegment?.durSec),
      to: timeText(a, newSegment?.durSec),
      testId: 'time',
    },
    {
      label: t('correctRowScore'),
      from: `${b.pf} - ${b.pa}`,
      to: `${a.pf} - ${a.pa}`,
      testId: 'score',
    },
    {
      label: t('correctRowTurnovers'),
      from: String(b.tov),
      to: String(a.tov),
      testId: 'tov',
    },
    {
      label: t('correctRowFinalScore'),
      from: `${before.scoreFor} - ${before.scoreAgainst}`,
      to: `${after.game.scoreFor} - ${after.game.scoreAgainst}`,
      testId: 'final',
    },
    {
      label: t('correctRowTotalTurnovers'),
      from: String(sumTurnovers(before.segments)),
      to: String(sumTurnovers(after.game.segments)),
      testId: 'total-tov',
    },
  ];
  return (
    <dl className="correction-summary" data-testid="correct-segment-summary">
      {rows.map((r) => (
        <div key={r.testId} className="correction-summary__row">
          <dt>{r.label}</dt>
          <dd data-testid={`correct-summary-${r.testId}`}>
            <span className="correction-summary__from">
              <span className="correction-summary__tag">{t('correctBeforeLabel')}</span> {r.from}
            </span>
            <span className="correction-summary__to">
              <span className="correction-summary__tag">{t('correctAfterLabel')}</span> {r.to}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
