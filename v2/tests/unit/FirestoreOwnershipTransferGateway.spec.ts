// PR 8.3c-2b-iii — FirestoreOwnershipTransferGateway met gemockte Firestore/Auth (fictieve
// data). Bewijst: de aanroeper komt uit de Auth-sessie en het EIGEN membershippad; elke
// read via de server-varianten (`getDocsFromServer`/`getDocFromServer` of een transactie,
// nooit `getDocs`/`getDoc`); rolgevoelige writes alleen in een transactie met de verwachte
// rol als voorwaarde (geen write bij een afwijking); exact de patches uit
// `ownershipTransferPaths.ts`; de eigen uid als doel → geen write; intrekken raakt alleen
// open uitnodigingen op dat adres in die organisatie; readback na elke write en
// classificatie van een Rules-weigering met een readback. De echte Rules beoordelen
// dezelfde bouwers en de echte gateway in
// firebase/tests/rules/ownership-transfer-gateway.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  getDocFromServer: vi.fn(),
  getDocsFromServer: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
}));
vi.mock('firebase/auth', () => ({ getAuth: vi.fn() }));

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { DocumentValidationError } from 'firebase-base/documents';
import {
  FirestoreOwnershipTransferGateway,
  OWNERSHIP_TRANSFER_TIMEOUT_MS,
} from '../../src/infrastructure/account/FirestoreOwnershipTransferGateway';
import { createAccountServices } from '../../src/infrastructure/account/createAccountServices';
import { OwnershipTransferCoordinator } from '../../src/application/account/OwnershipTransferCoordinator';

const ME = 'uid-fictief-nieuwe-owner';
const A = 'uid-fictief-vorige-owner';
const COACH = 'uid-fictief-coach';
const A_EMAIL = 'vorige-owner@example.test';
const ORG = 'org-fictief-a';
const ORG_B = 'org-fictief-b';
const SERVER_TIME = { __serverTimestamp: true };

const fakeDb = { app: {} } as unknown as Firestore;

/** In-memory "server": documentpad → data. */
const server = new Map<string, Record<string, unknown>>();
/** Paden waarvan `data()` gooit (converterfout). */
const throwOn = new Set<string>();
/** Paden waarop Rules elke write weigeren (`permission-denied`). */
const denyWrite = new Set<string>();
/** Paden waarop Rules elke directe get weigeren. */
const denyRead = new Set<string>();
/** Wordt vlak vóór elke write (of commit) aangeroepen: laat de "server" tussendoor veranderen. */
let beforeWrite: (path: string) => void = () => {};

interface FakeRef {
  kind: 'doc' | 'col';
  path: string;
  id: string;
  withConverter: () => FakeRef;
}

function firestoreError(code: string) {
  return Object.assign(new Error(code), { code });
}

function fakeSnap(path: string) {
  return {
    id: path.split('/').at(-1)!,
    ref: { path },
    exists: () => server.has(path),
    data: () => {
      if (throwOn.has(path)) throw new DocumentValidationError('test', 'role', 'ongeldig');
      return server.get(path);
    },
  };
}

function checkWrite(path: string) {
  if (denyWrite.has(path)) throw firestoreError('permission-denied');
}

function applyPatch(path: string, patch: Record<string, unknown>) {
  const resolved = Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [key, value === SERVER_TIME ? 'NU' : value]),
  );
  server.set(path, { ...server.get(path), ...resolved });
}

function setupMocks() {
  const makeRef =
    (kind: FakeRef['kind']) =>
    (_db: unknown, ...segments: string[]): FakeRef => {
      const ref: FakeRef = {
        kind,
        path: segments.join('/'),
        id: segments.at(-1)!,
        withConverter: () => ref,
      };
      return ref;
    };
  (doc as Mock).mockImplementation(makeRef('doc'));
  (collection as Mock).mockImplementation(makeRef('col'));
  (serverTimestamp as Mock).mockReturnValue(SERVER_TIME);
  (getDocsFromServer as Mock).mockImplementation(async (target: FakeRef) => {
    if (denyRead.has(target.path)) throw firestoreError('permission-denied');
    const paths = [...server.keys()].filter(
      (path) => path.split('/').slice(0, -1).join('/') === target.path,
    );
    return { docs: paths.map(fakeSnap) };
  });
  (getDocFromServer as Mock).mockImplementation(async (ref: FakeRef) => {
    if (denyRead.has(ref.path)) throw firestoreError('permission-denied');
    return fakeSnap(ref.path);
  });
  (updateDoc as Mock).mockImplementation(async (ref: FakeRef, patch: Record<string, unknown>) => {
    beforeWrite(ref.path);
    checkWrite(ref.path);
    applyPatch(ref.path, patch);
  });
  (deleteDoc as Mock).mockImplementation(async (ref: FakeRef) => {
    beforeWrite(ref.path);
    checkWrite(ref.path);
    server.delete(ref.path);
  });
  // Transactie: reads van de "server", writes gebufferd en pas bij de commit — atomair.
  // Zoals de client-SDK: elk in de transactie gelezen document moet bij de commit nog
  // dezelfde versie hebben; anders herhaalt de transactie zich (max. 5 pogingen).
  (runTransaction as Mock).mockImplementation(
    async (_db: unknown, update: (tx: unknown) => Promise<unknown>) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const writes: (['update', string, Record<string, unknown>] | ['delete', string])[] = [];
        const readVersions = new Map<string, string>();
        const version = (path: string) => JSON.stringify(server.get(path) ?? null);
        const transaction = {
          get: async (ref: FakeRef) => {
            transactionReads.push(ref.path);
            if (denyRead.has(ref.path)) throw firestoreError('permission-denied');
            readVersions.set(ref.path, version(ref.path));
            return fakeSnap(ref.path);
          },
          update: (ref: FakeRef, patch: Record<string, unknown>) => {
            writes.push(['update', ref.path, patch]);
          },
          delete: (ref: FakeRef) => {
            writes.push(['delete', ref.path]);
          },
        };
        const result = await update(transaction);
        beforeCommit();
        if ([...readVersions].some(([path, read]) => version(path) !== read)) continue;
        for (const write of writes) beforeWrite(write[1]);
        for (const write of writes) checkWrite(write[1]);
        for (const write of writes) {
          if (write[0] === 'update') applyPatch(write[1], write[2]);
          else server.delete(write[1]);
        }
        transactionWrites.push(...writes);
        return result;
      }
      throw firestoreError('aborted');
    },
  );
}

