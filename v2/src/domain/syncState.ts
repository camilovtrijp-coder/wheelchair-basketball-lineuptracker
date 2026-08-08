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

// PR 5.3d-vervolgonderzoek: write() mag NIET op de volledige backend-ack
// wachten voordat de aanroeper iets terugkrijgt — de Firestore Web SDK
// resolvet setDoc() pas na serverbevestiging en blijft offline onbeperkt
// pending, terwijl de write lokaal al via latency compensation is toegepast
// (zichtbaar via onSnapshot/hasPendingWrites, zie
// FirestoreSettingsRepository.subscribe()). write() retourneert daarom
// meteen het lokale resultaat (`ok`/`syncState`) plus een apart `settled`-
// Promise voor wie de uiteindelijke serverbevestiging wél wil afwachten.
// `settled` is een `Promise<WriteSettled>` die NOOIT reject — dat is een
// garantie van dít contract (elke adapter's write() moet setDoc()/
// gelijkwaardige serverbevestiging zelf in een .then()-paar vangen, zie
// FirestoreSettingsRepository.write()), niet iets dat de onderliggende
// SDK-call uit zichzelf biedt. Een afwijzing wordt vertaald naar
// `{ok:false, error}`, zodat een aanroeper 'm zonder eigen try/catch kan
// negeren zonder een unhandled rejection te riskeren.
export interface WriteSettled {
  ok: boolean;
  error?: unknown;
}

export interface WriteResult {
  ok: boolean;
  syncState: SyncState;
  error?: unknown;
  settled: Promise<WriteSettled>;
}
