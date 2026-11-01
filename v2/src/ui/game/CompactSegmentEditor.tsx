import { useEffect, useState } from 'preact/hooks';
import { MAX_SCORE, type ActiveGame, type GamePlayer } from '../../domain/game/types';
import {
  clockDuration,
  editSegment,
  segmentScoreBounds,
  type LiveCommandError,
} from '../../domain/game/liveCommands';
import {
  deriveGameHistory,
  isOverLimit,
  segmentDeletedAction,
  segmentTurnovers,
  type ClassificationConfig,
} from '../../domain/game/tracking';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import { useFocusTrap } from '../../application/a11y/useFocusTrap';
import { fmtSec, liveErrorKey } from './liveFormat';
import {
  ClockFields,
  NumberDropdownField,
  clockDraftFromSeconds,
  parseClockDraft,
  parseScoreDraft,
  type ClockDraft,
} from './CompactNumberFields';

/**
 * Segmenteditor van het compacte scherm (bouwplan C3, modal). Werkt op het
 * segment-ID (nooit een arrayindex), valideert via `editSegment` en legt een
 * `segment-edited`-actie vast; verwijderen (na bevestiging) legt de bestaande
 * `segment-deleted`-actie vast. Score en turnovers van het open segment, de
 * tijdgrenzen van andere segmenten en de actuele lineup blijven ongemoeid:
 * herberekening gebeurt door de bestaande reducer.
 */
export interface CompactSegmentEditorProps {
  lang: Lang;
  game: ActiveGame;
  segmentId: string;
  quarterCount: number;
  periodLabel: string;
  classification: ClassificationConfig;
  teamName: string;
  tag1Label: string;
  tag2Label: string;
  canWrite: boolean;
  onCommit: (next: ActiveGame) => void;
  onClose: () => void;
}

const MAX_TURNOVERS = 99;

function tagOf(player: GamePlayer, tag1Label: string, tag2Label: string): string {
  const tag1 = tag1Label.charAt(0).toUpperCase();
  const tag2 = tag2Label.charAt(0).toUpperCase();
  return player.vrouw ? (player.jeugd ? `${tag1}${tag2}` : tag1) : player.jeugd ? tag2 : '';
}

