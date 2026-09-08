import { describe, expect, it, vi } from 'vitest';
import { OrganizationExportCoordinator } from '../../src/application/export/OrganizationExportCoordinator';
import type {
  OrganizationExportGateway,
  OrganizationExportReadResult,
} from '../../src/application/export/OrganizationExportGateway';
import type { RawOrganizationExportInput } from '../../src/domain/export/build';
import type { OrganizationRole } from '../../src/domain/organizations/types';

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

function gatewayReturning(
  result: OrganizationExportReadResult,
  callerRole: OrganizationRole | null = 'organizationOwner',
): OrganizationExportGateway {
  return {
    readOrganizationExportInput: vi.fn().mockResolvedValue(result),
    readCallerRole: vi.fn().mockResolvedValue(callerRole),
  };
}

describe('OrganizationExportCoordinator', () => {
  it('roept readOrganizationExportInput nooit aan voor een niet-owner rol (autoritatief via readCallerRole)', async () => {
    for (const callerRole of ['organizationAdmin', 'coach', 'scorer', 'viewer'] as const) {
      const gateway = gatewayReturning({ ok: true, data: rawInput() }, callerRole);
      const coordinator = new OrganizationExportCoordinator(
        gateway,
        () => '2026-03-01T00:00:00.000Z',
      );
      const outcome = await coordinator.run({ organizationId: 'org-1', callerUid: 'uid-x' });
      expect(outcome).toEqual({ status: 'denied' });
      expect(gateway.readOrganizationExportInput).not.toHaveBeenCalled();
    }
  });

  it('herreview PR #89 (P1): een door de aanroeper meegegeven rol wordt genegeerd — alleen readCallerRole() beslist', async () => {
    // Geen enkel veld in `OrganizationExportRequest` draagt nog een rol — dit
    // bewijst dat een `organizationAdmin` de coordinator niet met een
    // vervalste eigen-rolclaim kan aanroepen: er is domweg geen plek voor.
    const gateway = gatewayReturning({ ok: true, data: rawInput() }, null);
    const coordinator = new OrganizationExportCoordinator(gateway);
    const outcome = await coordinator.run({ organizationId: 'org-1', callerUid: 'uid-x' });
    expect(outcome).toEqual({ status: 'denied' });
    expect(gateway.readOrganizationExportInput).not.toHaveBeenCalled();
  });

  it('geeft een geslaagd resultaat voor de owner met een geldige lezing', async () => {
    const gateway = gatewayReturning({ ok: true, data: rawInput() }, 'organizationOwner');
    const coordinator = new OrganizationExportCoordinator(
      gateway,
      () => '2026-03-01T00:00:00.000Z',
    );

    const outcome = await coordinator.run({ organizationId: 'org-1', callerUid: 'uid-owner' });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') throw new Error('expected ok outcome');
    expect(outcome.export.organization.id).toBe('org-1');
    expect(outcome.export.exportedBy).toBe('uid-owner');
  });

  it('geeft organization-not-found door zonder een vals volledig resultaat te bouwen', async () => {
    const gateway = gatewayReturning(
      { ok: false, error: { code: 'organization-not-found' } },
      'organizationOwner',
    );
    const coordinator = new OrganizationExportCoordinator(gateway);

    const outcome = await coordinator.run({
      organizationId: 'org-missing',
      callerUid: 'uid-owner',
    });
    expect(outcome).toEqual({ status: 'failed', reason: 'organization-not-found' });
  });

  it('geeft read-failed door bij een corrupte/onleesbare read i.p.v. een gedeeltelijk resultaat', async () => {
    const gateway = gatewayReturning(
      { ok: false, error: { code: 'read-failed', detail: new Error('boom') } },
      'organizationOwner',
    );
    const coordinator = new OrganizationExportCoordinator(gateway);

    const outcome = await coordinator.run({ organizationId: 'org-1', callerUid: 'uid-owner' });
    expect(outcome).toEqual({ status: 'failed', reason: 'read-failed' });
  });
});
