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
}

/**
 * Dunne balk náást (niet in) `App` — zo blijft `App.tsx` zelf ongewijzigd
 * terwijl er toch een uitlog- en contextwisselknop beschikbaar zijn zodra
 * er een actieve sessie is. Vervangt ui/auth/SignOutBar.tsx uit stap 5: die
 * had alleen uitloggen, dit is dezelfde balk met de wisselknop erbij.
 */
export function SessionBar({ lang, onSignOut, onSwitchContext, syncStatus }: SessionBarProps) {
  return (
    <div className="session-bar">
      {syncStatus ? <SyncStatusIndicator lang={lang} status={syncStatus} /> : null}
      <button type="button" data-testid="switch-context" onClick={onSwitchContext}>
        {translate(lang, 'contextSwitcherSwitchBtn')}
      </button>
      <button type="button" data-testid="sign-out" onClick={onSignOut}>
        {translate(lang, 'authSignOutBtn')}
      </button>
    </div>
  );
}
