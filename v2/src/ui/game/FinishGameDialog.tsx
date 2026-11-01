import { useEffect, useRef, useState } from 'preact/hooks';
import type { ActiveGame } from '../../domain/game/types';
import {
  clockDuration,
  commitSegment,
  openSegmentSummary,
  type LiveCommandError,
} from '../../domain/game/liveCommands';
import { deriveGameHistory, type ClassificationConfig } from '../../domain/game/tracking';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import { useFocusTrap } from '../../application/a11y/useFocusTrap';
import { fmtSec, liveErrorKey } from './liveFormat';
import {
  ClockFields,
  clockDraftFromSeconds,
  parseClockDraft,
  type ClockDraft,
} from './CompactNumberFields';
import { playerText } from './CompactSegmentList';

/**
 * Afrondkeuze (bouwplan C3, besluit 4), gedeeld door Klassiek (alleen bij open
 * punten/turnovers) en Compact (altijd). Staan er nog punten of turnovers
 * buiten een segment, dan waarschuwt de dialoog en kiest de gebruiker tussen
 * "laatste segment vastleggen en afronden" en "bewust afronden zonder"
 * (annuleren sluit zonder iets te wijzigen). Staat er niets open, dan wordt
 * toch gevraagd of alle gespeelde tijd al vastligt: een gelijke stand zegt niets
 * over ongeregistreerde speeltijd.
 *
 * De dialoog schrijft zelf niets weg: "laatste segment vastleggen" roept
 * `onGameChange(next)` en daarna `onFinishGame(next)` aan, zodat App met de
 * actuele stand afrondt; de bestaande afrondlogica (validatie, opslag,
 * outbox/herstel, dubbele-afrondingsbescherming) blijft in App. Per dialoog
 * wordt maximaal één keer afgerond.
 */
export interface FinishGameDialogProps {
  lang: Lang;
  game: ActiveGame;
  classification: ClassificationConfig;
  canWrite: boolean;
  /** Uitwedstrijd: alleen de weergavevolgorde van de stand (tegenstander links). */
  away?: boolean;
  onGameChange: (next: ActiveGame) => void;
  onFinishGame: (latestGame?: ActiveGame) => void;
  onClose: () => void;
}

