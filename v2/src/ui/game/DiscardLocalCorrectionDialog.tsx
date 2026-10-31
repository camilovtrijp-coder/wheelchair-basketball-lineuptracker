import { useFocusTrap } from '../../application/a11y/useFocusTrap';
import { translate, type Lang } from '../../i18n/strings';

/**
 * PR 7.6b (docs/pr-7.6-plan.md §D.3): bevestigingsstap voor "Mijn lokale
 * versie verwerpen" bij een correctieconflict. Bewust een eigen dialoog en geen
 * `window.confirm`: de tekst legt uit wat er gebeurt (alleen de kopie op dit
 * apparaat verdwijnt, de teamversie komt terug, een niet-geüploade lokale
 * correctie gaat verloren). Annuleren, Escape en de achtergrond doen niets.
 * Zelfde opbouw als `TakeoverConfirmDialog` (focus-trap via `useFocusTrap`).
 */
export interface DiscardLocalCorrectionDialogProps {
  lang: Lang;
  /** `true` na een mislukte poging (de dialoog blijft open). */
  failed: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DiscardLocalCorrectionDialog({
  lang,
  failed,
  onConfirm,
  onCancel,
}: DiscardLocalCorrectionDialogProps) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const title = t('correctionDiscardConfirmTitle');

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="modal-overlay"
      role="dialog"
      aria-label={title}
      aria-modal="true"
      data-testid="history-correction-discard-dialog"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <div className="modal" role="document" ref={trapRef} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="modal__desc" data-testid="history-correction-discard-text">
          {t('correctionDiscardConfirm')}
        </p>
        {failed ? (
          <p className="settings-error" role="alert" data-testid="history-correction-discard-error">
            {t('correctionDiscardFailed')}
          </p>
        ) : null}
        <div className="settings-actions">
          <button
            type="button"
            className="btn-danger"
            data-testid="history-correction-discard-confirm"
            onClick={onConfirm}
          >
            {t('correctionDiscardConfirmAction')}
          </button>
          <button
            type="button"
            className="btn-outline"
            data-testid="history-correction-discard-cancel"
            onClick={onCancel}
          >
            {t('correctionDiscardCancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
