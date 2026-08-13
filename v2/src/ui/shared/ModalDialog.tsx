/**
 * Gedeeld modaal-dialoogpatroon (verplaatst uit `ui/stats/StatsPanel.tsx`
 * bij PR 6.5, zodat `GamesFilterModal` — nu gedeeld tussen Stats en Trends —
 * en `PlayerFilterModal` dezelfde implementatie gebruiken). Voldoet aan
 * jsx-a11y: de backdrop-click sluit het dialoog (`role="dialog"` met
 * `aria-modal` en keyboard handler), terwijl de binnenste `.modal` de
 * click-propagation stopt zodat interacties binnen het dialoog de backdrop
 * niet sluiten.
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
      <div className="modal" role="document" onClick={(e) => e.stopPropagation()}>
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
