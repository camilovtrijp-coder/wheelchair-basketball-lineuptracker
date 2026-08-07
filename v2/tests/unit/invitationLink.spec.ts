import { describe, it, expect } from 'vitest';
import { parseInvitationLink } from '../../src/infrastructure/invitations/invitationLink';

describe('infrastructure/invitations/invitationLink — parseInvitationLink', () => {
  it('leest orgId en invitationId uit een geldige querystring', () => {
    expect(parseInvitationLink('?orgId=org-1&invitationId=inv-1')).toEqual({
      orgId: 'org-1',
      invitationId: 'inv-1',
    });
  });

  it('werkt ook zonder leidend vraagteken', () => {
    expect(parseInvitationLink('orgId=org-1&invitationId=inv-1')).toEqual({
      orgId: 'org-1',
      invitationId: 'inv-1',
    });
  });

  it('geeft null terug als orgId ontbreekt', () => {
    expect(parseInvitationLink('?invitationId=inv-1')).toBeNull();
  });

  it('geeft null terug als invitationId ontbreekt', () => {
    expect(parseInvitationLink('?orgId=org-1')).toBeNull();
  });

  it('geeft null terug bij een lege querystring', () => {
    expect(parseInvitationLink('')).toBeNull();
  });

  it('negeert onbekende extra parameters', () => {
    expect(parseInvitationLink('?orgId=org-1&invitationId=inv-1&utm_source=x')).toEqual({
      orgId: 'org-1',
      invitationId: 'inv-1',
    });
  });
});
