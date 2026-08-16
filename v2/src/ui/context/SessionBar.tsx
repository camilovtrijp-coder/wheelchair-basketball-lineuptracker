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
}: SessionBarProps) {
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
      <button type="button" data-testid="switch-context" onClick={onSwitchContext}>
        {translate(lang, 'contextSwitcherSwitchBtn')}
      </button>
      <button type="button" data-testid="sign-out" onClick={onSignOut}>
        {translate(lang, 'authSignOutBtn')}
      </button>
    </div>
  );
}
