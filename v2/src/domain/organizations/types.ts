export { ORGANIZATION_ROLES } from 'firebase-base/documents';
export type { OrganizationRole } from 'firebase-base/documents';

import type { OrganizationRole } from 'firebase-base/documents';

/** Eén organisatielidmaatschap van de ingelogde gebruiker, zoals getoond in de contextwisselaar. */
export interface Membership {
  orgId: string;
  orgName: string;
  role: OrganizationRole;
}

export interface TeamSummary {
  teamId: string;
  name: string;
}

export interface SelectedContext {
  orgId: string;
  teamId: string;
}
