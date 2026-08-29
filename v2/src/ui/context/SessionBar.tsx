import { useState } from 'preact/hooks';
import { translate, type Lang } from '../../i18n/strings';
import type { SyncStatus } from '../../domain/syncState';
import { SyncStatusIndicator } from '../sync/SyncStatusIndicator';

export interface SessionBarProps {
  lang: Lang;
  onSignOut: () => void;
  onSwitchContext: () => void;
  /**
   * Alleen meegeven in cloud-modus (PR 5.3c-2) — `undefined` toont geen
   * indicator. Lokale modus heeft niets om te syncen; zie
   * ui/sync/SyncStatusIndicator.tsx.
   */
  syncStatus?: SyncStatus;
  syncFromCache?: boolean;
  /**
   * E-mailadres van de ingelogde gebruiker (PR 5.5c-bugfixes bug 7) — nergens
   * anders in de app is te zien met welk account je bent ingelogd. `null`/
   * `undefined` toont geen indicator (bijv. tijdens een korte overgangsstate).
   */
  email?: string | null;
  /**
   * PR 8.2c (docs/pr-8.2-plan.md §B punt 5, tweede subpunt): herroepbare
   * vertrouwd-apparaat-instelling — er was tot nu toe geen UI-pad om de
   * `TrustedDevicePrompt`-keuze later te herzien (bijv. een clubtablet dat
   * per ongeluk als "vertrouwd" is gemarkeerd). Wissel naar onvertrouwd
   * wist meteen dezelfde lokale data als `handleSignOut()`'s onvertrouwd-
   * apparaatpad, dus toont eerst een bevestiging.
   */
  trustedDevice: boolean;
  onChangeTrustedDevice: (trusted: boolean) => void;
}

/**
 * Dunne balk náást (niet in) `App` — zo blijft `App.tsx` zelf ongewijzigd
 * terwijl er toch een uitlog- en contextwisselknop beschikbaar zijn zodra
 * er een actieve sessie is. Vervangt ui/auth/SignOutBar.tsx uit stap 5: die
 * had alleen uitloggen, dit is dezelfde balk met de wisselknop erbij.
 */
export function SessionBar({
  lang,
  onSignOut,
  onSwitchContext,
  syncStatus,
  syncFromCache,
  email,
  trustedDevice,
  onChangeTrustedDevice,
}: SessionBarProps) {
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  function handleTrustedDeviceToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      onChangeTrustedDevice(true);
      return;
    }
    // Uitzetten wist meteen lokale data (zie clearLocalDeviceData()) — eerst
    // bevestigen i.p.v. dat direct bij een onbedoelde klik te laten gebeuren.
    setConfirmingRevoke(true);
  }

  return (
    <div className="session-bar">
      <div className="session-bar__left">
        {email ? (
          <span className="session-bar__account" data-testid="session-account-email">
            {email}
          </span>
        ) : null}
        {syncStatus ? (
          <SyncStatusIndicator lang={lang} status={syncStatus} fromCache={syncFromCache} />
        ) : null}
      </div>
      <label className="session-bar__trusted-device">
        <input
          type="checkbox"
          data-testid="trusted-device-setting-toggle"
          checked={trustedDevice}
          onChange={handleTrustedDeviceToggle}
        />
        {translate(lang, 'trustedDeviceSettingLabel')}
      </label>
      <button type="button" data-testid="switch-context" onClick={onSwitchContext}>
        {translate(lang, 'contextSwitcherSwitchBtn')}
      </button>
      <button type="button" data-testid="sign-out" onClick={onSignOut}>
        {translate(lang, 'authSignOutBtn')}
      </button>
      {confirmingRevoke ? (
        <div
          className="session-bar__trusted-device-confirm"
          role="alertdialog"
          aria-modal="true"
          data-testid="trusted-device-revoke-confirm"
        >
          <p>{translate(lang, 'trustedDeviceRevokeConfirmTitle')}</p>
          <p>{translate(lang, 'trustedDeviceRevokeConfirmBody')}</p>
          <button
            type="button"
            data-testid="trusted-device-revoke-confirm-btn"
            onClick={() => {
              setConfirmingRevoke(false);
              onChangeTrustedDevice(false);
            }}
          >
            {translate(lang, 'trustedDeviceRevokeConfirmBtn')}
          </button>
          <button
            type="button"
            data-testid="trusted-device-revoke-cancel-btn"
            onClick={() => setConfirmingRevoke(false)}
          >
            {translate(lang, 'trustedDeviceRevokeCancelBtn')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
