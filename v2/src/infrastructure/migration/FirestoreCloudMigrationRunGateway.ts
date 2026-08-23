// Firestore-implementatie van CloudMigrationRunGateway (PR 7.4b,
// docs/pr-7.4-plan.md §C 7.4b werk 1/2). Bewaart
// organizations/{orgId}/teams/{teamId}/migrationRuns/{runId} — zusje van
// games/{gameId} qua schrijfstijl: create-only manifest (`ensureRun()`) +
// revisie-bewaakte checkpointpatch (`patchRunCheckpoint()`, spiegelt
// `FirestoreGameCloudGateway.patchSnapshot()`'s niet-transactionele
// updateDoc()-aanpak — firestore.rules dwingt de optimistische-concurrency
// zelf af). Elke aanroep aan `withTimeout()` gebonden, zelfde patroon/reden
// als `FirestoreGameCloudGateway.ts`/`FirestoreCloudMigrationInventoryGateway.ts`.
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import type {
  CloudMigrationRunGateway,
  MigrationRunCloudWriteResult,
  MigrationRunManifestProjection,
} from '../../application/migration/CloudMigrationRunGateway';
import type { MigrationRunItemCheckpoint } from '../../domain/migration/run';

const DEFAULT_TIMEOUT_MS = 8000;

class MigrationRunTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label}: geen serverantwoord binnen ${ms}ms`);
    this.name = 'MigrationRunTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new MigrationRunTimeoutError(label, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Firestore accepteert geen `undefined`-waarden in een document — `items[].lastError`
 * is optioneel op het domeintype, hier expliciet `null` i.p.v. weggelaten (een
 * consistente sleutelset per item is eenvoudiger te valideren dan een
 * wisselende, en spiegelt hoe `GameDocument` optionele velden al als
 * expliciete `null` bewaart, zie firestore.rules' `gameKeys()`). */
function toStoredItem(item: MigrationRunItemCheckpoint): Record<string, unknown> {
  return {
    kind: item.kind,
    sourceId: item.sourceId,
    targetId: item.targetId,
    label: item.label,
    payloadHash: item.payloadHash,
    status: item.status,
    lastError: item.lastError ?? null,
  };
}

function fromStoredItem(raw: Record<string, unknown>): MigrationRunItemCheckpoint {
  return {
    kind: raw.kind as MigrationRunItemCheckpoint['kind'],
    sourceId: raw.sourceId as string,
    targetId: raw.targetId as string,
    label: raw.label as string,
    payloadHash: raw.payloadHash as string,
    status: raw.status as MigrationRunItemCheckpoint['status'],
    lastError: raw.lastError == null ? undefined : (raw.lastError as string),
  };
}

export class FirestoreCloudMigrationRunGateway implements CloudMigrationRunGateway {
  constructor(
    private readonly db: Firestore,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  private ref(organizationId: string, teamId: string, runId: string) {
    return doc(this.db, 'organizations', organizationId, 'teams', teamId, 'migrationRuns', runId);
  }

  async ensureRun(
    organizationId: string,
    teamId: string,
    runId: string,
    manifest: MigrationRunManifestProjection,
  ): Promise<
    MigrationRunCloudWriteResult & {
      existing?: MigrationRunManifestProjection & { revision: number };
    }
  > {
    const ref = this.ref(organizationId, teamId, runId);
    try {
      const existingSnap = await withTimeout(getDoc(ref), this.timeoutMs, 'ensureRun:read');
      if (existingSnap.exists()) {
        const data = existingSnap.data();
        return {
          ok: true,
          revision: data.revision as number,
          existing: {
            manifestHash: data.manifestHash as string,
            source: data.source as MigrationRunManifestProjection['source'],
            target: data.target as MigrationRunManifestProjection['target'],
            callerRole: data.callerRole as MigrationRunManifestProjection['callerRole'],
            contextFingerprint: data.contextFingerprint as string,
            createdBy: data.createdBy as string,
            createdAt: data.createdAt as string,
            items: (data.items as Record<string, unknown>[]).map(fromStoredItem),
            status: data.status as MigrationRunManifestProjection['status'],
            rollbackRequested: data.rollbackRequested as boolean,
            revision: data.revision as number,
          },
        };
      }
      await withTimeout(
        setDoc(ref, {
          manifestHash: manifest.manifestHash,
          source: manifest.source,
          target: manifest.target,
          callerRole: manifest.callerRole,
          contextFingerprint: manifest.contextFingerprint,
          createdBy: manifest.createdBy,
          createdAt: manifest.createdAt,
          items: manifest.items.map(toStoredItem),
          status: manifest.status,
          rollbackRequested: manifest.rollbackRequested,
          revision: 0,
          updatedAt: serverTimestamp(),
        }),
        this.timeoutMs,
        'ensureRun:create',
      );
      return { ok: true, revision: 0 };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async patchRunCheckpoint(
    organizationId: string,
    teamId: string,
    runId: string,
    patch: {
      items: MigrationRunItemCheckpoint[];
      status: MigrationRunManifestProjection['status'];
      rollbackRequested: boolean;
      updatedAt: string;
    },
    expectedRevision: number,
  ): Promise<MigrationRunCloudWriteResult> {
    const ref = this.ref(organizationId, teamId, runId);
    try {
      await withTimeout(
        updateDoc(ref, {
          items: patch.items.map(toStoredItem),
          status: patch.status,
          rollbackRequested: patch.rollbackRequested,
          revision: expectedRevision + 1,
          updatedAt: serverTimestamp(),
        }),
        this.timeoutMs,
        'patchRunCheckpoint',
      );
      return { ok: true, revision: expectedRevision + 1 };
    } catch (error) {
      return { ok: false, error };
    }
  }
}
