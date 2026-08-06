import type { AuthUser } from '../auth/types';
import type { Membership, SelectedContext } from './types';

export type AppState =
  | { kind: 'not-logged-in' }
  | { kind: 'trusted-device-prompt' }
  | { kind: 'loading' }
  | { kind: 'uncached-offline' }
  | { kind: 'no-organizations'; reason: 'fresh-signup' | 'lost-all-memberships' }
  | { kind: 'context-switcher' }
  | { kind: 'selected-context-revoked' }
  | { kind: 'active' };

export interface DeriveAppStateInput {
  online: boolean;
  authUser: AuthUser | null;
  /** Of de vertrouwd-apparaatvraag al beantwoord is (moet vóór de eerste Firestore-read bekend zijn). */
  trustedDeviceAnswered: boolean;
  /** `null` = nog niet geladen (geen cache, geen serverrespons ontvangen). */
  memberships: Membership[] | null;
  selectedContext: SelectedContext | null;
  /** Of deze gebruiker ooit memberships heeft gehad, om een verse registratie te onderscheiden van intrekking. */
  hasEverHadMemberships: boolean;
}

/**
 * Eén beslispunt dat sessie/netwerk/membership-status vertaalt naar precies
 * één schermkeuze. Bewust geen check op e-mailverificatie: firestore.rules
 * eist `email_verified` alleen bij het claimen van een uitnodiging, niet bij
 * de zelfregistratie-bootstrap van een eerste organisatie — dat blijft dus
 * schermlokale logica in de uitnodigingsflow, niet hier.
 */
export function deriveAppState(input: DeriveAppStateInput): AppState {
  if (input.authUser === null) {
    return { kind: 'not-logged-in' };
  }
  if (!input.trustedDeviceAnswered) {
    return { kind: 'trusted-device-prompt' };
  }
  if (input.memberships === null) {
    return input.online ? { kind: 'loading' } : { kind: 'uncached-offline' };
  }
  if (input.memberships.length === 0) {
    return {
      kind: 'no-organizations',
      reason: input.hasEverHadMemberships ? 'lost-all-memberships' : 'fresh-signup',
    };
  }
  if (input.selectedContext !== null) {
    const selected = input.selectedContext;
    const stillValid = input.memberships.some((m) => m.orgId === selected.orgId);
    return stillValid ? { kind: 'active' } : { kind: 'selected-context-revoked' };
  }
  return { kind: 'context-switcher' };
}
