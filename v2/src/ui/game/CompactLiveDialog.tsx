import { useEffect, useRef, useState } from 'preact/hooks';
import { MAX_SCORE, type ActiveGame, type GamePlayer } from '../../domain/game/types';
import {
  clockDuration,
  closeQuarter,
  commitSegment,
  confirmSwap,
  type LiveCommandError,
  type LiveCommandResult,
} from '../../domain/game/liveCommands';
import {
  deriveGameHistory,
  swapOnCourt,
  type ClassificationConfig,
} from '../../domain/game/tracking';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import { useFocusTrap } from '../../application/a11y/useFocusTrap';
import { fmtSec, liveErrorKey } from './LiveTrackingPanel';
import {
  ClockFields,
  NumberDropdownField,
  clockDraftFromSeconds,
  parseClockDraft,
  parseScoreDraft,
  type ClockDraft,
} from './CompactNumberFields';

/**
 * Concept-dialoog van het compacte wedstrijdscherm (bouwplan C2b). Alles hier
 * is UI-state (besluit 6): de `ActiveGame` verandert pas bij Bevestigen, via
 * één `onCommit(next)` met het resultaat van `confirmSwap`/`commitSegment`/
 * `closeQuarter` op de LAATSTE game-state. Geweigerde commando's tonen een
 * zichtbare melding en veranderen niets.
 */
export type CompactDialogMode = 'swap' | 'segment' | 'quarter' | 'confirm-pending';

type Step = 'select' | 'time' | 'review';
type Team = 'for' | 'against';

export interface CompactLiveDialogProps {
  lang: Lang;
  game: ActiveGame;
  mode: CompactDialogMode;
  quarterCount: number;
  periodLabel: string;
  classification: ClassificationConfig;
  teamName: string;
  tag1Label: string;
  tag2Label: string;
  canWrite: boolean;
  /** Uitwedstrijd (lokale presentatievoorkeur): tegenstander links. Alleen volgorde. */
  away?: boolean;
  onCommit: (next: ActiveGame) => void;
  onClose: () => void;
}

function tagOf(player: GamePlayer, tag1Label: string, tag2Label: string): string {
  const tag1 = tag1Label.charAt(0).toUpperCase();
  const tag2 = tag2Label.charAt(0).toUpperCase();
  return player.vrouw ? (player.jeugd ? `${tag1}${tag2}` : tag1) : player.jeugd ? tag2 : '';
}

