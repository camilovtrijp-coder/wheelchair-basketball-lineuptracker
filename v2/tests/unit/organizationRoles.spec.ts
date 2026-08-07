import { describe, it, expect } from 'vitest';
import { ORGANIZATION_ROLES as DOMAIN_ORGANIZATION_ROLES } from '../../src/domain/organizations/types';
import { INVITATION_STATUSES as DOMAIN_INVITATION_STATUSES } from '../../src/domain/invitations/types';
import {
  ORGANIZATION_ROLES as FIREBASE_ORGANIZATION_ROLES,
  INVITATION_STATUSES as FIREBASE_INVITATION_STATUSES,
} from 'firebase-base/documents';

// domain/ mag geen packages importeren (firebase-spike/tsconfig.json's
// ../v2/src/domain/**/*.ts-include dwingt dat af), dus deze rol-/statuslijsten
// staan onafhankelijk gedupliceerd t.o.v. firebase/src/documents/. Deze test
// is de vangrail die stil uit elkaar lopen voorkomt.
describe('domain-rollen/statussen blijven gelijk aan firebase-base/documents', () => {
  it('ORGANIZATION_ROLES is identiek', () => {
    expect(DOMAIN_ORGANIZATION_ROLES).toEqual(FIREBASE_ORGANIZATION_ROLES);
  });

  it('INVITATION_STATUSES is identiek', () => {
    expect(DOMAIN_INVITATION_STATUSES).toEqual(FIREBASE_INVITATION_STATUSES);
  });
});