export function FinishGameDialog({
  lang,
  game,
  classification,
  canWrite,
  away = false,
  onGameChange,
  onFinishGame,
  onClose,
}: FinishGameDialogProps) {
  const t = (key: StringKey) => translate(lang, key);
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const submitted = useRef(false);
  const [step, setStep] = useState<'choose' | 'last'>('choose');
  const [clock, setClock] = useState<ClockDraft>(() => clockDraftFromSeconds(game.endSec));
  const [error, setError] = useState<LiveCommandError | null>(null);

  const [touched, setTouched] = useState(false);

  // Escape/achtergrond: een gewijzigde kloktijd in stap 'last' niet stil weggooien.
  function requestClose() {
    if (submitted.current) return;
    if (step === 'last' && touched && !window.confirm(t('compactDiscardDraftConfirm'))) return;
    onClose();
  }
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  // Weergave: eigen team links, bij uitwedstrijd de tegenstander.
  const fill = (template: string, own: number, opp: number) =>
    template
      .replace('{for}', String(away ? opp : own))
      .replace('{against}', String(away ? own : opp));

  const open = openSegmentSummary(game);
  const history = deriveGameHistory(game);
  const lineup = game.pendingSwapLineup ?? game.onCourt;
  const endSec = parseClockDraft(clock);
  const dur = endSec != null ? clockDuration(game.clockDown, game.beginSec, endSec) : null;
  const errorKey = error != null ? liveErrorKey(error) : null;
  const start = `${history.segStartFor}-${history.segStartAgainst}`;

  function finishWithout() {
    if (!canWrite || submitted.current) return;
    submitted.current = true;
    onFinishGame();
    onClose();
  }

  function recordLastAndFinish() {
    if (!canWrite || submitted.current) return;
    if (endSec == null) {
      setError('invalid-clock');
      return;
    }
    const result = commitSegment(game, { endSec, classification });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    submitted.current = true;
    onGameChange(result.game);
    onFinishGame(result.game);
    onClose();
  }

  const title = step === 'last' ? t('finishLastTitle') : t('finishGameBtn');

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
        data-testid="finish-dialog"
        data-step={step}
        ref={trapRef}
      >
        <h2 className="compact-dialog__title">{title}</h2>

        {step === 'choose' ? (
          <>
            <p className="compact-dialog__hint">{t('confirmFinishGame')}</p>
            {open.hasOpen ? (
              <div className="tracking-warning" role="alert" data-testid="finish-open-warning">
                <p>{t('finishOpenWarning')}</p>
                <ul>
                  {open.pointsFor !== 0 || open.pointsAgainst !== 0 ? (
                    <li data-testid="finish-open-points">
                      {fill(t('finishOpenPoints'), open.pointsFor, open.pointsAgainst)}
                    </li>
                  ) : null}
                  {open.turnovers !== 0 ? (
                    <li data-testid="finish-open-turnovers">
                      {t('finishOpenTurnovers').replace('{n}', String(open.turnovers))}
                    </li>
                  ) : null}
                </ul>
                <p>{t('finishOpenWithoutNote')}</p>
              </div>
            ) : (
              <p className="compact-dialog__hint" data-testid="finish-nothing-open">
                {t('finishDialogHint')}
              </p>
            )}
            <div className="compact-finish__choices">
              <button
                type="button"
                className="btn-primary"
                disabled={!canWrite}
                data-testid="finish-choose-last"
                onClick={() => {
                  setError(null);
                  setStep('last');
                }}
              >
                {t('finishChooseLast')}
              </button>
              <button
                type="button"
                className="btn-outline"
                disabled={!canWrite}
                data-testid="finish-choose-without"
                onClick={finishWithout}
              >
                {open.hasOpen ? t('finishChooseWithout') : t('finishChooseAllRecorded')}
              </button>
              <button
                type="button"
                className="btn-outline"
                data-testid="finish-cancel"
                onClick={onClose}
              >
                {t('cancelBtn')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="compact-dialog__section">
              <span className="compact-dialog__field-label">
                {t(game.clockDown ? 'compactClockDownTitle' : 'compactClockUpTitle')}
              </span>
              <ClockFields
                draft={clock}
                idPrefix="finish-clock"
                label={t(game.clockDown ? 'compactClockDownTitle' : 'compactClockUpTitle')}
                minutesLabel={t('minutesUnitLabel')}
                secondsLabel={t('secondsUnitLabel')}
                pickLabel={(what) => t('compactPickValue').replace('{label}', what)}
                disabled={!canWrite}
                onChange={(next) => {
                  setTouched(true);
                  setError(null);
                  setClock(next);
                }}
              />
              <p className="compact-dialog__hint" data-testid="finish-since">
                {t('compactLineupSince')} {fmtSec(game.beginSec)}
                {dur != null && dur > 0 ? ` · ${t('compactReviewDuration')} ${fmtSec(dur)}` : ''}
              </p>
            </div>
            <div className="compact-dialog__section" data-testid="finish-last-lineup">
              <h3 className="compact-dialog__subtitle">{t('finishLastLineup')}</h3>
              <p className="compact-dialog__hint">
                {lineup.map((id) => playerText(game, id)).join(' · ')}
              </p>
            </div>
            <p className="compact-dialog__hint" data-testid="finish-last-score">
              {fill(t('finishLastScoreNote'), history.scoreFor, history.scoreAgainst)}
              {' · '}
              {t('compactReviewPoints')}{' '}
              {away
                ? `${open.pointsAgainst}–${open.pointsFor}`
                : `${open.pointsFor}–${open.pointsAgainst}`}{' '}
              · {t('turnoversLabel')} {open.turnovers}
            </p>
            {errorKey != null ? (
              <p className="settings-error" role="alert" data-testid="finish-error">
                {t(errorKey).replace('{start}', start)}
              </p>
            ) : null}
            <div className="modal__actions">
              <button
                type="button"
                className="btn-outline"
                data-testid="finish-last-back"
                onClick={() => {
                  setError(null);
                  setStep('choose');
                }}
              >
                {t('backBtn')}
              </button>
              <button
                type="button"
                className="btn-outline"
                data-testid="finish-last-cancel"
                onClick={onClose}
              >
                {t('cancelBtn')}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!canWrite}
                data-testid="finish-last-confirm"
                onClick={recordLastAndFinish}
              >
                {t('finishLastConfirmBtn')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
