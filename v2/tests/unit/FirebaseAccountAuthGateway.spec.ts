// PR 8.3c-2b-ii — FirebaseAccountAuthGateway met een gemockte `firebase/auth` (fictieve
// gebruikers en wachtwoorden). Bewijst: altijd een geforceerde tokenverversing, de
// e-mail/wachtwoord-credential uit de SESSIE, de expectedUid-guard (geen aanroep op een
// ander account), de foutmapping uit docs/pr-8.3c-2b-plan.md §B.11, de timeouts, en dat
// geen uitkomst het wachtwoord of het SDK-foutobject draagt.
// Het echte gedrag tegen de Auth-emulator staat in
// firebase/tests/rules/account-auth-emulator.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('firebase/auth', () => ({
  deleteUser: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
}));

import {
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  type Auth,
} from 'firebase/auth';
import {
  ACCOUNT_AUTH_TIMEOUT_MS,
  FirebaseAccountAuthGateway,
} from '../../src/infrastructure/auth/FirebaseAccountAuthGateway';

const ME = 'uid-fictief-ik';
const MY_EMAIL = 'ik@example.test';
const PASSWORD = 'fictief-wachtwoord-9';
const GUARD = { expectedUid: ME };

let getIdTokenResult: Mock;
let auth: { currentUser: unknown };
let gateway: FirebaseAccountAuthGateway;

