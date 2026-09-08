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
  caller: { uid: string; role: OrganizationRole } | null = {
    uid: 'uid-owner',
    role: 'organizationOwner',
  },
): OrganizationExportGateway {
  return {
    readOrganizationExportInput: vi.fn().mockResolvedValue(result),
    readAuthoritativeCaller: vi.fn().mockResolvedValue(caller),
  };
}

describe('OrganizationExportCoordinator', () => {
  it('roept readOrganizationExportInput nooit aan voor een niet-owner rol (autoritatief via readAuthoritativeCaller)', async () => {
    for (const role of ['organizationAdmin', 'coach', 'scorer', 'viewer'] as const) {
      const gateway = gatewayReturning({ ok: true, data: rawInput() }, { uid: 'uid-x', role });
      const coordinator = new OrganizationExportCoordinator(
        gateway,
        () => '2026-03-01T00:00:00.000Z',
      );
      const outcome = await coordinator.run({ organizationId: 'org-1' });
      expect(outcome).toEqual({ status: 'denied' });
      expect(gateway.readOrganizationExportInput).not.toHaveBeenCalled();
    }
  });

  it('herreview PR #89 (P1, tweede ronde): OrganizationExportRequest draagt geen identiteit — alleen readAuthoritativeCaller() beslist', async () => {
    // Geen enkel veld in `OrganizationExportRequest` draagt nog een rol of
    // uid — dit bewijst dat een `organizationAdmin` de coordinator niet met
    // een vervalste eigen- of andermans-identiteitsclaim kan aanroepen: er
    // is domweg geen plek voor. Geen ingelogde/bekende aanroeper (`null`) is
    // altijd `denied`, ongeacht wat er ooit als parameter meegegeven zou
    // kunnen worden.
    const gateway = gatewayReturning({ ok: true, data: rawInput() }, null);
    const coordinator = new OrganizationExportCoordinator(gateway);
    const outcome = await coordinator.run({ organizationId: 'org-1' });
    expect(outcome).toEqual({ status: 'denied' });
    expect(gateway.readOrganizationExportInput).not.toHaveBeenCalled();
  });

  it('geeft een geslaagd resultaat voor de owner met een geldige lezing', async () => {
    const gateway = gatewayReturning(
      { ok: true, data: rawInput() },
      { uid: 'uid-owner', role: 'organizationOwner' },
    );
    const coordinator = new OrganizationExportCoordinator(
      gateway,
      () => '2026-03-01T00:00:00.000Z',
    );

    const outcome = await coordinator.run({ organizationId: 'org-1' });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') throw new Error('expected ok outcome');
    expect(outcome.export.organization.id).toBe('org-1');
    expect(outcome.export.exportedBy).toBe('uid-owner');
  });

  it('geeft organization-not-found door zonder een vals volledig resultaat te bouwen', async () => {
    const gateway = gatewayReturning(
      { ok: false, error: { code: 'organization-not-found' } },
      { uid: 'uid-owner', role: 'organizationOwner' },
    );
    const coordinator = new OrganizationExportCoordinator(gateway);

    const outcome = await coordinator.run({ organizationId: 'org-missing' });
    expect(outcome).toEqual({ status: 'failed', reason: 'organization-not-found' });
  });

  it('geeft read-failed door bij een corrupte/onleesbare read i.p.v. een gedeeltelijk resultaat', async () => {
    const gateway = gatewayReturning(
      { ok: false, error: { code: 'read-failed', detail: new Error('boom') } },
      { uid: 'uid-owner', role: 'organizationOwner' },
    );
    const coordinator = new OrganizationExportCoordinator(gateway);

    const outcome = await coordinator.run({ organizationId: 'org-1' });
    expect(outcome).toEqual({ status: 'failed', reason: 'read-failed' });
  });
});
