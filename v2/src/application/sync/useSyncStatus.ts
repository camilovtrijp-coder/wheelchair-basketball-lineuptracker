// Sync-status hook (PR 5.3c-2, schrijfcontract herzien in PR 5.3d na
// vervolgonderzoek, indicator-update herzien na het PR 5.3d-onderzoeksrapport
// §H "label-gebrek"). repositories.settings/.roster.subscribe() leveren een
// SyncState mee (via onSettingsSync/onRosterSync, door App vanuit zijn
// bestaande 5.3c-1-subscribe-effect aangeroepen) op basis van onSnapshot's
// hasPendingWrites-metadata — dat blijft de bron voor externe wijzigingen
// (een ander apparaat/tabblad dat hetzelfde document wijzigt).
//
// VOOR een eigen write() geldt dat NIET meer exclusief: zowel in de
// PR 5.3d-sandboxdiagnostiek (zie domain/syncState.ts en het
// onderzoeksrapport §A) als in een handmatige test op een echt apparaat
// (rapport §H) bleek de onSnapshot-listener op het beschreven document na
// een offline write geen (tijdige) nieuwe snapshot af te leveren — de
// indicator bleef dan "bevroren" op de waarde van vóór de write, in plaats
// van naar wacht-op-synchronisatie te springen. saveSettings/saveRoster
// zetten de bg-status daarom voortaan zelf, direct vanuit write()'s eigen
// `syncState` (meteen na de call) en vanuit `settled`'s uitkomst (zodra de
// server bevestigt) — zonder daarbij op een listener-event te wachten. Komt
// de listener alsnog (tijdig) met dezelfde waarde, dan is die update een
// no-op (identieke state, geen extra render).
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
//
// GENERATIETELLER (onafhankelijke review op PR #36, 8 aug. 2026): elke
// saveSettings/saveRoster-aanroep en elke dismiss() verhoogt een teller per
// kind. Een `settled`-callback past `pending`/de bg-status alleen toe als
// zijn eigen teller nog gelijk is aan de HUIDIGE teller op het moment dat
// hij resolvet. Dat lost twee dingen tegelijk op: (1) dismiss() annuleert
// een later alsnog binnenkomende afwijzing van precies de gedismisste write
// (zonder teller zou die de net opgeruimde pending-entry stilzwijgend
// terugzetten — een UX-flicker); (2) een tweede save vóórdat de eerste
// settled is, "wint" — de eerste write se uiteindelijke uitkomst wordt
// genegeerd zodra er een nieuwere write voor hetzelfde kind loopt. Omdat elke
// save() de VOLLEDIGE document-snapshot verstuurt (geen patch) en de UI die
// snapshot opbouwt uit de actuele in-memory staat (die eerdere, nog niet
// bevestigde edits al bevat), draagt de nieuwere write de inhoud van de
// oudere al mee — dit voorkomt dat een trage afwijzing van write A een
// inmiddels door write B overschreven/ingehaalde staat alsnog als
// "actie-nodig" bestempelt. Dit lost NIET het bredere ontwerpvraagstuk op
// van een expliciete wachtrij/merge van meerdere gelijktijdig-pending writes
// — dat blijft een aparte afweging (zie PR #36-reviewnotities).
// isMountedRef voorkomt een state-update op een reeds ontkoppelde hook-
// instance (bijv. na een contextwissel/uitloggen terwijl een `settled` nog
// niet is opgelost — die kan minuten blijven hangen als het apparaat
// offline blijft).

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { AsyncRosterRepository } from '../roster/AsyncRosterRepository';
import type { AsyncSettingsRepository } from '../settings/AsyncSettingsRepository';
import type { Roster } from '../../domain/roster/types';
import { DEFAULT_SETTINGS, type Settings, type SettingsKey } from '../../domain/settings/types';
import type { SyncState, SyncStatus } from '../../domain/syncState';

export type SyncKind = 'settings' | 'roster';

export interface PendingAction {
  kind: SyncKind;
  payload: (Settings & Record<string, unknown>) | Roster;
  settingsChangedKeys?: readonly SettingsKey[];
}

export interface SyncStatusApi {
  status: SyncStatus;
  fromCache: boolean;
  pending: PendingAction[];
  onSettingsSync: (sync: SyncState) => void;
  onRosterSync: (sync: SyncState) => void;
  saveSettings: (
    payload: Settings & Record<string, unknown>,
    changedKeys?: readonly SettingsKey[],
  ) => Promise<boolean>;
  saveRoster: (payload: Roster) => Promise<boolean>;
  resetSettings: () => Promise<Settings & Record<string, unknown>>;
  retry: (kind: SyncKind) => Promise<void>;
  dismiss: (kind: SyncKind) => void;
}

const STATUS_PRIORITY: Record<SyncStatus, number> = {
  'actie-nodig': 3,
  'wacht-op-synchronisatie': 2,
  'lokaal-beschikbaar': 1,
  gesynchroniseerd: 0,
};

const SYNCED_STATE: SyncState = {
  status: 'gesynchroniseerd',
  fromCache: false,
  hasPendingWrites: false,
};

function settingsPendingAction(
  payload: Settings & Record<string, unknown>,
  changedKeys?: readonly SettingsKey[],
): PendingAction {
  return changedKeys === undefined
    ? { kind: 'settings', payload }
    : { kind: 'settings', payload, settingsChangedKeys: changedKeys };
}

function worstStatus(a: SyncStatus, b: SyncStatus): SyncStatus {
  return STATUS_PRIORITY[a] >= STATUS_PRIORITY[b] ? a : b;
}

