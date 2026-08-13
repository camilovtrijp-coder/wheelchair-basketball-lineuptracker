import { useState } from 'preact/hooks';
import type { ActiveGame, GamePlayer, Segment } from '../../domain/game/types';
import {
  buildSegment,
  canSaveSegment,
  deriveGameHistory,
  isOverLimit,
  segDur,
  segmentDeletedAction,
  segmentEditedAction,
  segmentSavedAction,
  scoreDeltaAction,
  scoreSetAction,
  selectQuarter,
  swapOnCourt,
  type ClassificationConfig,
} from '../../domain/game/tracking';
import { translate, type Lang, type StringKey } from '../../i18n/strings';

export interface LiveTrackingPanelProps {
  lang: Lang;
  game: ActiveGame;
  quarterCount: number;
  periodLabel: string;
  classification: ClassificationConfig;
  teamName: string;
  tag1Label: string;
  tag2Label: string;
  onGameChange: (next: ActiveGame) => void;
  canWrite: boolean;
}

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

/** v1: `fmt()` — "-1:05"/"1:05" (min:ss, met minteken bij negatieve duur). */
function fmtSec(sec: number): string {
  const neg = sec < 0;
  const abs = Math.abs(sec);
  return `${neg ? '-' : ''}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

function minutesOf(totalSec: number): number {
  return Math.floor(totalSec / 60);
}

function secondsOf(totalSec: number): number {
  return totalSec % 60;
}

function withMinutes(totalSec: number, min: number): number {
  return min * 60 + secondsOf(totalSec);
}

function withSeconds(totalSec: number, sec: number): number {
  return minutesOf(totalSec) * 60 + sec;
}

interface Selected {
  id: string;
  where: 'court' | 'bench';
}

interface EditDraft {
  quarter: number;
  beginSec: number;
  endSec: number;
  lineup: string[];
  pf: string;
  pa: string;
}

function playerLabel(players: GamePlayer[], id: string): string {
  const p = players.find((pl) => pl.id === id);
  return p ? `${p.naam} #${p.nr}` : '?';
}

