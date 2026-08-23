import { describe, expect, it } from 'vitest';
import {
  canBulkMigrate,
  computeMigrationContextFingerprint,
  isPreviewStillValid,
} from '../../src/domain/migration/capability';
import type { OrganizationRole } from '../../src/domain/organizations/types';

describe('domain/migration/capability (docs/pr-7.4-plan.md §B/§C 7.4a werk 4)', () => {
  it('organizationOwner/organizationAdmin/coach mogen bulk-migreren', () => {
    expect(canBulkMigrate('organizationOwner')).toBe(true);
    expect(canBulkMigrate('organizationAdmin')).toBe(true);
    expect(canBulkMigrate('coach')).toBe(true);
  });

  it('scorer en viewer mogen NOOIT bulk-migreren (acceptatiecriterium)', () => {
    expect(canBulkMigrate('scorer')).toBe(false);
    expect(canBulkMigrate('viewer')).toBe(false);
  });

  it('computeMigrationContextFingerprint is deterministisch', () => {
    const ctx = { organizationId: 'org1', teamId: 'team1', role: 'coach' as OrganizationRole };
    expect(computeMigrationContextFingerprint(ctx)).toBe(computeMigrationContextFingerprint(ctx));
  });

  it('isPreviewStillValid: geldig zolang org/team/rol ongewijzigd', () => {
    const ctx = { organizationId: 'org1', teamId: 'team1', role: 'coach' as OrganizationRole };
    const fp = computeMigrationContextFingerprint(ctx);
    expect(isPreviewStillValid(fp, ctx)).toBe(true);
  });

  it('isPreviewStillValid: een contextwissel (ander team) maakt de preview ongeldig', () => {
    const fp = computeMigrationContextFingerprint({
      organizationId: 'org1',
      teamId: 'team1',
      role: 'coach',
    });
    expect(
      isPreviewStillValid(fp, { organizationId: 'org1', teamId: 'team2', role: 'coach' }),
    ).toBe(false);
  });

  it('isPreviewStillValid: een rolwissel (bijv. gedegradeerde coach) maakt de preview ongeldig', () => {
    const fp = computeMigrationContextFingerprint({
      organizationId: 'org1',
      teamId: 'team1',
      role: 'coach',
    });
    expect(
      isPreviewStillValid(fp, { organizationId: 'org1', teamId: 'team1', role: 'viewer' }),
    ).toBe(false);
  });
});