export function useSyncStatus(repositories: {
  settings: AsyncSettingsRepository;
  roster: AsyncRosterRepository;
}): SyncStatusApi {
  const [settingsBgState, setSettingsBgState] = useState<SyncState>(SYNCED_STATE);
  const [rosterBgState, setRosterBgState] = useState<SyncState>(SYNCED_STATE);
  const [pending, setPending] = useState<PendingAction[]>([]);

  const isMountedRef = useRef(true);
  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  const settingsGenerationRef = useRef(0);
  const rosterGenerationRef = useRef(0);

  const setPendingFor = useCallback((kind: SyncKind, item: PendingAction | null) => {
    setPending((prev) => {
      const withoutKind = prev.filter((p) => p.kind !== kind);
      return item === null ? withoutKind : [...withoutKind, item];
    });
  }, []);

  const saveSettings = useCallback(
    async (payload: Settings & Record<string, unknown>, changedKeys?: readonly SettingsKey[]) => {
      const generation = ++settingsGenerationRef.current;
      const isCurrent = () => isMountedRef.current && generation === settingsGenerationRef.current;

      const result =
        changedKeys === undefined
          ? await repositories.settings.write(payload)
          : await repositories.settings.write(payload, changedKeys);
      if (!result.ok) {
        if (isCurrent()) setPendingFor('settings', settingsPendingAction(payload, changedKeys));
        return false;
      }
      // Zie headercommentaar: niet louter op de subscribe()-listener
      // vertrouwen voor de wacht-op-synchronisatie-overgang — die bleek na
      // een offline write niet betrouwbaar (tijdig) te vuren.
      if (isCurrent()) setSettingsBgState(result.syncState);
      // Niet awaiten: dat zou saveSettings() weer net zo lang laten
      // blokkeren als vóór dit contract. `settled` reject nooit.
      void result.settled.then((settled) => {
        if (!isCurrent()) return;
        setPendingFor('settings', settled.ok ? null : settingsPendingAction(payload, changedKeys));
        if (settled.ok) {
          setSettingsBgState(SYNCED_STATE);
        }
      });
      return true;
    },
    [repositories.settings, setPendingFor],
  );

  const saveRoster = useCallback(
    async (payload: Roster) => {
      const generation = ++rosterGenerationRef.current;
      const isCurrent = () => isMountedRef.current && generation === rosterGenerationRef.current;

      const result = await repositories.roster.write(payload);
      if (!result.ok) {
        if (isCurrent()) setPendingFor('roster', { kind: 'roster', payload });
        return false;
      }
      if (isCurrent()) setRosterBgState(result.syncState);
      void result.settled.then((settled) => {
        if (!isCurrent()) return;
        setPendingFor('roster', settled.ok ? null : { kind: 'roster', payload });
        if (settled.ok) {
          setRosterBgState(SYNCED_STATE);
        }
      });
      return true;
    },
    [repositories.roster, setPendingFor],
  );

  // Reset gaat bewust via saveSettings (i.p.v. rechtstreeks repo.reset() aan
  // te roepen, zoals vóór deze fix) zodat een server-afwijzing van de reset
  // dezelfde pending/actie-nodig-afhandeling krijgt als een gewone save —
  // reset() op de adapter zelf observeert `settled` nergens.
  const resetSettings = useCallback(async () => {
    const defaults: Settings & Record<string, unknown> = { ...DEFAULT_SETTINGS };
    await saveSettings(defaults);
    return defaults;
  }, [saveSettings]);

  const retry = useCallback(
    async (kind: SyncKind) => {
      const item = pending.find((p) => p.kind === kind);
      if (!item) return;
      if (kind === 'settings') {
        await saveSettings(
          item.payload as Settings & Record<string, unknown>,
          item.settingsChangedKeys,
        );
      } else {
        await saveRoster(item.payload as Roster);
      }
    },
    [pending, saveSettings, saveRoster],
  );

  // Verhoogt ook de generatieteller (zie headercommentaar): een `settled`
  // die nog onderweg was voor precies déze pending-entry mag 'm na dismiss
  // niet alsnog terugzetten. Zet de bg-status expliciet terug naar
  // gesynchroniseerd — zonder dat zou de indicator op de laatst gezette
  // waarde (typisch wacht-op-synchronisatie) blijven "hangen" na dismiss.
  const dismiss = useCallback(
    (kind: SyncKind) => {
      if (kind === 'settings') {
        settingsGenerationRef.current += 1;
        setSettingsBgState(SYNCED_STATE);
      } else {
        rosterGenerationRef.current += 1;
        setRosterBgState(SYNCED_STATE);
      }
      setPendingFor(kind, null);
    },
    [setPendingFor],
  );

  const onSettingsSync = useCallback((sync: SyncState) => setSettingsBgState(sync), []);
  const onRosterSync = useCallback((sync: SyncState) => setRosterBgState(sync), []);

  const settingsPending = pending.some((p) => p.kind === 'settings');
  const rosterPending = pending.some((p) => p.kind === 'roster');
  const status = worstStatus(
    settingsPending ? 'actie-nodig' : settingsBgState.status,
    rosterPending ? 'actie-nodig' : rosterBgState.status,
  );
  const fromCache = settingsBgState.fromCache || rosterBgState.fromCache;

  return {
    status,
    fromCache,
    pending,
    onSettingsSync,
    onRosterSync,
    saveSettings,
    saveRoster,
    resetSettings,
    retry,
    dismiss,
  };
}
