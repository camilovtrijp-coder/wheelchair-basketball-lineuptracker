// 4-statencontract uit ADR-002, afgeleid uit Firestore's SnapshotMetadata.
//
// 'actie-nodig' wordt NIET afgeleid uit metadata; de adapter zet dit expliciet wanneer
// een write-promise na reconnect alsnog afwijst (bijv. door een ingetrokken membership
// of een Rules-afwijzing). De afleiding dekt de andere drie toestanden.
//
// Geen firebase-import: dit type leeft in de domeinlaag en mag in elke laag gebruikt
// worden zonder een storage-implementatie te kennen (zelfde patroon als Roster/Settings).

export type SyncStatus =
  'lokaal-beschikbaar' | 'wacht-op-synchronisatie' | 'gesynchroniseerd' | 'actie-nodig';

export interface SyncState {
  status: SyncStatus;
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export function deriveSyncState(meta: {
  fromCache: boolean;
  hasPendingWrites: boolean;
}): SyncState {
  if (meta.hasPendingWrites) {
    return {
      status: 'wacht-op-synchronisatie',
      fromCache: meta.fromCache,
      hasPendingWrites: true,
    };
  }
  if (meta.fromCache) {
    return { status: 'lokaal-beschikbaar', fromCache: true, hasPendingWrites: false };
  }
  return { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };
}
