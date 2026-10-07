// PR 8.3c-2c-i — één slot over verlaten en accountverwijdering (reviewnit B op 2b-ii).
// Zonder deze poort konden `leave()` en `clearFirestoreData()` gelijktijdig lopen, omdat
// elke coördinator alleen zijn eigen slot kent. PR 8.3c-2c-ii: de overdracht zit achter
// hetzelfde slot.
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
    ownershipTransferCoordinator: {
      listTransferCandidates: vi.fn(),
      promote: vi.fn(),
      completeTransfer: vi.fn(),
    },
  };
}

type Coordinators = ReturnType<typeof coordinators>;

/** Alle zeven acties van de poort, elk met fictieve argumenten. */
function allActions(gate: AccountActionGate) {
  return {
    leave: () => gate.leave('org-b'),
    assess: () => gate.assess(),
    clearFirestoreData: () => gate.clearFirestoreData('geheim-fictief'),
    deleteAuthAccount: () => gate.deleteAuthAccount('geheim-fictief'),
    listTransferCandidates: () => gate.listTransferCandidates('org-b'),
    promote: () => gate.promote('org-b', 'uid-fictief-b'),
    completeTransfer: () => gate.completeTransfer('org-b', 'uid-fictief-a'),
  };
}

function coordinatorMocks(c: Coordinators) {
  return {
    leave: c.leaveCoordinator.leave,
    assess: c.accountDeletionCoordinator.assess,
    clearFirestoreData: c.accountDeletionCoordinator.clearFirestoreData,
    deleteAuthAccount: c.accountDeletionCoordinator.deleteAuthAccount,
    listTransferCandidates: c.ownershipTransferCoordinator.listTransferCandidates,
    promote: c.ownershipTransferCoordinator.promote,
    completeTransfer: c.ownershipTransferCoordinator.completeTransfer,
  };
}

type ActionName = keyof ReturnType<typeof allActions>;
const ACTION_NAMES: ActionName[] = [
  'leave',
  'assess',
  'clearFirestoreData',
  'deleteAuthAccount',
  'listTransferCandidates',
  'promote',
  'completeTransfer',
];

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

  // PR 8.3c-2c-ii: de overdracht zit achter HETZELFDE slot (docs/pr-8.3c-2c-plan.md §8).
  it.each(ACTION_NAMES)(
    'zolang %s loopt, geeft elke andere actie in-progress zonder coördinatoraanroep',
    async (running) => {
      const c = coordinators();
      const mocks = coordinatorMocks(c);
      const pending = deferred<{ status: 'offline' }>();
      mocks[running].mockReturnValue(pending.promise);
      const gate = new AccountActionGate(c as never);
      const actions = allActions(gate);

      const first = actions[running]();
      expect(gate.isBusy).toBe(true);
      for (const other of ACTION_NAMES) {
        await expect(actions[other]()).resolves.toEqual({ status: 'in-progress' });
      }
      for (const other of ACTION_NAMES) {
        expect(mocks[other]).toHaveBeenCalledTimes(other === running ? 1 : 0);
      }
      pending.resolve({ status: 'offline' });
      await expect(first).resolves.toEqual({ status: 'offline' });
      expect(gate.isBusy).toBe(false);
    },
  );

  it('geeft de overdrachtsargumenten ongewijzigd door en het slot vrij na afloop', async () => {
    const c = coordinators();
    c.ownershipTransferCoordinator.promote.mockResolvedValue({ status: 'ok', outcome: 'promoted' });
    c.ownershipTransferCoordinator.completeTransfer.mockRejectedValueOnce(new Error('kapot'));
    c.ownershipTransferCoordinator.listTransferCandidates.mockResolvedValue({
      status: 'denied',
      reason: 'not-owner',
    });
    const gate = new AccountActionGate(c as never);
    await expect(gate.promote('org-a', 'uid-fictief-b')).resolves.toEqual({
      status: 'ok',
      outcome: 'promoted',
    });
    expect(c.ownershipTransferCoordinator.promote).toHaveBeenCalledWith('org-a', 'uid-fictief-b');
    await expect(gate.completeTransfer('org-a', 'uid-fictief-a')).rejects.toThrow('kapot');
    expect(c.ownershipTransferCoordinator.completeTransfer).toHaveBeenCalledWith(
      'org-a',
      'uid-fictief-a',
    );
    expect(gate.isBusy).toBe(false);
    await expect(gate.listTransferCandidates('org-a')).resolves.toEqual({
      status: 'denied',
      reason: 'not-owner',
    });
    expect(c.ownershipTransferCoordinator.listTransferCandidates).toHaveBeenCalledWith('org-a');
  });
});
