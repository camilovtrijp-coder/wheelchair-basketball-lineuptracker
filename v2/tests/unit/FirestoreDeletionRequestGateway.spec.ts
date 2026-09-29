// PR 8.3c-1 deel 2 — FirestoreDeletionRequestGateway. Gemockte Firestore/Auth: dit
// bewijst de PADEN, de exacte payloads (de echte Rules bewijzen ze in
// firebase/tests/rules/deletion-request-gateway-payloads.spec.ts), de foutmapping,
// de weigering zonder ingelogde gebruiker en dat er nooit een delete plaatsvindt.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));
vi.mock('firebase/auth', () => ({ getAuth: vi.fn() }));

import { Timestamp, doc, getDoc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { FirestoreDeletionRequestGateway } from '../../src/infrastructure/deletion/FirestoreDeletionRequestGateway';
import type { DeletionExportProof, DeletionRequest } from '../../src/domain/deletion/types';

const fakeDb = { app: {} } as unknown as Firestore;
const withConverter = vi.fn();
const fakeRef = { withConverter } as unknown as ReturnType<typeof doc>;

const PROOF: DeletionExportProof = {
  contentHash: 'hash-1',
  exportedAt: '2026-09-29T10:00:00.000Z',
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
};

/** Wat `deletionRequestConverter.fromFirestore()` na validatie zou teruggeven. */
function convertedDocument(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 'org-1',
    status: 'requested',
    attempt: 1,
    requestedBy: 'uid-owner',
    requestedAt: Timestamp.fromMillis(Date.parse('2026-09-29T12:00:00.000Z')),
    exportProof: PROOF,
    cancelledAt: null,
    revision: 0,
    ...overrides,
  };
}

function snap(data: unknown) {
  return { exists: () => data !== null, data: () => data };
}

const EXPECTED: DeletionRequest = {
  organizationId: 'org-1',
  status: 'requested',
  attempt: 2,
  requestedBy: 'uid-owner',
  requestedAt: '2026-09-29T12:00:00.000Z',
  exportProof: PROOF,
  cancelledAt: null,
  revision: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  withConverter.mockReturnValue(fakeRef);
  (doc as Mock).mockReturnValue(fakeRef);
  (getAuth as Mock).mockReturnValue({ currentUser: { uid: 'uid-owner' } });
  (setDoc as Mock).mockResolvedValue(undefined);
  (updateDoc as Mock).mockResolvedValue(undefined);
});

describe('FirestoreDeletionRequestGateway: paden', () => {
  it('gebruikt uitsluitend organizations/{orgId}/deletionRequests/current', async () => {
    (getDoc as Mock).mockResolvedValue(snap(null));
    await new FirestoreDeletionRequestGateway(fakeDb).read('org-1');
    expect(doc).toHaveBeenCalledWith(
      fakeDb,
      'organizations',
      'org-1',
      'deletionRequests',
      'current',
    );
  });
});

describe('FirestoreDeletionRequestGateway.read', () => {
  it('geeft null wanneer er geen verzoek bestaat', async () => {
    (getDoc as Mock).mockResolvedValue(snap(null));
    expect(await new FirestoreDeletionRequestGateway(fakeDb).read('org-1')).toEqual({
      ok: true,
      request: null,
    });
  });

  it('zet Timestamps om naar ISO-strings', async () => {
    (getDoc as Mock).mockResolvedValue(
      snap(
        convertedDocument({
          status: 'cancelled',
          cancelledAt: Timestamp.fromMillis(Date.parse('2026-09-29T13:00:00.000Z')),
        }),
      ),
    );
    const result = await new FirestoreDeletionRequestGateway(fakeDb).read('org-1');
    expect(result).toMatchObject({
      ok: true,
      request: {
        status: 'cancelled',
        requestedAt: '2026-09-29T12:00:00.000Z',
        cancelledAt: '2026-09-29T13:00:00.000Z',
      },
    });
  });

  it('een mislukte read (bijv. corrupt document) is read-failed, nooit een gok', async () => {
    (getDoc as Mock).mockRejectedValue(new Error('corrupt'));
    const result = await new FirestoreDeletionRequestGateway(fakeDb).read('org-1');
    expect(result.ok).toBe(false);
  });
});

