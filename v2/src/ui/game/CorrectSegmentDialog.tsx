import { useEffect, useRef, useState } from 'preact/hooks';
import { useFocusTrap } from '../../application/a11y/useFocusTrap';
import {
  correctableFieldsOf,
  correctSegment,
  type CorrectSegmentError,
} from '../../domain/game/correction';
import { sumTurnovers } from '../../domain/game/turnoverStats';
import {
  adjustedAllowed,
  isOverAllowed,
  lineupClassSum,
  sameLineupSet,
} from '../../domain/game/segmentLineup';
import type { ClassificationConfig } from '../../domain/game/tracking';
import type {
  CompletedGame,
  CorrectableSegmentFields,
  GamePlayer,
  Segment,
} from '../../domain/game/types';
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
 * `CorrectSegmentError` naar een tekstsleutel.
 *
 * PR 7.7b (docs/pr-7.7-plan.md §C.3): ook de vijf spelers van het segment zijn
 * te corrigeren (alleen deelnemers van de wedstrijd). Klassesom en limiet worden
 * live getoond uit dezelfde domeinfuncties als `correctSegment()` gebruikt;
 * overschrijding waarschuwt maar blokkeert niet. Namen komen alleen in de UI,
 * het logitem bevat uitsluitend speler-ID's.
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
  'invalid-lineup': 'correctErrorInvalidLineup',
  'classification-unavailable': 'correctErrorClassificationUnavailable',
};

/**
 * Compacte, taalonafhankelijke weergave van de bewerkbare velden. Met
 * `players` en een gelogde lineup komen de rugnummers erbij (PR 7.7b).
 */
export function describeCorrectableFields(
  f: CorrectableSegmentFields,
  lang: Lang,
  players?: readonly GamePlayer[],
): string {
  const base = `Q${f.quarter} · ${fmtSec(f.beginSec)} → ${fmtSec(f.endSec)} · ${f.pf}-${f.pa} · ${translate(lang, 'turnoverPillPrefix')} ${f.tov}`;
  if (players === undefined || f.lineup === undefined) return base;
  const numbers = f.lineup.map((id) => players.find((p) => p.id === id)?.nr ?? '?').join('-');
  return `${base} · ${translate(lang, 'correctRowLineup')} ${numbers}`;
}

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(value),
    template,
  );
}

