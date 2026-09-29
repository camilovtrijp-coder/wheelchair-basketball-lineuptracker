// PR 8.3c-1 deel 2 — DeletionRequestCoordinator (docs/pr-8.3c-besluitvoorstel.md §2.5).
// Fake poorten, maar de ECHTE export-opbouw en roundtrip: het exportProof moet uit
// dezelfde read komen als de blokkadecheck.
import { describe, expect, it } from 'vitest';
import { DeletionRequestCoordinator } from '../../src/application/deletion/DeletionRequestCoordinator';
import type {
  DeletionRequestGateway,
  DeletionRequestReadResult,
  DeletionRequestWriteResult,
} from '../../src/application/deletion/DeletionRequestGateway';
import type {
  OrganizationExportGateway,
  OrganizationExportReadResult,
} from '../../src/application/export/OrganizationExportGateway';
import type { RawOrganizationExportInput } from '../../src/domain/export/build';
import type { DeletionExportProof, DeletionRequest } from '../../src/domain/deletion/types';
import type { OrganizationRole } from '../../src/domain/organizations/types';

const NOW = new Date('2026-09-29T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function inputWith(
  overrides: { games?: Record<string, unknown>[]; migrationRuns?: Record<string, unknown>[] } = {},
): RawOrganizationExportInput {
  return {
    organization: {
      id: 'org-1',
      name: 'Fictieve Org',
      createdBy: 'uid-owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    organizationMembers: [{ id: 'uid-owner', uid: 'uid-owner', role: 'organizationOwner' }],
    invitations: [],
    teams: [
      {
        teamId: 'team-1',
        name: 'Team 1',
        orgName: 'Fictieve Org',
        createdBy: 'uid-owner',
        createdAt: '2026-01-01T00:00:00.000Z',
        teamMembers: [],
        settings: null,
        roster: null,
        games: (overrides.games ?? []).map((g) => ({ actions: [], ...g })) as never,
        completedGames: [],
        migrationRuns: (overrides.migrationRuns ?? []) as never,
      },
    ],
  };
}

class FakeExportGateway implements OrganizationExportGateway {
  reads = 0;
  constructor(
    public caller: { uid: string; role: OrganizationRole } | null,
    public input: OrganizationExportReadResult = { ok: true, data: inputWith() },
  ) {}
  async readAuthoritativeCaller() {
    return this.caller;
  }
  async readOrganizationExportInput() {
    this.reads += 1;
    return this.input;
  }
}

function storedRequest(overrides: Partial<DeletionRequest> = {}): DeletionRequest {
  return {
    organizationId: 'org-1',
    status: 'requested',
    attempt: 1,
    requestedBy: 'uid-owner',
    requestedAt: '2026-09-28T10:00:00.000Z',
    exportProof: {
      contentHash: 'hash-vorige',
      exportedAt: '2026-09-28T10:00:00.000Z',
      counts: {
        organizationMembers: 1,
        invitations: 0,
        teams: 1,
        teamMembers: 0,
        settingsDocuments: 0,
        rosterPlayers: 0,
        games: 0,
        gameActions: 0,
        completedGames: 0,
        migrationRuns: 0,
      },
    },
    cancelledAt: null,
    revision: 0,
    ...overrides,
  };
}

class FakeRequestGateway implements DeletionRequestGateway {
  calls: string[] = [];
  lastProof: DeletionExportProof | null = null;
  constructor(
    public stored: DeletionRequest | null = null,
    public readResult: DeletionRequestReadResult | null = null,
    public writeError: DeletionRequestWriteResult | null = null,
  ) {}
  async read(): Promise<DeletionRequestReadResult> {
    this.calls.push('read');
    return this.readResult ?? { ok: true, request: this.stored };
  }
  async create(_org: string, proof: DeletionExportProof): Promise<DeletionRequestWriteResult> {
    this.calls.push('create');
    this.lastProof = proof;
    if (this.writeError) return this.writeError;
    this.stored = storedRequest({ exportProof: proof, requestedAt: NOW.toISOString() });
    return { ok: true, request: this.stored };
  }
  async cancel(_org: string, expected: DeletionRequest): Promise<DeletionRequestWriteResult> {
    this.calls.push('cancel');
    if (this.writeError) return this.writeError;
    this.stored = {
      ...expected,
      status: 'cancelled',
      cancelledAt: NOW.toISOString(),
      revision: expected.revision + 1,
    };
    return { ok: true, request: this.stored };
  }
  async restart(
    _org: string,
    expected: DeletionRequest,
    proof: DeletionExportProof,
  ): Promise<DeletionRequestWriteResult> {
    this.calls.push('restart');
    this.lastProof = proof;
    if (this.writeError) return this.writeError;
    this.stored = {
      ...expected,
      status: 'requested',
      attempt: expected.attempt + 1,
      exportProof: proof,
      cancelledAt: null,
      revision: expected.revision + 1,
    };
    return { ok: true, request: this.stored };
  }
}

function coordinator(exportGateway: FakeExportGateway, requestGateway: FakeRequestGateway) {
  return new DeletionRequestCoordinator(exportGateway, requestGateway, () => NOW);
}

const OWNER = { uid: 'uid-owner', role: 'organizationOwner' as const };

describe('DeletionRequestCoordinator: autorisatie', () => {
  it.each(['organizationAdmin', 'coach', 'scorer', 'viewer'] as const)(
    '%s wordt geweigerd vóór ook maar één read',
    async (role) => {
      const exportGateway = new FakeExportGateway({ uid: 'uid-x', role });
      const requestGateway = new FakeRequestGateway();
      const c = coordinator(exportGateway, requestGateway);
      expect(await c.request({ organizationId: 'org-1', acknowledgedStaleGames: true })).toEqual({
        status: 'denied',
      });
      expect(await c.assess('org-1')).toEqual({ status: 'denied' });
      expect(await c.cancel('org-1')).toEqual({ status: 'denied' });
      expect(exportGateway.reads).toBe(0);
      expect(requestGateway.calls).toEqual([]);
    },
  );

  it('een niet-ingelogde aanroeper (caller null) wordt geweigerd', async () => {
    const exportGateway = new FakeExportGateway(null);
    const requestGateway = new FakeRequestGateway();
    const outcome = await coordinator(exportGateway, requestGateway).request({
      organizationId: 'org-1',
      acknowledgedStaleGames: true,
    });
    expect(outcome).toEqual({ status: 'denied' });
    expect(exportGateway.reads).toBe(0);
    expect(requestGateway.calls).toEqual([]);
  });
});

describe('DeletionRequestCoordinator.request', () => {
  it('maakt een verzoek aan met een exportProof uit dezelfde read en levert de export voor download', async () => {
    const exportGateway = new FakeExportGateway(OWNER);
    const requestGateway = new FakeRequestGateway();
    const outcome = await coordinator(exportGateway, requestGateway).request({
      organizationId: 'org-1',
      acknowledgedStaleGames: false,
    });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(exportGateway.reads).toBe(1);
    expect(requestGateway.calls).toEqual(['read', 'create']);
    expect(requestGateway.lastProof).toEqual({
      contentHash: outcome.export.contentHash,
      exportedAt: NOW.toISOString(),
      counts: outcome.export.counts,
    });
    expect(outcome.export.counts.teams).toBe(1);
    expect(outcome.request.status).toBe('requested');
  });

  it('een recente actieve wedstrijd blokkeert hard, zonder enige write of tweede read', async () => {
    const exportGateway = new FakeExportGateway(OWNER, {
      ok: true,
      data: inputWith({
        games: [
          {
            id: 'g-live',
            completedGameId: null,
            lastWriterActivityAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
            createdAt: '2026-09-29T08:00:00.000Z',
          },
        ],
      }),
    });
    const requestGateway = new FakeRequestGateway();
    const outcome = await coordinator(exportGateway, requestGateway).request({
      organizationId: 'org-1',
      acknowledgedStaleGames: true,
    });
    expect(outcome).toEqual({
      status: 'blocked',
      blockers: [{ code: 'recent-active-game', teamId: 'team-1', gameId: 'g-live' }],
    });
    expect(requestGateway.calls).toEqual([]);
  });

  it('een niet-terminale migratierun blokkeert hard, ook mét bevestiging van verlaten wedstrijden', async () => {
    const exportGateway = new FakeExportGateway(OWNER, {
      ok: true,
      data: inputWith({ migrationRuns: [{ id: 'run-1', status: 'paused' }] }),
    });
    const requestGateway = new FakeRequestGateway();
    const outcome = await coordinator(exportGateway, requestGateway).request({
      organizationId: 'org-1',
      acknowledgedStaleGames: true,
    });
    expect(outcome.status).toBe('blocked');
    expect(requestGateway.calls).toEqual([]);
  });

  describe('verlaten wedstrijden', () => {
    const stale = {
      games: [
        {
          id: 'g-oud',
          completedGameId: null,
          lastWriterActivityAt: new Date(NOW.getTime() - 40 * DAY).toISOString(),
          createdAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    };

    it('vragen om een expliciete bevestiging in plaats van te blokkeren', async () => {
      const requestGateway = new FakeRequestGateway();
      const outcome = await coordinator(
        new FakeExportGateway(OWNER, { ok: true, data: inputWith(stale) }),
        requestGateway,
      ).request({ organizationId: 'org-1', acknowledgedStaleGames: false });
      expect(outcome).toEqual({ status: 'needs-acknowledgement', staleGameCount: 1 });
      expect(requestGateway.calls).toEqual([]);
    });

    it('slagen na bevestiging', async () => {
      const requestGateway = new FakeRequestGateway();
      const outcome = await coordinator(
        new FakeExportGateway(OWNER, { ok: true, data: inputWith(stale) }),
        requestGateway,
      ).request({ organizationId: 'org-1', acknowledgedStaleGames: true });
      expect(outcome.status).toBe('ok');
      expect(requestGateway.calls).toEqual(['read', 'create']);
    });
  });

  it.each(['requested', 'executing', 'completed', 'failed'] as const)(
    'een bestaand verzoek in status %s is al open: geen nieuwe write',
    async (status) => {
      const requestGateway = new FakeRequestGateway(storedRequest({ status }));
      const outcome = await coordinator(new FakeExportGateway(OWNER), requestGateway).request({
        organizationId: 'org-1',
        acknowledgedStaleGames: false,
      });
      expect(outcome.status).toBe('already-open');
      expect(requestGateway.calls).toEqual(['read']);
    },
  );

  it('herstart een geannuleerd verzoek met een vers bewijs (attempt + 1)', async () => {
    const requestGateway = new FakeRequestGateway(
      storedRequest({ status: 'cancelled', cancelledAt: '2026-09-28T11:00:00.000Z', revision: 1 }),
    );
    const outcome = await coordinator(new FakeExportGateway(OWNER), requestGateway).request({
      organizationId: 'org-1',
      acknowledgedStaleGames: false,
    });
    expect(outcome.status).toBe('ok');
    expect(requestGateway.calls).toEqual(['read', 'restart']);
    if (outcome.status === 'ok') {
      expect(outcome.request.attempt).toBe(2);
      expect(outcome.request.revision).toBe(2);
    }
  });

  it('een herstart met een klok die niet ná het vorige bewijs ligt geeft clock-behind, zonder write', async () => {
    const requestGateway = new FakeRequestGateway(
      storedRequest({
        status: 'cancelled',
        exportProof: { ...storedRequest().exportProof, exportedAt: '2026-09-29T12:00:00.000Z' },
      }),
    );
    const outcome = await coordinator(new FakeExportGateway(OWNER), requestGateway).request({
      organizationId: 'org-1',
      acknowledgedStaleGames: false,
    });
    expect(outcome).toEqual({
      status: 'clock-behind',
      previousExportedAt: '2026-09-29T12:00:00.000Z',
    });
    expect(requestGateway.calls).toEqual(['read']);
  });

  it('een mislukte organisatie-read eindigt als failed, zonder write', async () => {
    const requestGateway = new FakeRequestGateway();
    const outcome = await coordinator(
      new FakeExportGateway(OWNER, { ok: false, error: { code: 'read-failed', detail: 'x' } }),
      requestGateway,
    ).request({ organizationId: 'org-1', acknowledgedStaleGames: true });
    expect(outcome).toEqual({ status: 'failed', reason: 'read-failed' });
    expect(requestGateway.calls).toEqual([]);
  });

  it('een niet-bestaande organisatie eindigt als organization-not-found', async () => {
    const outcome = await coordinator(
      new FakeExportGateway(OWNER, { ok: false, error: { code: 'organization-not-found' } }),
      new FakeRequestGateway(),
    ).request({ organizationId: 'org-1', acknowledgedStaleGames: true });
    expect(outcome).toEqual({ status: 'failed', reason: 'organization-not-found' });
  });

  it('een mislukte lezing van het bestaande verzoek eindigt als failed, zonder write', async () => {
    const requestGateway = new FakeRequestGateway(null, {
      ok: false,
      error: { code: 'read-failed', detail: 'x' },
    });
    const outcome = await coordinator(new FakeExportGateway(OWNER), requestGateway).request({
      organizationId: 'org-1',
      acknowledgedStaleGames: false,
    });
    expect(outcome).toEqual({ status: 'failed', reason: 'read-failed' });
    expect(requestGateway.calls).toEqual(['read']);
  });

  it('een door Rules geweigerde write komt terug als write-failed, nooit als succes', async () => {
    const requestGateway = new FakeRequestGateway(null, null, {
      ok: false,
      error: { code: 'rejected' },
    });
    const outcome = await coordinator(new FakeExportGateway(OWNER), requestGateway).request({
      organizationId: 'org-1',
      acknowledgedStaleGames: false,
    });
    expect(outcome).toEqual({ status: 'write-failed', error: { code: 'rejected' } });
  });
});

describe('DeletionRequestCoordinator.cancel', () => {
  it('annuleert een requested-verzoek', async () => {
    const requestGateway = new FakeRequestGateway(storedRequest());
    const outcome = await coordinator(new FakeExportGateway(OWNER), requestGateway).cancel('org-1');
    expect(outcome.status).toBe('ok');
    expect(requestGateway.calls).toEqual(['read', 'cancel']);
  });

  it.each([null, 'cancelled', 'executing', 'completed', 'failed'] as const)(
    'kan niet annuleren wanneer het verzoek %s is',
    async (status) => {
      const requestGateway = new FakeRequestGateway(
        status === null ? null : storedRequest({ status }),
      );
      const outcome = await coordinator(new FakeExportGateway(OWNER), requestGateway).cancel(
        'org-1',
      );
      expect(outcome.status).toBe('not-cancellable');
      expect(requestGateway.calls).toEqual(['read']);
    },
  );

  it('een geweigerde annulering komt terug als write-failed', async () => {
    const requestGateway = new FakeRequestGateway(storedRequest(), null, {
      ok: false,
      error: { code: 'rejected' },
    });
    const outcome = await coordinator(new FakeExportGateway(OWNER), requestGateway).cancel('org-1');
    expect(outcome).toEqual({ status: 'write-failed', error: { code: 'rejected' } });
  });
});

describe('DeletionRequestCoordinator.assess', () => {
  it('levert blokkades, opruimoverzicht en het bestaande verzoek voor de UI, zonder write', async () => {
    const requestGateway = new FakeRequestGateway(storedRequest());
    const outcome = await coordinator(new FakeExportGateway(OWNER), requestGateway).assess('org-1');
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.assessment.blockers).toEqual([]);
    expect(outcome.cleanup.abandonedGames).toBe(0);
    expect(outcome.existingRequest?.status).toBe('requested');
    expect(requestGateway.calls).toEqual(['read']);
  });
});
