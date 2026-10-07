// PR 8.3c-2c-i — één slot over verlaten en accountverwijdering (reviewnit B op 2b-ii).
// Zonder deze poort konden `leave()` en `clearFirestoreData()` gelijktijdig lopen, omdat
// elke coördinator alleen zijn eigen slot kent.
import { describe, it, expect, vi } from 'vitest';
import { AccountActionGate } from '../../src/application/account/AccountActionGate';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function coordinators() {
  return {
    leaveCoordinator: { leave: vi.fn() },
    accountDeletionCoordinator: {
      assess: vi.fn(),
      clearFirestoreData: vi.fn(),
      deleteAuthAccount: vi.fn(),
    },
  };
}

describe('AccountActionGate', () => {
  it('blokkeert clearFirestoreData() zolang leave() loopt, zonder de coördinator aan te roepen', async () => {
    const c = coordinators();
    const pending = deferred<{ status: 'offline' }>();
    c.leaveCoordinator.leave.mockReturnValue(pending.promise);
    const gate = new AccountActionGate(c as never);

    const leave = gate.leave('org-a');
    expect(gate.isBusy).toBe(true);
    await expect(gate.clearFirestoreData('geheim-fictief')).resolves.toEqual({
      status: 'in-progress',
    });
    await expect(gate.assess()).resolves.toEqual({ status: 'in-progress' });
    await expect(gate.deleteAuthAccount('geheim-fictief')).resolves.toEqual({
      status: 'in-progress',
    });
    await expect(gate.leave('org-b')).resolves.toEqual({ status: 'in-progress' });
    expect(c.accountDeletionCoordinator.clearFirestoreData).not.toHaveBeenCalled();
    expect(c.accountDeletionCoordinator.assess).not.toHaveBeenCalled();
    expect(c.accountDeletionCoordinator.deleteAuthAccount).not.toHaveBeenCalled();
    expect(c.leaveCoordinator.leave).toHaveBeenCalledTimes(1);

    pending.resolve({ status: 'offline' });
    await expect(leave).resolves.toEqual({ status: 'offline' });
    expect(gate.isBusy).toBe(false);
  });

  it('blokkeert leave() zolang de accountverwijdering loopt', async () => {
    const c = coordinators();
    const pending = deferred<{ status: 'ready-for-auth-deletion' }>();
    c.accountDeletionCoordinator.clearFirestoreData.mockReturnValue(pending.promise);
    const gate = new AccountActionGate(c as never);

    const clear = gate.clearFirestoreData('geheim-fictief');
    await expect(gate.leave('org-a')).resolves.toEqual({ status: 'in-progress' });
    expect(c.leaveCoordinator.leave).not.toHaveBeenCalled();
    pending.resolve({ status: 'ready-for-auth-deletion' });
    await clear;
  });

  it('geeft het slot vrij na afloop, ook als de coördinator gooit', async () => {
    const c = coordinators();
    c.leaveCoordinator.leave.mockRejectedValueOnce(new Error('kapot'));
    c.leaveCoordinator.leave.mockResolvedValueOnce({ status: 'not-a-member' });
    const gate = new AccountActionGate(c as never);
    await expect(gate.leave('org-a')).rejects.toThrow('kapot');
    await expect(gate.leave('org-a')).resolves.toEqual({ status: 'not-a-member' });
  });

  it('geeft argumenten ongewijzigd door (wachtwoord alleen als argument)', async () => {
    const c = coordinators();
    c.accountDeletionCoordinator.deleteAuthAccount.mockResolvedValue({ status: 'deleted' });
    const gate = new AccountActionGate(c as never);
    await gate.deleteAuthAccount('geheim-fictief');
    expect(c.accountDeletionCoordinator.deleteAuthAccount).toHaveBeenCalledWith('geheim-fictief');
    expect(JSON.stringify(gate)).not.toContain('geheim-fictief');
  });
});
