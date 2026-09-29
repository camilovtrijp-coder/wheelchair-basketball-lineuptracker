// Bevestigingsdialoog voor het verwijderverzoek (PR 8.3c-1c,
// docs/pr-8.3c-besluitvoorstel.md §2.5: "sterke bevestiging"). Zelfde
// structuurpatroon als `ui/game/TakeoverConfirmDialog.tsx` en
// `ui/shared/ModalDialog.tsx`: backdrop-klik en Escape sluiten, de binnenste
// `.modal` stopt click-propagatie, en `useFocusTrap` vangt focus bij mount en
// geeft die bij unmount terug aan het element dat het dialoog opende (plan §D:
// "axe-, focus-, Escape-, Tab/Shift+Tab- en focusrestoredekking").
//
// Twee varianten via `requireText`: het aanvragen vraagt om de naam van de
// organisatie te typen (bewust omslachtig — een eenmalige, moeilijk terug te
// draaien actie), het annuleren van een verzoek is een gewone bevestiging.
//
// Tijdens `inProgress` sluit NIETS het dialoog (Escape, backdrop en knoppen zijn
// uitgeschakeld): een verzoek dat halverwege wordt weggeklikt geeft een
// onduidelijke status.
import { useState } from 'preact/hooks';
import { useFocusTrap } from '../../application/a11y/useFocusTrap';

export interface DeletionConfirmDialogProps {
  testId: string;
  title: string;
  description: string;
  confirmLabel: string;
  inProgressLabel: string;
  backLabel: string;
  /** Wanneer gezet moet de gebruiker exact deze tekst typen om te kunnen bevestigen. */
  requireText?: string;
  requireTextLabel?: string;
  inProgress: boolean;
  errorMessage?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeletionConfirmDialog({
  testId,
  title,
  description,
  confirmLabel,
  inProgressLabel,
  backLabel,
  requireText,
  requireTextLabel,
  inProgress,
  errorMessage,
  onConfirm,
  onCancel,
}: DeletionConfirmDialogProps) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const [typed, setTyped] = useState('');
  const confirmed = requireText === undefined || typed.trim() === requireText.trim();
  const close = () => {
    if (!inProgress) onCancel();
  };
  // Defense-in-depth naast `disabled` op de knop: een gedispatchte klik (of een
  // toekomstige wijziging aan de knop) mag de bevestiging nooit omzeilen.
  const confirm = () => {
    if (inProgress || !confirmed) return;
    onConfirm();
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="modal-overlay"
      role="dialog"
      aria-label={title}
      aria-modal="true"
      data-testid={testId}
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <div className="modal" role="document" ref={trapRef} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="modal__desc">{description}</p>

        {requireText !== undefined ? (
          <label className="settings-field">
            <span className="settings-field__label">{requireTextLabel}</span>
            <input
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellcheck={false}
              value={typed}
              disabled={inProgress}
              data-testid={`${testId}-input`}
              onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)}
            />
          </label>
        ) : null}

        {errorMessage ? (
          <p className="settings-error" role="alert" data-testid={`${testId}-error`}>
            {errorMessage}
          </p>
        ) : null}

        <div className="settings-actions">
          <button
            type="button"
            className="btn-primary"
            data-testid={`${testId}-confirm`}
            disabled={inProgress || !confirmed}
            onClick={confirm}
          >
            {inProgress ? inProgressLabel : confirmLabel}
          </button>
          <button
            type="button"
            className="btn-outline"
            data-testid={`${testId}-back`}
            disabled={inProgress}
            onClick={onCancel}
          >
            {backLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
