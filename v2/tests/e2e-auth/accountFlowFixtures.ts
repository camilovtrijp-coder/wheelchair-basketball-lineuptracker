// PR 8.3c-2d: seed-, lees- en Auth-hulpfuncties voor de e2e van "organisatie verlaten",
// "account verwijderen" en de overdracht (docs/pr-8.3c-2b-plan.md §D, docs/pr-8.3c-2c-plan.md).
// Firestore uitsluitend via `firebase-admin/firestore` (bypass Rules, bewust — zelfde
// precedent als `adminFixtures.ts`/`deletionFixtures.ts`); de Auth-emulator via zijn
// REST-API met de emulator-only beheerdersbearer `owner` (geen sleutel, geen geheim: die
// bearer werkt uitsluitend tegen de emulator). Puur testcode, nooit vanuit `src/`
// geïmporteerd. Fictieve data (`@example.test`).
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { adminDb } from './adminFixtures';
import { uniqueTestEmail } from './helpers';

export const ACCOUNT_PASSWORD = 'AccountFlow123!';
const PROJECT_ID = 'demo-lineup-tracker-dev';

function authEmulator(): string {
  return `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}`;
}

export interface TestUser {
  uid: string;
  /** Het adres zoals de Auth-emulator het opslaat en in het token zet. */
  email: string;
  /** Het adres zoals het bij het aanmaken (en bij het inloggen) is getypt. */
  typedEmail: string;
  password: string;
}

/** Maakt van een uniek adres een variant met hoofdletters (A3/R5). */
function mixedCase(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.charAt(0).toUpperCase()}${local.slice(1, 4).toUpperCase()}${local.slice(4)}@${domain
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('.')}`;
}

/**
 * Maakt een gebruiker aan in de Auth-emulator, standaard met een geverifieerd e-mailadres
 * (accountverwijdering eist een geverifieerde e-mailclaim). `mixedCase` maakt het adres met
 * hoofdletters aan; `email` in het resultaat is wat de emulator teruggeeft.
 */
export async function createUser(
  label: string,
  opts: { mixedCase?: boolean; verified?: boolean } = {},
): Promise<TestUser> {
  const base = uniqueTestEmail(label);
  const typedEmail = opts.mixedCase ? mixedCase(base) : base;
  const response = await fetch(
    `${authEmulator()}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({
        email: typedEmail,
        password: ACCOUNT_PASSWORD,
        emailVerified: opts.verified ?? true,
      }),
    },
  );
  if (!response.ok) throw new Error(`Auth-emulator: aanmaken mislukt (${response.status})`);
  const data = (await response.json()) as { localId?: string; email?: string };
  if (!data.localId || !data.email) throw new Error('Auth-emulator: geen uid/e-mail terug');
  return { uid: data.localId, email: data.email, typedEmail, password: ACCOUNT_PASSWORD };
}

