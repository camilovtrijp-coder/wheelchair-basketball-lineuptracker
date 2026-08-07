// Sync-status hook (PR 5.3c-2, schrijfcontract herzien in PR 5.3d na
// vervolgonderzoek). Leest de SyncState die repositories.settings/
// .roster.subscribe() al meeleveren (via onSettingsSync/onRosterSync, door
// App vanuit zijn bestaande 5.3c-1-subscribe-effect aangeroepen — geen tweede
// listener nodig) voor de wacht-op-synchronisatie ↔ gesynchroniseerd-
// overgangen (gebaseerd op onSnapshot's hasPendingWrites-metadata).
//
// write() zelf wacht NIET op de volledige serverbevestiging (zie
// domain/syncState.ts — setDoc() resolvet pas na ack en blijft offline
// onbeperkt pending) en retourneert dus vrijwel meteen `ok:true` zodra de
// write lokaal is geaccepteerd. Metadata alléén kan een afgewezen write
// echter niet van een succesvolle onderscheiden (bij afwijzing rolt
// Firestore de lokale waarde terug en wordt hasPendingWrites ook gewoon
// weer false) — daarom volgt saveSettings/saveRoster hieronder apart het
// `settled`-Promise van elke write om een échte afwijzing alsnog als
// actie-nodig te registreren, zonder de aanroeper daarop te laten wachten.
// `settled` reject nooit, dus de `.then()` hieronder kan nooit een
// unhandled rejection worden.
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
      if (!result.ok) {
        setPendingFor('settings', payload);
        return false;
      }
      // Niet awaiten: dat zou saveSettings() weer net zo lang laten
      // blokkeren als vóór dit contract. `settled` reject nooit.
      void result.settled.then((settled) => {
        setPendingFor('settings', settled.ok ? null : payload);
      });
      return true;
    },
    [repositories.settings, setPendingFor],
  );

  const saveRoster = useCallback(
    async (payload: Roster) => {
      const result = await repositories.roster.write(payload);
      if (!result.ok) {
        setPendingFor('roster', payload);
        return false;
      }
      void result.settled.then((settled) => {
        setPendingFor('roster', settled.ok ? null : payload);
      });
      return true;
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
