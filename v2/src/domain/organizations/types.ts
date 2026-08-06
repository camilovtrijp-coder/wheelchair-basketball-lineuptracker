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

/**
 * Eén organisatiecontext van de ingelogde gebruiker, zoals getoond in de contextwisselaar.
 * `role` is `null` voor een team-only groep (issue #31): een organisatie waar deze gebruiker
 * uitsluitend via één of meer expliciete `teamMembers`-documenten toegang toe heeft, zonder
 * eigen `organizationMembers`-document. Zulke groepen worden door AuthGate opgebouwd uit
 * `listMyTeamOnlyContexts()` (zie `TeamOnlyContext` hieronder), niet uit `listMyMemberships()`.
 */
export interface Membership {
  orgId: string;
  orgName: string;
  role: OrganizationRole | null;
}

export interface TeamSummary {
  teamId: string;
  name: string;
}

/**
 * Eén team waar de ingelogde gebruiker toegang toe heeft via een expliciet `teamMembers`-
 * document, ONAFHANKELIJK van een eventueel `organizationMembers`-document (issue #31) —
 * het resultaat van `listMyTeamOnlyContexts()`. Bevat, anders dan `Membership`+`TeamSummary`,
 * altijd al de teamrol: voor een team-only context is er geen aparte `getMyTeamAccess()`-call
 * nodig (en die zou voor zo'n gebruiker ook niet altijd mogelijk zijn — zie ContextSwitcher).
 */
export interface TeamOnlyContext {
  orgId: string;
  orgName: string;
  teamId: string;
  teamName: string;
  role: OrganizationRole;
}

export interface SelectedContext {
  orgId: string;
  teamId: string;
}
