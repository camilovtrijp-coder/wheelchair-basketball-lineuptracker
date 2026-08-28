// Sterke overname-bevestigingsflow (PR 7.3c, docs/pr-7.3-plan.md §C 7.3c
// werk 1). Toont de zichtbare huidige writer, de laatste bekende
// serveractiviteit en het gevolg voor dit apparaat se eigen nog-offline
// acties, vóórdat de gebruiker `GameSyncCoordinator.takeoverWriter()`
// (PR 7.3a, tot nu toe zonder UI-aanroeppunt) daadwerkelijk aanroept. Een
// overname is ALTIJD een expliciete, bewuste gebruikersactie — nooit
// auto-getriggerd (§B "Overname vereist ... sterke bevestiging", §D "Geen
// time-based auto-takeover") — dit dialoog is het enige aanroeppunt.
//
// Zelfde structuurpatroon als `ui/shared/ModalDialog.tsx` (backdrop-click/
// Escape sluit, binnenste click stopt propagatie) — geen hergebruik van
// ModalDialog zelf, want die is toegesneden op filter-modals met een
// clear/done-knoppenpaar; deze heeft een eigen bevestig/annuleer-paar plus
// een blokkerende in-progress-staat tijdens de overnamepoging.

import { translate, type Lang } from '../../i18n/strings';
import type { WriterClaimErrorCode, WriterIdentity } from '../../domain/game/writerClaim';
import { useFocusTrap } from '../../application/a11y/useFocusTrap';

function takeoverBlockedKey(code: WriterClaimErrorCode) {
  switch (code) {
    case 'offline':
      return 'takeoverBlockedOffline' as const;
    case 'already-claimed':
      return 'takeoverBlockedAlreadyClaimed' as const;
    case 'stale-revision':
      return 'takeoverBlockedStaleRevision' as const;
    case 'role-denied':
      return 'takeoverBlockedRoleDenied' as const;
    case 'game-completed':
      return 'takeoverBlockedGameCompleted' as const;
    case 'unknown':
      return 'takeoverBlockedUnknown' as const;
  }
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export interface TakeoverConfirmDialogProps {
  lang: Lang;
  /** Actuele, van de server bekende writeridentiteit — `null` als die nog niet bekend is (initiële laadstaat). */
  currentWriter: WriterIdentity | null;
  /** `GameDocument.lastWriterActivityAt` — `null` als er nog nooit een draaiveldpatch was. */
  lastWriterActivityAt: string | null;
  /** Aantal lokale acties op DIT apparaat dat nog niet server-bevestigd is (`GameSyncCoordinator.readSyncDiagnostics()`). */
  pendingActionCount: number;
  inProgress: boolean;
  blockedCode: WriterClaimErrorCode | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function TakeoverConfirmDialog({
  lang,
  currentWriter,
  lastWriterActivityAt,
  pendingActionCount,
  inProgress,
  blockedCode,
  onConfirm,
  onCancel,
}: TakeoverConfirmDialogProps) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  // PR 8.2a (docs/pr-8.2-plan.md §C 8.2a werk 4): zelfde focus-trap-
  // aanvulling als `ModalDialog.tsx` — vangt/herstelt focus, vervangt het
  // bestaande backdrop-click-/Escape-sluitgedrag hieronder niet.
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="modal-overlay"
      role="dialog"
      aria-label={t('takeoverConfirmTitle')}
      aria-modal="true"
      data-testid="takeover-confirm-dialog"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <div className="modal" role="document" ref={trapRef} onClick={(e) => e.stopPropagation()}>
        <h2>{t('takeoverConfirmTitle')}</h2>
        <p className="modal__desc">{t('takeoverConfirmDesc')}</p>

        <dl className="takeover-confirm-facts">
          <dt>{t('takeoverCurrentWriterLabel')}</dt>
          <dd data-testid="takeover-current-writer">
            {currentWriter
              ? `${shortId(currentWriter.writerUid)} · ${shortId(currentWriter.deviceId)} (epoch ${currentWriter.writerEpoch})`
              : t('takeoverCurrentWriterUnknown')}
          </dd>
          <dt>{t('takeoverLastActivityLabel')}</dt>
          <dd data-testid="takeover-last-activity">
            {lastWriterActivityAt ?? t('takeoverLastActivityUnknown')}
          </dd>
        </dl>

        {pendingActionCount > 0 ? (
          <p className="settings-explainer" role="status" data-testid="takeover-pending-warning">
            {t('takeoverPendingActionsWarning').replace('{count}', String(pendingActionCount))}
          </p>
        ) : null}

        {blockedCode ? (
          <p className="settings-error" role="alert" data-testid="takeover-blocked-error">
            {t(takeoverBlockedKey(blockedCode))}
          </p>
        ) : null}

        <div className="settings-actions">
          <button
            type="button"
            className="btn-primary"
            data-testid="takeover-confirm-btn"
            disabled={inProgress}
            onClick={onConfirm}
          >
            {inProgress ? t('takeoverInProgress') : t('takeoverConfirmBtn')}
          </button>
          <button
            type="button"
            className="btn-outline"
            data-testid="takeover-cancel-btn"
            disabled={inProgress}
            onClick={onCancel}
          >
            {t('takeoverCancelBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
