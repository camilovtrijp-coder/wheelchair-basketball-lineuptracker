// Pure payloadbouw voor `organizations/{orgId}/deletionRequests/current`
// (PR 8.3c-1 deel 2). Bewust een eigen bestand zonder enige Firestore-padopbouw
// en zonder Auth: de gateway gebruikt deze functies voor iedere
// write, en een Rules-test in `firebase/tests/rules` importeert ze om te bewijzen
// dat PRECIES wat de gateway schrijft door de echte Security Rules komt — zodat de
// payloadvorm en de Rules niet ongemerkt uit elkaar kunnen lopen.
import { serverTimestamp } from 'firebase/firestore';
import type { DeletionExportProof, DeletionRequest } from '../../domain/deletion/types';

export function buildCreatePayload(
  organizationId: string,
  requestedBy: string,
  exportProof: DeletionExportProof,
) {
  return {
    organizationId,
    status: 'requested' as const,
    attempt: 1,
    requestedBy,
    requestedAt: serverTimestamp(),
    exportProof,
    cancelledAt: null,
    revision: 0,
  };
}

export function buildCancelPatch(expected: Pick<DeletionRequest, 'revision'>) {
  return {
    status: 'cancelled' as const,
    cancelledAt: serverTimestamp(),
    revision: expected.revision + 1,
  };
}

export function buildRestartPatch(
  expected: Pick<DeletionRequest, 'attempt' | 'revision'>,
  requestedBy: string,
  exportProof: DeletionExportProof,
) {
  return {
    status: 'requested' as const,
    attempt: expected.attempt + 1,
    requestedBy,
    requestedAt: serverTimestamp(),
    exportProof,
    cancelledAt: null,
    revision: expected.revision + 1,
  };
}
