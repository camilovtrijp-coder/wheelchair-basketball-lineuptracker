import { translate, type Lang, type StringKey } from '../../i18n/strings';
import type { OrganizationRole } from '../../domain/organizations/types';

/**
 * PR 8.3c-2c-i (docs/pr-8.3c-2c-plan.md §2): de ingang voor "organisatie verlaten" en
 * "account verwijderen" op het tabblad Instellingen (zelfde plek en vorm als
 * `ExportPanel`/`DeletionPanel`). Dit paneel roept zelf niets aan: de knoppen openen de
 * flow in `AuthGate` (`useAccountFlow`), die een contextwissel en het verdwijnen van dit
 * scherm overleeft.
 *
 * Een owner krijgt GEEN verlaatknop maar de uitleg waarom het niet kan (Rules weigeren een
 * owner die zichzelf verwijdert; overdracht komt in 2c-ii). Voor alle andere rollen en een
 * team-only context (`role === null`) beslist de coördinator, met een server-inventaris,
 * of vertrek mag (bijv. de maker van de organisatie kan het niet); een weigering schrijft
 * niets en wordt in het dialoog uitgelegd.
 *
 * PR 8.3c-2c-ii (docs/pr-8.3c-2c-plan.md §8): een owner krijgt onder de uitleg (die nu naar
 * de knop verwijst) "Eigendom overdragen…" (stap 1, A) en "Andere eigenaar verwijderen…"
 * (stap 2, B; besluit B9). Beide ALLEEN voor owners; andere rollen en team-only zien ze
 * nooit. De coördinator controleert de ownerrol bovendien zelf van de server.
 */
export interface AccountPanelProps {
  lang: Lang;
  organizationName: string;
  role: OrganizationRole | null;
  /** Er loopt al een accountflow: geen tweede starten. */
  busy: boolean;
  onLeaveOrganization: () => void;
  onDeleteAccount: () => void;
  /** Ontbreekt → geen overdrachtsknoppen (bijv. zonder accountdiensten). */
  onTransferOwnership?: () => void;
  onRemoveOtherOwner?: () => void;
}

export function AccountPanel({
  lang,
  organizationName,
  role,
  busy,
  onLeaveOrganization,
  onDeleteAccount,
  onTransferOwnership,
  onRemoveOtherOwner,
}: AccountPanelProps) {
  const t = (key: StringKey): string => translate(lang, key);
  const withOrg = (key: StringKey) => t(key).split('{org}').join(organizationName);
  return (
    <fieldset className="settings-section account-panel" data-testid="account-panel">
      <legend>{t('accountPanelTitle')}</legend>
      {role === 'organizationOwner' ? (
        <>
          <p className="settings-explainer" data-testid="leave-org-owner-note">
            {withOrg('leaveOrgOwnerNote')}
          </p>
          {onTransferOwnership ? (
            <>
              <p className="settings-explainer">{withOrg('transferPanelDesc')}</p>
              <div className="settings-actions">
                <button
                  type="button"
                  className="btn-outline"
                  data-testid="transfer-start-btn"
                  disabled={busy}
                  onClick={onTransferOwnership}
                >
                  {t('transferStartBtn')}
                </button>
              </div>
            </>
          ) : null}
          {onRemoveOtherOwner ? (
            <>
              <p className="settings-explainer">{t('transferRemoveOwnerDesc')}</p>
              <div className="settings-actions">
                <button
                  type="button"
                  className="btn-outline"
                  data-testid="transfer-remove-owner-start-btn"
                  disabled={busy}
                  onClick={onRemoveOtherOwner}
                >
                  {t('transferRemoveOwnerStartBtn')}
                </button>
              </div>
            </>
          ) : null}
        </>
      ) : (
        <>
          <p className="settings-explainer">{withOrg('leaveOrgDesc')}</p>
          <div className="settings-actions">
            <button
              type="button"
              className="btn-outline"
              data-testid="leave-org-start-btn"
              disabled={busy}
              onClick={onLeaveOrganization}
            >
              {t('leaveOrgStartBtn')}
            </button>
          </div>
        </>
      )}
      <p className="settings-explainer">{t('accountDeleteDesc')}</p>
      <div className="settings-actions">
        <button
          type="button"
          className="btn-outline"
          data-testid="account-delete-start-btn"
          disabled={busy}
          onClick={onDeleteAccount}
        >
          {t('accountDeleteStartBtn')}
        </button>
      </div>
    </fieldset>
  );
}
