// "Actie nodig"-paneel (PR 5.3c-2): lijst van geweigerde payloads met
// [Opnieuw proberen] [Negeren] [Exporteren] per item. "Negeren" raakt alleen
// de pending-store aan (useSyncStatus), nooit lineup-tracker-settings/-roster
// — zie docs/pr-5.3-plan.md §C/5.3c-2 punt 5.

import { translate, type Lang } from '../../i18n/strings';
import type { PendingAction, SyncKind } from '../../application/sync/useSyncStatus';

export interface ActionNeededPanelProps {
  lang: Lang;
  pending: PendingAction[];
  onRetry: (kind: SyncKind) => void;
  onDismiss: (kind: SyncKind) => void;
  onExport: (kind: SyncKind) => void;
}

export function ActionNeededPanel({
  lang,
  pending,
  onRetry,
  onDismiss,
  onExport,
}: ActionNeededPanelProps) {
  if (pending.length === 0) return null;

  const title = translate(lang, 'actionNeededTitle');

  return (
    <section className="action-needed-panel" aria-label={title} data-testid="action-needed-panel">
      <h2>{title}</h2>
      <ul className="action-needed-list">
        {pending.map((item) => (
          <li
            key={item.kind}
            className="action-needed-item"
            data-testid={`action-needed-${item.kind}`}
          >
            <span className="action-needed-item__kind">{item.kind}</span>
            <div className="action-needed-item__actions">
              <button
                type="button"
                className="btn-primary"
                data-testid={`action-needed-retry-${item.kind}`}
                onClick={() => onRetry(item.kind)}
              >
                {translate(lang, 'actionNeededRetryBtn')}
              </button>
              <button
                type="button"
                className="btn-outline"
                data-testid={`action-needed-dismiss-${item.kind}`}
                onClick={() => onDismiss(item.kind)}
              >
                {translate(lang, 'actionNeededDismissBtn')}
              </button>
              <button
                type="button"
                className="btn-outline"
                data-testid={`action-needed-export-${item.kind}`}
                onClick={() => onExport(item.kind)}
              >
                {translate(lang, 'actionNeededExportBtn')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