const transactionWrites: unknown[] = [];
/** Elk pad dat een transactie (in elke poging) las, in volgorde. */
const transactionReads: string[] = [];
/** Wordt in elke transactiepoging vlak vóór de commit aangeroepen (gelijktijdige commit). */
let beforeCommit: () => void = () => {};

function signIn(uid: string | null = ME) {
  (getAuth as Mock).mockReturnValue({ currentUser: uid === null ? null : { uid } });
}

const memberPath = (orgId: string, uid: string) =>
  `organizations/${orgId}/organizationMembers/${uid}`;
const teamMemberPath = (orgId: string, teamId: string, uid: string) =>
  `organizations/${orgId}/teams/${teamId}/teamMembers/${uid}`;
const invitationPath = (orgId: string, id: string) => `organizations/${orgId}/invitations/${id}`;

function seed() {
  server.clear();
  throwOn.clear();
  denyWrite.clear();
  denyRead.clear();
  transactionWrites.length = 0;
  transactionReads.length = 0;
  beforeWrite = () => {};
  beforeCommit = () => {};
  const member = (orgId: string, uid: string, role: string, email: string) =>
    server.set(memberPath(orgId, uid), { role, email, uid });
  member(ORG, ME, 'organizationOwner', 'nieuwe-owner@example.test');
  member(ORG, A, 'organizationOwner', A_EMAIL);
  member(ORG, COACH, 'coach', 'coach@example.test');
  member(ORG_B, A, 'organizationOwner', A_EMAIL);

  for (const teamId of ['team-1', 'team-2', 'team-3']) {
    server.set(`organizations/${ORG}/teams/${teamId}`, { name: teamId });
  }
  server.set(teamMemberPath(ORG, 'team-1', A), { role: 'coach', email: A_EMAIL, uid: A });
  server.set(teamMemberPath(ORG, 'team-2', A), { role: 'scorer', email: A_EMAIL, uid: A });
  server.set(teamMemberPath(ORG, 'team-1', COACH), {
    role: 'coach',
    email: 'coach@example.test',
    uid: COACH,
  });
  server.set(`organizations/${ORG_B}/teams/team-x`, { name: 'team-x' });
  server.set(teamMemberPath(ORG_B, 'team-x', A), { role: 'coach', email: A_EMAIL, uid: A });

  const invitation = (orgId: string, id: string, email: string, status: string) =>
    server.set(invitationPath(orgId, id), { email, status, role: 'organizationAdmin' });
  invitation(ORG, 'inv-pending', A_EMAIL, 'pending');
  invitation(ORG, 'inv-accepted', 'Vorige-Owner@Example.TEST', 'accepted');
  invitation(ORG, 'inv-claimed', A_EMAIL, 'claimed');
  invitation(ORG, 'inv-revoked', A_EMAIL, 'revoked');
  invitation(ORG, 'inv-ander', 'coach@example.test', 'pending');
  invitation(ORG_B, 'inv-org-b', A_EMAIL, 'pending');
}

let gateway: FirestoreOwnershipTransferGateway;

beforeEach(() => {
  vi.clearAllMocks();
  setupMocks();
  seed();
  signIn();
  gateway = new FirestoreOwnershipTransferGateway(fakeDb);
});

afterEach(() => {
  vi.useRealTimers();
  // Geen enkele read mag uit de cache kunnen komen.
  expect(getDocs).not.toHaveBeenCalled();
  expect(getDoc).not.toHaveBeenCalled();
});

function writtenPaths(): string[] {
  return [
    ...(updateDoc as Mock).mock.calls.map((call) => `update:${(call[0] as FakeRef).path}`),
    ...(deleteDoc as Mock).mock.calls.map((call) => `delete:${(call[0] as FakeRef).path}`),
  ];
}

/** Laat de eerste aanroep van `fn` nooit afronden, zodat de timeout van de gateway afgaat. */
async function expectTimeout<T>(fn: Mock, run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  fn.mockImplementationOnce(() => new Promise(() => {}));
  const pending = run();
  await vi.advanceTimersByTimeAsync(OWNERSHIP_TRANSFER_TIMEOUT_MS + 1);
  return pending;
}

