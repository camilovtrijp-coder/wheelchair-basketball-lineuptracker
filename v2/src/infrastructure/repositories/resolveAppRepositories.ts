// Vertaalt de kind-op-mode-keuze van selectRepositories() naar concrete
// repository's die App altijd via de async-poort kan gebruiken (PR 5.3c-1,
// docs/pr-5.3-plan.md §C/5.3c-1). selectRepositories() zelf blijft
// ongewijzigd — dit is een dunne laag erbovenop, geen vervanging.
//
// Bij kind:'local' bouwt dit de nieuwe LocalAsync*Repository-wrappers rond
// verse LocalStorage*Repository-instanties; bij kind:'cloud' geeft het de
// Firestore-adapters uit de selectie ongewijzigd door. `mode` blijft
// beschikbaar zodat de UI (indicator, cloud-import-banner) weet welke van de
// twee actief is zonder zelf opnieuw te hoeven beslissen.

import type { AsyncRosterRepository } from '../../application/roster/AsyncRosterRepository';
import type { AsyncSettingsRepository } from '../../application/settings/AsyncSettingsRepository';
import type { GameSyncCoordinator } from '../../application/game/GameSyncCoordinator';
import type { GameCloudWriterContext } from '../../application/game/projectGameForCloud';
import type { KeyValueStorage } from '../../i18n/persistence';
import type { RepositorySelection } from './selectRepositories';
import { LocalAsyncRosterRepository } from '../roster/LocalAsyncRosterRepository';
import { LocalStorageRosterRepository } from '../roster/LocalStorageRosterRepository';
import { LocalAsyncSettingsRepository } from '../settings/LocalAsyncSettingsRepository';
import { LocalStorageSettingsRepository } from '../settings/LocalStorageSettingsRepository';

export interface ResolvedAppRepositories {
  mode: 'local' | 'cloud';
  settings: AsyncSettingsRepository;
  roster: AsyncRosterRepository;
  /** PR 7.1c: `null` in lokale modus — App roept dan nooit cloud-sync aan voor wedstrijden. */
  gameSync: GameSyncCoordinator | null;
  gameWriterContext: GameCloudWriterContext | null;
}

export function resolveAppRepositories(
  selection: RepositorySelection,
  storage: KeyValueStorage,
): ResolvedAppRepositories {
  if (selection.kind === 'cloud') {
    return {
      mode: 'cloud',
      settings: selection.settings,
      roster: selection.roster,
      gameSync: selection.gameSync,
      gameWriterContext: selection.gameWriterContext,
    };
  }
  return {
    mode: 'local',
    settings: new LocalAsyncSettingsRepository(new LocalStorageSettingsRepository(storage)),
    roster: new LocalAsyncRosterRepository(new LocalStorageRosterRepository(storage)),
    gameSync: null,
    gameWriterContext: null,
  };
}
