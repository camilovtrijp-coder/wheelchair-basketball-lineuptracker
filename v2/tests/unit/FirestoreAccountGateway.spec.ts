// PR 8.3c-2b-i — FirestoreAccountGateway met gemockte Firestore/Auth (fictieve data).
// Bewijst: alleen de drie querycontract-queries met de EIGEN uid/token-e-mail; elke read
// via de server-varianten (`getDocsFromServer`/`getDocFromServer`, nooit `getDocs`/
// `getDoc`); elke self-delete op exact het eigen-uid-pad; teruglezen vóór en na elke
// delete (`already-gone` i.p.v. een fout bij een al verwijderd document); de foutmapping
// (offline, timeout, permission-denied, converterfout). De echte Rules beoordelen
// dezelfde query- en padbouwers in firebase/tests/rules/account-gateway-queries.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  collection: vi.fn(),
  collectionGroup: vi.fn(),
  doc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  getDocFromServer: vi.fn(),
  getDocsFromServer: vi.fn(),
  deleteDoc: vi.fn(),
}));
vi.mock('firebase/auth', () => ({ getAuth: vi.fn() }));

import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { DocumentValidationError } from 'firebase-base/documents';
import {
  ACCOUNT_GATEWAY_TIMEOUT_MS,
  FirestoreAccountGateway,
} from '../../src/infrastructure/account/FirestoreAccountGateway';
import { createAccountServices } from '../../src/infrastructure/account/createAccountServices';
import { LeaveOrganizationCoordinator } from '../../src/application/account/LeaveOrganizationCoordinator';

const ME = 'uid-fictief-ik';
const MY_EMAIL = 'ik@example.test';
const OTHER = 'uid-fictief-ander';
const ORG_A = 'org-fictief-a';
const ORG_B = 'org-fictief-b';

const fakeDb = { app: {} } as unknown as Firestore;

/** In-memory "server": documentpad → data. `throwOn` laat `data()` van een pad gooien (converterfout). */
const server = new Map<string, Record<string, unknown>>();
const throwOn = new Set<string>();

