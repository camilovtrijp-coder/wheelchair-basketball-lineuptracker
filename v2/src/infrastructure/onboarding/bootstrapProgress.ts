import type { KeyValueStorage } from '../../i18n/persistence';

export const BOOTSTRAP_ORG_ID_STORAGE_KEY = 'lineup-tracker-bootstrap-org-id';

/**
 * Onthoudt het `orgId` van een organisatie waarvan de create-write is gestart (mogelijk zelfs
 * al gecommit) maar waarvan de owner-membership nog niet bevestigd is — puur componentstate
 * overleeft geen reload/crash halverwege de onboarding-flow. `null` betekent: geen onvoltooide
 * bootstrap bekend (nieuwe poging mag gewoon een nieuwe organisatie maken).
 */
export function readBootstrapOrgId(storage: KeyValueStorage): string | null {
  return storage.getItem(BOOTSTRAP_ORG_ID_STORAGE_KEY);
}

export function writeBootstrapOrgId(storage: KeyValueStorage, orgId: string): void {
  storage.setItem(BOOTSTRAP_ORG_ID_STORAGE_KEY, orgId);
}

export function clearBootstrapOrgId(storage: KeyValueStorage): void {
  storage.removeItem(BOOTSTRAP_ORG_ID_STORAGE_KEY);
}
