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
import { FirestoreRosterRepository } from '../roster/FirestoreRosterRepository';
import { FirestoreSettingsRepository } from '../settings/FirestoreSettingsRepository';
import type { Firestore } from 'firebase/firestore';

export interface CloudRepositorySelection {
  kind: 'cloud';
  settings: AsyncSettingsRepository;
  roster: AsyncRosterRepository;
}

export type RepositorySelection = CloudRepositorySelection | { kind: 'local' };

export function selectRepositories(input: {
  authUser: AuthUser | null;
  selectedContext: SelectedContext | null;
  trustedDevice: boolean;
  firestoreDb: Firestore;
}): RepositorySelection {
  if (!input.authUser || !input.selectedContext || !input.trustedDevice) {
    return { kind: 'local' };
  }
  return {
    kind: 'cloud',
    settings: new FirestoreSettingsRepository(
      input.firestoreDb,
      input.selectedContext.orgId,
      input.selectedContext.teamId,
    ),
    roster: new FirestoreRosterRepository(
      input.firestoreDb,
      input.selectedContext.orgId,
      input.selectedContext.teamId,
    ),
  };
}
