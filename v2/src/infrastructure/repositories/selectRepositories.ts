// Adapter-selectie: één bron van waarheid voor "welke repository-instantie is
// actief". De UI en de wiring-importeur (5.3c) lezen deze functie, NIET een
// eigen ternaire met `online` erbij.
//
// Architecturaal bindend (zie docs/pr-5.3-plan.md §C/5.3a punt 1 + de
// architectuur-review): de keuze is `authUser && selectedContext && trustedDevice`.
// `online` is GEEN schakelcriterium — een cloud-only team heeft geen
// v1-localStorage-data; een fallback naar localStorage bij offline zou een lege
// of verouderde dataset tonen en de #27-garantie (cache blijft zichtbaar na
// offline reload) onmogelijk maken. Binnen de Firestore-modus handelt
// persistentLocalCache het offline-gedrag zelf af; ongecachet offline valt
// buiten deze functie (de bestaande OfflineUncachedScreen uit AuthGate
// vangt dat op — geen fallback-datasource).
//
// Bij "geen cloud" retourneert de functie `null` zodat de aanroeper (5.3c) zelf
// de localStorage-adapters kan instantiëren — hier bewust geen beslissing
// forceren, alleen de cloud-vs-niet-cloud-vraag beantwoorden.

import type { AuthUser } from '../../domain/auth/types';
import type { SelectedContext } from '../../domain/organizations/types';
import type { AsyncRosterRepository } from '../../application/roster/AsyncRosterRepository';
import type { AsyncSettingsRepository } from '../../application/settings/AsyncSettingsRepository';
import type { CompletedGameRepository } from '../../application/game/CompletedGameRepository';
import type { GameCloudWriterContext } from '../../application/game/projectGameForCloud';
import { GameSyncCoordinator } from '../../application/game/GameSyncCoordinator';
import { FirestoreRosterRepository } from '../roster/FirestoreRosterRepository';
import { FirestoreSettingsRepository } from '../settings/FirestoreSettingsRepository';
import { FirestoreGameCloudGateway } from '../game/FirestoreGameCloudGateway';
import { FirestoreCompletedGameRepository } from '../game/FirestoreCompletedGameRepository';
import { CompositeCompletedGameRepository } from '../game/CompositeCompletedGameRepository';
import { LocalStorageCompletedGameRepository } from '../game/LocalStorageCompletedGameRepository';
import { LocalStorageGameSyncCheckpointRepository } from '../game/LocalStorageGameSyncCheckpointRepository';
import { readOrCreateDeviceId } from '../device/deviceId';
import { strictReadBrowserStorage } from '../../i18n/browserStorage';
import type { KeyValueStorage } from '../../i18n/persistence';
import type { Firestore } from 'firebase/firestore';

export interface CloudRepositorySelection {
  kind: 'cloud';
  settings: AsyncSettingsRepository;
  roster: AsyncRosterRepository;
  /**
   * PR 7.1c: orkestreert wedstrijd-cloud-sync (docs/pr-7.1-plan.md §C 7.1c).
   * `GameRepository`/`gameRepo` zelf blijft buiten deze functie (zie
   * `app/App.tsx` — dat instantieert de synchrone lokale actielog nog steeds
   * rechtstreeks); dit levert alleen de cloudkant die App optioneel
   * aanroept na elke lokale wedstrijdwrite.
   */
  gameSync: GameSyncCoordinator;
  gameWriterContext: GameCloudWriterContext;
  /**
   * PR 7.2b (docs/pr-7.2-plan.md §C 7.2b): samengestelde lokaal+cloud-
   * historie, achter dezelfde `CompletedGameRepository`-poort als de
   * lokale-modus-variant — zie `CompositeCompletedGameRepository`. Gebruikt
   * bewust `strictReadBrowserStorage` voor de lokale helft, niet
   * `input.storage` (net als `app/App.tsx`'s bestaande
   * `LocalStorageCompletedGameRepository`/`LocalStoragePendingFinalizeRepository`
   * — een onbeschikbare/falende storage-GETTER moet hier een echte leesfout
   * blijven, geen stille lege lijst, zie `i18n/browserStorage.ts`).
   */
  completedGames: CompletedGameRepository;
}

export type RepositorySelection = CloudRepositorySelection | { kind: 'local' };

export function selectRepositories(input: {
  authUser: AuthUser | null;
  selectedContext: SelectedContext | null;
  trustedDevice: boolean;
  firestoreDb: Firestore;
  storage: KeyValueStorage;
}): RepositorySelection {
  if (!input.authUser || !input.selectedContext || !input.trustedDevice) {
    return { kind: 'local' };
  }
  const gateway = new FirestoreGameCloudGateway(input.firestoreDb);
  const checkpoints = new LocalStorageGameSyncCheckpointRepository(input.storage);
  const { orgId, teamId } = input.selectedContext;
  return {
    kind: 'cloud',
    settings: new FirestoreSettingsRepository(input.firestoreDb, orgId, teamId),
    roster: new FirestoreRosterRepository(input.firestoreDb, orgId, teamId),
    gameSync: new GameSyncCoordinator({ gateway, checkpoints }),
    completedGames: new CompositeCompletedGameRepository(
      new LocalStorageCompletedGameRepository(strictReadBrowserStorage, orgId, teamId),
      new FirestoreCompletedGameRepository(input.firestoreDb, orgId, teamId),
    ),
    gameWriterContext: {
      authorUid: input.authUser.uid,
      // writerEpoch blijft vast op 0 vóór PR 7.3 (epoch-increment is
      // overname-scope, zie GameSyncCoordinator/ADR-002 punt 3).
      deviceId: readOrCreateDeviceId(input.storage),
      writerEpoch: 0,
    },
  };
}
