// Firestore-implementatie van DeletionRequestGateway (PR 8.3c-1 deel 2,
// docs/pr-8.3c-besluitvoorstel.md §2.5). Schrijft UITSLUITEND naar
// `organizations/{orgId}/deletionRequests/current` en alleen de drie overgangen
// die `firestore.rules` een client toestaat (create, cancel, restart). Geen
// enkele delete, geen enkel ander pad, geen door de aanroeper meegegeven pad of
// identiteit: de aanvrager is `getAuth(db.app).currentUser` (dezelfde les als de
// 8.3b-herreview over `callerUid`).
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { deletionRequestConverter, type DeletionRequestDocument } from 'firebase-base/documents';
import type {
  DeletionRequestGateway,
  DeletionRequestReadResult,
  DeletionRequestWriteResult,
} from '../../application/deletion/DeletionRequestGateway';
import type { DeletionExportProof, DeletionRequest } from '../../domain/deletion/types';
import { buildCancelPatch, buildCreatePayload, buildRestartPatch } from './deletionRequestPayloads';

function toDomain(document: DeletionRequestDocument): DeletionRequest {
  return {
    organizationId: document.organizationId,
    status: document.status,
    attempt: document.attempt,
    requestedBy: document.requestedBy,
    requestedAt: document.requestedAt.toDate().toISOString(),
    exportProof: {
      contentHash: document.exportProof.contentHash,
      exportedAt: document.exportProof.exportedAt,
      counts: { ...document.exportProof.counts },
    },
    cancelledAt: document.cancelledAt === null ? null : document.cancelledAt.toDate().toISOString(),
    revision: document.revision,
  };
}

function isPermissionDenied(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'permission-denied'
  );
}

export class FirestoreDeletionRequestGateway implements DeletionRequestGateway {
  constructor(private readonly db: Firestore) {}

  private ref(organizationId: string): DocumentReference {
    return doc(this.db, 'organizations', organizationId, 'deletionRequests', 'current');
  }

  async read(organizationId: string): Promise<DeletionRequestReadResult> {
    try {
      const snap = await getDoc(this.ref(organizationId).withConverter(deletionRequestConverter));
      return { ok: true, request: snap.exists() ? toDomain(snap.data()) : null };
    } catch (detail) {
      return { ok: false, error: { code: 'read-failed', detail } };
    }
  }

  async create(
    organizationId: string,
    exportProof: DeletionExportProof,
  ): Promise<DeletionRequestWriteResult> {
    const uid = getAuth(this.db.app).currentUser?.uid;
    if (!uid) return { ok: false, error: { code: 'not-signed-in' } };
    return this.write(organizationId, () =>
      setDoc(this.ref(organizationId), buildCreatePayload(organizationId, uid, exportProof)),
    );
  }

  async cancel(
    organizationId: string,
    expected: DeletionRequest,
  ): Promise<DeletionRequestWriteResult> {
    return this.write(organizationId, () =>
      updateDoc(this.ref(organizationId), buildCancelPatch(expected)),
    );
  }

  async restart(
    organizationId: string,
    expected: DeletionRequest,
    exportProof: DeletionExportProof,
  ): Promise<DeletionRequestWriteResult> {
    const uid = getAuth(this.db.app).currentUser?.uid;
    if (!uid) return { ok: false, error: { code: 'not-signed-in' } };
    return this.write(organizationId, () =>
      updateDoc(this.ref(organizationId), buildRestartPatch(expected, uid, exportProof)),
    );
  }

  /** Voert de write uit en leest het document daarna terug: geen succes zonder serverreadback. */
  private async write(
    organizationId: string,
    perform: () => Promise<void>,
  ): Promise<DeletionRequestWriteResult> {
    try {
      await perform();
    } catch (detail) {
      return isPermissionDenied(detail)
        ? { ok: false, error: { code: 'rejected' } }
        : { ok: false, error: { code: 'failed', detail } };
    }
    const readback = await this.read(organizationId);
    if (!readback.ok || readback.request === null) {
      return {
        ok: false,
        error: {
          code: 'readback-failed',
          detail: readback.ok ? 'document ontbreekt na write' : readback.error.detail,
        },
      };
    }
    return { ok: true, request: readback.request };
  }
}
