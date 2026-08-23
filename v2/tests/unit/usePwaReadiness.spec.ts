// @vitest-environment jsdom
//
// PR 8.1b (docs/pr-8.1-plan.md §C 8.1b werk 1): dekt de application-laag-
// hook die de gedeelde `pwaUpdateAdapter`-singleton (8.1a) hergebruikt om
// `PwaReadinessStatus` af te leiden, reactief bijgewerkt bij elke
// adapterwijziging — geen tweede, parallelle service-worker-observatie.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/preact';
import { usePwaReadiness } from '../../src/application/pwa/usePwaReadiness';
import { PwaUpdateAdapter } from '../../src/infrastructure/pwa/PwaUpdateAdapter';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockAdapterState(state: {
  status: 'idle' | 'update-available' | 'reloading' | 'error';
  registered: boolean;
}) {
  vi.spyOn(PwaUpdateAdapter.prototype, 'getState').mockImplementation(() => state);
  vi.spyOn(PwaUpdateAdapter.prototype, 'subscribe').mockImplementation((listener) => {
    listener(state);
    return () => undefined;
  });
}

describe('usePwaReadiness', () => {
  it("geen 'serviceWorker' in navigator → 'unsupported', ongeacht adapterstatus", () => {
    vi.stubGlobal('navigator', {});
    mockAdapterState({ status: 'idle', registered: true });
    const { result } = renderHook(() => usePwaReadiness());
    expect(result.current).toEqual({ kind: 'unsupported' });
  });

  it("swSupported + idle + niet-registered → 'registering'", () => {
    vi.stubGlobal('navigator', { serviceWorker: {} });
    mockAdapterState({ status: 'idle', registered: false });
    const { result } = renderHook(() => usePwaReadiness());
    expect(result.current).toEqual({ kind: 'registering' });
  });

  it("swSupported + idle + registered → 'ready'", () => {
    vi.stubGlobal('navigator', { serviceWorker: {} });
    mockAdapterState({ status: 'idle', registered: true });
    const { result } = renderHook(() => usePwaReadiness());
    expect(result.current).toEqual({ kind: 'ready' });
  });

  it("swSupported + 'update-available' → 'update-pending'", () => {
    vi.stubGlobal('navigator', { serviceWorker: {} });
    mockAdapterState({ status: 'update-available', registered: true });
    const { result } = renderHook(() => usePwaReadiness());
    expect(result.current).toEqual({ kind: 'update-pending' });
  });

  it("swSupported + 'error' → 'broken'", () => {
    vi.stubGlobal('navigator', { serviceWorker: {} });
    mockAdapterState({ status: 'error', registered: false });
    const { result } = renderHook(() => usePwaReadiness());
    expect(result.current).toEqual({ kind: 'broken' });
  });

  it('roept adapter.init() NIET aan — dat blijft main.tsx/usePwaUpdate se verantwoordelijkheid', () => {
    vi.stubGlobal('navigator', { serviceWorker: {} });
    const initSpy = vi.spyOn(PwaUpdateAdapter.prototype, 'init');
    mockAdapterState({ status: 'idle', registered: true });
    renderHook(() => usePwaReadiness());
    expect(initSpy).not.toHaveBeenCalled();
  });
});
