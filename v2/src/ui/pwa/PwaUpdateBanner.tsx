// 8.1a (docs/pr-8.1-plan.md §C 8.1a werk 3): update-beschikbaar-banner.
// Bewust een EIGEN, aparte UI-locatie — NIET via `ui/sync/ActionNeededPanel`
// (die blijft gereserveerd voor sync-acties op wedstrijd-/back-updata, zie
// 7.1c/7.2c/7.4b). Een mislukte SW-install of een blijvend uitblijvende
// `controllerchange` gaat via `ui/sync/PwaActionNeededPanel.tsx` (of
// `ActionNeededPanel` zelf) — de twee mogen niet door elkaar lopen (externe
// review PR #74). Deze component rendert dus UITSLUITEND de
// "update-available"/"reloading"-statussen, nooit `error`.
import { translate, type Lang } from '../../i18n/strings';
import type { PwaUpdateStatus } from '../../infrastructure/pwa/PwaUpdateAdapter';

export interface PwaUpdateBannerProps {
  lang: Lang;
  status: PwaUpdateStatus;
  /** Zelfde `locked`-afleiding als `App.tsx` — bepaalt uitsluitend de
   * getoonde tekst (auto-bevestiging al dan niet actief); de knop blijft in
   * beide gevallen aanwezig en werkt hetzelfde. */
  locked: boolean;
  onConfirm: () => void;
}

export function PwaUpdateBanner({ lang, status, locked, onConfirm }: PwaUpdateBannerProps) {
  if (status !== 'update-available' && status !== 'reloading') return null;

  return (
    <div className="pwa-update-banner" role="status" data-testid="pwa-update-banner">
      <span>
        {translate(
          lang,
          status === 'reloading'
            ? 'pwaUpdateReloading'
            : locked
              ? 'pwaUpdateAvailableLocked'
              : 'pwaUpdateAvailable',
        )}
      </span>
      {status === 'update-available' && (
        <button
          type="button"
          className="btn-primary"
          data-testid="pwa-update-confirm"
          onClick={onConfirm}
        >
          {translate(lang, 'pwaUpdateConfirmBtn')}
        </button>
      )}
    </div>
  );
}