interface FakeRef {
  kind: 'doc' | 'col';
  path: string;
  id: string;
  withConverter: () => FakeRef;
}
interface FakeQuery {
  kind: 'cg';
  name: string;
  field: string;
  op: string;
  value: unknown;
  withConverter: () => FakeQuery;
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

function setupMocks() {
  (doc as Mock).mockImplementation((_db: unknown, ...segments: string[]): FakeRef => {
    const ref: FakeRef = {
      kind: 'doc',
      path: segments.join('/'),
      id: segments.at(-1)!,
      withConverter: () => ref,
    };
    return ref;
  });
  (collection as Mock).mockImplementation((_db: unknown, ...segments: string[]): FakeRef => {
    const ref: FakeRef = {
      kind: 'col',
      path: segments.join('/'),
      id: segments.at(-1)!,
      withConverter: () => ref,
    };
    return ref;
  });
  (collectionGroup as Mock).mockImplementation((_db: unknown, name: string) => ({ name }));
  (where as Mock).mockImplementation((field: string, op: string, value: unknown) => ({
    field,
    op,
    value,
  }));
  (query as Mock).mockImplementation(
    (group: { name: string }, filter: { field: string; op: string; value: unknown }) => {
      const q: FakeQuery = { kind: 'cg', name: group.name, ...filter, withConverter: () => q };
      return q;
    },
  );
  (getDocsFromServer as Mock).mockImplementation(async (target: FakeQuery | FakeRef) => {
    const paths = [...server.keys()].filter((path) => {
      const parts = path.split('/');
      if (target.kind === 'cg') {
        return parts.at(-2) === target.name && server.get(path)?.[target.field] === target.value;
      }
      return parts.slice(0, -1).join('/') === target.path;
    });
    return { docs: paths.map(fakeSnap) };
  });
  (getDocFromServer as Mock).mockImplementation(async (ref: FakeRef) => fakeSnap(ref.path));
  (deleteDoc as Mock).mockImplementation(async (ref: FakeRef) => {
    server.delete(ref.path);
  });
}

function signIn(claims: Record<string, unknown> = { email: MY_EMAIL, email_verified: true }) {
  const getIdTokenResult = vi.fn().mockResolvedValue({ claims });
  (getAuth as Mock).mockReturnValue({ currentUser: { uid: ME, getIdTokenResult } });
  return getIdTokenResult;
}

function seed() {
  server.clear();
  throwOn.clear();
  server.set(`organizations/${ORG_A}`, { name: 'Org A', createdBy: OTHER });
  server.set(`organizations/${ORG_A}/organizationMembers/${ME}`, {
    role: 'coach',
    email: MY_EMAIL,
    uid: ME,
  });
  server.set(`organizations/${ORG_A}/organizationMembers/${OTHER}`, {
    role: 'organizationOwner',
    email: 'ander@example.test',
    uid: OTHER,
  });
  server.set(`organizations/${ORG_A}/teams/team-1/teamMembers/${ME}`, {
    role: 'coach',
    email: MY_EMAIL,
    uid: ME,
  });
  server.set(`organizations/${ORG_A}/teams/team-1/teamMembers/${OTHER}`, {
    role: 'coach',
    email: 'ander@example.test',
    uid: OTHER,
  });
  server.set(`organizations/${ORG_A}/invitations/inv-1`, {
    email: MY_EMAIL,
    role: 'organizationAdmin',
    status: 'pending',
  });
  server.set(`organizations/${ORG_B}/invitations/inv-2`, {
    email: MY_EMAIL,
    role: 'viewer',
    status: 'claimed',
  });
  server.set(`organizations/${ORG_B}/invitations/inv-3`, {
    email: 'ander@example.test',
    role: 'viewer',
    status: 'pending',
  });
}

let gateway: FirestoreAccountGateway;

beforeEach(() => {
  vi.clearAllMocks();
  setupMocks();
  seed();
  signIn();
  gateway = new FirestoreAccountGateway(fakeDb);
});

afterEach(() => {
  vi.useRealTimers();
  // Geen enkele read mag uit de cache kunnen komen.
  expect(getDocs).not.toHaveBeenCalled();
  expect(getDoc).not.toHaveBeenCalled();
});

describe('readIdentity', () => {
  const identity = (emailVerified: boolean, email: string | null = MY_EMAIL) => ({
    ok: true,
    identity: { uid: ME, email, emailVerified },
  });

  it('uid uit de sessie, e-mail en email_verified uit de TOKEN-claims', async () => {
    expect(await gateway.readIdentity()).toEqual(identity(true));
  });

  // Reviewbevinding A op 2b-i: een gecachet token met een verouderde email_verified=false
  // liet de uitnodigingsstap stil weg. De preflight ververst daarom altijd.
  it('ververst het token ALTIJD (getIdTokenResult(true))', async () => {
    const getIdTokenResult = signIn();
    await gateway.readIdentity();
    expect(getIdTokenResult).toHaveBeenCalledTimes(1);
    expect(getIdTokenResult).toHaveBeenCalledWith(true);
  });

  it('email_verified ontbreekt of is geen true → niet geverifieerd', async () => {
    signIn({ email: MY_EMAIL, email_verified: 'true' });
    expect(await gateway.readIdentity()).toEqual(identity(false));
    signIn({ email: MY_EMAIL });
    expect(await gateway.readIdentity()).toEqual(identity(false));
  });

  it('geen e-mailclaim → email null', async () => {
    signIn({ email_verified: true });
    expect(await gateway.readIdentity()).toEqual(identity(true, null));
  });

  it('niet ingelogd → not-signed-in', async () => {
    (getAuth as Mock).mockReturnValue({ currentUser: null });
    expect(await gateway.readIdentity()).toEqual({ ok: false, error: { code: 'not-signed-in' } });
  });

  it('verversing faalt offline → offline (niet "niet ingelogd", geen gok naar email_verified)', async () => {
    signIn().mockRejectedValue({ code: 'auth/network-request-failed' });
    expect(await gateway.readIdentity()).toEqual({ ok: false, error: { code: 'offline' } });
  });

  it.each([
    'auth/user-token-expired',
    'auth/user-not-found',
    'auth/user-disabled',
    'auth/invalid-user-token',
  ])('sessie niet meer bruikbaar (%s) → not-signed-in', async (code) => {
    signIn().mockRejectedValue({ code });
    expect(await gateway.readIdentity()).toEqual({ ok: false, error: { code: 'not-signed-in' } });
  });

  it('andere fout bij verversen → read-failed', async () => {
    signIn().mockRejectedValue(new Error('onverwacht'));
    const result = await gateway.readIdentity();
    expect(!result.ok && result.error.code).toBe('read-failed');
  });

  it('geen antwoord binnen 8 s → timeout', async () => {
    vi.useFakeTimers();
    signIn().mockReturnValue(new Promise(() => {}));
    const pending = gateway.readIdentity();
    await vi.advanceTimersByTimeAsync(ACCOUNT_GATEWAY_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, error: { code: 'timeout' } });
  });

  it('de stappen NA de preflight gebruiken het gecachete (verse) token, zonder extra verversing', async () => {
    const getIdTokenResult = signIn();
    await gateway.readInventoryFromServer({ includeInvitations: true });
    await gateway.deleteOwnInvitation({ organizationId: ORG_A, invitationId: 'inv-1' });
    expect(getIdTokenResult.mock.calls.every((call) => call[0] === false)).toBe(true);
  });
});

