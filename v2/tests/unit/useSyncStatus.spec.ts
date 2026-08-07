// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useSyncStatus } from '../../src/application/sync/useSyncStatus';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import { DEFAULT_SETTINGS } from '../../src/domain/settings/types';
import type { Roster } from '../../src/domain/roster/types';
import type { SyncState } from '../../src/domain/syncState';

const REJECTED: SyncState = { status: 'actie-nodig', fromCache: false, hasPendingWrites: false };
const SYNCED: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };
const PENDING: SyncState = {
  status: 'wacht-op-synchronisatie',
  fromCache: false,
  hasPendingWrites: true,
};

function fakeSettingsRepo(
  write: AsyncSettingsRepository['write'] = vi.fn(async () => ({ ok: true, syncState: SYNCED })),
): AsyncSettingsRepository {
  return {
    read: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
    write,
    reset: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
    subscribe: vi.fn(() => () => undefined),
  };
}

function fakeRosterRepo(
  write: AsyncRosterRepository['write'] = vi.fn(async () => ({ ok: true, syncState: SYNCED })),
): AsyncRosterRepository {
  return {
    read: vi.fn(async () => [] as Roster),
    write,
    subscribe: vi.fn(() => () => undefined),
  };
}

describe('useSyncStatus (PR 5.3c-2)', () => {
  it('start op gesynchroniseerd zonder pending items', () => {
    const { result } = renderHook(() =>
      useSyncStatus({ settings: fakeSettingsRepo(), roster: fakeRosterRepo() }),
    );
    expect(result.current.status).toBe('gesynchroniseerd');
    expect(result.current.pending).toEqual([]);
  });

  it('onSettingsSync/onRosterSync werken de achtergrondstatus bij (worst-of)', () => {
    const { result } = renderHook(() =>
      useSyncStatus({ settings: fakeSettingsRepo(), roster: fakeRosterRepo() }),
    );
    act(() => result.current.onSettingsSync(PENDING));
    expect(result.current.status).toBe('wacht-op-synchronisatie');

    act(() => result.current.onRosterSync(REJECTED));
    expect(result.current.status).toBe('actie-nodig');
  });

  it('saveSettings bij een geweigerde write voegt de payload toe aan pending en zet status op actie-nodig', async () => {
    const write = vi.fn(async () => ({ ok: false, syncState: REJECTED, error: new Error('nope') }));
    const { result } = renderHook(() =>
      useSyncStatus({ settings: fakeSettingsRepo(write), roster: fakeRosterRepo() }),
    );
    const payload = { ...DEFAULT_SETTINGS, teamName: 'X' };
    let ok = true;
    await act(async () => {
      ok = await result.current.saveSettings(payload);
    });
    expect(ok).toBe(false);
    expect(result.current.status).toBe('actie-nodig');
    expect(result.current.pending).toEqual([{ kind: 'settings', payload }]);
  });

  it('een geslaagde saveSettings na een eerdere weigering wist de pending-entry', async () => {
    const write = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, syncState: REJECTED, error: new Error('nope') })
      .mockResolvedValueOnce({ ok: true, syncState: SYNCED });
    const { result } = renderHook(() =>
      useSyncStatus({ settings: fakeSettingsRepo(write), roster: fakeRosterRepo() }),
    );
    const payload = { ...DEFAULT_SETTINGS, teamName: 'X' };
    await act(async () => {
      await result.current.saveSettings(payload);
    });
    expect(result.current.pending).toHaveLength(1);

    await act(async () => {
      await result.current.saveSettings(payload);
    });
    expect(result.current.pending).toEqual([]);
  });

  it('retry() stuurt de opgeslagen pending-payload opnieuw en wist die bij succes', async () => {
    const write = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, syncState: REJECTED, error: new Error('nope') })
      .mockResolvedValueOnce({ ok: true, syncState: SYNCED });
    const { result } = renderHook(() =>
      useSyncStatus({ settings: fakeSettingsRepo(write), roster: fakeRosterRepo() }),
    );
    const payload = { ...DEFAULT_SETTINGS, teamName: 'X' };
    await act(async () => {
      await result.current.saveSettings(payload);
    });
    expect(result.current.pending).toHaveLength(1);

    await act(async () => {
      await result.current.retry('settings');
    });
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(payload);
    expect(result.current.pending).toEqual([]);
  });

  it('dismiss() wist de pending-entry zonder write() opnieuw aan te roepen', async () => {
    const write = vi.fn(async () => ({ ok: false, syncState: REJECTED, error: new Error('nope') }));
    const { result } = renderHook(() =>
      useSyncStatus({ settings: fakeSettingsRepo(write), roster: fakeRosterRepo() }),
    );
    const payload = { ...DEFAULT_SETTINGS, teamName: 'X' };
    await act(async () => {
      await result.current.saveSettings(payload);
    });
    expect(result.current.pending).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(1);

    act(() => result.current.dismiss('settings'));
    expect(result.current.pending).toEqual([]);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('settings en roster hebben onafhankelijke pending-items', async () => {
    const settingsWrite = vi.fn(async () => ({
      ok: false,
      syncState: REJECTED,
      error: new Error('nope'),
    }));
    const rosterWrite = vi.fn(async () => ({ ok: true, syncState: SYNCED }));
    const { result } = renderHook(() =>
      useSyncStatus({
        settings: fakeSettingsRepo(settingsWrite),
        roster: fakeRosterRepo(rosterWrite),
      }),
    );
    await act(async () => {
      await result.current.saveSettings({ ...DEFAULT_SETTINGS });
      await result.current.saveRoster([]);
    });
    expect(result.current.pending).toEqual([
      { kind: 'settings', payload: { ...DEFAULT_SETTINGS } },
    ]);
  });
});
