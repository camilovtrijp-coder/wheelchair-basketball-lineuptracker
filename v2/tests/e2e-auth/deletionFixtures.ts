// PR 8.3c-1c-ii: seed-/leeshulpfuncties voor de e2e van het verwijderverzoek.
// Uitsluitend `firebase-admin/firestore` (bypass Rules, bewust — zelfde precedent als
// `adminFixtures.ts`/`organizationExportFixtures.ts`): elke functie zet een document in
// exact de vorm die de ECHTE converters/export-gateway weer inlezen, zodat de assessment
// in de app over dezelfde velden rekent als in productie. Puur testcode, nooit vanuit
// `src/` geïmporteerd. Fictieve data.
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './adminFixtures';

export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;

export function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

export interface SeededOrg {
  orgId: string;
  teamId: string;
  orgName: string;
  teamName: string;
}

export async function seedBareOrg(orgName: string, teamName: string): Promise<SeededOrg> {
  const orgRef = adminDb().collection('organizations').doc();
  const teamRef = orgRef.collection('teams').doc();
  await orgRef.set({ name: orgName, createdBy: 'seed', createdAt: new Date() });
  await teamRef.set({ name: teamName, orgName, createdBy: 'seed', createdAt: new Date() });
  return { orgId: orgRef.id, teamId: teamRef.id, orgName, teamName };
}

export async function seedOrgMember(
  orgId: string,
  uid: string,
  email: string,
  role: 'organizationOwner' | 'organizationAdmin' | 'coach' | 'scorer' | 'viewer',
): Promise<void> {
  await adminDb()
    .collection('organizations')
    .doc(orgId)
    .collection('organizationMembers')
    .doc(uid)
    .set({ role, email, uid, joinedAt: new Date() });
}

export async function seedTeamMember(
  orgId: string,
  teamId: string,
  uid: string,
  email: string,
  role: 'coach' | 'scorer' | 'viewer',
): Promise<void> {
  await adminDb()
    .collection('organizations')
    .doc(orgId)
    .collection('teams')
    .doc(teamId)
    .collection('teamMembers')
    .doc(uid)
    .set({ role, email, uid, addedAt: new Date() });
}

const PLAYER = {
  id: 'p1',
  rosterId: 1,
  nr: '4',
  naam: 'Speler Een',
  kl: '3.0',
  vrouw: false,
  jeugd: false,
  participate: true,
  start: true,
};

/**
 * Een NIET-afgeronde wedstrijd (`completedGameId: null`). `lastActivityAgoMs: null` betekent
 * "nog geen writer geclaimd" (`lastWriterActivityAt: null`, geen writer).
 */
export async function seedUnfinishedGame(
  org: SeededOrg,
  opts: { lastActivityAgoMs: number | null; createdAgoMs: number; updatedAgoMs?: number },
): Promise<string> {
  const gameRef = adminDb()
    .collection('organizations')
    .doc(org.orgId)
    .collection('teams')
    .doc(org.teamId)
    .collection('games')
    .doc();
  const claimed = opts.lastActivityAgoMs !== null;
  await gameRef.set({
    organizationId: org.orgId,
    teamId: org.teamId,
    phase: 'setup',
    players: [PLAYER],
    opponent: 'Tegenstander',
    competition: 'Competitie',
    clockDown: true,
    limitStr: '',
    onCourt: [],
    curQuarter: 1,
    beginSec: 0,
    endSec: 600,
    pendingSwapLineup: null,
    scoreFor: 0,
    scoreAgainst: 0,
    segmentCount: 0,
    writerUid: claimed ? 'seed-writer' : null,
    deviceId: claimed ? 'device-seed' : null,
    writerEpoch: 0,
    claimedAt: claimed ? ago(opts.lastActivityAgoMs ?? 0).toISOString() : null,
    lastWriterActivityAt: claimed ? ago(opts.lastActivityAgoMs ?? 0).toISOString() : null,
    revision: 0,
    createdAt: ago(opts.createdAgoMs).toISOString(),
    startedAt: null,
    completedGameId: null,
    updatedAt: Timestamp.fromDate(ago(opts.updatedAgoMs ?? opts.createdAgoMs)),
  });
  return gameRef.id;
}