describe('readInventoryFromServer', () => {
  it('gebruikt exact de drie contractqueries met de EIGEN uid en token-e-mail, van de server', async () => {
    const result = await gateway.readInventoryFromServer({ includeInvitations: true });

    expect(result).toEqual({
      ok: true,
      inventory: {
        organizationMemberships: [{ organizationId: ORG_A, role: 'coach' }],
        teamMemberships: [{ organizationId: ORG_A, teamId: 'team-1', role: 'coach' }],
        invitations: [
          {
            organizationId: ORG_A,
            invitationId: 'inv-1',
            status: 'pending',
            role: 'organizationAdmin',
          },
          { organizationId: ORG_B, invitationId: 'inv-2', status: 'claimed', role: 'viewer' },
        ],
      },
    });
    expect((collectionGroup as Mock).mock.calls.map((call) => call[1])).toEqual([
      'organizationMembers',
      'teamMembers',
      'invitations',
    ]);
    expect((where as Mock).mock.calls).toEqual([
      ['uid', '==', ME],
      ['uid', '==', ME],
      ['email', '==', MY_EMAIL],
    ]);
    expect(getDocsFromServer).toHaveBeenCalledTimes(3);
  });

  it('zonder uitnodigingen: alleen de twee uid-queries', async () => {
    const result = await gateway.readInventoryFromServer({ includeInvitations: false });
    expect(result.ok && result.inventory.invitations).toEqual([]);
    expect(getDocsFromServer).toHaveBeenCalledTimes(2);
  });

  it('uitnodigingen gevraagd zonder geverifieerde claim → email-not-verified, GEEN query', async () => {
    signIn({ email: MY_EMAIL, email_verified: false });
    expect(await gateway.readInventoryFromServer({ includeInvitations: true })).toEqual({
      ok: false,
      error: { code: 'email-not-verified' },
    });
    expect(getDocsFromServer).not.toHaveBeenCalled();
  });

  it('niet ingelogd → not-signed-in, geen query', async () => {
    (getAuth as Mock).mockReturnValue({ currentUser: null });
    expect(await gateway.readInventoryFromServer({ includeInvitations: false })).toEqual({
      ok: false,
      error: { code: 'not-signed-in' },
    });
    expect(getDocsFromServer).not.toHaveBeenCalled();
  });

  it('offline (unavailable van getDocsFromServer) → offline, nooit een leeg resultaat', async () => {
    (getDocsFromServer as Mock).mockRejectedValue({ code: 'unavailable' });
    expect(await gateway.readInventoryFromServer({ includeInvitations: false })).toEqual({
      ok: false,
      error: { code: 'offline' },
    });
  });

  // Reviewbevinding C op 2b-i: een ontbrekende index (failed-precondition) is een echte
  // leesfout, geen "offline".
  it('failed-precondition (bijv. ontbrekende index) → read-failed, niet offline', async () => {
    (getDocsFromServer as Mock).mockRejectedValue({ code: 'failed-precondition' });
    const result = await gateway.readInventoryFromServer({ includeInvitations: false });
    expect(!result.ok && result.error.code).toBe('read-failed');
  });

  it('permission-denied → read-failed', async () => {
    (getDocsFromServer as Mock).mockRejectedValue({ code: 'permission-denied' });
    const result = await gateway.readInventoryFromServer({ includeInvitations: false });
    expect(!result.ok && result.error.code).toBe('read-failed');
  });

  it('geen serverantwoord binnen 8 s → timeout', async () => {
    vi.useFakeTimers();
    (getDocsFromServer as Mock).mockReturnValue(new Promise(() => {}));
    const pending = gateway.readInventoryFromServer({ includeInvitations: false });
    await vi.advanceTimersByTimeAsync(ACCOUNT_GATEWAY_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, error: { code: 'timeout' } });
  });

  it('converterfout (bijv. onbekende rol) → read-failed', async () => {
    throwOn.add(`organizations/${ORG_A}/organizationMembers/${ME}`);
    const result = await gateway.readInventoryFromServer({ includeInvitations: false });
    expect(!result.ok && result.error.code).toBe('read-failed');
  });

  it('een eigen document op een onverwacht pad (buiten organizations/) → read-failed', async () => {
    server.set(`elders/x/organizationMembers/${ME}`, { role: 'coach', email: MY_EMAIL, uid: ME });
    const result = await gateway.readInventoryFromServer({ includeInvitations: false });
    expect(!result.ok && result.error.code).toBe('read-failed');
  });

  it('een document waarvan document-ID en uid-veld afwijken → read-failed', async () => {
    server.set(`organizations/${ORG_B}/organizationMembers/uid-vreemd`, {
      role: 'coach',
      email: MY_EMAIL,
      uid: ME,
    });
    const result = await gateway.readInventoryFromServer({ includeInvitations: false });
    expect(!result.ok && result.error.code).toBe('read-failed');
  });
});

