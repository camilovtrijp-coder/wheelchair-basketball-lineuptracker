// Niet-opdringerige syncstatus-badge (PR 5.3c-2). Wordt door App/AuthGate
// uitsluitend gerenderd wanneer mode==='cloud' — lokale modus heeft niets om
// te syncen, "Gesynchroniseerd" tonen zonder cloud zou misleidend zijn (zie
// docs/pr-5.3-plan.md §C/5.3c-2 punt 2).

import { translate, type Lang, type StringKey } from '../../i18n/strings';
import type { SyncStatus } from '../../domain/syncState';

export interface SyncStatusIndicatorProps {
  lang: Lang;
  status: SyncStatus;
  fromCache?: boolean;
}

const KEY_BY_STATUS: Record<SyncStatus, StringKey> = {
  'lokaal-beschikbaar': 'syncStatusLocal',
  'wacht-op-synchronisatie': 'syncStatusPending',
  gesynchroniseerd: 'syncStatusSynced',
  'actie-nodig': 'syncStatusActionNeeded',
};

export function SyncStatusIndicator({ lang, status, fromCache = false }: SyncStatusIndicatorProps) {
  return (
    <span
      className={`sync-status-indicator sync-status-indicator--${status}`}
      data-testid="sync-status-indicator"
      data-status={status}
    >
      {translate(lang, KEY_BY_STATUS[status])}
      {fromCache ? ` · ${translate(lang, 'syncStatusFromCache')}` : null}
    </span>
  );
}
