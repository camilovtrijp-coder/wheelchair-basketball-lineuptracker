import { describe, it, expect, vi } from 'vitest';
import { LocalAsyncRosterRepository } from '../../src/infrastructure/roster/LocalAsyncRosterRepository';
import type { RosterRepository } from '../../src/application/roster/RosterRepository';
import type { Roster } from '../../src/domain/roster/types';

function fakeSync(overrides: Partial<RosterRepository> = {}): RosterRepository {
  return {
    read: vi.fn(() => [] as Roster),
    write: vi.fn(() => true),
    ...overrides,
  };
}

const onePlayer: Roster = [
  { id: 1, nr: '4', naam: 'Speler Eén', kl: '3.0', vrouw: false, jeugd: false },
];

describe('LocalAsyncRosterRepository (PR 5.3c-1)', () => {
  it('read() delegeert naar de synchrone repository en resolvet de waarde', async () => {
    const sync = fakeSync({ read: vi.fn(() => onePlayer) });
    const repo = new LocalAsyncRosterRepository(sync);
    await expect(repo.read()).resolves.toEqual(onePlayer);
  });

  it('write() roept de synchrone write() aan en meldt lokaal-beschikbaar bij succes (settled resolvet meteen)', async () => {
    const sync = fakeSync();
    const repo = new LocalAsyncRosterRepository(sync);
    const result = await repo.write(onePlayer);
    expect(sync.write).toHaveBeenCalledWith(onePlayer);
    expect(result.ok).toBe(true);
    expect(result.syncState).toEqual({
      status: 'lokaal-beschikbaar',
      fromCache: false,
      hasPendingWrites: false,
    });
    await expect(result.settled).resolves.toEqual({ ok: true });
  });

  it('write() meldt actie-nodig wanneer de synchrone write false retourneert (bijv. quota)', async () => {
    const sync = fakeSync({ write: vi.fn(() => false) });
    const repo = new LocalAsyncRosterRepository(sync);
    const result = await repo.write(onePlayer);
    expect(result.ok).toBe(false);
    expect(result.syncState.status).toBe('actie-nodig');
    await expect(result.settled).resolves.toEqual({ ok: false });
  });

  it('subscribe() emitteert direct één keer met de huidige waarde en levert een unsubscribe-functie', () => {
    const sync = fakeSync({ read: vi.fn(() => onePlayer) });
    const repo = new LocalAsyncRosterRepository(sync);
    const seen: Roster[] = [];
    const unsub = repo.subscribe((players) => seen.push(players));
    expect(seen).toEqual([onePlayer]);
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });
});
