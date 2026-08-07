// Exporteert een geweigerde "Actie nodig"-payload als downloadbaar .json-
// bestand (PR 5.3c-2, docs/pr-5.3-plan.md §C/5.3c-2 punt 4). Gebruikt bewust
// dezelfde v1-back-up-`data`-envelop als docs/data-contracts.md
// §"JSON Back-up Contract" (type/version/exportedAt/data met de exacte
// v1-localStorage-key als subveld) — geen nieuw sidecar-formaat, zodat het
// fragment later via de bestaande v1-importflow herstelbaar is.
//
// buildPendingPayloadEnvelope() is puur en los getest; downloadPendingPayload()
// is de enige plek met DOM-bijwerkingen (Blob/URL/click).

import type { PendingAction } from '../../application/sync/useSyncStatus';

const V1_KEY_BY_KIND: Record<PendingAction['kind'], string> = {
  settings: 'lineup-tracker-settings',
  roster: 'lineup-tracker-roster',
};

export interface BackupEnvelope {
  type: 'lineup-tracker-backup';
  version: 1;
  exportedAt: string;
  data: Record<string, unknown>;
}

export function buildPendingPayloadEnvelope(
  item: PendingAction,
  now: () => string = () => new Date().toISOString(),
): BackupEnvelope {
  return {
    type: 'lineup-tracker-backup',
    version: 1,
    exportedAt: now(),
    data: {
      [V1_KEY_BY_KIND[item.kind]]: item.payload,
    },
  };
}

export function downloadPendingPayload(item: PendingAction): void {
  const envelope = buildPendingPayloadEnvelope(item);
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${item.kind}-actie-nodig-${Date.now()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