describe('readOrganizationFacts', () => {
  it('leest organisatie, ledenlijst en verwijderverzoek van de server', async () => {
    server.set(`organizations/${ORG_A}/deletionRequests/current`, { status: 'requested' });
    expect(await gateway.readOrganizationFacts(ORG_A)).toEqual({
      ok: true,
      facts: {
        organizationId: ORG_A,
        exists: true,
        createdBy: OTHER,
        ownerUids: [OTHER],
        deletionRequestStatus: 'requested',
      },
    });
    expect((getDocFromServer as Mock).mock.calls.map((call) => call[0].path)).toEqual([
      `organizations/${ORG_A}`,
      `organizations/${ORG_A}/deletionRequests/current`,
    ]);
    expect((getDocsFromServer as Mock).mock.calls.map((call) => call[0].path)).toEqual([
      `organizations/${ORG_A}/organizationMembers`,
    ]);
  });

  it('geen verwijderverzoek → null', async () => {
    const result = await gateway.readOrganizationFacts(ORG_A);
    expect(result.ok && result.facts.deletionRequestStatus).toBeNull();
  });

  it.each([undefined, '', '   ', 42, null])(
    'createdBy %o → null (geen converter, dus geen leesfout)',
    async (value) => {
      server.set(`organizations/${ORG_A}`, { name: 'Org A', createdBy: value });
      const result = await gateway.readOrganizationFacts(ORG_A);
      expect(result.ok && result.facts.createdBy).toBeNull();
    },
  );

  it('ontbrekend organisatiedocument → exists=false zonder verdere reads', async () => {
    server.delete(`organizations/${ORG_A}`);
    expect(await gateway.readOrganizationFacts(ORG_A)).toEqual({
      ok: true,
      facts: {
        organizationId: ORG_A,
        exists: false,
        createdBy: null,
        ownerUids: [],
        deletionRequestStatus: null,
      },
    });
    expect(getDocsFromServer).not.toHaveBeenCalled();
  });

  it('offline → offline', async () => {
    (getDocFromServer as Mock).mockRejectedValue({ code: 'unavailable' });
    expect(await gateway.readOrganizationFacts(ORG_A)).toEqual({
      ok: false,
      error: { code: 'offline' },
    });
  });

  it('ongeldig membershipdocument van een ander lid → read-failed (fail closed)', async () => {
    throwOn.add(`organizations/${ORG_A}/organizationMembers/${OTHER}`);
    const result = await gateway.readOrganizationFacts(ORG_A);
    expect(!result.ok && result.error.code).toBe('read-failed');
  });
});

