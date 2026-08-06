import { describe, it, expect } from 'vitest';
import { deriveTeamAccess } from '../../src/domain/organizations/teamAccess';

describe('domain/organizations/teamAccess', () => {
  describe('deriveTeamAccess', () => {
    it('geeft owner impliciete volledige toegang zonder teamMembers-document', () => {
      expect(deriveTeamAccess('organizationOwner', null)).toEqual({
        effectiveRole: 'organizationOwner',
        canManageTeamData: true,
      });
    });

    it('geeft admin impliciete volledige toegang zonder teamMembers-document', () => {
      expect(deriveTeamAccess('organizationAdmin', null)).toEqual({
        effectiveRole: 'organizationAdmin',
        canManageTeamData: true,
      });
    });

    it('owner/admin behouden hun orgrol als effectieve rol, ook met een afwijkend teamMembers-document', () => {
      expect(deriveTeamAccess('organizationOwner', 'viewer')).toEqual({
        effectiveRole: 'organizationOwner',
        canManageTeamData: true,
      });
    });

    it('coach met expliciet teamMembers-document mag schrijven', () => {
      expect(deriveTeamAccess('coach', 'coach')).toEqual({
        effectiveRole: 'coach',
        canManageTeamData: true,
      });
    });

    it('scorer met expliciet teamMembers-document mag niet schrijven', () => {
      expect(deriveTeamAccess('scorer', 'scorer')).toEqual({
        effectiveRole: 'scorer',
        canManageTeamData: false,
      });
    });

    it('viewer met expliciet teamMembers-document mag niet schrijven', () => {
      expect(deriveTeamAccess('viewer', 'viewer')).toEqual({
        effectiveRole: 'viewer',
        canManageTeamData: false,
      });
    });

    it('valt terug op de orgrol als effectieve rol zonder teamspecifiek document', () => {
      expect(deriveTeamAccess('viewer', null)).toEqual({
        effectiveRole: 'viewer',
        canManageTeamData: false,
      });
    });
  });
});
