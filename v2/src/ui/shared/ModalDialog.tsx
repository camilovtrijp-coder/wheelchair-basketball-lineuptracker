import { useFocusTrap } from '../../application/a11y/useFocusTrap';

/**
 * Gedeeld modaal-dialoogpatroon (verplaatst uit `ui/stats/StatsPanel.tsx`
 * bij PR 6.5, zodat `GamesFilterModal` — nu gedeeld tussen Stats en Trends —
 * en `PlayerFilterModal` dezelfde implementatie gebruiken). Voldoet aan
 * jsx-a11y: de backdrop-click sluit het dialoog (`role="dialog"` met
 * `aria-modal` en keyboard handler), terwijl de binnenste `.modal` de
 * click-propagation stopt zodat interacties binnen het dialoog de backdrop
 * niet sluiten.
 *
 * PR 8.2a (docs/pr-8.2-plan.md §C 8.2a werk 4): `useFocusTrap` vangt focus
 * zodra dit dialoog mount en geeft 'm terug bij unmount — een AANVULLING op
 * het bestaande backdrop-click-/Escape-sluitgedrag hierboven, geen
 * vervanging.
 */
export function ModalDialog({
  title,
  description,
  onClose,
  onClear,
  clearLabel,
  doneLabel,
  testId,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  onClear?: () => void;
  clearLabel: string;
  doneLabel: string;
  testId: string;
  children: preact.ComponentChildren;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="modal-overlay"
      role="dialog"
      aria-label={title}
      aria-modal="true"
      data-testid={testId}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <div className="modal" role="document" ref={trapRef} onClick={(e) => e.stopPropagation()}>
        <div className="modal__title-row">
          {onClear ? (
            <button
              type="button"
              className="btn-outline"
              data-testid={`${testId}-clear`}
              onClick={onClear}
            >
              {clearLabel}
            </button>
          ) : (
            <span />
          )}
          <h2>{title}</h2>
          <button
            type="button"
            className="btn-outline"
            data-testid={`${testId}-done`}
            onClick={onClose}
          >
            {doneLabel}
          </button>
        </div>
        {description ? <p className="modal__desc">{description}</p> : null}
        {children}
      </div>
    </div>
  );
}
