/**
 * Rollen zoals gebruikt in organizationMembers/teamMembers. Moet gelijk
 * blijven aan firebase/src/documents/organizationMember.ts' ORGANIZATION_ROLES
 * — bewust hier onafhankelijk gedupliceerd i.p.v. geïmporteerd, want domain/
 * blijft volledig vrij van elke package-afhankelijkheid (firebase-spike/
 * tsconfig.json's `../v2/src/domain/**\/*.ts`-include dwingt dat af: de
 * spike kan firebase-base niet resolven, en domain/ moet dus ook zonder
 * kunnen type-checken). infrastructure/organizations/FirestoreOrganizationGateway.ts
 * gebruikt wél rechtstreeks firebase-base/documents als bron van waarheid
 * voor de daadwerkelijke Firestore-converters/-validatie; hier gaat het
 * alleen om de naamlijst van rollen, wat triviaal in sync te houden is (zie
 * tests/unit/organizationRoles.spec.ts).
 */
export const ORGANIZATION_ROLES = [
  'organizationOwner',
  'organizationAdmin',
  'coach',
  'scorer',
  'viewer',
] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

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