function TimeSelect({
  value,
  max,
  pad,
  testId,
  disabled,
  onChange,
}: {
  value: number;
  max: number;
  pad: boolean;
  testId: string;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const options = Array.from({ length: max + 1 }, (_, i) => i);
  return (
    <select
      className="time-select"
      value={value}
      disabled={disabled}
      data-testid={testId}
      onChange={(e) => onChange(Number((e.target as HTMLSelectElement).value))}
    >
      {options.map((n) => (
        <option key={n} value={n}>
          {pad ? String(n).padStart(2, '0') : n}
        </option>
      ))}
    </select>
  );
}

function PlayerChip({
  player,
  selected,
  useClassLimit,
  tag1Label,
  tag2Label,
  testId,
  onClick,
}: {
  player: GamePlayer;
  selected: boolean;
  useClassLimit: boolean;
  tag1Label: string;
  tag2Label: string;
  testId: string;
  onClick: () => void;
}) {
  const tag1 = tag1Label.charAt(0).toUpperCase();
  const tag2 = tag2Label.charAt(0).toUpperCase();
  const tag = player.vrouw ? (player.jeugd ? `${tag1}${tag2}` : tag1) : player.jeugd ? tag2 : '';
  return (
    <button
      type="button"
      className={`chip${selected ? ' chip--selected' : ''}`}
      data-testid={testId}
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

export function LiveTrackingPanel({
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
}: LiveTrackingPanelProps) {
  const [selected, setSelected] = useState<Selected | null>(null);
  // Snapshot van onCourt van vóór het huidige, nog niet bevestigde blokje
  // wissels (v1: `pendingSwapLineup`). Bewust niet gepersisteerd — zie
  // domain/game/types.ts bij `GameAction`.
  const [pendingSwapLineup, setPendingSwapLineup] = useState<string[] | null>(null);
  const [swapConfirmEndSec, setSwapConfirmEndSec] = useState<number | null>(null);
  const [endTouched, setEndTouched] = useState(false);
  const [editSegmentId, setEditSegmentId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const history = deriveGameHistory(game);
  const courtLimit = isOverLimit(game, game.onCourt, classification);
  const segDeltaFor = history.scoreFor - history.segStartFor;
  const segDeltaAgainst = history.scoreAgainst - history.segStartAgainst;
  const segPM = segDeltaFor - segDeltaAgainst;
  const dur = segDur(game);
  const durValid = dur > 0;
  const lineupValid = game.onCourt.length === 5;
  const bench = game.players.filter((p) => p.participate && !game.onCourt.includes(p.id));

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
    if (selected.where !== where) {
      const courtId = where === 'court' ? id : selected.id;
      const benchId = where === 'bench' ? id : selected.id;
      const snapshot = pendingSwapLineup ?? game.onCourt;
      setPendingSwapLineup(snapshot);
      onGameChange({ ...game, onCourt: swapOnCourt(game.onCourt, courtId, benchId) });
      setSelected(null);
    } else {
      setSelected({ id, where });
    }
  }

  function handleDiscardSwaps() {
    if (pendingSwapLineup == null) return;
    onGameChange({ ...game, onCourt: pendingSwapLineup });
    setPendingSwapLineup(null);
  }

  function buildAndAppendSegment(
    quarter: number,
    beginSec: number,
    endSec: number,
    lineup: string[],
  ) {
    const segment = buildSegment(
      game,
      quarter,
      beginSec,
      endSec,
      lineup,
      segDeltaFor,
      segDeltaAgainst,
      classification,
    );
    onGameChange({
      ...game,
      beginSec: endSec,
      endSec,
      actions: [...game.actions, segmentSavedAction(segment)],
    });
  }

  function handleConfirmSwapBatch() {
    if (pendingSwapLineup == null || swapConfirmEndSec == null) return;
    const swapDur = game.clockDown
      ? game.beginSec - swapConfirmEndSec
      : swapConfirmEndSec - game.beginSec;
    if (swapDur < 0) return;
    if (swapDur > 0) {
      buildAndAppendSegment(game.curQuarter, game.beginSec, swapConfirmEndSec, pendingSwapLineup);
    }
    setPendingSwapLineup(null);
    setSwapConfirmEndSec(null);
  }

  function handleSaveSegment() {
    if (!canWrite) return;
    const lineup = pendingSwapLineup ?? game.onCourt;
    if (!canSaveSegment(dur, lineup)) return;
    buildAndAppendSegment(game.curQuarter, game.beginSec, game.endSec, lineup);
    setPendingSwapLineup(null);
    setEndTouched(false);
  }

  function handleSelectQuarter(q: number) {
    if (!canWrite) return;
    onGameChange({ ...game, ...selectQuarter(game, q) });
    if (q !== game.curQuarter) setEndTouched(false);
  }

  function openEditSegment(segment: Segment) {
    setEditSegmentId(segment.id);
    setEditDraft({
      quarter: segment.quarter,
      beginSec: segment.beginSec,
      endSec: segment.endSec,
      lineup: [...segment.lineup],
      pf: String(segment.pf),
      pa: String(segment.pa),
    });
  }

  function closeEditSegment() {
    setEditSegmentId(null);
    setEditDraft(null);
  }

  function handleSaveEditSegment() {
    if (!canWrite || editDraft == null || editSegmentId == null) return;
    const editDur = game.clockDown
      ? editDraft.beginSec - editDraft.endSec
      : editDraft.endSec - editDraft.beginSec;
    if (!(editDur > 0) || editDraft.lineup.length !== 5) return;
    const { sum, allowed, over } = isOverLimit(game, editDraft.lineup, classification);
    const updated: Segment = {
      id: editSegmentId,
      quarter: editDraft.quarter,
      beginSec: editDraft.beginSec,
      endSec: editDraft.endSec,
      durSec: editDur,
      lineup: [...editDraft.lineup],
      pf: Number(editDraft.pf) || 0,
      pa: Number(editDraft.pa) || 0,
      classSum: sum,
      allowed,
      over,
    };
    onGameChange({
      ...game,
      actions: [...game.actions, segmentEditedAction(editSegmentId, updated)],
    });
    closeEditSegment();
  }

  function handleDeleteEditSegment() {
    if (!canWrite || editSegmentId == null) return;
    if (!window.confirm(t(lang, 'confirmDeleteSegment'))) return;
    onGameChange({ ...game, actions: [...game.actions, segmentDeletedAction(editSegmentId)] });
    closeEditSegment();
  }

  const pmColor = (n: number) =>
    n > 0 ? 'live-pm--pos' : n < 0 ? 'live-pm--neg' : 'live-pm--flat';

  function scoreRow(team: 'for' | 'against') {
    const score = team === 'for' ? history.scoreFor : history.scoreAgainst;
    const delta = team === 'for' ? segDeltaFor : segDeltaAgainst;
    const name =
      team === 'for' ? teamName || t(lang, 'teamFallbackLabel') : t(lang, 'teamOpponent');
    return (
      <div className="score-row" data-testid={`score-row-${team}`}>
        <div className="score-row__header">
          <span className="score-row__name">{name}</span>
          <span className="score-row__delta">
            {t(lang, 'segmentDeltaLabel')} {delta >= 0 ? '+' : ''}
            {delta}
          </span>
        </div>
        <div className="score-row__controls">
          <select
            className="score-select"
            value={score}
            disabled={!canWrite}
            data-testid={`score-select-${team}`}
            onChange={(e) =>
              onGameChange({
                ...game,
                actions: [
                  ...game.actions,
                  scoreSetAction(team, Number((e.target as HTMLSelectElement).value)),
                ],
              })
            }
          >
            {Array.from({ length: 151 }, (_, n) => n).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <div className="score-row__buttons">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                className="score-btn"
                disabled={!canWrite}
                data-testid={`score-plus${n}-${team}`}
                onClick={() =>
                  onGameChange({ ...game, actions: [...game.actions, scoreDeltaAction(team, n)] })
                }
              >
                +{n}
              </button>
            ))}
            <button
              type="button"
              className="btn-outline score-btn score-btn--wide"
              disabled={!canWrite}
              data-testid={`score-minus1-${team}`}
              onClick={() =>
                onGameChange({ ...game, actions: [...game.actions, scoreDeltaAction(team, -1)] })
              }
            >
              {t(lang, 'correctMinus1Btn')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="tracking-panel" aria-label={t(lang, 'gameTitle')}>
      <header className="tracking-panel__header">
        <h2>{t(lang, 'gameTitle')}</h2>
        <p className="tracking-panel__standing" data-testid="lineup-standing">
          {t(lang, 'lineupStandingPrefix')}{' '}
          <span className={pmColor(segPM)}>
            {segPM >= 0 ? '+' : ''}
            {segPM}
          </span>
        </p>
      </header>

      <div className="score-card">
        {scoreRow('for')}
        {scoreRow('against')}
      </div>

      <div className="oncourt-section">
        <div className="oncourt-section__header">
          <span className="oncourt-section__title">{t(lang, 'onCourtLabel')}</span>
          {classification.useClassLimit ? (
            <span
              className={courtLimit.over ? 'class-badge class-badge--over' : 'class-badge'}
              data-testid="class-badge"
            >
              {courtLimit.sum.toFixed(1)} / {courtLimit.allowed.toFixed(1)}
            </span>
          ) : null}
        </div>
        {classification.useClassLimit ? (
          <div className="class-bar">
            <div
              className={
                courtLimit.over ? 'class-bar__fill class-bar__fill--over' : 'class-bar__fill'
              }
              style={{
                width: `${Math.min(100, Math.max(0, Math.round((courtLimit.sum / Math.max(0.1, courtLimit.allowed)) * 100)))}%`,
              }}
            />
          </div>
        ) : null}
        <div className="chip-grid">
          {game.onCourt.map((id) => {
            const p = game.players.find((pl) => pl.id === id);
            if (!p) return null;
            return (
              <PlayerChip
                key={id}
                player={p}
                selected={selected?.id === id}
                useClassLimit={classification.useClassLimit}
                tag1Label={tag1Label}
                tag2Label={tag2Label}
                testId={`court-chip-${id}`}
                onClick={() => handleTapPlayer(id)}
              />
            );
          })}
        </div>
      </div>

      {classification.useClassLimit && courtLimit.over ? (
        <p className="tracking-warning" role="alert" data-testid="class-warning">
          {t(lang, 'tooManyClassPointsPrefix')} ({courtLimit.sum.toFixed(1)} &gt;{' '}
          {courtLimit.allowed.toFixed(1)})
        </p>
      ) : null}

      <div className={selected != null ? 'swap-banner swap-banner--active' : 'swap-banner'}>
        {selected != null ? (
          <span data-testid="swap-selected">
            <strong>{playerLabel(game.players, selected.id)}</strong>
            {t(lang, 'swapChosenSuffix')}
          </span>
        ) : (
          <span className="swap-banner__hint">{t(lang, 'swapHint')}</span>
        )}
      </div>

      {pendingSwapLineup != null ? (
        <div className="swap-pending-actions">
          <button
            type="button"
            className="btn-primary"
            data-testid="swap-done-btn"
            onClick={() => setSwapConfirmEndSec(game.endSec)}
          >
            {t(lang, 'swapDoneBtn')}
          </button>
          <button
            type="button"
            className="btn-outline"
            data-testid="swap-cancel-btn"
            onClick={handleDiscardSwaps}
          >
            {t(lang, 'cancelBtn')}
          </button>
        </div>
      ) : null}

      <div className="bench-section">
        <span className="bench-section__title">{t(lang, 'benchLabel')}</span>
        <div className="chip-grid">
          {bench.map((p) => (
            <PlayerChip
              key={p.id}
              player={p}
              selected={selected?.id === p.id}
              useClassLimit={classification.useClassLimit}
              tag1Label={tag1Label}
              tag2Label={tag2Label}
              testId={`bench-chip-${p.id}`}
              onClick={() => handleTapPlayer(p.id)}
            />
          ))}
        </div>
      </div>

      <div className="segment-card">
        <h3>{t(lang, 'segmentCardTitle')}</h3>
        <div className="quarter-row">
          <span className="quarter-row__label">{periodLabel || t(lang, 'quarterLabel')}</span>
          {Array.from({ length: quarterCount }, (_, i) => i + 1).map((q) => (
            <button
              key={q}
              type="button"
              className={q === game.curQuarter ? 'quarter-btn quarter-btn--active' : 'quarter-btn'}
              disabled={!canWrite}
              data-testid={`quarter-btn-${q}`}
              onClick={() => handleSelectQuarter(q)}
            >
              {q}
            </button>
          ))}
        </div>
        <div className="time-row">
          <span className="time-row__label">{t(lang, 'beginLabel')}</span>
          <TimeSelect
            value={minutesOf(game.beginSec)}
            max={10}
            pad={false}
            disabled={!canWrite}
            testId="begin-min"
            onChange={(v) => onGameChange({ ...game, beginSec: withMinutes(game.beginSec, v) })}
          />
          <span>:</span>
          <TimeSelect
            value={secondsOf(game.beginSec)}
            max={59}
            pad
            disabled={!canWrite}
            testId="begin-sec"
            onChange={(v) => onGameChange({ ...game, beginSec: withSeconds(game.beginSec, v) })}
          />
        </div>
        <div className="time-row">
          <span className="time-row__label">{t(lang, 'endLabel')}</span>
          <TimeSelect
            value={minutesOf(game.endSec)}
            max={10}
            pad={false}
            disabled={!canWrite}
            testId="end-min"
            onChange={(v) => {
              onGameChange({ ...game, endSec: withMinutes(game.endSec, v) });
              setEndTouched(true);
            }}
          />
          <span>:</span>
          <TimeSelect
            value={secondsOf(game.endSec)}
            max={59}
            pad
            disabled={!canWrite}
            testId="end-sec"
            onChange={(v) => {
              onGameChange({ ...game, endSec: withSeconds(game.endSec, v) });
              setEndTouched(true);
            }}
          />
        </div>
        <p className="segment-card__duration" data-testid="segment-duration">
          {durValid
            ? `${t(lang, 'segDurationValidPrefix')} ${fmtSec(dur)}`
            : endTouched
              ? t(lang, 'endAfterBegin')
              : ' '}
        </p>
        <button
          type="button"
          className="btn-primary segment-card__save"
          disabled={!canWrite || !durValid || !lineupValid}
          data-testid="save-segment-btn"
          onClick={handleSaveSegment}
        >
          {t(lang, 'saveSegmentBtnPrefix')} ({segPM >= 0 ? '+' : ''}
          {segPM})
        </button>
        {lineupValid ? null : (
          <p className="tracking-warning" data-testid="need-five-on-court">
            {t(lang, 'needFiveOnCourt')}
          </p>
        )}
      </div>

      {history.segments.length > 0 ? (
        <div className="segment-list">
          <div className="segment-list__header">
            <span className="segment-list__title">
              {t(lang, 'segmentsTitlePrefix')} ({history.segments.length})
            </span>
            <span className="segment-list__hint">{t(lang, 'tapToEdit')}</span>
          </div>
          {history.segments.map((s) => {
            const pm = s.pf - s.pa;
            const nrs = s.lineup
              .map((id) => game.players.find((p) => p.id === id)?.nr ?? '?')
              .join('-');
            return (
              <button
                type="button"
                key={s.id}
                className="segment-item"
                data-testid={`segment-item-${s.id}`}
                onClick={() => openEditSegment(s)}
              >
                <span className="segment-item__lineup">
                  {s.over ? '⚠ ' : ''}
                  <span className="segment-item__quarter">Q{s.quarter}</span> {nrs}
                </span>
                <span className="segment-item__stats">
                  <span>{fmtSec(s.durSec)}</span>
                  <span className={pmColor(pm)}>
                    {pm >= 0 ? '+' : ''}
                    {pm}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {swapConfirmEndSec != null ? (
        <div className="modal-overlay">
          <button
            type="button"
            className="modal-overlay__backdrop"
            aria-label={t(lang, 'backBtn')}
            onClick={() => setSwapConfirmEndSec(null)}
          />
          <div
            className="modal"
            role="dialog"
            aria-label={t(lang, 'swapConfirmTitle')}
            data-testid="swap-confirm-modal"
          >
            <h2>{t(lang, 'swapConfirmTitle')}</h2>
            <p className="modal__desc">{t(lang, 'swapConfirmDesc')}</p>
            <div className="time-row">
              <span className="time-row__label">{t(lang, 'timeLabel')}</span>
              <TimeSelect
                value={minutesOf(swapConfirmEndSec)}
                max={10}
                pad={false}
                disabled={!canWrite}
                testId="swap-confirm-min"
                onChange={(v) => setSwapConfirmEndSec(withMinutes(swapConfirmEndSec, v))}
              />
              <span>:</span>
              <TimeSelect
                value={secondsOf(swapConfirmEndSec)}
                max={59}
                pad
                disabled={!canWrite}
                testId="swap-confirm-sec"
                onChange={(v) => setSwapConfirmEndSec(withSeconds(swapConfirmEndSec, v))}
              />
            </div>
            {(() => {
              const swapDur = game.clockDown
                ? game.beginSec - swapConfirmEndSec
                : swapConfirmEndSec - game.beginSec;
              return (
                <p className="segment-card__duration" data-testid="swap-confirm-duration">
                  {swapDur >= 0
                    ? `${t(lang, 'segSoFarPrefix')} ${fmtSec(swapDur)}`
                    : t(lang, 'timeAfterSegStart')}
                </p>
              );
            })()}
            <div className="modal__actions">
              <button
                type="button"
                className="btn-outline"
                data-testid="swap-confirm-back"
                onClick={() => setSwapConfirmEndSec(null)}
              >
                {t(lang, 'backBtn')}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  !canWrite ||
                  (game.clockDown
                    ? game.beginSec - swapConfirmEndSec
                    : swapConfirmEndSec - game.beginSec) < 0
                }
                data-testid="swap-confirm-confirm"
                onClick={handleConfirmSwapBatch}
              >
                {t(lang, 'confirmBtn')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editDraft != null && editSegmentId != null ? (
        <div className="modal-overlay">
          <button
            type="button"
            className="modal-overlay__backdrop"
            aria-label={t(lang, 'backBtn')}
            onClick={closeEditSegment}
          />
          <div
            className="modal"
            role="dialog"
            aria-label={t(lang, 'editSegmentTitle')}
            data-testid="edit-segment-modal"
          >
            <div className="modal__title-row">
              <h2>{t(lang, 'editSegmentTitle')}</h2>
              <button
                type="button"
                className="modal__close"
                data-testid="edit-segment-close"
                onClick={closeEditSegment}
              >
                ✕
              </button>
            </div>
            <div className="quarter-row">
              <span className="quarter-row__label">{periodLabel || t(lang, 'quarterLabel')}</span>
              {Array.from({ length: quarterCount }, (_, i) => i + 1).map((q) => (
                <button
                  key={q}
                  type="button"
                  className={
                    q === editDraft.quarter ? 'quarter-btn quarter-btn--active' : 'quarter-btn'
                  }
                  data-testid={`edit-quarter-${q}`}
                  onClick={() => setEditDraft({ ...editDraft, quarter: q })}
                >
                  {q}
                </button>
              ))}
            </div>
            <div className="time-row">
              <span className="time-row__label">{t(lang, 'beginLabel')}</span>
              <TimeSelect
                value={minutesOf(editDraft.beginSec)}
                max={10}
                pad={false}
                disabled={false}
                testId="edit-begin-min"
                onChange={(v) =>
                  setEditDraft({ ...editDraft, beginSec: withMinutes(editDraft.beginSec, v) })
                }
              />
              <span>:</span>
              <TimeSelect
                value={secondsOf(editDraft.beginSec)}
                max={59}
                pad
                disabled={false}
                testId="edit-begin-sec"
                onChange={(v) =>
                  setEditDraft({ ...editDraft, beginSec: withSeconds(editDraft.beginSec, v) })
                }
              />
            </div>
            <div className="time-row">
              <span className="time-row__label">{t(lang, 'endLabel')}</span>
              <TimeSelect
                value={minutesOf(editDraft.endSec)}
                max={10}
                pad={false}
                disabled={false}
                testId="edit-end-min"
                onChange={(v) =>
                  setEditDraft({ ...editDraft, endSec: withMinutes(editDraft.endSec, v) })
                }
              />
              <span>:</span>
              <TimeSelect
                value={secondsOf(editDraft.endSec)}
                max={59}
                pad
                disabled={false}
                testId="edit-end-sec"
                onChange={(v) =>
                  setEditDraft({ ...editDraft, endSec: withSeconds(editDraft.endSec, v) })
                }
              />
            </div>
            {(() => {
              const editDur = game.clockDown
                ? editDraft.beginSec - editDraft.endSec
                : editDraft.endSec - editDraft.beginSec;
              return (
                <p className="segment-card__duration" data-testid="edit-segment-duration">
                  {editDur > 0
                    ? `${t(lang, 'segDurationPlainPrefix')} ${fmtSec(editDur)}`
                    : t(lang, 'endAfterBegin')}
                </p>
              );
            })()}
            <div className="edit-lineup-header">
              <span>{t(lang, 'lineupLabel')}</span>
              <span
                className={
                  editDraft.lineup.length === 5 ? 'lineup-count' : 'lineup-count lineup-count--bad'
                }
                data-testid="edit-lineup-count"
              >
                {editDraft.lineup.length}/5 {t(lang, 'lineupChosenSuffix')}
              </span>
            </div>
            <div className="chip-grid">
              {game.players.map((p) => (
                <PlayerChip
                  key={p.id}
                  player={p}
                  selected={editDraft.lineup.includes(p.id)}
                  useClassLimit={classification.useClassLimit}
                  tag1Label={tag1Label}
                  tag2Label={tag2Label}
                  testId={`edit-lineup-${p.id}`}
                  onClick={() => {
                    const inLineup = editDraft.lineup.includes(p.id);
                    setEditDraft({
                      ...editDraft,
                      lineup: inLineup
                        ? editDraft.lineup.filter((id) => id !== p.id)
                        : [...editDraft.lineup, p.id],
                    });
                  }}
                />
              ))}
            </div>
            <div className="edit-points-row">
              <label className="settings-field">
                <span className="settings-field__label">{t(lang, 'pointsForLabel')}</span>
                <input
                  type="number"
                  value={editDraft.pf}
                  data-testid="edit-pf"
                  onInput={(e) =>
                    setEditDraft({ ...editDraft, pf: (e.target as HTMLInputElement).value })
                  }
                />
              </label>
              <label className="settings-field">
                <span className="settings-field__label">{t(lang, 'pointsAgainstLabel')}</span>
                <input
                  type="number"
                  value={editDraft.pa}
                  data-testid="edit-pa"
                  onInput={(e) =>
                    setEditDraft({ ...editDraft, pa: (e.target as HTMLInputElement).value })
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={
                !canWrite ||
                editDraft.lineup.length !== 5 ||
                !(
                  (game.clockDown
                    ? editDraft.beginSec - editDraft.endSec
                    : editDraft.endSec - editDraft.beginSec) > 0
                )
              }
              data-testid="edit-segment-save"
              onClick={handleSaveEditSegment}
            >
              {t(lang, 'saveBtn')}
            </button>
            <button
              type="button"
              className="btn-outline"
              disabled={!canWrite}
              data-testid="edit-segment-delete"
              onClick={handleDeleteEditSegment}
            >
              {t(lang, 'deleteBtn')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
