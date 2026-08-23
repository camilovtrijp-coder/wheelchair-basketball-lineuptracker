import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Mock firebase/firestore vóór de import van de adapter — anders pakt de
// adapter de echte firebase-functies en kunnen we getDoc/setDoc spy'en.
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));

import { doc, getDoc, type Firestore } from 'firebase/firestore';
import {
  FirestoreCloudMigrationRunGateway,
  isKnownMigrationRunItemKind,
  isKnownMigrationRunItemStatus,
} from '../../src/infrastructure/migration/FirestoreCloudMigrationRunGateway';
import type { MigrationRunManifestProjection } from '../../src/application/migration/CloudMigrationRunGateway';

const fakeRef = {} as unknown as ReturnType<typeof doc>;
const fakeDb = {} as unknown as Firestore;

function fakeSnap(data: Record<string, unknown> | null) {
  return {
    exists: () => data !== null,
    data: () => data,
  };
}

function baseManifest(): MigrationRunManifestProjection {
  return {
    manifestHash: 'hash-1',
    source: { organizationId: 'org-src', teamId: 'team-src', organizationName: '', teamName: '' },
    target: { organizationId: 'org-dst', teamId: 'team-dst', organizationName: '', teamName: '' },
    callerRole: 'coach',
    contextFingerprint: 'fp-1',
    createdBy: 'uid-1',
    createdAt: '2026-08-23T10:00:00.000Z',
    items: [],
    status: 'paused',
    rollbackRequested: false,
  };
}

function storedItem(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'settings',
    sourceId: 'src-1',
    targetId: 'dst-1',
    label: 'Instellingen',
    payloadHash: 'ph-1',
    status: 'pending',
    lastError: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (doc as Mock).mockReturnValue(fakeRef);
});

describe('isKnownMigrationRunItemKind / isKnownMigrationRunItemStatus', () => {
  it('herkent alle bekende enumwaarden', () => {
    for (const kind of ['settings', 'roster', 'activeGame', 'completedGame']) {
      expect(isKnownMigrationRunItemKind(kind)).toBe(true);
    }
    for (const status of [
      'pending',
      'confirmed',
      'conflict',
      'failed',
      'compensated',
      'compensationFailed',
    ]) {
      expect(isKnownMigrationRunItemStatus(status)).toBe(true);
    }
  });

  it('wijst onbekende/vervalste waarden af (fail closed)', () => {
    expect(isKnownMigrationRunItemKind('unknownKind')).toBe(false);
    expect(isKnownMigrationRunItemKind(undefined)).toBe(false);
    expect(isKnownMigrationRunItemKind(42)).toBe(false);
    expect(isKnownMigrationRunItemStatus('unknownStatus')).toBe(false);
    expect(isKnownMigrationRunItemStatus(null)).toBe(false);
  });
});

describe('FirestoreCloudMigrationRunGateway.ensureRun — fail-closed cloud-itemvalidatie (reviewer-fix minimax PR #71, quick-win 1)', () => {
  it('leest een bestaand manifest met uitsluitend bekende kind/status-waarden gewoon in', async () => {
    (getDoc as Mock).mockResolvedValueOnce(
      fakeSnap({ ...baseManifest(), items: [storedItem()], revision: 3 }),
    );
    const gateway = new FirestoreCloudMigrationRunGateway(fakeDb);
    const result = await gateway.ensureRun('org-dst', 'team-dst', 'hash-1', baseManifest());
    expect(result.ok).toBe(true);
    expect(result.existing?.items).toEqual([
      {
        kind: 'settings',
        sourceId: 'src-1',
        targetId: 'dst-1',
        label: 'Instellingen',
        payloadHash: 'ph-1',
        status: 'pending',
        lastError: undefined,
      },
    ]);
  });

  it('faalt closed (ok:false) bij een item met een onbekende kind — nooit een stilzwijgende cast', async () => {
    (getDoc as Mock).mockResolvedValueOnce(
      fakeSnap({
        ...baseManifest(),
        items: [storedItem({ kind: 'toekomstigNieuwType' })],
        revision: 1,
      }),
    );
    const gateway = new FirestoreCloudMigrationRunGateway(fakeDb);
    const result = await gateway.ensureRun('org-dst', 'team-dst', 'hash-1', baseManifest());
    expect(result.ok).toBe(false);
    expect(result.existing).toBeUndefined();
    expect((result.error as Error).name).toBe('MigrationRunInvalidCloudDataError');
  });

  it('faalt closed (ok:false) bij een item met een onbekende status — nooit een stilzwijgende cast', async () => {
    (getDoc as Mock).mockResolvedValueOnce(
      fakeSnap({
        ...baseManifest(),
        items: [storedItem({ status: 'toekomstigeStatus' })],
        revision: 1,
      }),
    );
    const gateway = new FirestoreCloudMigrationRunGateway(fakeDb);
    const result = await gateway.ensureRun('org-dst', 'team-dst', 'hash-1', baseManifest());
    expect(result.ok).toBe(false);
    expect(result.existing).toBeUndefined();
    expect((result.error as Error).name).toBe('MigrationRunInvalidCloudDataError');
  });
});
