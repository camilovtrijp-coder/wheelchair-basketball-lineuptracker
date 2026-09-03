import { describe, expect, it, vi } from 'vitest';
import { OrganizationExportCoordinator } from '../../src/application/export/OrganizationExportCoordinator';
import type {
  OrganizationExportGateway,
  OrganizationExportReadResult,
} from '../../src/application/export/OrganizationExportGateway';
import type { RawOrganizationExportInput } from '../../src/domain/export/build';

function rawInput(): RawOrganizationExportInput {
  return {
    organization: {
      id: 'org-1',
      name: 'ROBA',
      createdBy: 'uid-owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    organizationMembers: [
      { uid: 'uid-owner', role: 'organizationOwner', email: 'owner@example.test' },
    ],
    invitations: [],
    teams: [],
  };
}

function gatewayReturning(result: OrganizationExportReadResult): OrganizationExportGateway {
  return { readOrganizationExportInput: vi.fn().mockResolvedValue(result) };
}

describe('OrganizationExportCoordinator', () => {
  it('roept de gateway nooit aan voor een niet-owner rol', async () => {
    const gateway = gatewayReturning({ ok: true, data: rawInput() });
    const coordinator = new OrganizationExportCoordinator(
      gateway,
      () => '2026-03-01T00:00:00.000Z',
    );

    for (const callerRole of ['organizationAdmin', 'coach', 'scorer', 'viewer'] as const) {
      const outcome = await coordinator.run({
        organizationId: 'org-1',
        callerUid: 'uid-x',
        callerRole,
      });
      expect(outcome).toEqual({ status: 'denied' });
    }
    expect(gateway.readOrganizationExportInput).not.toHaveBeenCalled();
  });

  it('geeft een geslaagd resultaat voor de owner met een geldige lezing', async () => {
    const gateway = gatewayReturning({ ok: true, data: rawInput() });
    const coordinator = new OrganizationExportCoordinator(
      gateway,
      () => '2026-03-01T00:00:00.000Z',
    );

    const outcome = await coordinator.run({
      organizationId: 'org-1',
      callerUid: 'uid-owner',
      callerRole: 'organizationOwner',
    });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') throw new Error('expected ok outcome');
    expect(outcome.export.organization.id).toBe('org-1');
    expect(outcome.export.exportedBy).toBe('uid-owner');
  });

  it('geeft organization-not-found door zonder een vals volledig resultaat te bouwen', async () => {
    const gateway = gatewayReturning({ ok: false, error: { code: 'organization-not-found' } });
    const coordinator = new OrganizationExportCoordinator(gateway);

    const outcome = await coordinator.run({
      organizationId: 'org-missing',
      callerUid: 'uid-owner',
      callerRole: 'organizationOwner',
    });
    expect(outcome).toEqual({ status: 'failed', reason: 'organization-not-found' });
  });

  it('geeft read-failed door bij een corrupte/onleesbare read i.p.v. een gedeeltelijk resultaat', async () => {
    const gateway = gatewayReturning({
      ok: false,
      error: { code: 'read-failed', detail: new Error('boom') },
    });
    const coordinator = new OrganizationExportCoordinator(gateway);

    const outcome = await coordinator.run({
      organizationId: 'org-1',
      callerUid: 'uid-owner',
      callerRole: 'organizationOwner',
    });
    expect(outcome).toEqual({ status: 'failed', reason: 'read-failed' });
  });
});