function user(overrides: Record<string, unknown> = {}) {
  return { uid: ME, email: MY_EMAIL, getIdTokenResult, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  getIdTokenResult = vi
    .fn()
    .mockResolvedValue({ claims: { email: MY_EMAIL, email_verified: true } });
  auth = { currentUser: user() };
  gateway = new FirebaseAccountAuthGateway(auth as unknown as Auth);
  (EmailAuthProvider.credential as Mock).mockImplementation((email: string, password: string) => ({
    kind: 'credential',
    email,
    password,
  }));
  (reauthenticateWithCredential as Mock).mockResolvedValue({});
  (deleteUser as Mock).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('readVerifiedEmailClaim', () => {
  it('ververst ALTIJD en leest uid, e-mail en email_verified uit de token-claims', async () => {
    expect(await gateway.readVerifiedEmailClaim()).toEqual({
      ok: true,
      uid: ME,
      email: MY_EMAIL,
      verified: true,
    });
    expect(getIdTokenResult).toHaveBeenCalledWith(true);
  });

  it('email_verified niet precies true → verified false; geen e-mailclaim → email null', async () => {
    getIdTokenResult.mockResolvedValue({ claims: { email_verified: 'true' } });
    expect(await gateway.readVerifiedEmailClaim()).toEqual({
      ok: true,
      uid: ME,
      email: null,
      verified: false,
    });
  });

  it('niet ingelogd → not-signed-in, geen tokenverzoek', async () => {
    auth.currentUser = null;
    expect(await gateway.readVerifiedEmailClaim()).toEqual({ ok: false, code: 'not-signed-in' });
  });

  it.each([
    ['uitgelogd', null],
    ['als een ander account ingelogd', 'uid-fictief-ander'],
  ])(
    'sessie wisselt TIJDENS de tokenverversing (%s) → not-signed-in, geen uid/claims van een ander account',
    async (_label, nextUid) => {
      getIdTokenResult.mockImplementation(async () => {
        auth.currentUser = nextUid === null ? null : user({ uid: nextUid });
        return { claims: { email: MY_EMAIL, email_verified: true } };
      });
      expect(await gateway.readVerifiedEmailClaim()).toEqual({ ok: false, code: 'not-signed-in' });
    },
  );

  it('zelfde account opnieuw ingelogd tijdens de verversing (ander User-object) → gewoon ok', async () => {
    getIdTokenResult.mockImplementation(async () => {
      auth.currentUser = user();
      return { claims: { email: MY_EMAIL, email_verified: true } };
    });
    expect(await gateway.readVerifiedEmailClaim()).toEqual({
      ok: true,
      uid: ME,
      email: MY_EMAIL,
      verified: true,
    });
  });

  it.each([
    ['auth/network-request-failed', 'network'],
    ['auth/user-token-expired', 'session-invalid'],
    ['auth/user-not-found', 'session-invalid'],
    ['auth/user-disabled', 'session-invalid'],
    ['auth/invalid-user-token', 'session-invalid'],
    ['auth/internal-error', 'other'],
  ])('%s → %s', async (code, expected) => {
    getIdTokenResult.mockRejectedValue({ code, customData: { email: MY_EMAIL } });
    expect(await gateway.readVerifiedEmailClaim()).toEqual({ ok: false, code: expected });
  });

  it('geen antwoord binnen de timeout → network', async () => {
    vi.useFakeTimers();
    getIdTokenResult.mockReturnValue(new Promise(() => {}));
    const pending = gateway.readVerifiedEmailClaim();
    await vi.advanceTimersByTimeAsync(ACCOUNT_AUTH_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, code: 'network' });
  });
});

describe('reauthenticateWithPassword', () => {
  it('e-mail uit de SESSIE + wachtwoord → reauthenticateWithCredential op de huidige gebruiker', async () => {
    expect(await gateway.reauthenticateWithPassword(PASSWORD, GUARD)).toEqual({ ok: true });
    expect(EmailAuthProvider.credential).toHaveBeenCalledWith(MY_EMAIL, PASSWORD);
    expect(reauthenticateWithCredential).toHaveBeenCalledWith(auth.currentUser, {
      kind: 'credential',
      email: MY_EMAIL,
      password: PASSWORD,
    });
  });

  it('niet ingelogd of een ANDER account dan verwacht → not-signed-in, geen poging', async () => {
    auth.currentUser = null;
    expect(await gateway.reauthenticateWithPassword(PASSWORD, GUARD)).toEqual({
      ok: false,
      code: 'not-signed-in',
    });
    auth.currentUser = user({ uid: 'uid-fictief-ander' });
    expect(await gateway.reauthenticateWithPassword(PASSWORD, GUARD)).toEqual({
      ok: false,
      code: 'not-signed-in',
    });
    expect(reauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it('sessie zonder e-mailadres → other, geen poging (de app kent alleen e-mail/wachtwoord)', async () => {
    auth.currentUser = user({ email: null });
    expect(await gateway.reauthenticateWithPassword(PASSWORD, GUARD)).toEqual({
      ok: false,
      code: 'other',
    });
    expect(reauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it.each([
    ['auth/wrong-password', 'wrong-password'],
    ['auth/invalid-credential', 'wrong-password'],
    ['auth/invalid-login-credentials', 'wrong-password'],
    ['auth/too-many-requests', 'too-many-requests'],
    ['auth/network-request-failed', 'network'],
    ['auth/user-not-found', 'session-invalid'],
    ['auth/user-token-expired', 'session-invalid'],
    ['auth/user-mismatch', 'other'],
    ['auth/internal-error', 'other'],
  ])(
    '%s → %s; uitkomst bevat alleen de code (geen wachtwoord, geen SDK-fout)',
    async (code, expected) => {
      (reauthenticateWithCredential as Mock).mockRejectedValue({
        code,
        customData: { email: MY_EMAIL },
      });
      const result = await gateway.reauthenticateWithPassword(PASSWORD, GUARD);
      expect(result).toEqual({ ok: false, code: expected });
      expect(JSON.stringify(result)).not.toContain(PASSWORD);
      expect(JSON.stringify(result)).not.toContain(MY_EMAIL);
    },
  );

  it('geen antwoord binnen de timeout → network', async () => {
    vi.useFakeTimers();
    (reauthenticateWithCredential as Mock).mockReturnValue(new Promise(() => {}));
    const pending = gateway.reauthenticateWithPassword(PASSWORD, GUARD);
    await vi.advanceTimersByTimeAsync(ACCOUNT_AUTH_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, code: 'network' });
  });
});

describe('deleteCurrentUser', () => {
  it('deleteUser(currentUser) → ok alleen na een bevestigend antwoord', async () => {
    expect(await gateway.deleteCurrentUser(GUARD)).toEqual({ ok: true });
    expect(deleteUser).toHaveBeenCalledWith(auth.currentUser);
  });

  it('niet ingelogd of een ANDER account dan verwacht → not-signed-in, GEEN deleteUser', async () => {
    auth.currentUser = null;
    expect(await gateway.deleteCurrentUser(GUARD)).toEqual({ ok: false, code: 'not-signed-in' });
    auth.currentUser = user({ uid: 'uid-fictief-ander' });
    expect(await gateway.deleteCurrentUser(GUARD)).toEqual({ ok: false, code: 'not-signed-in' });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it.each([
    ['auth/requires-recent-login', 'requires-recent-login'],
    ['auth/network-request-failed', 'network'],
    ['auth/user-token-expired', 'unknown-state'],
    ['auth/user-not-found', 'unknown-state'],
    ['auth/internal-error', 'other'],
  ])('%s → %s', async (code, expected) => {
    (deleteUser as Mock).mockRejectedValue({ code });
    expect(await gateway.deleteCurrentUser(GUARD)).toEqual({ ok: false, code: expected });
  });

  it('geen antwoord binnen de timeout → unknown-state (het verzoek kan wel zijn uitgevoerd)', async () => {
    vi.useFakeTimers();
    (deleteUser as Mock).mockReturnValue(new Promise(() => {}));
    const pending = gateway.deleteCurrentUser(GUARD);
    await vi.advanceTimersByTimeAsync(ACCOUNT_AUTH_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, code: 'unknown-state' });
  });
});