/** Bestaat het Auth-account nog (beheerderslookup op uid in de emulator)? */
export async function authAccountExists(uid: string): Promise<boolean> {
  const response = await fetch(
    `${authEmulator()}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ localId: [uid] }),
    },
  );
  if (!response.ok) throw new Error(`Auth-emulator: lookup mislukt (${response.status})`);
  const data = (await response.json()) as { users?: unknown[] };
  return (data.users?.length ?? 0) > 0;
}

/** Het gewone client-inlogendpoint (zoals de browser-SDK): slaagt het met dit wachtwoord? */
export async function passwordSignInSucceeds(email: string, password: string): Promise<boolean> {
  const response = await fetch(
    `${authEmulator()}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  return response.ok;
}

/** De e-mailclaim in een vers ID-token van deze gebruiker (A3: kleine letters?). */
export async function tokenEmailClaim(typedEmail: string, password: string): Promise<string> {
  const response = await fetch(
    `${authEmulator()}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: typedEmail, password, returnSecureToken: true }),
    },
  );
  if (!response.ok) throw new Error(`inloggen mislukt (${response.status})`);
  const data = (await response.json()) as { idToken: string };
  const payload = data.idToken.split('.')[1] ?? '';
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    email?: string;
  };
  return claims.email ?? '';
}

export interface Org {
  orgId: string;
  orgName: string;
  teamIds: string[];
}

/** Organisatie met `teamCount` teams. `createdBy`/`createdAt` voor de maker-/R6-gevallen. */
export async function seedOrg(
  orgName: string,
  opts: { teamCount?: number; createdBy?: string; createdAt?: Date } = {},
): Promise<Org> {
  const orgRef = adminDb().collection('organizations').doc();
  await orgRef.set({
    name: orgName,
    createdBy: opts.createdBy ?? 'uid-seed-maker',
    createdAt: opts.createdAt ?? new Date(),
  });
  const teamIds: string[] = [];
  for (let i = 0; i < (opts.teamCount ?? 1); i += 1) {
    const teamRef = orgRef.collection('teams').doc();
    await teamRef.set({
      name: `${orgName} Team ${i + 1}`,
      orgName,
      createdBy: opts.createdBy ?? 'uid-seed-maker',
      createdAt: new Date(),
    });
    teamIds.push(teamRef.id);
  }
  return { orgId: orgRef.id, orgName, teamIds };
}

export type OrgRole = 'organizationOwner' | 'organizationAdmin' | 'coach' | 'scorer' | 'viewer';
export type TeamRole = 'coach' | 'scorer' | 'viewer';

export async function seedMember(org: Org, user: Pick<TestUser, 'uid' | 'email'>, role: OrgRole) {
  await adminDb()
    .doc(`organizations/${org.orgId}/organizationMembers/${user.uid}`)
    .set({ role, email: user.email, uid: user.uid, joinedAt: new Date() });
}

export async function seedTeamMember(
  org: Org,
  teamId: string,
  user: Pick<TestUser, 'uid' | 'email'>,
  role: TeamRole,
) {
  await adminDb()
    .doc(`organizations/${org.orgId}/teams/${teamId}/teamMembers/${user.uid}`)
    .set({ role, email: user.email, uid: user.uid, addedAt: new Date() });
}

export type InvitationStatus = 'pending' | 'accepted' | 'claimed' | 'revoked';

/** Uitnodiging in exact de vorm die `invitationConverter` inleest; geeft het pad terug. */
export async function seedInvitation(
  org: Org,
  email: string,
  status: InvitationStatus,
  role: OrgRole = 'viewer',
): Promise<string> {
  const ref = adminDb().collection(`organizations/${org.orgId}/invitations`).doc();
  const now = Timestamp.now();
  await ref.set({
    email,
    role,
    status,
    invitedBy: 'uid-seed-maker',
    invitedAt: now,
    acceptedAt: status === 'accepted' || status === 'claimed' ? now : null,
    ...(status === 'claimed' ? { claimedAt: now } : {}),
    ...(status === 'revoked' ? { revokedAt: now } : {}),
  });
  return ref.path;
}

/** Een open verwijderverzoek (`requested`) in de vorm die `deletionRequestConverter` eist. */
export async function seedDeletionRequest(org: Org, requestedBy: string): Promise<void> {
  await adminDb()
    .doc(`organizations/${org.orgId}/deletionRequests/current`)
    .set({
      organizationId: org.orgId,
      status: 'requested',
      attempt: 1,
      requestedBy,
      requestedAt: Timestamp.now(),
      exportProof: {
        contentHash: 'seed-content-hash',
        exportedAt: new Date().toISOString(),
        counts: {
          organizationMembers: 1,
          teamMembers: 0,
          invitations: 0,
          teams: 1,
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
    });
}

export interface OwnDocuments {
  organizationMembers: string[];
  teamMembers: string[];
  /** `pad#status`, gesorteerd. */
  invitations: string[];
}

/** Serverreadback via Admin: alle documenten die de eigen uid/het eigen adres dragen. */
export async function readOwnDocuments(uid: string, email: string): Promise<OwnDocuments> {
  const db = adminDb();
  const [members, teamMembers, invitations] = await Promise.all([
    db.collectionGroup('organizationMembers').where('uid', '==', uid).get(),
    db.collectionGroup('teamMembers').where('uid', '==', uid).get(),
    db.collectionGroup('invitations').where('email', '==', email).get(),
  ]);
  return {
    organizationMembers: members.docs.map((d) => d.ref.path).sort(),
    teamMembers: teamMembers.docs.map((d) => d.ref.path).sort(),
    invitations: invitations.docs.map((d) => `${d.ref.path}#${String(d.get('status'))}`).sort(),
  };
}

export async function readMemberRole(org: Org, uid: string): Promise<string | undefined> {
  const snap = await adminDb().doc(`organizations/${org.orgId}/organizationMembers/${uid}`).get();
  return snap.exists ? String(snap.get('role')) : undefined;
}

export async function readInvitationStatus(path: string): Promise<string | undefined> {
  const snap = await adminDb().doc(path).get();
  return snap.exists ? String(snap.get('status')) : undefined;
}

async function walk(ref: DocumentReference, out: Record<string, unknown>): Promise<void> {
  const snap = await ref.get();
  if (snap.exists) {
    out[ref.path] = {
      // `updateTime` mee: ook een write met identieke inhoud zou opvallen.
      updateTime: `${snap.updateTime?.seconds}.${snap.updateTime?.nanoseconds}`,
      data: JSON.parse(JSON.stringify(snap.data())) as unknown,
    };
  }
  for (const collection of await ref.listCollections()) {
    for (const child of await collection.listDocuments()) await walk(child, out);
  }
}

/**
 * Volledige momentopname van een organisatie (elk document in elke subcollectie, met
 * inhoud én `updateTime`). Twee gelijke opnames bewijzen dat er niets is geschreven.
 */
export async function snapshotOrganization(org: Org): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  await walk(adminDb().doc(`organizations/${org.orgId}`), out);
  return out;
}

/**
 * Een tweede, volledig gevulde organisatie waarin de testgebruiker(s) GEEN rol hebben,
 * met een ander lid, een teamlid en een uitnodiging: elke flow moet haar byte-identiek laten.
 */
export async function seedBystanderOrg(label: string): Promise<Org> {
  const org = await seedOrg(`${label} Omstander-Org`, { teamCount: 2 });
  const other = { uid: `uid-omstander-${org.orgId}`, email: `omstander-${org.orgId}@example.test` };
  await seedMember(org, other, 'organizationOwner');
  await seedTeamMember(org, org.teamIds[0] ?? '', other, 'coach');
  await seedInvitation(org, `uitgenodigd-${org.orgId}@example.test`, 'pending', 'coach');
  return org;
}