describe('self-deletes: eigen pad, teruglezen vóór en na', () => {
  it('teamMembers: verwijdert exact organizations/{org}/teams/{team}/teamMembers/{EIGEN uid}', async () => {
    expect(
      await gateway.deleteOwnTeamMembership({ organizationId: ORG_A, teamId: 'team-1' }),
    ).toEqual({ ok: true, outcome: 'deleted' });
    expect((deleteDoc as Mock).mock.calls.map((call) => call[0].path)).toEqual([
      `organizations/${ORG_A}/teams/team-1/teamMembers/${ME}`,
    ]);
    // Teruglezen vóór en na, via de eigen-uid-query van de server.
    expect(getDocsFromServer).toHaveBeenCalledTimes(2);
    expect(server.has(`organizations/${ORG_A}/teams/team-1/teamMembers/${OTHER}`)).toBe(true);
  });

  it('organizationMembers: verwijdert exact het EIGEN membership', async () => {
    expect(await gateway.deleteOwnOrganizationMembership(ORG_A)).toEqual({
      ok: true,
      outcome: 'deleted',
    });
    expect((deleteDoc as Mock).mock.calls.map((call) => call[0].path)).toEqual([
      `organizations/${ORG_A}/organizationMembers/${ME}`,
    ]);
    expect(server.has(`organizations/${ORG_A}/organizationMembers/${OTHER}`)).toBe(true);
  });

  it('uitnodiging: zoekt met de token-e-mail en verwijdert exact dat document', async () => {
    expect(
      await gateway.deleteOwnInvitation({ organizationId: ORG_A, invitationId: 'inv-1' }),
    ).toEqual({ ok: true, outcome: 'deleted' });
    expect((deleteDoc as Mock).mock.calls.map((call) => call[0].path)).toEqual([
      `organizations/${ORG_A}/invitations/inv-1`,
    ]);
    expect((where as Mock).mock.calls.every((call) => call[2] === MY_EMAIL)).toBe(true);
  });

  it('uitnodiging zonder geverifieerde claim → rejected, geen read en geen delete', async () => {
    signIn({ email: MY_EMAIL, email_verified: false });
    expect(
      await gateway.deleteOwnInvitation({ organizationId: ORG_A, invitationId: 'inv-1' }),
    ).toEqual({ ok: false, error: { code: 'rejected' } });
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(getDocsFromServer).not.toHaveBeenCalled();
  });

  it('een andermans uitnodiging (niet in de eigen query) wordt nooit verwijderd', async () => {
    expect(
      await gateway.deleteOwnInvitation({ organizationId: ORG_B, invitationId: 'inv-3' }),
    ).toEqual({ ok: true, outcome: 'already-gone' });
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(server.has(`organizations/${ORG_B}/invitations/inv-3`)).toBe(true);
  });

  it('A1: membership is al weg → already-gone ZONDER delete-poging (geen permission-denied als fout)', async () => {
    server.delete(`organizations/${ORG_A}/organizationMembers/${ME}`);
    expect(await gateway.deleteOwnOrganizationMembership(ORG_A)).toEqual({
      ok: true,
      outcome: 'already-gone',
    });
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('permission-denied en het document is tussendoor verdwenen → already-gone', async () => {
    (deleteDoc as Mock).mockImplementation(async (ref: FakeRef) => {
      server.delete(ref.path); // een ander was ons net voor
      throw { code: 'permission-denied' };
    });
    expect(await gateway.deleteOwnOrganizationMembership(ORG_A)).toEqual({
      ok: true,
      outcome: 'already-gone',
    });
  });

  it('permission-denied en het document staat er nog → rejected', async () => {
    (deleteDoc as Mock).mockRejectedValue({ code: 'permission-denied' });
    expect(await gateway.deleteOwnOrganizationMembership(ORG_A)).toEqual({
      ok: false,
      error: { code: 'rejected' },
    });
  });

  it('delete "geslaagd" maar de server kent het document nog → failed, nooit deleted', async () => {
    (deleteDoc as Mock).mockResolvedValue(undefined);
    const result = await gateway.deleteOwnTeamMembership({
      organizationId: ORG_A,
      teamId: 'team-1',
    });
    expect(!result.ok && result.error.code).toBe('failed');
  });

  it('geen serverbevestiging binnen 8 s (offline in de wachtrij) → timeout', async () => {
    vi.useFakeTimers();
    (deleteDoc as Mock).mockReturnValue(new Promise(() => {}));
    const pending = gateway.deleteOwnTeamMembership({ organizationId: ORG_A, teamId: 'team-1' });
    await vi.advanceTimersByTimeAsync(ACCOUNT_GATEWAY_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, error: { code: 'timeout' } });
  });

  it('offline bij het teruglezen vooraf → offline, geen delete in de wachtrij', async () => {
    (getDocsFromServer as Mock).mockRejectedValue({ code: 'unavailable' });
    expect(await gateway.deleteOwnOrganizationMembership(ORG_A)).toEqual({
      ok: false,
      error: { code: 'offline' },
    });
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('een andere SDK-fout op de delete → failed', async () => {
    (deleteDoc as Mock).mockRejectedValue({ code: 'internal' });
    const result = await gateway.deleteOwnOrganizationMembership(ORG_A);
    expect(!result.ok && result.error.code).toBe('failed');
  });

  it('niet ingelogd → not-signed-in, niets gelezen of verwijderd', async () => {
    (getAuth as Mock).mockReturnValue({ currentUser: null });
    expect(await gateway.deleteOwnOrganizationMembership(ORG_A)).toEqual({
      ok: false,
      error: { code: 'not-signed-in' },
    });
    expect(
      await gateway.deleteOwnTeamMembership({ organizationId: ORG_A, teamId: 'team-1' }),
    ).toEqual({ ok: false, error: { code: 'not-signed-in' } });
    expect(
      await gateway.deleteOwnInvitation({ organizationId: ORG_A, invitationId: 'inv-1' }),
    ).toEqual({ ok: false, error: { code: 'not-signed-in' } });
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('geen methode neemt een uid of e-mailadres aan (typetest)', () => {
    // @ts-expect-error — de eigen uid komt uitsluitend uit de Auth-sessie.
    void gateway.deleteOwnOrganizationMembership(ORG_A, OTHER);
    // @ts-expect-error — idem voor teamMembers.
    void gateway.deleteOwnTeamMembership({ organizationId: ORG_A, teamId: 'team-1', uid: OTHER });
    // @ts-expect-error — en de inventaris heeft geen identiteitsparameter.
    void gateway.readInventoryFromServer({ includeInvitations: false, uid: OTHER });
    expect(true).toBe(true);
  });
});

describe('createAccountServices', () => {
  it('levert een gateway en een LeaveOrganizationCoordinator zonder geselecteerde context', () => {
    const services = createAccountServices(fakeDb);
    expect(services.accountGateway).toBeInstanceOf(FirestoreAccountGateway);
    expect(services.leaveCoordinator).toBeInstanceOf(LeaveOrganizationCoordinator);
  });
});

describe('end-to-end met de coördinator op de gemockte SDK', () => {
  const noLocalWork = { countForOrganization: () => 0 };

  it('leave(org A): teamMembers → open uitnodiging → membership; org B en andermans documenten intact', async () => {
    const { leaveCoordinator } = createAccountServices(fakeDb, noLocalWork);
    expect(await leaveCoordinator.leave(ORG_A)).toEqual({
      status: 'ok',
      removed: { teamMembers: 1, invitations: 1, organizationMember: true },
      organizationDeletionPending: false,
      invitationsChecked: true,
    });
    expect((deleteDoc as Mock).mock.calls.map((call) => call[0].path)).toEqual([
      `organizations/${ORG_A}/teams/team-1/teamMembers/${ME}`,
      `organizations/${ORG_A}/invitations/inv-1`,
      `organizations/${ORG_A}/organizationMembers/${ME}`,
    ]);
    expect(server.has(`organizations/${ORG_B}/invitations/inv-2`)).toBe(true);
    expect(server.has(`organizations/${ORG_A}/organizationMembers/${OTHER}`)).toBe(true);

    // Tweede keer: niets meer te doen, geen enkele delete.
    (deleteDoc as Mock).mockClear();
    expect(await leaveCoordinator.leave(ORG_A)).toEqual({ status: 'not-a-member' });
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  // Reviewbevinding A op 2b-i: het gecachete token zegt nog email_verified=false, de server
  // weet al dat het adres geverifieerd is. Vóór de fix sloeg leave() de eigen open
  // uitnodiging stil over en eindigde toch `ok`.
  it('verouderd gecachet token (email_verified=false): de preflight ververst, de open uitnodiging gaat mee', async () => {
    let cached = { claims: { email: MY_EMAIL, email_verified: false } };
    const fresh = { claims: { email: MY_EMAIL, email_verified: true } };
    const getIdTokenResult = vi.fn(async (forceRefresh?: boolean) => {
      if (forceRefresh === true) cached = fresh;
      return cached;
    });
    (getAuth as Mock).mockReturnValue({ currentUser: { uid: ME, getIdTokenResult } });

    const { leaveCoordinator } = createAccountServices(fakeDb, noLocalWork);
    expect(await leaveCoordinator.leave(ORG_A)).toMatchObject({
      status: 'ok',
      removed: { invitations: 1 },
      invitationsChecked: true,
    });
    expect(server.has(`organizations/${ORG_A}/invitations/inv-1`)).toBe(false);
    expect(getIdTokenResult).toHaveBeenNthCalledWith(1, true);
  });

  it('echt ongeverifieerd: ok, maar invitationsChecked=false en de uitnodiging staat er nog', async () => {
    signIn({ email: MY_EMAIL, email_verified: false });
    const { leaveCoordinator } = createAccountServices(fakeDb, noLocalWork);
    expect(await leaveCoordinator.leave(ORG_A)).toMatchObject({
      status: 'ok',
      removed: { invitations: 0 },
      invitationsChecked: false,
    });
    expect(server.has(`organizations/${ORG_A}/invitations/inv-1`)).toBe(true);
  });
});
