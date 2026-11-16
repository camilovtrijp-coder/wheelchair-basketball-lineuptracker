import { translate, type Lang, type StringKey } from '../../i18n/strings';

/**
 * Verwijdervak onderaan een segment-editor (bouwplan Rustig, R6). Staat
 * visueel los van Opslaan/Annuleren (eigen vak met scheidingslijn) en vraagt
 * inline om bevestiging, zonder `window.confirm`. Gedeeld door Klassiek en
 * Compact/Snel; de test-ID's volgen het voorvoegsel van de editor
 * (`{prefix}-delete`, `{prefix}-delete-confirm`, `{prefix}-delete-cancel`,
 * `{prefix}-delete-confirm-btn`).
 *
 * Gecontroleerd: de editor houdt `confirming` bij, zodat hij de bevestiging
 * kan intrekken zodra de gebruiker iets anders aanpast.
 */
export interface SegmentDeleteZoneProps {
  lang: Lang;
  testIdPrefix: string;
  canWrite: boolean;
  confirming: boolean;
  onConfirmingChange: (confirming: boolean) => void;
  onDelete: () => void;
}

export function SegmentDeleteZone({
  lang,
  testIdPrefix,
  canWrite,
  confirming,
  onConfirmingChange,
  onDelete,
}: SegmentDeleteZoneProps) {
  const t = (key: StringKey) => translate(lang, key);
  return (
    <div className="segment-delete-zone" data-testid={`${testIdPrefix}-delete-zone`}>
      {confirming ? (
        <div
          className="segment-delete-zone__confirm"
          data-testid={`${testIdPrefix}-delete-confirm`}
        >
          <p className="tracking-warning" role="alert">
            {t('confirmDeleteSegment')}
          </p>
          <div className="segment-delete-zone__actions">
            <button
              type="button"
              className="btn-outline"
              data-testid={`${testIdPrefix}-delete-cancel`}
              onClick={() => onConfirmingChange(false)}
            >
              {t('segmentDeleteKeepBtn')}
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={!canWrite}
              data-testid={`${testIdPrefix}-delete-confirm-btn`}
              onClick={() => canWrite && onDelete()}
            >
              {t('compactDeleteConfirmBtn')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="segment-delete-zone__trigger"
          disabled={!canWrite}
          data-testid={`${testIdPrefix}-delete`}
          onClick={() => canWrite && onConfirmingChange(true)}
        >
          {t('compactDeleteSegmentBtn')}
        </button>
      )}
    </div>
  );
}