function toggled(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function CompactLiveDialog({
  lang,
  game,
  mode,
  quarterCount,
  periodLabel,
  classification,
  teamName,
  tag1Label,
  tag2Label,
  canWrite,
  away = false,
  onCommit,
  onClose,
}: CompactLiveDialogProps) {
  const t = (key: StringKey) => translate(lang, key);
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const history = deriveGameHistory(game);
  const [step, setStep] = useState<Step>(mode === 'swap' ? 'select' : 'time');
  const [outIds, setOutIds] = useState<string[]>([]);
  const [inIds, setInIds] = useState<string[]>([]);
  const [clock, setClock] = useState<ClockDraft>(() => clockDraftFromSeconds(game.endSec));
  const [scoreFor, setScoreFor] = useState(() => String(history.scoreFor));
  const [scoreAgainst, setScoreAgainst] = useState(() => String(history.scoreAgainst));
  const [error, setError] = useState<LiveCommandError | null>(null);

  const [touched, setTouched] = useState(false);
  const submittedRef = useRef(false);
  const [submitted, setSubmitted] = useState(false);
  // Escape/achtergrond: een concept met invoer niet stil weggooien.
  const hasDraft = touched || (mode === 'swap' ? step !== 'select' : step === 'review');
  function requestClose() {
    if (submittedRef.current) return;
    if (hasDraft && !window.confirm(t('compactDiscardDraftConfirm'))) return;
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
  const bench = game.players.filter((p) => p.participate && !game.onCourt.includes(p.id));
  const playerById = (id: string) => game.players.find((p) => p.id === id);
  const lastPeriod = game.curQuarter >= quarterCount;
  const nextQuarter = lastPeriod ? game.curQuarter : game.curQuarter + 1;

  const title =
    mode === 'swap'
      ? t('compactDialogSwapTitle')
      : mode === 'segment'
        ? t('compactDialogSegmentTitle')
        : mode === 'quarter'
          ? t('compactDialogQuarterTitle')
          : t('compactDialogPendingTitle');

  // Nieuwe opstelling uit de LAATSTE game: i-de eruit-speler wordt vervangen
  // door de i-de erin-speler (swapOnCourt-semantiek: positie behouden).
  function proposedLineup(): string[] | null {
    if (mode !== 'swap') return null;
    if (outIds.length === 0 || outIds.length !== inIds.length) return null;
    if (!outIds.every((id) => game.onCourt.includes(id))) return null;
    if (!inIds.every((id) => bench.some((p) => p.id === id))) return null;
    return outIds.reduce(
      (lineup, out, i) => swapOnCourt(lineup, out, inIds[i] as string),
      [...game.onCourt],
    );
  }

  function parsed():
    | { ok: true; endSec: number; scoreFor: number; scoreAgainst: number }
    | { ok: false; error: LiveCommandError } {
    const endSec = parseClockDraft(clock);
    if (endSec == null) return { ok: false, error: 'invalid-clock' };
    const sf = parseScoreDraft(scoreFor, MAX_SCORE);
    const sa = parseScoreDraft(scoreAgainst, MAX_SCORE);
    if (sf == null || sa == null) return { ok: false, error: 'invalid-score' };
    return { ok: true, endSec, scoreFor: sf, scoreAgainst: sa };
  }

  function attempt(): LiveCommandResult {
    const input = parsed();
    if (!input.ok) return { ok: false, error: input.error };
    const common = {
      endSec: input.endSec,
      scoreFor: input.scoreFor,
      scoreAgainst: input.scoreAgainst,
      classification,
    };
    if (mode === 'swap') {
      const lineup = proposedLineup();
      if (lineup == null) return { ok: false, error: 'invalid-lineup' };
      return confirmSwap({ ...game, onCourt: lineup, pendingSwapLineup: game.onCourt }, common);
    }
    if (mode === 'confirm-pending') return confirmSwap(game, common);
    if (mode === 'segment') return commitSegment(game, common);
    return closeQuarter(game, { ...common, nextQuarter, quarterCount });
  }

  function touch<T>(setter: (v: T) => void) {
    return (v: T) => {
      setTouched(true);
      setError(null);
      setter(v);
    };
  }

  function goReview() {
    const result = attempt();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setStep('review');
  }

  function handleConfirm() {
    if (!canWrite || submittedRef.current) return;
    const result = attempt();
    if (!result.ok) {
      setError(result.error);
      setStep('time');
      return;
    }
    submittedRef.current = true;
    setSubmitted(true);
    onCommit(result.game);
    onClose();
  }

  function pickPlayer(side: 'out' | 'in', id: string) {
    setTouched(true);
    setError(null);
    if (side === 'out') setOutIds((list) => toggled(list, id));
    else setInIds((list) => toggled(list, id));
  }

  function clearSelection() {
    setTouched(true);
    setError(null);
    setOutIds([]);
    setInIds([]);
  }

  function playerGrid(side: 'out' | 'in', ids: string[], chosen: string[]) {
    return (
      <div
        className="compact-pick__grid"
        role="group"
        aria-label={t(side === 'out' ? 'compactSwapOutTitle' : 'compactSwapInTitle')}
      >
        {ids.map((id) => {
          const p = playerById(id);
          if (!p) return null;
          const order = chosen.indexOf(id);
          const tag = tagOf(p, tag1Label, tag2Label);
          return (
            <button
              key={id}
              type="button"
              className={`compact-pick__player${order >= 0 ? ' compact-pick__player--on' : ''}`}
              aria-pressed={order >= 0}
              disabled={!canWrite}
              data-testid={`compact-swap-${side}-${id}`}
              title={`#${p.nr} ${p.naam}`}
              onClick={() => pickPlayer(side, id)}
            >
              <span className="compact-pick__nr">{p.nr}</span>
              <span className="compact-pick__name">{p.naam}</span>
              {classification.useClassLimit ? (
                <span className="compact-pick__class">
                  {p.kl}
                  {tag ? ` ${tag}` : ''}
                </span>
              ) : null}
              {order >= 0 && chosen.length > 1 ? (
                <span className="compact-pick__order" aria-hidden="true">
                  {order + 1}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  // Uitwedstrijd: alleen de weergavevolgorde draait om; for/against blijven eigen team/tegenstander.
  const sides: Team[] = away ? ['against', 'for'] : ['for', 'against'];

  const pair = (own: number, opp: number) => (away ? `${opp}–${own}` : `${own}–${opp}`);

  function scoreField(team: Team) {
    const name = team === 'for' ? ownName : opponentName;
    const label = t('compactScoreOfTeam').replace('{team}', name);
    return (
      <div className="compact-dialog__field">
        <span className="compact-dialog__field-label">{name}</span>
        <NumberDropdownField
          value={team === 'for' ? scoreFor : scoreAgainst}
          min={0}
          max={MAX_SCORE}
          pad={false}
          maxLength={3}
          testId={`compact-dialog-score-${team}`}
          label={label}
          pickLabel={t('compactPickValue').replace('{label}', label)}
          disabled={!canWrite}
          onChange={touch(team === 'for' ? setScoreFor : setScoreAgainst)}
        />
      </div>
    );
  }

  const errorKey = error != null ? liveErrorKey(error) : null;
  const start = `${history.segStartFor}-${history.segStartAgainst}`;

  const input = parsed();
  const endSec = input.ok ? input.endSec : null;
  const dur = endSec != null ? clockDuration(game.clockDown, game.beginSec, endSec) : null;
  const lineup = proposedLineup();
  const reviewLineup = lineup ?? game.onCourt;
  const segTurnovers = history.turnovers - history.segStartTurnovers;

  const selectReady = outIds.length > 0 && outIds.length === inIds.length;

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
        aria-label={title}
        data-testid="compact-dialog"
        data-step={step}
        ref={trapRef}
      >
        <h2 className="compact-dialog__title">{title}</h2>

        {step === 'select' ? (
          <>
            <div className="compact-dialog__section">
              <h3 className="compact-dialog__subtitle">{t('compactSwapOutTitle')}</h3>
              {playerGrid('out', game.onCourt, outIds)}
            </div>
            <div className="compact-dialog__section">
              <h3 className="compact-dialog__subtitle">{t('compactSwapInTitle')}</h3>
              {playerGrid(
                'in',
                bench.map((p) => p.id),
                inIds,
              )}
            </div>
            {!selectReady && (outIds.length > 0 || inIds.length > 0) ? (
              <p className="compact-dialog__hint" role="status" data-testid="compact-swap-unequal">
                {t('compactSwapUnequal')}
              </p>
            ) : null}
            <div className="modal__actions">
              <button
                type="button"
                className="btn-outline"
                disabled={outIds.length === 0 && inIds.length === 0}
                data-testid="compact-swap-clear"
                onClick={clearSelection}
              >
                {t('compactSwapClearSelection')}
              </button>
              <button
                type="button"
                className="btn-outline"
                data-testid="compact-dialog-cancel"
                onClick={onClose}
              >
                {t('cancelBtn')}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!canWrite || !selectReady}
                data-testid="compact-swap-next"
                onClick={() => setStep('time')}
              >
                {t('compactSwapNext')}
              </button>
            </div>
          </>
        ) : null}

        {step === 'time' ? (
          <>
            <div className="compact-dialog__section">
              <span className="compact-dialog__field-label">
                {t(game.clockDown ? 'compactClockDownTitle' : 'compactClockUpTitle')}
              </span>
              <ClockFields
                draft={clock}
                idPrefix="compact-dialog-clock"
                label={t(game.clockDown ? 'compactClockDownTitle' : 'compactClockUpTitle')}
                minutesLabel={t('minutesUnitLabel')}
                secondsLabel={t('secondsUnitLabel')}
                pickLabel={(what) => t('compactPickValue').replace('{label}', what)}
                disabled={!canWrite}
                onChange={touch(setClock)}
              />
              <p className="compact-dialog__hint" data-testid="compact-dialog-since">
                {t('compactLineupSince')} {fmtSec(game.beginSec)}
              </p>
            </div>
            <div className="compact-dialog__scores">{sides.map((team) => scoreField(team))}</div>
            {mode === 'quarter' ? (
              <p className="compact-dialog__hint" data-testid="compact-quarter-note">
                {lastPeriod
                  ? t('compactLastPeriodNote')
                  : t('compactNextPeriodNote')
                      .replace('{period}', period)
                      .replace('{n}', String(nextQuarter))}
              </p>
            ) : null}
            {errorKey != null ? (
              <p className="settings-error" role="alert" data-testid="compact-dialog-error">
                {t(errorKey).replace('{start}', start)}
              </p>
            ) : null}
            <div className="modal__actions">
              {mode === 'swap' ? (
                <button
                  type="button"
                  className="btn-outline"
                  data-testid="compact-dialog-back"
                  onClick={() => {
                    setError(null);
                    setStep('select');
                  }}
                >
                  {t('backBtn')}
                </button>
              ) : null}
              <button
                type="button"
                className="btn-outline"
                data-testid="compact-dialog-cancel"
                onClick={onClose}
              >
                {t('cancelBtn')}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!canWrite}
                data-testid="compact-dialog-review"
                onClick={goReview}
              >
                {t('compactSwapNext')}
              </button>
            </div>
          </>
        ) : null}

        {step === 'review' ? (
          <>
            <h3 className="compact-dialog__subtitle">{t('compactReviewTitle')}</h3>
            {input.ok ? (
              <dl className="compact-review" data-testid="compact-review">
                <dt>{t('compactReviewStartScore')}</dt>
                <dd data-testid="compact-review-start">
                  {pair(history.segStartFor, history.segStartAgainst)}
                </dd>
                <dt>{t('compactReviewEndScore')}</dt>
                <dd data-testid="compact-review-end">{pair(input.scoreFor, input.scoreAgainst)}</dd>
                <dt>{t('compactReviewPoints')}</dt>
                <dd data-testid="compact-review-points">
                  {pair(
                    input.scoreFor - history.segStartFor,
                    input.scoreAgainst - history.segStartAgainst,
                  )}
                </dd>
                <dt>{t('compactReviewTurnovers')}</dt>
                <dd data-testid="compact-review-turnovers">{segTurnovers}</dd>
                <dt>{t('compactReviewTimes')}</dt>
                <dd data-testid="compact-review-times">
                  {fmtSec(game.beginSec)} – {fmtSec(input.endSec)}
                </dd>
                <dt>{t('compactReviewDuration')}</dt>
                <dd data-testid="compact-review-duration">{dur != null ? fmtSec(dur) : ''}</dd>
              </dl>
            ) : null}
            {dur === 0 ? (
              <p className="compact-dialog__hint" data-testid="compact-review-nosegment">
                {t('compactReviewNoSegment')}
              </p>
            ) : null}
            {mode === 'swap' || mode === 'confirm-pending' ? (
              <div className="compact-dialog__section" data-testid="compact-review-lineup">
                <h3 className="compact-dialog__subtitle">{t('compactSwapNewLineup')}</h3>
                <ul className="compact-review__lineup">
                  {reviewLineup.map((id) => {
                    const p = playerById(id);
                    if (!p) return null;
                    return (
                      <li
                        key={id}
                        className="compact-review__player"
                        data-testid={`compact-review-player-${id}`}
                      >
                        <span className="compact-pick__nr">{p.nr}</span>
                        <span className="compact-pick__name">{p.naam}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {mode === 'quarter' ? (
              <p className="compact-dialog__hint">
                {lastPeriod
                  ? t('compactLastPeriodNote')
                  : t('compactNextPeriodNote')
                      .replace('{period}', period)
                      .replace('{n}', String(nextQuarter))}
              </p>
            ) : null}
            {errorKey != null ? (
              <p className="settings-error" role="alert" data-testid="compact-dialog-error">
                {t(errorKey).replace('{start}', start)}
              </p>
            ) : null}
            <div className="modal__actions">
              <button
                type="button"
                className="btn-outline"
                data-testid="compact-dialog-back"
                onClick={() => {
                  setError(null);
                  setStep('time');
                }}
              >
                {t('backBtn')}
              </button>
              <button
                type="button"
                className="btn-outline"
                data-testid="compact-dialog-cancel"
                onClick={onClose}
              >
                {t('cancelBtn')}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!canWrite || submitted}
                data-testid="compact-dialog-confirm"
                onClick={handleConfirm}
              >
                {t('confirmBtn')}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