function playerLabel(players: readonly GamePlayer[], id: string): string {
  const p = players.find((pl) => pl.id === id);
  return p ? `#${p.nr} ${p.naam}`.trim() : '?';
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
  /**
   * PR 7.7b: HUIDIGE klasse-instellingen (variant A); nodig om `allowed` bij te
   * stellen als de lineup wijzigt in een wedstrijd met klassegrens.
   */
  classification?: ClassificationConfig;
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
  classification,
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
  const [lineupDraft, setLineupDraft] = useState<string[]>([...segment.lineup]);
  const [pickSlot, setPickSlot] = useState<number | null>(null);
  const [errorKey, setErrorKey] = useState<StringKey | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [review, setReview] = useState<ReturnType<typeof correctSegment> | null>(null);

  function buildPatch(): Partial<CorrectableSegmentFields> {
    const candidate = {
      quarter: draft.quarter,
      beginSec: draft.beginSec,
      endSec: draft.endSec,
      pf: toNumber(draft.pf),
      pa: toNumber(draft.pa),
      tov: toNumber(draft.tov),
    };
    const patch: Partial<CorrectableSegmentFields> = {};
    for (const key of Object.keys(candidate) as (keyof typeof candidate)[]) {
      // Number.isNaN: een leeg/ongeldig veld telt als gewijzigd zodat de
      // domeinvalidatie het afkeurt in plaats van stil de oude waarde te houden.
      if (candidate[key] !== original[key]) patch[key] = candidate[key];
    }
    // PR 7.7b: alleen een andere samenstelling telt (volgorde niet).
    if (!sameLineupSet(lineupDraft, segment.lineup)) patch.lineup = [...lineupDraft];
    return patch;
  }

  function handleReview() {
    const result = correctSegment(game, segment.id, buildPatch(), by, { classification });
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
  // Focusbeheer: bij de overgang bewerken <-> samenvatting verdwijnt de
  // gefocuste knop; zet de focus dan op de titel (binnen de focus trap).
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const reviewing = review != null;
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [reviewing]);
  const reviewOk = review != null && review.ok ? review : null;

  const lineupChanged = !sameLineupSet(lineupDraft, segment.lineup);
  const candidates = game.players.filter((p) => p.participate && !lineupDraft.includes(p.id));
  const showClass = game.useClassLimit && (!lineupChanged || classification != null);
  const liveSum = lineupChanged
    ? lineupClassSum(lineupDraft, game.players, game.useClassLimit)
    : segment.classSum;
  const liveAllowed =
    lineupChanged && classification != null
      ? adjustedAllowed(segment.allowed, segment.lineup, lineupDraft, game.players, classification)
      : segment.allowed;
  const liveOver = isOverAllowed(liveSum, liveAllowed);
  const pickedPlayer = pickSlot != null ? lineupDraft[pickSlot] : undefined;

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
          <h2 ref={headingRef} tabIndex={-1}>
            {reviewOk ? t('correctSummaryTitle') : title}
          </h2>
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
            <section className="correct-lineup" data-testid="correct-lineup">
              <h3 className="correct-lineup__title">{t('correctLineupTitle')}</h3>
              <p className="quick-sheet__meta">{t('correctLineupHint')}</p>
              <div className="quick-grid">
                {lineupDraft.map((id, i) => {
                  const p = game.players.find((pl) => pl.id === id);
                  const on = pickSlot === i;
                  return (
                    <button
                      key={`${i}-${id}`}
                      type="button"
                      className={`chip quick-chip${on ? ' chip--selected' : ''}`}
                      aria-pressed={on}
                      aria-label={fill(t('correctLineupSlotAria'), {
                        nr: p?.nr ?? '?',
                        name: p?.naam ?? '',
                      })}
                      data-testid={`correct-lineup-slot-${i}`}
                      onClick={() => setPickSlot(on ? null : i)}
                    >
                      <span className="chip__nr">{p?.nr ?? '?'}</span>
                      <span className="chip__name">{p?.naam ?? ''}</span>
                    </button>
                  );
                })}
              </div>
              {pickSlot != null ? (
                <div className="correct-lineup__pick" data-testid="correct-lineup-picker">
                  <p className="quick-sheet__meta">
                    {fill(t('correctLineupPickTitle'), {
                      name: playerLabel(game.players, pickedPlayer ?? ''),
                    })}
                  </p>
                  {candidates.length === 0 ? (
                    <p className="quick-sheet__meta" data-testid="correct-lineup-none">
                      {t('correctLineupNoCandidates')}
                    </p>
                  ) : (
                    <div className="quick-grid">
                      {candidates.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="chip quick-chip"
                          data-testid={`correct-lineup-option-${p.id}`}
                          onClick={() => {
                            setLineupDraft(
                              lineupDraft.map((id, i) => (i === pickSlot ? p.id : id)),
                            );
                            setPickSlot(null);
                            setErrorKey(null);
                          }}
                        >
                          <span className="chip__nr">{p.nr}</span>
                          <span className="chip__name">{p.naam}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
              {showClass ? (
                <p
                  className={liveOver ? 'quarter-start__class--over' : 'quarter-start__class--ok'}
                  data-testid="correct-lineup-class"
                  role={liveOver ? 'alert' : undefined}
                >
                  {fill(t('quarterStartClass'), {
                    sum: liveSum.toFixed(1),
                    allowed: liveAllowed.toFixed(1),
                  })}
                  {liveOver ? ` · ${t('quarterStartOver')}` : ''}
                </p>
              ) : null}
            </section>
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
  const classText = (s: Segment): string =>
    `${fill(t('quarterStartClass'), { sum: s.classSum.toFixed(1), allowed: s.allowed.toFixed(1) })}${
      s.over ? ` · ${t('quarterStartOver')}` : ''
    }`;
  const rows: { label: string; from: string; to: string; testId: string; note?: string }[] = [
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
    ...(a.lineup !== undefined && b.lineup !== undefined
      ? [
          {
            label: t('correctRowLineup'),
            from: b.lineup.map((id) => playerLabel(before.players, id)).join(', '),
            to: a.lineup.map((id) => playerLabel(before.players, id)).join(', '),
            testId: 'lineup',
            note: fill(t('quickPlanInOut'), {
              ins: a.lineup
                .filter((id) => !b.lineup?.includes(id))
                .map((id) => playerLabel(before.players, id))
                .join(', '),
              outs: b.lineup
                .filter((id) => !a.lineup?.includes(id))
                .map((id) => playerLabel(before.players, id))
                .join(', '),
            }),
          },
        ]
      : []),
    ...(a.lineup !== undefined && before.useClassLimit && oldSegment && newSegment
      ? [
          {
            label: t('correctRowClass'),
            from: classText(oldSegment),
            to: classText(newSegment),
            testId: 'class',
          },
        ]
      : []),
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
            {r.note !== undefined ? (
              <span
                className="correction-summary__note"
                data-testid={`correct-summary-${r.testId}-note`}
              >
                {r.note}
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