export function CompactSegmentEditor({
  lang,
  game,
  segmentId,
  quarterCount,
  periodLabel,
  classification,
  teamName,
  tag1Label,
  tag2Label,
  canWrite,
  onCommit,
  onClose,
}: CompactSegmentEditorProps) {
  const t = (key: StringKey) => translate(lang, key);
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const history = deriveGameHistory(game);
  const index = history.segments.findIndex((s) => s.id === segmentId);
  const segment = history.segments[index];

  const [quarter, setQuarter] = useState(() => segment?.quarter ?? 1);
  const [begin, setBegin] = useState<ClockDraft>(() =>
    clockDraftFromSeconds(segment?.beginSec ?? 0),
  );
  const [end, setEnd] = useState<ClockDraft>(() => clockDraftFromSeconds(segment?.endSec ?? 0));
  const [lineup, setLineup] = useState<string[]>(() => [...(segment?.lineup ?? [])]);
  const [pf, setPf] = useState(() => String(segment?.pf ?? 0));
  const [pa, setPa] = useState(() => String(segment?.pa ?? 0));
  const [tov, setTov] = useState(() => String(segment ? segmentTurnovers(segment) : 0));
  const [error, setError] = useState<LiveCommandError | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [touched, setTouched] = useState(false);

  // Escape/achtergrond: gewijzigde invoer niet stil weggooien.
  function requestClose() {
    if (touched && !window.confirm(t('compactDiscardDraftConfirm'))) return;
    onClose();
  }
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  const ownName = teamName || t('teamFallbackLabel');
  const opponentName = t('teamOpponent');
  const period = periodLabel || t('quarterLabel');
  const bounds = segmentScoreBounds(history.segments)[index];
  const start = bounds ? `${bounds.beginFor}-${bounds.beginAgainst}` : '0-0';
  const quarterMax = Math.max(quarterCount, segment?.quarter ?? 1);

  const beginSec = parseClockDraft(begin);
  const endSec = parseClockDraft(end);
  const dur =
    beginSec != null && endSec != null ? clockDuration(game.clockDown, beginSec, endSec) : null;
  const limit = isOverLimit(game, lineup, classification);

  function touch<T>(setter: (v: T) => void) {
    return (v: T) => {
      setTouched(true);
      setError(null);
      setConfirmingDelete(false);
      setter(v);
    };
  }

  function handleSave() {
    if (!canWrite || segment == null) return;
    const pfN = parseScoreDraft(pf, MAX_SCORE);
    const paN = parseScoreDraft(pa, MAX_SCORE);
    const tovN = parseScoreDraft(tov, MAX_TURNOVERS);
    if (beginSec == null || endSec == null) {
      setError('invalid-clock');
      return;
    }
    if (pfN == null || paN == null || tovN == null) {
      setError('invalid-score');
      return;
    }
    const result = editSegment(
      game,
      segmentId,
      { quarter, beginSec, endSec, lineup, pf: pfN, pa: paN, tov: tovN },
      classification,
      quarterCount,
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCommit(result.game);
    onClose();
  }

  function handleDelete() {
    if (!canWrite || segment == null) return;
    onCommit({ ...game, actions: [...game.actions, segmentDeletedAction(segmentId)] });
    onClose();
  }

  function toggleLineup(id: string) {
    setTouched(true);
    setError(null);
    setConfirmingDelete(false);
    setLineup((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  }

  const errorKey = error != null ? liveErrorKey(error) : null;
  const pickLabel = (what: string) => t('compactPickValue').replace('{label}', what);

  function pointsField(team: 'for' | 'against') {
    const name = team === 'for' ? ownName : opponentName;
    const label = t('compactEditPointsOf').replace('{team}', name);
    return (
      <div className="compact-dialog__field">
        <span className="compact-dialog__field-label">{label}</span>
        <NumberDropdownField
          value={team === 'for' ? pf : pa}
          min={0}
          max={MAX_SCORE}
          pad={false}
          maxLength={3}
          testId={`compact-edit-p${team === 'for' ? 'f' : 'a'}`}
          label={label}
          pickLabel={pickLabel(label)}
          disabled={!canWrite}
          onChange={touch(team === 'for' ? setPf : setPa)}
        />
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <button
        type="button"
        className="modal-overlay__backdrop"
        aria-label={t('cancelBtn')}
        onClick={requestClose}
      />
      <div
        className="modal compact-dialog"
        role="dialog"
        aria-label={t('editSegmentTitle')}
        data-testid="compact-edit-dialog"
        ref={trapRef}
      >
        <h2 className="compact-dialog__title">{t('editSegmentTitle')}</h2>

        {segment == null ? (
          <>
            <p className="settings-error" role="alert" data-testid="compact-edit-error">
              {t('correctErrorUnknownSegment')}
            </p>
            <div className="modal__actions">
              <button
                type="button"
                className="btn-outline"
                data-testid="compact-edit-cancel"
                onClick={onClose}
              >
                {t('backBtn')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="compact-dialog__hint" data-testid="compact-edit-start">
              {t('compactEditStartScore').replace('{score}', start.replace('-', '–'))}
            </p>

            <label className="compact-dialog__field">
              <span className="compact-dialog__field-label">{period}</span>
              <select
                className="compact-edit__quarter"
                value={quarter}
                disabled={!canWrite}
                data-testid="compact-edit-quarter"
                onChange={(e) => touch(setQuarter)(Number((e.target as HTMLSelectElement).value))}
              >
                {Array.from({ length: quarterMax }, (_, i) => i + 1).map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </label>

            <div className="compact-dialog__section">
              <span className="compact-dialog__field-label">{t('beginLabel')}</span>
              <ClockFields
                draft={begin}
                idPrefix="compact-edit-begin"
                label={t('beginLabel')}
                minutesLabel={t('minutesUnitLabel')}
                secondsLabel={t('secondsUnitLabel')}
                pickLabel={pickLabel}
                disabled={!canWrite}
                onChange={touch(setBegin)}
              />
            </div>
            <div className="compact-dialog__section">
              <span className="compact-dialog__field-label">{t('endLabel')}</span>
              <ClockFields
                draft={end}
                idPrefix="compact-edit-end"
                label={t('endLabel')}
                minutesLabel={t('minutesUnitLabel')}
                secondsLabel={t('secondsUnitLabel')}
                pickLabel={pickLabel}
                disabled={!canWrite}
                onChange={touch(setEnd)}
              />
              <p className="compact-dialog__hint" data-testid="compact-edit-duration">
                {dur != null && dur > 0
                  ? `${t('compactEditDuration')} ${fmtSec(dur)}`
                  : t('endAfterBegin')}
              </p>
            </div>

            <div className="compact-dialog__section">
              <div className="compact-edit__lineup-head">
                <h3 className="compact-dialog__subtitle">{t('lineupLabel')}</h3>
                <span
                  className={
                    lineup.length === 5 ? 'lineup-count' : 'lineup-count lineup-count--bad'
                  }
                  data-testid="compact-edit-lineup-count"
                >
                  {lineup.length}/5 {t('lineupChosenSuffix')}
                </span>
              </div>
              <div className="compact-pick__grid" role="group" aria-label={t('lineupLabel')}>
                {game.players.map((p) => {
                  const on = lineup.includes(p.id);
                  const tag = tagOf(p, tag1Label, tag2Label);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`compact-pick__player${on ? ' compact-pick__player--on' : ''}`}
                      aria-pressed={on}
                      disabled={!canWrite}
                      data-testid={`compact-edit-player-${p.id}`}
                      title={`#${p.nr} ${p.naam}`}
                      onClick={() => toggleLineup(p.id)}
                    >
                      <span className="compact-pick__nr">{p.nr}</span>
                      <span className="compact-pick__name">{p.naam}</span>
                      {classification.useClassLimit ? (
                        <span className="compact-pick__class">
                          {p.kl}
                          {tag ? ` ${tag}` : ''}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {classification.useClassLimit && limit.over ? (
                <p
                  className="tracking-warning"
                  role="alert"
                  data-testid="compact-edit-class-warning"
                >
                  {t('compactEditOverLimit')} ({limit.sum.toFixed(1)} &gt;{' '}
                  {limit.allowed.toFixed(1)})
                </p>
              ) : null}
            </div>

            <div className="compact-dialog__scores">
              {pointsField('for')}
              {pointsField('against')}
            </div>
            <div className="compact-dialog__field">
              <span className="compact-dialog__field-label">{t('compactEditTurnoversLabel')}</span>
              <NumberDropdownField
                value={tov}
                min={0}
                max={MAX_TURNOVERS}
                pad={false}
                maxLength={2}
                testId="compact-edit-tov"
                label={t('compactEditTurnoversLabel')}
                pickLabel={pickLabel(t('compactEditTurnoversLabel'))}
                disabled={!canWrite}
                onChange={touch(setTov)}
              />
            </div>

            {errorKey != null ? (
              <p className="settings-error" role="alert" data-testid="compact-edit-error">
                {t(errorKey).replace('{start}', start)}
              </p>
            ) : null}

            {confirmingDelete ? (
              <div className="compact-dialog__section" data-testid="compact-edit-delete-confirm">
                <p className="tracking-warning" role="alert">
                  {t('confirmDeleteSegment')}
                </p>
                <div className="modal__actions">
                  <button
                    type="button"
                    className="btn-outline"
                    data-testid="compact-edit-delete-cancel"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    {t('cancelBtn')}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!canWrite}
                    data-testid="compact-edit-delete-confirm-btn"
                    onClick={handleDelete}
                  >
                    {t('compactDeleteConfirmBtn')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="modal__actions compact-edit__actions">
                <button
                  type="button"
                  className="btn-outline"
                  disabled={!canWrite}
                  data-testid="compact-edit-delete"
                  onClick={() => canWrite && setConfirmingDelete(true)}
                >
                  {t('compactDeleteSegmentBtn')}
                </button>
                <button
                  type="button"
                  className="btn-outline"
                  data-testid="compact-edit-cancel"
                  onClick={onClose}
                >
                  {t('cancelBtn')}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!canWrite}
                  data-testid="compact-edit-save"
                  onClick={handleSave}
                >
                  {t('saveBtn')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
