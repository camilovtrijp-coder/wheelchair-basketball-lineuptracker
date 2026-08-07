// Sync-status hook (PR 5.3c-2). Leest de SyncState die repositories.settings/
// .roster.subscribe() al meeleveren (via onSettingsSync/onRosterSync, door
// App vanuit zijn bestaande 5.3c-1-subscribe-effect aangeroepen — geen tweede
// listener nodig) en houdt zelf de laatst-geweigerde payload per repository
// vast. write()-afwijzingen komen NIET via subscribe() binnen (Firestore
// meldt een geweigerde write alleen synchroon aan de aanroeper van write()),
// dus saveSettings/saveRoster hieronder wikkelen repositories.settings/
// roster.write() in en registreren een afwijzing zelf.
//
// De gecombineerde `status` toont het "ergste" van settings en roster
// (actie-nodig wint van wacht-op-synchronisatie wint van lokaal-beschikbaar
// wint van gesynchroniseerd) — één indicator in SessionBar i.p.v. twee.

import { useCallback, useState } from 'preact/hooks';
import type { AsyncRosterRepository } from '../roster/AsyncRosterRepository';
import type { AsyncSettingsRepository } from '../settings/AsyncSettingsRepository';
import type { Roster } from '../../domain/roster/types';
import type { Settings } from '../../domain/settings/types';
import type { SyncState, SyncStatus } from '../../domain/syncState';

export type SyncKind = 'settings' | 'roster';

export interface PendingAction {
  kind: SyncKind;
  payload: (Settings & Record<string, unknown>) | Roster;
}

export interface SyncStatusApi {
  status: SyncStatus;
  pending: PendingAction[];
  onSettingsSync: (sync: SyncState) => void;
  onRosterSync: (sync: SyncState) => void;
  saveSettings: (payload: Settings & Record<string, unknown>) => Promise<boolean>;
  saveRoster: (payload: Roster) => Promise<boolean>;
  retry: (kind: SyncKind) => Promise<void>;
  dismiss: (kind: SyncKind) => void;
}

const STATUS_PRIORITY: Record<SyncStatus, number> = {
  'actie-nodig': 3,
  'wacht-op-synchronisatie': 2,
  'lokaal-beschikbaar': 1,
  gesynchroniseerd: 0,
};

function worstStatus(a: SyncStatus, b: SyncStatus): SyncStatus {
  return STATUS_PRIORITY[a] >= STATUS_PRIORITY[b] ? a : b;
}

export function useSyncStatus(repositories: {
  settings: AsyncSettingsRepository;
  roster: AsyncRosterRepository;
}): SyncStatusApi {
  const [settingsBgStatus, setSettingsBgStatus] = useState<SyncStatus>('gesynchroniseerd');
  const [rosterBgStatus, setRosterBgStatus] = useState<SyncStatus>('gesynchroniseerd');
  const [pending, setPending] = useState<PendingAction[]>([]);

  const setPendingFor = useCallback((kind: SyncKind, payload: PendingAction['payload'] | null) => {
    setPending((prev) => {
      const withoutKind = prev.filter((p) => p.kind !== kind);
      return payload === null ? withoutKind : [...withoutKind, { kind, payload }];
    });
  }, []);

  const saveSettings = useCallback(
    async (payload: Settings & Record<string, unknown>) => {
      const result = await repositories.settings.write(payload);
      setPendingFor('settings', result.ok ? null : payload);
      return result.ok;
    },
    [repositories.settings, setPendingFor],
  );

  const saveRoster = useCallback(
    async (payload: Roster) => {
      const result = await repositories.roster.write(payload);
      setPendingFor('roster', result.ok ? null : payload);
      return result.ok;
    },
    [repositories.roster, setPendingFor],
  );

  const retry = useCallback(
    async (kind: SyncKind) => {
      const item = pending.find((p) => p.kind === kind);
      if (!item) return;
      if (kind === 'settings') {
        await saveSettings(item.payload as Settings & Record<string, unknown>);
      } else {
        await saveRoster(item.payload as Roster);
      }
    },
    [pending, saveSettings, saveRoster],
  );

  const dismiss = useCallback(
    (kind: SyncKind) => {
      setPendingFor(kind, null);
    },
    [setPendingFor],
  );

  const settingsPending = pending.some((p) => p.kind === 'settings');
  const rosterPending = pending.some((p) => p.kind === 'roster');
  const status = worstStatus(
    settingsPending ? 'actie-nodig' : settingsBgStatus,
    rosterPending ? 'actie-nodig' : rosterBgStatus,
  );

  return {
    status,
    pending,
    onSettingsSync: (sync) => setSettingsBgStatus(sync.status),
    onRosterSync: (sync) => setRosterBgStatus(sync.status),
    saveSettings,
    saveRoster,
    retry,
    dismiss,
  };
}
