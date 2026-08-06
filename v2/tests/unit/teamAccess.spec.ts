import { describe, it, expect } from 'vitest';
import { deriveTeamAccess } from '../../src/domain/organizations/teamAccess';

describe('domain/organizations/teamAccess', () => {
  describe('deriveTeamAccess', () => {
    it('geeft owner impliciete volledige toegang zonder teamMembers-document', () => {
      expect(deriveTeamAccess('organizationOwner', null)).toEqual({
        effectiveRole: 'organizationOwner',
        canManageTeamData: true,
        isExplicitlyAuthorized: true,
      });
    });

    it('geeft admin impliciete volledige toegang zonder teamMembers-document', () => {
      expect(deriveTeamAccess('organizationAdmin', null)).toEqual({
        effectiveRole: 'organizationAdmin',
        canManageTeamData: true,
        isExplicitlyAuthorized: true,
      });
    });

    it('owner/admin behouden hun orgrol als effectieve rol, ook met een afwijkend teamMembers-document', () => {
      expect(deriveTeamAccess('organizationOwner', 'viewer')).toEqual({
        effectiveRole: 'organizationOwner',
        canManageTeamData: true,
        isExplicitlyAuthorized: true,
      });
    });

    it('coach met expliciet teamMembers-document mag schrijven', () => {
      expect(deriveTeamAccess('coach', 'coach')).toEqual({
        effectiveRole: 'coach',
        canManageTeamData: true,
        isExplicitlyAuthorized: true,
      });
    });

    it('scorer met expliciet teamMembers-document mag niet schrijven', () => {
      expect(deriveTeamAccess('scorer', 'scorer')).toEqual({
        effectiveRole: 'scorer',
        canManageTeamData: false,
        isExplicitlyAuthorized: true,
      });
    });

    it('viewer met expliciet teamMembers-document mag niet schrijven', () => {
      expect(deriveTeamAccess('viewer', 'viewer')).toEqual({
        effectiveRole: 'viewer',
        canManageTeamData: false,
        isExplicitlyAuthorized: true,
      });
    });

    it('valt terug op de orgrol als effectieve rol zonder teamspecifiek document, maar is niet aantoonbaar geautoriseerd', () => {
      expect(deriveTeamAccess('viewer', null)).toEqual({
        effectiveRole: 'viewer',
        canManageTeamData: false,
        isExplicitlyAuthorized: false,
      });
    });

    it('org-coach/scorer zonder teamMembers-document zijn evenmin aantoonbaar geautoriseerd voor een specifiek team', () => {
      expect(deriveTeamAccess('coach', null)).toEqual({
        effectiveRole: 'coach',
        canManageTeamData: false,
        isExplicitlyAuthorized: false,
      });
      expect(deriveTeamAccess('scorer', null)).toEqual({
        effectiveRole: 'scorer',
        canManageTeamData: false,
        isExplicitlyAuthorized: false,
      });
    });

    it('team-only gebruiker (orgRole null, issue #31) is coach: effectieve rol komt van het teamMembers-document, mag schrijven', () => {
      expect(deriveTeamAccess(null, 'coach')).toEqual({
        effectiveRole: 'coach',
        canManageTeamData: true,
        isExplicitlyAuthorized: true,
      });
    });

    it('team-only gebruiker (orgRole null, issue #31) is viewer: mag niet schrijven', () => {
      expect(deriveTeamAccess(null, 'viewer')).toEqual({
        effectiveRole: 'viewer',
        canManageTeamData: false,
        isExplicitlyAuthorized: true,
      });
    });

    it('zonder orgRole EN zonder teamMembers-document (onbereikbaar bij geldig gebruik) valt terug op een veilige, niet-schrijvende default', () => {
      expect(deriveTeamAccess(null, null)).toEqual({
        effectiveRole: 'viewer',
        canManageTeamData: false,
        isExplicitlyAuthorized: false,
      });
    });
  });
});
