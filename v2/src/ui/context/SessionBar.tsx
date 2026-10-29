import { useEffect, useRef, useState } from 'preact/hooks';
import { translate, type Lang } from '../../i18n/strings';
import type { SyncStatus } from '../../domain/syncState';
import { SyncStatusIndicator } from '../sync/SyncStatusIndicator';
import { useFocusTrap } from '../../application/a11y/useFocusTrap';

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
 * Compacte accountchip met uitklapmenu (v1-look, stap 3/5). Wordt door
 * AuthGate als `headerSlot` in de app-header van `App` geplaatst, naast de
 * taalknop; het menu bevat e-mailadres, wissel van organisatie/team,
 * vertrouwd-apparaat-schakelaar en uitloggen. De sync-indicator blijft
 * zichtbaar naast de chip. Alleen presentatie: de handlers en de
 * bevestiging voor het intrekken van "vertrouwd apparaat" zijn ongewijzigd.
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
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Sluit bij Escape (focus terug naar de chip) en bij een klik buiten het
  // menu. Tijdens de bevestiging van het intrekken beheert de focus-trap het
  // toetsenbord, dus dan doet het menu niets.
  useEffect(() => {
    if (!menuOpen) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || confirmingRevoke) return;
      setMenuOpen(false);
      triggerRef.current?.focus();
    }
    function handlePointerDown(event: Event) {
      if (confirmingRevoke) return;
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [menuOpen, confirmingRevoke]);

  function handleFocusOut(event: FocusEvent) {
    if (confirmingRevoke) return;
    const next = event.relatedTarget as Node | null;
    if (next && wrapperRef.current && !wrapperRef.current.contains(next)) setMenuOpen(false);
  }
  // PR 8.2a-patroon (zie ModalDialog.tsx/TakeoverConfirmDialog.tsx): vangt
  // focus zodra de bevestiging opent, laat Tab binnen het dialoog cyclen en
  // geeft focus terug (aan de checkbox, want die had focus vóór het openen)
  // zodra 'confirmingRevoke' weer false wordt.
  const trapRef = useFocusTrap<HTMLDivElement>(confirmingRevoke);

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

  const initial = email ? email.trim().charAt(0).toUpperCase() : '•';

  return (
    <div className="session-bar" ref={wrapperRef} onFocusOut={handleFocusOut}>
      {syncStatus ? (
        <SyncStatusIndicator lang={lang} status={syncStatus} fromCache={syncFromCache} />
      ) : null}
      <button
        type="button"
        ref={triggerRef}
        className="btn-outline session-bar__trigger"
        data-testid="account-menu-trigger"
        aria-haspopup="true"
        aria-expanded={menuOpen}
        aria-controls="account-menu"
        aria-label={translate(lang, 'accountMenuTriggerLabel')}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span aria-hidden="true">{initial}</span>
        <span aria-hidden="true" className="session-bar__caret">
          {menuOpen ? '▴' : '▾'}
        </span>
      </button>
      {menuOpen ? (
        <div
          id="account-menu"
          className="session-bar__menu"
          role="group"
          aria-label={translate(lang, 'accountMenuTriggerLabel')}
          data-testid="account-menu"
        >
          {email ? (
            <p className="session-bar__menu-account">
              <span className="session-bar__menu-caption">
                {translate(lang, 'accountMenuSignedInAs')}
              </span>
              <span
                className="session-bar__account"
                data-testid="session-account-email"
                title={email}
              >
                {email}
              </span>
            </p>
          ) : null}
          <button
            type="button"
            className="btn-outline session-bar__menu-item"
            data-testid="switch-context"
            onClick={() => {
              setMenuOpen(false);
              onSwitchContext();
            }}
          >
            {translate(lang, 'contextSwitcherSwitchBtn')}
          </button>
          <label className="session-bar__trusted-device">
            <input
              type="checkbox"
              data-testid="trusted-device-setting-toggle"
              checked={trustedDevice}
              onChange={handleTrustedDeviceToggle}
            />
            {translate(lang, 'trustedDeviceSettingLabel')}
          </label>
          <button
            type="button"
            className="btn-outline session-bar__menu-item session-bar__sign-out"
            data-testid="sign-out"
            onClick={() => {
              setMenuOpen(false);
              onSignOut();
            }}
          >
            {translate(lang, 'authSignOutBtn')}
          </button>
        </div>
      ) : null}
      {confirmingRevoke ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          className="modal-overlay"
          role="alertdialog"
          aria-label={translate(lang, 'trustedDeviceRevokeConfirmTitle')}
          aria-modal="true"
          onClick={() => setConfirmingRevoke(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setConfirmingRevoke(false);
          }}
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
          <div
            className="modal session-bar__trusted-device-confirm"
            role="document"
            ref={trapRef}
            data-testid="trusted-device-revoke-confirm"
            onClick={(e) => e.stopPropagation()}
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
        </div>
      ) : null}
    </div>
  );
}
