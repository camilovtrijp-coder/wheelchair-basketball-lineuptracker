// @vitest-environment jsdom
//
// PR 5.3d-vervolgonderzoek: write() retourneert nu meteen `ok:true` zodra
// een write lokaal geaccepteerd is (zie domain/syncState.ts — niet meer
// wachten op setDoc()'s volledige serverbevestiging). Een échte afwijzing
// (bijv. een Rules-weigering na reconnect) komt daarom NIET meer via het
// eerste `write()`-resultaat binnen, maar via het los meelopende
// `settled`-Promise. De meeste tests hieronder simuleren dat tweetraps-
// gedrag: `write()` meldt eerst `ok:true`, en pas ná een microtask-tick
// (wanneer `settled` alsnog `{ok:false}` oplevert) verschijnt het item in
// `pending`. Eén test dekt de directe-weigering-variant (bijv. een lokale
// opslagfout) waarbij `write()` zelf al `ok:false` meldt.
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

/** settled resolvet altijd — nooit reject, zie domain/syncState.ts. */
function settledOk(ok: boolean, error?: unknown) {
  return Promise.resolve(ok ? { ok: true } : { ok: false, error });
}

function fakeSettingsRepo(
  write: AsyncSettingsRepository['write'] = vi.fn(async () => ({
    ok: true,
    syncState: SYNCED,
    settled: settledOk(true),
  })),
): AsyncSettingsRepository {
  return {
    read: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
    write,
    reset: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
    subscribe: vi.fn(() => () => undefined),
  };
}

function fakeRosterRepo(
  write: AsyncRosterRepository['write'] = vi.fn(async () => ({
    ok: true,
    syncState: SYNCED,
    settled: settledOk(true),
  })),
): AsyncRosterRepository {
  return {
    read: vi.fn(async () => [] as Roster),
    write,
    subscribe: vi.fn(() => () => undefined),
  };
}

