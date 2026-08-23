// 8.1a (docs/pr-8.1-plan.md §C 8.1a werk 3, §B punt 5): herstelbaar-
// foutscenario voor PWA-updates — een mislukte SW-registratie/install of
// een blijvend uitblijvende `controllerchange` na een bevestigde
// `skipWaiting`-aanroep. Zit BEWUST NAAST `ActionNeededPanel.tsx` (zelfde
// map, zelfde visuele/diagnostische conventies — `action-needed-*`-CSS-
// klassen, dezelfde "Opnieuw proberen"/"Negeren"-vertaalsleutels), maar is
// een aparte component: `ActionNeededPanel`'s `PendingAction`-contract
// (`application/sync/useSyncStatus.ts`) is specifiek voor een te herzenden
// settings-/roster-payload (`retry()` schrijft die payload opnieuw) — een
// PWA-registratiefout heeft geen payload om opnieuw te versturen, alleen een
// registratie om opnieuw te proberen. Dit is het "equivalente herstelpad
// binnen hetzelfde SyncStatus-diagnosecontract" waar het plan het over
// heeft: zelfde `actie-nodig`-semantiek en dezelfde UI-taal, geen nieuw,
// ongerelateerd foutkanaal — en niet vermengd met de update-beschikbaar-
// banner (`ui/pwa/PwaUpdateBanner.tsx`), die een heel ander scenario dekt.
import { translate, type Lang } from '../../i18n/strings';

export interface PwaActionNeededPanelProps {
  lang: Lang;
  visible: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}

export function PwaActionNeededPanel({
  lang,
  visible,
  onRetry,
  onDismiss,
}: PwaActionNeededPanelProps) {
  if (!visible) return null;

  const title = translate(lang, 'pwaActionNeededTitle');

  return (
    <section
      className="action-needed-panel"
      aria-label={title}
      data-testid="pwa-action-needed-panel"
    >
      <h2>{title}</h2>
      <p>{translate(lang, 'pwaActionNeededMessage')}</p>
      <div className="action-needed-item__actions">
        <button
          type="button"
          className="btn-primary"
          data-testid="pwa-action-needed-retry"
          onClick={onRetry}
        >
          {translate(lang, 'actionNeededRetryBtn')}
        </button>
        <button
          type="button"
          className="btn-outline"
          data-testid="pwa-action-needed-dismiss"
          onClick={onDismiss}
        >
          {translate(lang, 'actionNeededDismissBtn')}
        </button>
      </div>
    </section>
  );
}
