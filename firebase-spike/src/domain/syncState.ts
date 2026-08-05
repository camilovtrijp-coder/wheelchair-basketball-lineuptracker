// 4-statencontract uit ADR-002, afgeleid uit Firestore's SnapshotMetadata.

export type SyncStatus =
  | 'lokaal-beschikbaar'
  | 'wacht-op-synchronisatie'
  | 'gesynchroniseerd'
  | 'actie-nodig';

export interface SyncState {
  status: SyncStatus;
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export function deriveSyncState(meta: {
  fromCache: boolean;
  hasPendingWrites: boolean;
}): SyncState {
  if (meta.hasPendingWrites)
    return { status: 'wacht-op-synchronisatie', fromCache: meta.fromCache, hasPendingWrites: true };
  if (meta.fromCache)
    return { status: 'lokaal-beschikbaar', fromCache: true, hasPendingWrites: false };
  return { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };
  // 'actie-nodig' wordt NIET afgeleid uit metadata; de adapter zet dit expliciet wanneer
  // een write-promise na reconnect alsnog afwijst (bijv. door een ingetrokken membership).
}