/** Eén microtask-tick laten verlopen zodat een `void result.settled.then(...)`-callback kan draaien. */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useSyncStatus (PR 5.3c-2, schrijfcontract herzien in 5.3d)', () => {
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

  // PR 5.3d-onderzoeksrapport §H ("label-gebrek"): zowel in de sandbox- als
  // in de handmatige-apparaattest bleek de subscribe()-listener na een
  // offline write geen (tijdige) nieuwe snapshot af te leveren, waardoor de
  // indicator "bevroren" bleef op de waarde van vóór de write. De twee
  // tests hieronder bewijzen dat de status nu rechtstreeks vanuit write()'s
  // eigen resultaat overgaat — dus zonder ooit onSettingsSync/onRosterSync
  // aan te roepen, wat een listener die niet (tijdig) vuurt simuleert.
  it('saveSettings zet de status meteen op wacht-op-synchronisatie, zonder op een listener-event te wachten', async () => {
    const write = vi.fn(async () => ({
      ok: true,
      syncState: PENDING,
      settled: new Promise<{ ok: boolean }>(() => {}), // blijft bewust pending (offline)
    }));
    const { result } = renderHook(() =>
      useSyncStatus({ settings: fakeSettingsRepo(write), roster: fakeRosterRepo() }),
    );
    await act(async () => {
      await result.current.saveSettings({ ...DEFAULT_SETTINGS });
    });
    // Geen enkele onSettingsSync-aanroep hierboven — de status komt dus
    // uitsluitend uit write()'s eigen `syncState`.
    expect(result.current.status).toBe('wacht-op-synchronisatie');
  });

  it('saveSettings zet de status op gesynchroniseerd zodra settled ok:true oplevert, zonder listener-event', async () => {
    const write = vi.fn(async () => ({
      ok: true,
      syncState: PENDING,
      settled: settledOk(true),
    }));
    const { result } = renderHook(() =>
      useSyncStatus({ settings: fakeSettingsRepo(write), roster: fakeRosterRepo() }),
    );
    await act(async () => {
      await result.current.saveSettings({ ...DEFAULT_SETTINGS });
    });
    // Met een al-resolved fake `settled` is niet betrouwbaar te onderscheiden
    // of de settled-callback al binnen dit `act()` draaide (zelfde microtask-
    // ordening-kwestie als bij de bestaande "write() meldt meteen ok:true"-
    // test hierboven) — vandaar alleen de uiteindelijke, stabiele status.
    await flushMicrotasks();
    expect(result.current.status).toBe('gesynchroniseerd');
  });

  it('saveRoster zet de status meteen op wacht-op-synchronisatie, zonder op een listener-event te wachten', async () => {
    const write = vi.fn(async () => ({
      ok: true,
      syncState: PENDING,
      settled: new Promise<{ ok: boolean }>(() => {}),
    }));
    const { result } = renderHook(() =>
      useSyncStatus({ settings: fakeSettingsRepo(), roster: fakeRosterRepo(write) }),
    );
    await act(async () => {
      await result.current.saveRoster([]);
    });
    expect(result.current.status).toBe('wacht-op-synchronisatie');
  });

  it('een DIRECT geweigerde write (write() zelf meldt ok:false) komt meteen in pending', async () => {
    const write = vi.fn(async () => ({
      ok: false,
      syncState: REJECTED,
      error: new Error('nope'),
      settled: settledOk(false),
    }));
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

  it('write() meldt meteen ok:true (lokaal geaccepteerd); pas als settled alsnog faalt komt het item in pending', async () => {
    const write = vi.fn(async () => ({
      ok: true,
      syncState: PENDING,
      settled: settledOk(false, new Error('permission-denied')),
    }));
    const { result } = renderHook(() =>
      useSyncStatus({ settings: fakeSettingsRepo(write), roster: fakeRosterRepo() }),
    );
    const payload = { ...DEFAULT_SETTINGS, teamName: 'X' };
    let ok = false;
    await act(async () => {
      ok = await result.current.saveSettings(payload);
    });
    // write() retourneerde ok:true — de aanroeper wordt niet geblokkeerd tot
    // settled. (Met een al-resolved fake-Promise is het exacte moment waarop
    // de settled-callback binnen dezelfde `act()` alsnog draait niet
    // betrouwbaar te onderscheiden van "nog niet" — vandaar geen aparte
    // tussentijdse assertie op `pending` hier; alleen het uiteindelijke,
    // stabiele resultaat wordt gecontroleerd.)
    expect(ok).toBe(true);

    await flushMicrotasks();
    expect(result.current.pending).toEqual([{ kind: 'settings', payload }]);
    expect(result.current.status).toBe('actie-nodig');
  });

  it('wanneer settled alsnog ok:true oplevert, blijft pending leeg (geen valse actie-nodig)', async () => {
    const write = vi.fn(async () => ({
      ok: true,
      syncState: PENDING,
      settled: settledOk(true),
    }));
    const { result } = renderHook(() =>
      useSyncStatus({ settings: fakeSettingsRepo(write), roster: fakeRosterRepo() }),
    );
    await act(async () => {
      await result.current.saveSettings({ ...DEFAULT_SETTINGS });
    });
    await flushMicrotasks();
    expect(result.current.pending).toEqual([]);
  });

  it('een geslaagde retry-save (settled ok:true) wist een eerdere pending-entry', async () => {
    const write = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, syncState: PENDING, settled: settledOk(false) })
      .mockResolvedValueOnce({ ok: true, syncState: PENDING, settled: settledOk(true) });
    const { result } = renderHook(() =>
      useSyncStatus({ settings: fakeSettingsRepo(write), roster: fakeRosterRepo() }),
    );
    const payload = { ...DEFAULT_SETTINGS, teamName: 'X' };
    await act(async () => {
      await result.current.saveSettings(payload);
    });
    await flushMicrotasks();
    expect(result.current.pending).toHaveLength(1);

    await act(async () => {
      await result.current.saveSettings(payload);
    });
    await flushMicrotasks();
    expect(result.current.pending).toEqual([]);
  });

  it('retry() stuurt de opgeslagen pending-payload opnieuw en wist die bij succes', async () => {
    const write = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, syncState: PENDING, settled: settledOk(false) })
      .mockResolvedValueOnce({ ok: true, syncState: PENDING, settled: settledOk(true) });
    const { result } = renderHook(() =>
      useSyncStatus({ settings: fakeSettingsRepo(write), roster: fakeRosterRepo() }),
    );
    const payload = { ...DEFAULT_SETTINGS, teamName: 'X' };
    await act(async () => {
      await result.current.saveSettings(payload);
    });
    await flushMicrotasks();
    expect(result.current.pending).toHaveLength(1);

    await act(async () => {
      await result.current.retry('settings');
    });
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(payload);
    expect(result.current.pending).toEqual([]);
  });

  it('dismiss() wist de pending-entry zonder write() opnieuw aan te roepen', async () => {
    const write = vi.fn(async () => ({
      ok: true,
      syncState: PENDING,
      settled: settledOk(false, new Error('nope')),
    }));
    const { result } = renderHook(() =>
      useSyncStatus({ settings: fakeSettingsRepo(write), roster: fakeRosterRepo() }),
    );
    const payload = { ...DEFAULT_SETTINGS, teamName: 'X' };
    await act(async () => {
      await result.current.saveSettings(payload);
    });
    await flushMicrotasks();
    expect(result.current.pending).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(1);

    act(() => result.current.dismiss('settings'));
    expect(result.current.pending).toEqual([]);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('settings en roster hebben onafhankelijke pending-items', async () => {
    const settingsWrite = vi.fn(async () => ({
      ok: true,
      syncState: PENDING,
      settled: settledOk(false, new Error('nope')),
    }));
    const rosterWrite = vi.fn(async () => ({
      ok: true,
      syncState: PENDING,
      settled: settledOk(true),
    }));
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
    await flushMicrotasks();
    expect(result.current.pending).toEqual([
      { kind: 'settings', payload: { ...DEFAULT_SETTINGS } },
    ]);
  });
});