describe('readCaller', () => {
  it('leest het EIGEN membership van de server; de uid komt uit de sessie', async () => {
    expect(await gateway.readCaller(ORG)).toEqual({
      ok: true,
      caller: { uid: ME, role: 'organizationOwner' },
    });
    expect((getDocFromServer as Mock).mock.calls.map((c) => (c[0] as FakeRef).path)).toEqual([
      memberPath(ORG, ME),
    ]);
  });

  it('niet ingelogd → not-signed-in zonder read', async () => {
    signIn(null);
    expect(await gateway.readCaller(ORG)).toEqual({ ok: false, error: { code: 'not-signed-in' } });
    expect(getDocFromServer).not.toHaveBeenCalled();
  });

  it('geen membership (document ontbreekt of Rules weigeren de get) → caller null', async () => {
    expect(await gateway.readCaller('org-fictief-vreemd')).toEqual({ ok: true, caller: null });
    denyRead.add(memberPath(ORG, ME));
    expect(await gateway.readCaller(ORG)).toEqual({ ok: true, caller: null });
  });

  it('offline → offline; failed-precondition → read-failed (niet offline)', async () => {
    (getDocFromServer as Mock).mockRejectedValueOnce(firestoreError('unavailable'));
    expect(await gateway.readCaller(ORG)).toEqual({ ok: false, error: { code: 'offline' } });
    (getDocFromServer as Mock).mockRejectedValueOnce(firestoreError('failed-precondition'));
    expect(await gateway.readCaller(ORG)).toMatchObject({
      ok: false,
      error: { code: 'read-failed' },
    });
  });

  it('converterfout of afwijkend uid-veld → read-failed (fail closed)', async () => {
    throwOn.add(memberPath(ORG, ME));
    expect(await gateway.readCaller(ORG)).toMatchObject({ error: { code: 'read-failed' } });
    throwOn.clear();
    server.set(memberPath(ORG, ME), { role: 'organizationOwner', email: 'x@example.test', uid: A });
    expect(await gateway.readCaller(ORG)).toMatchObject({ error: { code: 'read-failed' } });
  });

  it('geen serverantwoord → timeout', async () => {
    expect(await expectTimeout(getDocFromServer as Mock, () => gateway.readCaller(ORG))).toEqual({
      ok: false,
      error: { code: 'timeout' },
    });
  });
});

describe('listOrganizationMembers', () => {
  it('ongefilterde listing van ÉÉN organisatie, van de server', async () => {
    const result = await gateway.listOrganizationMembers(ORG);
    expect(result).toEqual({
      ok: true,
      members: [
        { uid: ME, role: 'organizationOwner', email: 'nieuwe-owner@example.test' },
        { uid: A, role: 'organizationOwner', email: A_EMAIL },
        { uid: COACH, role: 'coach', email: 'coach@example.test' },
      ],
    });
    expect((getDocsFromServer as Mock).mock.calls.map((c) => (c[0] as FakeRef).path)).toEqual([
      `organizations/${ORG}/organizationMembers`,
    ]);
  });

  it('afwijkend uid-veld of converterfout → read-failed; offline → offline; niet ingelogd', async () => {
    server.set(memberPath(ORG, COACH), { role: 'coach', email: 'c@example.test', uid: A });
    expect(await gateway.listOrganizationMembers(ORG)).toMatchObject({
      error: { code: 'read-failed' },
    });
    seed();
    throwOn.add(memberPath(ORG, COACH));
    expect(await gateway.listOrganizationMembers(ORG)).toMatchObject({
      error: { code: 'read-failed' },
    });
    (getDocsFromServer as Mock).mockRejectedValueOnce(firestoreError('unavailable'));
    expect(await gateway.listOrganizationMembers(ORG)).toEqual({
      ok: false,
      error: { code: 'offline' },
    });
    signIn(null);
    expect(await gateway.listOrganizationMembers(ORG)).toEqual({
      ok: false,
      error: { code: 'not-signed-in' },
    });
  });
});