describe('FirestoreDeletionRequestGateway: writes', () => {
  it('create schrijft exact de aanmaakpayload, met de ingelogde uid en een servertijdstempel', async () => {
    (getDoc as Mock).mockResolvedValue(snap(convertedDocument()));
    const result = await new FirestoreDeletionRequestGateway(fakeDb).create('org-1', PROOF);
    expect(setDoc).toHaveBeenCalledWith(fakeRef, {
      organizationId: 'org-1',
      status: 'requested',
      attempt: 1,
      requestedBy: 'uid-owner',
      requestedAt: 'SERVER_TIMESTAMP',
      exportProof: PROOF,
      cancelledAt: null,
      revision: 0,
    });
    expect(result.ok).toBe(true);
  });

  it('cancel schrijft alleen status, cancelledAt en revision + 1', async () => {
    (getDoc as Mock).mockResolvedValue(snap(convertedDocument({ status: 'cancelled' })));
    await new FirestoreDeletionRequestGateway(fakeDb).cancel('org-1', {
      ...EXPECTED,
      attempt: 1,
      revision: 0,
    });
    expect(updateDoc).toHaveBeenCalledWith(fakeRef, {
      status: 'cancelled',
      cancelledAt: 'SERVER_TIMESTAMP',
      revision: 1,
    });
  });

  it('restart schrijft attempt + 1, verse aanvrager/tijd/bewijs, cancelledAt null en revision + 1', async () => {
    (getDoc as Mock).mockResolvedValue(snap(convertedDocument({ attempt: 2, revision: 2 })));
    await new FirestoreDeletionRequestGateway(fakeDb).restart(
      'org-1',
      { ...EXPECTED, status: 'cancelled', attempt: 1, revision: 1 },
      PROOF,
    );
    expect(updateDoc).toHaveBeenCalledWith(fakeRef, {
      status: 'requested',
      attempt: 2,
      requestedBy: 'uid-owner',
      requestedAt: 'SERVER_TIMESTAMP',
      exportProof: PROOF,
      cancelledAt: null,
      revision: 2,
    });
  });

  it('levert na een write het TERUGGELEZEN document op, niet de verstuurde waarden', async () => {
    (getDoc as Mock).mockResolvedValue(snap(convertedDocument({ revision: 7 })));
    const result = await new FirestoreDeletionRequestGateway(fakeDb).create('org-1', PROOF);
    expect(result).toMatchObject({ ok: true, request: { revision: 7 } });
    expect(getDoc).toHaveBeenCalledTimes(1);
  });

  it('een permission-denied van Rules is rejected', async () => {
    (setDoc as Mock).mockRejectedValue({ code: 'permission-denied' });
    expect(await new FirestoreDeletionRequestGateway(fakeDb).create('org-1', PROOF)).toEqual({
      ok: false,
      error: { code: 'rejected' },
    });
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('een andere fout is failed en wordt niet als rejected gerapporteerd', async () => {
    (updateDoc as Mock).mockRejectedValue({ code: 'unavailable' });
    const result = await new FirestoreDeletionRequestGateway(fakeDb).cancel('org-1', EXPECTED);
    expect(result).toMatchObject({ ok: false, error: { code: 'failed' } });
  });

  it('een geslaagde write met mislukte readback is readback-failed, nooit stil succes', async () => {
    (getDoc as Mock).mockRejectedValue(new Error('offline'));
    const result = await new FirestoreDeletionRequestGateway(fakeDb).create('org-1', PROOF);
    expect(result).toMatchObject({ ok: false, error: { code: 'readback-failed' } });
  });

  it('een geslaagde write waarna het document ontbreekt is readback-failed', async () => {
    (getDoc as Mock).mockResolvedValue(snap(null));
    const result = await new FirestoreDeletionRequestGateway(fakeDb).create('org-1', PROOF);
    expect(result).toMatchObject({ ok: false, error: { code: 'readback-failed' } });
  });

  it('create en restart weigeren zonder ingelogde gebruiker en schrijven niets', async () => {
    (getAuth as Mock).mockReturnValue({ currentUser: null });
    const gateway = new FirestoreDeletionRequestGateway(fakeDb);
    expect(await gateway.create('org-1', PROOF)).toEqual({
      ok: false,
      error: { code: 'not-signed-in' },
    });
    expect(await gateway.restart('org-1', EXPECTED, PROOF)).toEqual({
      ok: false,
      error: { code: 'not-signed-in' },
    });
    expect(setDoc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('heeft geen enkele delete-methode (een client mag dit document nooit verwijderen)', () => {
    const gateway = new FirestoreDeletionRequestGateway(fakeDb) as unknown as Record<
      string,
      unknown
    >;
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(gateway)).sort()).toEqual(
      ['cancel', 'constructor', 'create', 'read', 'ref', 'restart', 'write'].sort(),
    );
  });
});
