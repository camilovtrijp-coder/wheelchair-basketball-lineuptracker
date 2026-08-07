import { describe, it, expect, vi } from 'vitest';
import { LocalAsyncSettingsRepository } from '../../src/infrastructure/settings/LocalAsyncSettingsRepository';
import type { SettingsRepository } from '../../src/application/settings/SettingsRepository';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';

type SettingsLike = Settings & Record<string, unknown>;

function fakeSync(overrides: Partial<SettingsRepository> = {}): SettingsRepository {
  return {
    read: vi.fn(() => ({ ...DEFAULT_SETTINGS })),
    write: vi.fn(() => true),
    reset: vi.fn(() => ({ ...DEFAULT_SETTINGS })),
    ...overrides,
  };
}

describe('LocalAsyncSettingsRepository (PR 5.3c-1)', () => {
  it('read() delegeert naar de synchrone repository en resolvet de waarde', async () => {
    const sync = fakeSync({ read: vi.fn(() => ({ ...DEFAULT_SETTINGS, teamName: 'Lokaal' })) });
    const repo = new LocalAsyncSettingsRepository(sync);
    await expect(repo.read()).resolves.toEqual({ ...DEFAULT_SETTINGS, teamName: 'Lokaal' });
  });

  it('write() roept de synchrone write() aan en meldt lokaal-beschikbaar bij succes', async () => {
    const sync = fakeSync();
    const repo = new LocalAsyncSettingsRepository(sync);
    const payload: SettingsLike = { ...DEFAULT_SETTINGS, teamName: 'X' };
    const result = await repo.write(payload);
    expect(sync.write).toHaveBeenCalledWith(payload);
    expect(result).toEqual({
      ok: true,
      syncState: { status: 'lokaal-beschikbaar', fromCache: false, hasPendingWrites: false },
    });
  });

  it('write() meldt actie-nodig wanneer de synchrone write false retourneert (bijv. quota)', async () => {
    const sync = fakeSync({ write: vi.fn(() => false) });
    const repo = new LocalAsyncSettingsRepository(sync);
    const result = await repo.write({ ...DEFAULT_SETTINGS });
    expect(result.ok).toBe(false);
    expect(result.syncState.status).toBe('actie-nodig');
  });

  it('reset() delegeert naar de synchrone reset()', async () => {
    const sync = fakeSync({ reset: vi.fn(() => ({ ...DEFAULT_SETTINGS, teamName: 'Gereset' })) });
    const repo = new LocalAsyncSettingsRepository(sync);
    await expect(repo.reset()).resolves.toEqual({ ...DEFAULT_SETTINGS, teamName: 'Gereset' });
  });

  it('subscribe() emitteert direct één keer met de huidige waarde en levert een unsubscribe-functie', () => {
    const sync = fakeSync({ read: vi.fn(() => ({ ...DEFAULT_SETTINGS, teamName: 'Live' })) });
    const repo = new LocalAsyncSettingsRepository(sync);
    const seen: Array<{ teamName: string; status: string }> = [];
    const unsub = repo.subscribe((s, sync_) =>
      seen.push({ teamName: s.teamName as string, status: sync_.status }),
    );
    expect(seen).toEqual([{ teamName: 'Live', status: 'lokaal-beschikbaar' }]);
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });
});
