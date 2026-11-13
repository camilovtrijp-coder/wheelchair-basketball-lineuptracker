import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('firebase/auth', () => ({
  sendPasswordResetEmail: vi.fn(),
}));

import { sendPasswordResetEmail, type Auth } from 'firebase/auth';
import { FirebaseAuthGateway } from '../../src/infrastructure/auth/FirebaseAuthGateway';

describe('FirebaseAuthGateway.sendPasswordReset', () => {
  const gateway = new FirebaseAuthGateway({} as Auth);

  beforeEach(() => vi.clearAllMocks());

  it('verstuurt een herstelmail zonder sessie of wachtwoord', async () => {
    (sendPasswordResetEmail as Mock).mockResolvedValue(undefined);
    expect(await gateway.sendPasswordReset('coach@example.test')).toEqual({ ok: true });
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(expect.anything(), 'coach@example.test');
  });

  it('verbergt of een e-mailadres onbekend is', async () => {
    (sendPasswordResetEmail as Mock).mockRejectedValue({ code: 'auth/user-not-found' });
    expect(await gateway.sendPasswordReset('onbekend@example.test')).toEqual({ ok: true });
  });

  it('geeft een netwerkfout zonder SDK-foutobject terug', async () => {
    (sendPasswordResetEmail as Mock).mockRejectedValue({
      code: 'auth/network-request-failed',
      message: 'geen verbinding',
    });
    expect(await gateway.sendPasswordReset('coach@example.test')).toEqual({
      ok: false,
      errorCode: 'auth/network-request-failed',
    });
  });
});