describe('promoteToOwner', () => {
  it('transactie: leest de rol, zet ALLEEN role op organizationOwner, leest terug', async () => {
    expect(await gateway.promoteToOwner(ORG, COACH, 'coach')).toEqual({
      ok: true,
      outcome: 'promoted',
    });
    expect(transactionWrites).toEqual([
      ['update', memberPath(ORG, COACH), { role: 'organizationOwner' }],
    ]);
    expect(server.get(memberPath(ORG, COACH))).toEqual({
      role: 'organizationOwner',
      email: 'coach@example.test',
      uid: COACH,
    });
    // Readback van de server ná de transactie.
    expect((getDocFromServer as Mock).mock.calls.map((c) => (c[0] as FakeRef).path)).toEqual([
      memberPath(ORG, COACH),
    ]);
  });

  it('eigen uid als doel → self-target, geen transactie', async () => {
    expect(await gateway.promoteToOwner(ORG, ME, 'organizationAdmin')).toEqual({
      ok: false,
      error: { code: 'self-target' },
    });
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('niet ingelogd → not-signed-in, geen transactie', async () => {
    signIn(null);
    expect(await gateway.promoteToOwner(ORG, COACH, 'coach')).toEqual({
      ok: false,
      error: { code: 'not-signed-in' },
    });
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('doel bestaat niet → not-found, geen write', async () => {
    expect(await gateway.promoteToOwner(ORG, 'uid-fictief-vreemd', 'coach')).toEqual({
      ok: false,
      error: { code: 'not-found' },
    });
    expect(transactionWrites).toEqual([]);
  });

  it('al owner → already-owner, geen write', async () => {
    expect(await gateway.promoteToOwner(ORG, A, 'coach')).toEqual({
      ok: true,
      outcome: 'already-owner',
    });
    expect(transactionWrites).toEqual([]);
  });

  it('rol wijkt af van de verwachte rol → role-changed, GEEN write', async () => {
    server.set(memberPath(ORG, COACH), { role: 'viewer', email: 'coach@example.test', uid: COACH });
    expect(await gateway.promoteToOwner(ORG, COACH, 'coach')).toEqual({
      ok: false,
      error: { code: 'role-changed', actualRole: 'viewer' },
    });
    expect(transactionWrites).toEqual([]);
    expect(server.get(memberPath(ORG, COACH))?.role).toBe('viewer');
  });

  it('Rules weigeren (aanroeper geen owner meer) → readback: ongewijzigd → rejected', async () => {
    denyWrite.add(memberPath(ORG, COACH));
    expect(await gateway.promoteToOwner(ORG, COACH, 'coach')).toEqual({
      ok: false,
      error: { code: 'rejected' },
    });
    expect(server.get(memberPath(ORG, COACH))?.role).toBe('coach');
  });

  it('Rules weigeren maar een ander promoveerde tussendoor → already-owner', async () => {
    denyWrite.add(memberPath(ORG, COACH));
    beforeWrite = (path) => {
      if (path === memberPath(ORG, COACH)) {
        server.set(path, { ...server.get(path), role: 'organizationOwner' });
      }
    };
    expect(await gateway.promoteToOwner(ORG, COACH, 'coach')).toEqual({
      ok: true,
      outcome: 'already-owner',
    });
  });

  it('offline → offline; failed-precondition → failed; geen serverantwoord → timeout', async () => {
    (runTransaction as Mock).mockRejectedValueOnce(firestoreError('unavailable'));
    expect(await gateway.promoteToOwner(ORG, COACH, 'coach')).toEqual({
      ok: false,
      error: { code: 'offline' },
    });
    (runTransaction as Mock).mockRejectedValueOnce(firestoreError('failed-precondition'));
    expect(await gateway.promoteToOwner(ORG, COACH, 'coach')).toMatchObject({
      ok: false,
      error: { code: 'failed' },
    });
    expect(
      await expectTimeout(runTransaction as Mock, () =>
        gateway.promoteToOwner(ORG, COACH, 'coach'),
      ),
    ).toEqual({ ok: false, error: { code: 'timeout' } });
  });

  it('readback toont geen owner na een "geslaagde" transactie → failed (geen succes zonder serverbewijs)', async () => {
    (getDocFromServer as Mock).mockImplementationOnce(async () => ({
      exists: () => true,
      data: () => ({ role: 'coach', email: 'coach@example.test', uid: COACH }),
    }));
    expect(await gateway.promoteToOwner(ORG, COACH, 'coach')).toMatchObject({
      ok: false,
      error: { code: 'failed' },
    });
  });

  it('readback offline → offline', async () => {
    (getDocFromServer as Mock).mockRejectedValueOnce(firestoreError('unavailable'));
    expect(await gateway.promoteToOwner(ORG, COACH, 'coach')).toEqual({
      ok: false,
      error: { code: 'offline' },
    });
  });
});

describe('promoteToOwner — eigen membership in de transactie (reviewbevinding A op #108)', () => {
  it('leest in de transactie EERST het eigen membership van de aanroeper, dan het doel', async () => {
    await gateway.promoteToOwner(ORG, COACH, 'coach');
    expect(transactionReads).toEqual([memberPath(ORG, ME), memberPath(ORG, COACH)]);
  });

  it('aanroeper is (volgens de transactie) geen owner meer → rejected, GEEN write', async () => {
    server.set(memberPath(ORG, ME), {
      role: 'organizationAdmin',
      email: 'nieuwe-owner@example.test',
      uid: ME,
    });
    expect(await gateway.promoteToOwner(ORG, COACH, 'coach')).toEqual({
      ok: false,
      error: { code: 'rejected' },
    });
    expect(transactionWrites).toEqual([]);
    expect(server.get(memberPath(ORG, COACH))?.role).toBe('coach');
  });

  it('eigen membership verdwijnt vlak vóór de commit → herhaling ziet het niet → rejected, geen write', async () => {
    beforeCommit = () => {
      if (!server.has(memberPath(ORG, ME))) return;
      // Een andere owner verwijdert ons; daarna weigeren Rules ons elke read in org A.
      server.delete(memberPath(ORG, ME));
      for (const uid of [ME, A, COACH]) denyRead.add(memberPath(ORG, uid));
    };
    expect(await gateway.promoteToOwner(ORG, COACH, 'coach')).toEqual({
      ok: false,
      error: { code: 'rejected' },
    });
    expect(transactionWrites).toEqual([]);
    expect(server.get(memberPath(ORG, COACH))?.role).toBe('coach');
  });

  it('eigen membership met afwijkend uid-veld → failed (fail closed), geen write', async () => {
    server.set(memberPath(ORG, ME), { role: 'organizationOwner', email: 'x@example.test', uid: A });
    expect(await gateway.promoteToOwner(ORG, COACH, 'coach')).toMatchObject({
      ok: false,
      error: { code: 'failed' },
    });
    expect(transactionWrites).toEqual([]);
  });
});

describe('promoteToOwner — readback na een timeout', () => {
  it('transactie loopt uit maar het doel is daarna owner → ok/promoted (één readback)', async () => {
    const result = await expectTimeout(runTransaction as Mock, () => {
      const pending = gateway.promoteToOwner(ORG, COACH, 'coach');
      // De commit landt alsnog, na het verstrijken van de timeout maar vóór de readback.
      server.set(memberPath(ORG, COACH), {
        role: 'organizationOwner',
        email: 'coach@example.test',
        uid: COACH,
      });
      return pending;
    });
    expect(result).toEqual({ ok: true, outcome: 'promoted' });
    expect((getDocFromServer as Mock).mock.calls.map((c) => (c[0] as FakeRef).path)).toEqual([
      memberPath(ORG, COACH),
    ]);
  });

  it('doel ongewijzigd → timeout; readback zelf mislukt → timeout', async () => {
    expect(
      await expectTimeout(runTransaction as Mock, () =>
        gateway.promoteToOwner(ORG, COACH, 'coach'),
      ),
    ).toEqual({ ok: false, error: { code: 'timeout' } });
    expect(getDocFromServer).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    (getDocFromServer as Mock).mockRejectedValueOnce(firestoreError('unavailable'));
    expect(
      await expectTimeout(runTransaction as Mock, () =>
        gateway.promoteToOwner(ORG, COACH, 'coach'),
      ),
    ).toEqual({ ok: false, error: { code: 'timeout' } });
  });
});

describe('revokeOpenInvitationsForEmail', () => {
  it('trekt ALLEEN open uitnodigingen op dat adres (elke spelling) in deze organisatie in', async () => {
    expect(await gateway.revokeOpenInvitationsForEmail(ORG, A_EMAIL)).toEqual({
      ok: true,
      revoked: 2,
      alreadyClosed: 0,
      skippedMalformed: 0,
    });
    expect(writtenPaths()).toEqual([
      `update:${invitationPath(ORG, 'inv-pending')}`,
      `update:${invitationPath(ORG, 'inv-accepted')}`,
    ]);
    // Exact de patch die Rules toestaan: status + servergebonden revokedAt.
    for (const call of (updateDoc as Mock).mock.calls) {
      expect(call[1]).toEqual({ status: 'revoked', revokedAt: SERVER_TIME });
    }
    expect(server.get(invitationPath(ORG, 'inv-claimed'))?.status).toBe('claimed');
    expect(server.get(invitationPath(ORG, 'inv-revoked'))?.status).toBe('revoked');
    expect(server.get(invitationPath(ORG, 'inv-revoked'))?.revokedAt).toBeUndefined();
    expect(server.get(invitationPath(ORG, 'inv-ander'))?.status).toBe('pending');
    expect(server.get(invitationPath(ORG_B, 'inv-org-b'))?.status).toBe('pending');
    // Listing alleen van deze organisatie; elke intrekking teruggelezen.
    expect((getDocsFromServer as Mock).mock.calls.map((c) => (c[0] as FakeRef).path)).toEqual([
      `organizations/${ORG}/invitations`,
    ]);
    expect((getDocFromServer as Mock).mock.calls.map((c) => (c[0] as FakeRef).path)).toEqual([
      invitationPath(ORG, 'inv-pending'),
      invitationPath(ORG, 'inv-accepted'),
    ]);
  });

  it('niets open → ok 0, geen write; tweede aanroep idempotent', async () => {
    await gateway.revokeOpenInvitationsForEmail(ORG, A_EMAIL);
    vi.mocked(updateDoc).mockClear();
    expect(await gateway.revokeOpenInvitationsForEmail(ORG, A_EMAIL)).toEqual({
      ok: true,
      revoked: 0,
      alreadyClosed: 0,
      skippedMalformed: 0,
    });
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('Rules weigeren omdat de uitnodiging tussendoor gesloten is → alreadyClosed, verder', async () => {
    denyWrite.add(invitationPath(ORG, 'inv-pending'));
    beforeWrite = (path) => {
      if (path === invitationPath(ORG, 'inv-pending')) {
        server.set(path, { ...server.get(path), status: 'claimed' });
      }
    };
    expect(await gateway.revokeOpenInvitationsForEmail(ORG, A_EMAIL)).toEqual({
      ok: true,
      revoked: 1,
      alreadyClosed: 1,
      skippedMalformed: 0,
    });
  });

  it('Rules weigeren en de uitnodiging staat nog open → rejected, stopt direct', async () => {
    denyWrite.add(invitationPath(ORG, 'inv-pending'));
    expect(await gateway.revokeOpenInvitationsForEmail(ORG, A_EMAIL)).toEqual({
      ok: false,
      error: { code: 'rejected' },
      revoked: 0,
    });
    expect(writtenPaths()).toEqual([`update:${invitationPath(ORG, 'inv-pending')}`]);
  });

  it('offline/timeout halverwege → fout met het aantal al ingetrokken, geen volgende write', async () => {
    (updateDoc as Mock)
      .mockImplementationOnce(async (ref: FakeRef, patch: Record<string, unknown>) => {
        applyPatch(ref.path, patch);
      })
      .mockRejectedValueOnce(firestoreError('unavailable'));
    expect(await gateway.revokeOpenInvitationsForEmail(ORG, A_EMAIL)).toEqual({
      ok: false,
      error: { code: 'offline' },
      revoked: 1,
    });
    seed();
    vi.mocked(updateDoc).mockClear();
    expect(
      await expectTimeout(updateDoc as Mock, () =>
        gateway.revokeOpenInvitationsForEmail(ORG, A_EMAIL),
      ),
    ).toEqual({ ok: false, error: { code: 'timeout' }, revoked: 0 });
    expect(updateDoc).toHaveBeenCalledTimes(1);
  });

  it('listing geweigerd (geen owner/admin) → failed zonder write; offline → offline', async () => {
    denyRead.add(`organizations/${ORG}/invitations`);
    expect(await gateway.revokeOpenInvitationsForEmail(ORG, A_EMAIL)).toMatchObject({
      ok: false,
      error: { code: 'failed' },
      revoked: 0,
    });
    denyRead.clear();
    (getDocsFromServer as Mock).mockRejectedValueOnce(firestoreError('unavailable'));
    expect(await gateway.revokeOpenInvitationsForEmail(ORG, A_EMAIL)).toEqual({
      ok: false,
      error: { code: 'offline' },
      revoked: 0,
    });
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('readback na intrekken toont geen revoked → failed', async () => {
    (updateDoc as Mock).mockImplementationOnce(async () => {});
    expect(await gateway.revokeOpenInvitationsForEmail(ORG, A_EMAIL)).toMatchObject({
      ok: false,
      error: { code: 'failed' },
      revoked: 0,
    });
  });

  it('misvormde uitnodiging van een ánder adres (ongeldige rol/status) blokkeert niet', async () => {
    server.set(invitationPath(ORG, 'inv-ander'), {
      email: 'coach@example.test',
      status: 'onbekend',
      role: 42,
    });
    expect(await gateway.revokeOpenInvitationsForEmail(ORG, A_EMAIL)).toEqual({
      ok: true,
      revoked: 2,
      alreadyClosed: 0,
      skippedMalformed: 0,
    });
    expect(server.get(invitationPath(ORG, 'inv-ander'))?.status).toBe('onbekend');
  });

  it('uitnodiging zonder leesbaar email-veld → overgeslagen en apart geteld, nooit beschreven', async () => {
    server.set(invitationPath(ORG, 'inv-zonder-adres'), { status: 'pending', role: 'coach' });
    server.set(invitationPath(ORG, 'inv-adres-getal'), { email: 7, status: 'accepted' });
    expect(await gateway.revokeOpenInvitationsForEmail(ORG, A_EMAIL)).toEqual({
      ok: true,
      revoked: 2,
      alreadyClosed: 0,
      skippedMalformed: 2,
    });
    expect(writtenPaths()).toEqual([
      `update:${invitationPath(ORG, 'inv-pending')}`,
      `update:${invitationPath(ORG, 'inv-accepted')}`,
    ]);
    expect(server.get(invitationPath(ORG, 'inv-zonder-adres'))?.status).toBe('pending');
    // De footprint telt ze niet als open uitnodiging van A.
    expect(await gateway.readMemberFootprint(ORG, A, A_EMAIL)).toMatchObject({
      ok: true,
      footprint: { openInvitations: 0 },
    });
  });

  it('uitnodiging OP het doeladres met onleesbare status → failed (fail closed), geen write', async () => {
    server.set(invitationPath(ORG, 'inv-a-kapot'), { email: A_EMAIL, status: 'open?' });
    expect(await gateway.revokeOpenInvitationsForEmail(ORG, A_EMAIL)).toMatchObject({
      ok: false,
      error: { code: 'failed' },
      revoked: 0,
    });
    expect(updateDoc).not.toHaveBeenCalled();
    expect(await gateway.readMemberFootprint(ORG, A, A_EMAIL)).toMatchObject({
      ok: false,
      error: { code: 'read-failed' },
    });
  });

  it('readback na intrekken met onleesbare status → failed', async () => {
    (updateDoc as Mock).mockImplementationOnce(async (ref: FakeRef) => {
      server.set(ref.path, { ...server.get(ref.path), status: 'kapot' });
    });
    expect(await gateway.revokeOpenInvitationsForEmail(ORG, A_EMAIL)).toMatchObject({
      ok: false,
      error: { code: 'failed' },
      revoked: 0,
    });
  });

  it('niet ingelogd → not-signed-in zonder read', async () => {
    signIn(null);
    expect(await gateway.revokeOpenInvitationsForEmail(ORG, A_EMAIL)).toEqual({
      ok: false,
      error: { code: 'not-signed-in' },
      revoked: 0,
    });
    expect(getDocsFromServer).not.toHaveBeenCalled();
  });
});

describe('removeTeamMembershipsOf', () => {
  it('verwijdert het teamMembers-document van het doel in elk team van DEZE organisatie, met readback', async () => {
    expect(await gateway.removeTeamMembershipsOf(ORG, A)).toEqual({ ok: true, removed: 2 });
    expect(writtenPaths()).toEqual([
      `delete:${teamMemberPath(ORG, 'team-1', A)}`,
      `delete:${teamMemberPath(ORG, 'team-2', A)}`,
    ]);
    expect(server.has(teamMemberPath(ORG, 'team-1', COACH))).toBe(true);
    expect(server.has(teamMemberPath(ORG_B, 'team-x', A))).toBe(true);
    expect((getDocsFromServer as Mock).mock.calls.map((c) => (c[0] as FakeRef).path)).toEqual([
      `organizations/${ORG}/teams`,
    ]);
    // Per team een directe server-get vóór en (na een delete) ná.
    expect((getDocFromServer as Mock).mock.calls.map((c) => (c[0] as FakeRef).path)).toEqual([
      teamMemberPath(ORG, 'team-1', A),
      teamMemberPath(ORG, 'team-1', A),
      teamMemberPath(ORG, 'team-2', A),
      teamMemberPath(ORG, 'team-2', A),
      teamMemberPath(ORG, 'team-3', A),
    ]);
  });

  it('idempotent: niets meer → ok 0 zonder delete', async () => {
    await gateway.removeTeamMembershipsOf(ORG, A);
    vi.mocked(deleteDoc).mockClear();
    expect(await gateway.removeTeamMembershipsOf(ORG, A)).toEqual({ ok: true, removed: 0 });
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('eigen uid → self-target; niet ingelogd → not-signed-in; beide zonder read of write', async () => {
    expect(await gateway.removeTeamMembershipsOf(ORG, ME)).toEqual({
      ok: false,
      error: { code: 'self-target' },
      removed: 0,
    });
    signIn(null);
    expect(await gateway.removeTeamMembershipsOf(ORG, A)).toEqual({
      ok: false,
      error: { code: 'not-signed-in' },
      removed: 0,
    });
    expect(getDocsFromServer).not.toHaveBeenCalled();
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('Rules weigeren en het document staat er nog → rejected; tussendoor weg → overslaan', async () => {
    denyWrite.add(teamMemberPath(ORG, 'team-1', A));
    expect(await gateway.removeTeamMembershipsOf(ORG, A)).toEqual({
      ok: false,
      error: { code: 'rejected' },
      removed: 0,
    });
    beforeWrite = (path) => server.delete(path);
    expect(await gateway.removeTeamMembershipsOf(ORG, A)).toEqual({ ok: true, removed: 1 });
  });

  it('offline bij een delete → offline met het aantal tot dan toe', async () => {
    (deleteDoc as Mock)
      .mockImplementationOnce(async (ref: FakeRef) => {
        server.delete(ref.path);
      })
      .mockRejectedValueOnce(firestoreError('unavailable'));
    expect(await gateway.removeTeamMembershipsOf(ORG, A)).toEqual({
      ok: false,
      error: { code: 'offline' },
      removed: 1,
    });
  });

  it('readback toont het document nog → failed', async () => {
    (deleteDoc as Mock).mockImplementationOnce(async () => {});
    expect(await gateway.removeTeamMembershipsOf(ORG, A)).toMatchObject({
      ok: false,
      error: { code: 'failed' },
      removed: 0,
    });
  });

  it('teamlisting offline → offline, geen delete', async () => {
    (getDocsFromServer as Mock).mockRejectedValueOnce(firestoreError('unavailable'));
    expect(await gateway.removeTeamMembershipsOf(ORG, A)).toEqual({
      ok: false,
      error: { code: 'offline' },
      removed: 0,
    });
    expect(deleteDoc).not.toHaveBeenCalled();
  });
});

describe('removeOrganizationMember', () => {
  it('transactie: leest de rol, verwijdert, leest terug', async () => {
    expect(await gateway.removeOrganizationMember(ORG, A, 'organizationOwner')).toEqual({
      ok: true,
      outcome: 'deleted',
    });
    expect(transactionWrites).toEqual([['delete', memberPath(ORG, A)]]);
    expect(server.has(memberPath(ORG, A))).toBe(false);
    expect(server.has(memberPath(ORG_B, A))).toBe(true);
    expect((getDocFromServer as Mock).mock.calls.map((c) => (c[0] as FakeRef).path)).toEqual([
      memberPath(ORG, A),
    ]);
  });

  it('al weg → already-gone zonder delete', async () => {
    server.delete(memberPath(ORG, A));
    expect(await gateway.removeOrganizationMember(ORG, A, 'organizationOwner')).toEqual({
      ok: true,
      outcome: 'already-gone',
    });
    expect(transactionWrites).toEqual([]);
  });

  it('rol wijkt af (bijv. tussendoor gedemoveerd) → role-changed, GEEN delete', async () => {
    server.set(memberPath(ORG, A), { role: 'organizationAdmin', email: A_EMAIL, uid: A });
    expect(await gateway.removeOrganizationMember(ORG, A, 'organizationOwner')).toEqual({
      ok: false,
      error: { code: 'role-changed', actualRole: 'organizationAdmin' },
    });
    expect(transactionWrites).toEqual([]);
    expect(server.has(memberPath(ORG, A))).toBe(true);
  });

  it('eigen uid → self-target zonder transactie', async () => {
    expect(await gateway.removeOrganizationMember(ORG, ME, 'organizationOwner')).toEqual({
      ok: false,
      error: { code: 'self-target' },
    });
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('Rules weigeren (bijv. admin op een owner) → readback: staat er nog → rejected', async () => {
    denyWrite.add(memberPath(ORG, A));
    expect(await gateway.removeOrganizationMember(ORG, A, 'organizationOwner')).toEqual({
      ok: false,
      error: { code: 'rejected' },
    });
    expect(server.has(memberPath(ORG, A))).toBe(true);
  });

  it('Rules weigeren en het membership is tussendoor weg → already-gone', async () => {
    denyWrite.add(memberPath(ORG, A));
    beforeWrite = (path) => server.delete(path);
    expect(await gateway.removeOrganizationMember(ORG, A, 'organizationOwner')).toEqual({
      ok: true,
      outcome: 'already-gone',
    });
  });

  it('offline → offline; timeout → timeout; readback toont het nog → failed', async () => {
    (runTransaction as Mock).mockRejectedValueOnce(firestoreError('unavailable'));
    expect(await gateway.removeOrganizationMember(ORG, A, 'organizationOwner')).toEqual({
      ok: false,
      error: { code: 'offline' },
    });
    expect(
      await expectTimeout(runTransaction as Mock, () =>
        gateway.removeOrganizationMember(ORG, A, 'organizationOwner'),
      ),
    ).toEqual({ ok: false, error: { code: 'timeout' } });
    vi.useRealTimers();
    (runTransaction as Mock).mockResolvedValueOnce('deleted');
    expect(await gateway.removeOrganizationMember(ORG, A, 'organizationOwner')).toMatchObject({
      ok: false,
      error: { code: 'failed' },
    });
  });
});

describe('removeOrganizationMember — eigen membership in de transactie (reviewbevinding A op #108)', () => {
  it('leest in de transactie EERST het eigen membership van de aanroeper, dan het doel', async () => {
    await gateway.removeOrganizationMember(ORG, A, 'organizationOwner');
    expect(transactionReads).toEqual([memberPath(ORG, ME), memberPath(ORG, A)]);
  });

  it('aanroeper is (volgens de transactie) geen owner meer → rejected, GEEN delete', async () => {
    server.set(memberPath(ORG, ME), {
      role: 'organizationAdmin',
      email: 'nieuwe-owner@example.test',
      uid: ME,
    });
    expect(await gateway.removeOrganizationMember(ORG, A, 'organizationOwner')).toEqual({
      ok: false,
      error: { code: 'rejected' },
    });
    expect(transactionWrites).toEqual([]);
    expect(server.has(memberPath(ORG, A))).toBe(true);
  });

  it('twee owners verwijderen elkaar tegelijk: A wint vlak vóór onze commit → herhaling → rejected, A blijft owner', async () => {
    beforeCommit = () => {
      if (!server.has(memberPath(ORG, ME))) return;
      // De gelijktijdige transactie van A verwijdert ons membership en commit eerst.
      server.delete(memberPath(ORG, ME));
      for (const uid of [ME, A, COACH]) denyRead.add(memberPath(ORG, uid));
    };
    expect(await gateway.removeOrganizationMember(ORG, A, 'organizationOwner')).toEqual({
      ok: false,
      error: { code: 'rejected' },
    });
    expect(transactionWrites).toEqual([]);
    expect(server.get(memberPath(ORG, A))?.role).toBe('organizationOwner');
    // De tweede poging las opnieuw het eigen membership (geweigerd) en schreef niets.
    expect(transactionReads.filter((path) => path === memberPath(ORG, ME))).toHaveLength(2);
  });

  it('eigen membership geweigerd, doel nog leesbaar en aanwezig → rejected', async () => {
    denyRead.add(memberPath(ORG, ME));
    expect(await gateway.removeOrganizationMember(ORG, A, 'organizationOwner')).toEqual({
      ok: false,
      error: { code: 'rejected' },
    });
    expect(transactionWrites).toEqual([]);
  });
});

describe('removeOrganizationMember — readback na een timeout', () => {
  it('transactie loopt uit maar het doel is daarna weg → ok/deleted (één readback)', async () => {
    const result = await expectTimeout(runTransaction as Mock, () => {
      const pending = gateway.removeOrganizationMember(ORG, A, 'organizationOwner');
      server.delete(memberPath(ORG, A));
      return pending;
    });
    expect(result).toEqual({ ok: true, outcome: 'deleted' });
    expect((getDocFromServer as Mock).mock.calls.map((c) => (c[0] as FakeRef).path)).toEqual([
      memberPath(ORG, A),
    ]);
  });

  it('doel staat er nog → timeout; readback offline → timeout', async () => {
    expect(
      await expectTimeout(runTransaction as Mock, () =>
        gateway.removeOrganizationMember(ORG, A, 'organizationOwner'),
      ),
    ).toEqual({ ok: false, error: { code: 'timeout' } });
    vi.useRealTimers();
    (getDocFromServer as Mock).mockRejectedValueOnce(firestoreError('unavailable'));
    expect(
      await expectTimeout(runTransaction as Mock, () =>
        gateway.removeOrganizationMember(ORG, A, 'organizationOwner'),
      ),
    ).toEqual({ ok: false, error: { code: 'timeout' } });
    expect(server.has(memberPath(ORG, A))).toBe(true);
  });
});

describe('readMemberFootprint', () => {
  it('telt membership, teamMembers en open uitnodigingen van de server, alleen in deze organisatie', async () => {
    expect(await gateway.readMemberFootprint(ORG, A, A_EMAIL)).toEqual({
      ok: true,
      footprint: { organizationMember: true, teamMemberships: 2, openInvitations: 2 },
    });
    await gateway.revokeOpenInvitationsForEmail(ORG, A_EMAIL);
    await gateway.removeTeamMembershipsOf(ORG, A);
    await gateway.removeOrganizationMember(ORG, A, 'organizationOwner');
    expect(await gateway.readMemberFootprint(ORG, A, A_EMAIL)).toEqual({
      ok: true,
      footprint: { organizationMember: false, teamMemberships: 0, openInvitations: 0 },
    });
    expect(await gateway.readMemberFootprint(ORG_B, A, A_EMAIL)).toEqual({
      ok: true,
      footprint: { organizationMember: true, teamMemberships: 1, openInvitations: 1 },
    });
  });

  it('offline → offline; niet ingelogd → not-signed-in', async () => {
    (getDocFromServer as Mock).mockRejectedValueOnce(firestoreError('unavailable'));
    expect(await gateway.readMemberFootprint(ORG, A, A_EMAIL)).toEqual({
      ok: false,
      error: { code: 'offline' },
    });
    signIn(null);
    expect(await gateway.readMemberFootprint(ORG, A, A_EMAIL)).toEqual({
      ok: false,
      error: { code: 'not-signed-in' },
    });
  });
});

describe('createAccountServices', () => {
  it('levert de overdrachtsgateway en -coördinator, zonder geselecteerde context', () => {
    const services = createAccountServices(fakeDb);
    expect(services.ownershipTransferGateway).toBeInstanceOf(FirestoreOwnershipTransferGateway);
    expect(services.ownershipTransferCoordinator).toBeInstanceOf(OwnershipTransferCoordinator);
  });
});

describe('end-to-end met de coördinator op de gemockte SDK', () => {
  it('completeTransfer: intrekken → teamMembers → membership als LAATSTE write; org B intact', async () => {
    const { ownershipTransferCoordinator } = createAccountServices(fakeDb);
    expect(await ownershipTransferCoordinator.completeTransfer(ORG, A)).toEqual({
      status: 'ok',
      revokedInvitations: 2,
      skippedMalformedInvitations: 0,
      removedTeamMemberships: 2,
      organizationMember: 'deleted',
    });
    expect(writtenPaths()).toEqual([
      `update:${invitationPath(ORG, 'inv-pending')}`,
      `update:${invitationPath(ORG, 'inv-accepted')}`,
      `delete:${teamMemberPath(ORG, 'team-1', A)}`,
      `delete:${teamMemberPath(ORG, 'team-2', A)}`,
    ]);
    expect(transactionWrites).toEqual([['delete', memberPath(ORG, A)]]);
    // De transactie (membership) komt pas ná de laatste andere write.
    const lastPlainWrite = Math.max(
      ...(updateDoc as Mock).mock.invocationCallOrder,
      ...(deleteDoc as Mock).mock.invocationCallOrder,
    );
    expect((runTransaction as Mock).mock.invocationCallOrder[0]).toBeGreaterThan(lastPlainWrite);
    expect(server.has(memberPath(ORG_B, A))).toBe(true);
    expect(server.get(invitationPath(ORG_B, 'inv-org-b'))?.status).toBe('pending');
  });

  it('promote vanuit een coach-aanroeper → denied, geen transactie', async () => {
    signIn(COACH);
    const { ownershipTransferCoordinator } = createAccountServices(fakeDb);
    expect(await ownershipTransferCoordinator.promote(ORG, COACH)).toEqual({
      status: 'denied',
      reason: 'not-owner',
    });
    expect(runTransaction).not.toHaveBeenCalled();
  });
});