/** Een afgeronde wedstrijd; `tombstonedAgoMs` zet `deletedAt`/`deletedBy` (een echte tombstone). */
export async function seedCompletedGame(
  org: SeededOrg,
  opts: { tombstonedAgoMs?: number } = {},
): Promise<string> {
  const ref = adminDb()
    .collection('organizations')
    .doc(org.orgId)
    .collection('teams')
    .doc(org.teamId)
    .collection('completedGames')
    .doc();
  const tombstoned = opts.tombstonedAgoMs !== undefined;
  await ref.set({
    organizationId: org.orgId,
    teamId: org.teamId,
    sourceGameId: `source-${ref.id}`,
    opponent: 'Tegenstander',
    competition: 'Competitie',
    date: '2026-01-01T00:00:00.000Z',
    players: [PLAYER],
    segments: [],
    scoreFor: 10,
    scoreAgainst: 8,
    quarterCount: 4,
    periodLabel: 'Kwart',
    useClassLimit: false,
    syncedAt: Timestamp.now(),
    revision: tombstoned ? 1 : 0,
    deletedAt: tombstoned ? Timestamp.fromDate(ago(opts.tombstonedAgoMs ?? 0)) : null,
    deletedBy: tombstoned ? 'uid-verwijderaar' : null,
  });
  return ref.id;
}

export async function seedInvitation(
  orgId: string,
  opts: {
    status: 'pending' | 'accepted' | 'claimed' | 'revoked';
    email: string;
    invitedAgoMs: number;
    statusAgoMs?: number;
  },
): Promise<void> {
  const at = (ms: number) => Timestamp.fromDate(ago(ms));
  const statusAt = opts.statusAgoMs ?? opts.invitedAgoMs;
  await adminDb()
    .collection('organizations')
    .doc(orgId)
    .collection('invitations')
    .doc()
    .set({
      email: opts.email,
      role: 'viewer',
      status: opts.status,
      invitedBy: 'seed',
      invitedAt: at(opts.invitedAgoMs),
      acceptedAt: opts.status === 'accepted' || opts.status === 'claimed' ? at(statusAt) : null,
      ...(opts.status === 'claimed' ? { claimedAt: at(statusAt) } : {}),
      ...(opts.status === 'revoked' ? { revokedAt: at(statusAt) } : {}),
    });
}

export async function seedMigrationRun(
  org: SeededOrg,
  status: 'completed' | 'paused' | 'actionNeeded',
): Promise<void> {
  await adminDb()
    .collection('organizations')
    .doc(org.orgId)
    .collection('teams')
    .doc(org.teamId)
    .collection('migrationRuns')
    .doc()
    .set({ status, manifestHash: 'seed-manifest-hash', updatedAt: Timestamp.now() });
}

export interface StoredDeletionRequest {
  organizationId: string;
  status: string;
  attempt: number;
  requestedBy: string;
  requestedAt: Timestamp;
  exportProof: {
    contentHash: string;
    exportedAt: string;
    counts: Record<string, number>;
  };
  cancelledAt: Timestamp | null;
  revision: number;
}

/** Serverkant-readback via Admin (omzeilt Rules): `undefined` wanneer er geen verzoek bestaat. */
export async function readDeletionRequest(
  orgId: string,
): Promise<StoredDeletionRequest | undefined> {
  const snap = await adminDb()
    .collection('organizations')
    .doc(orgId)
    .collection('deletionRequests')
    .doc('current')
    .get();
  return snap.exists ? (snap.data() as StoredDeletionRequest) : undefined;
}
