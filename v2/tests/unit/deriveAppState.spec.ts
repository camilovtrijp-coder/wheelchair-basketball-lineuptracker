import { describe, it, expect } from 'vitest';
import {
  deriveAppState,
  type DeriveAppStateInput,
} from '../../src/domain/organizations/deriveAppState';
import type { AuthUser } from '../../src/domain/auth/types';
import type { Membership } from '../../src/domain/organizations/types';

const user: AuthUser = { uid: 'uid-alice', email: 'alice@example.test', emailVerified: true };

const rotterdam: Membership = {
  orgId: 'org-rotterdam',
  orgName: 'Rotterdam Basketball',
  role: 'organizationOwner',
};
const nbb: Membership = {
  orgId: 'org-nbb',
  orgName: 'Nederlandse Basketball Bond',
  role: 'viewer',
};

function input(overrides: Partial<DeriveAppStateInput> = {}): DeriveAppStateInput {
  return {
    online: true,
    authUser: user,
    trustedDeviceAnswered: true,
    memberships: [rotterdam],
    selectedContext: null,
    selectedContextTeamValid: true,
    hasEverHadMemberships: true,
    ...overrides,
  };
}

describe('domain/organizations/deriveAppState', () => {
  it('niet ingelogd wint van alle andere velden', () => {
    expect(deriveAppState(input({ authUser: null, online: false }))).toEqual({
      kind: 'not-logged-in',
    });
  });

  it('vraagt om het vertrouwd-apparaatantwoord vóórdat memberships worden geladen', () => {
    expect(deriveAppState(input({ trustedDeviceAnswered: false, memberships: null }))).toEqual({
      kind: 'trusted-device-prompt',
    });
  });

  it('toont loading als memberships nog niet geladen zijn maar er netwerk is', () => {
    expect(deriveAppState(input({ memberships: null, online: true }))).toEqual({ kind: 'loading' });
  });

  it('vraagt expliciet om netwerk bij een ongecachete context zonder verbinding', () => {
    expect(deriveAppState(input({ memberships: null, online: false }))).toEqual({
      kind: 'uncached-offline',
    });
  });

  it('onderscheidt een verse registratie zonder organisaties van het verliezen van alle memberships', () => {
    expect(deriveAppState(input({ memberships: [], hasEverHadMemberships: false }))).toEqual({
      kind: 'no-organizations',
      reason: 'fresh-signup',
    });
    expect(deriveAppState(input({ memberships: [], hasEverHadMemberships: true }))).toEqual({
      kind: 'no-organizations',
      reason: 'lost-all-memberships',
    });
  });

  it('toont de contextwisselaar als er memberships zijn maar nog geen context gekozen is', () => {
    expect(deriveAppState(input({ memberships: [rotterdam, nbb], selectedContext: null }))).toEqual(
      {
        kind: 'context-switcher',
      },
    );
  });

  it('is actief als de gekozen context nog in de membershiplijst voorkomt', () => {
    expect(
      deriveAppState(
        input({
          memberships: [rotterdam, nbb],
          selectedContext: { orgId: 'org-rotterdam', teamId: 'team-1' },
        }),
      ),
    ).toEqual({ kind: 'active' });
  });

  it('markeert de gekozen context als ingetrokken zodra deze niet meer in de membershiplijst voorkomt', () => {
    expect(
      deriveAppState(
        input({
          memberships: [nbb],
          selectedContext: { orgId: 'org-rotterdam', teamId: 'team-1' },
        }),
      ),
    ).toEqual({ kind: 'selected-context-revoked' });
  });

  it('intrekking bij organisatie A laat de gekozen context bij organisatie B ongemoeid (isolatie)', () => {
    const stateWithBothOrgs = deriveAppState(
      input({
        memberships: [rotterdam, nbb],
        selectedContext: { orgId: 'org-nbb', teamId: 'team-2' },
      }),
    );
    const stateAfterRotterdamRevoked = deriveAppState(
      input({
        memberships: [nbb],
        selectedContext: { orgId: 'org-nbb', teamId: 'team-2' },
      }),
    );
    expect(stateWithBothOrgs).toEqual({ kind: 'active' });
    expect(stateAfterRotterdamRevoked).toEqual({ kind: 'active' });
  });

  it('toont loading zolang de teamtoegang van de gekozen context nog gecontroleerd wordt', () => {
    expect(
      deriveAppState(
        input({
          memberships: [rotterdam],
          selectedContext: { orgId: 'org-rotterdam', teamId: 'team-1' },
          selectedContextTeamValid: null,
        }),
      ),
    ).toEqual({ kind: 'loading' });
  });

  it('markeert de context als ingetrokken als het organisatiemembership nog bestaat maar de teamtoegang niet meer geldig is (bijv. teamMembers-document verwijderd, of team zelf niet-bestaand)', () => {
    expect(
      deriveAppState(
        input({
          memberships: [rotterdam],
          selectedContext: { orgId: 'org-rotterdam', teamId: 'team-1' },
          selectedContextTeamValid: false,
        }),
      ),
    ).toEqual({ kind: 'selected-context-revoked' });
  });

  it('org-validatie gaat vóór team-validatie: bij een ingetrokken organisatie wordt de teamcheck niet afgewacht', () => {
    expect(
      deriveAppState(
        input({
          memberships: [nbb],
          selectedContext: { orgId: 'org-rotterdam', teamId: 'team-1' },
          selectedContextTeamValid: null,
        }),
      ),
    ).toEqual({ kind: 'selected-context-revoked' });
  });
});
