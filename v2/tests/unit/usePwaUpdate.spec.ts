// @vitest-environment jsdom
//
// 8.1a (docs/pr-8.1-plan.md §C 8.1a werk 3, §B punt 3): dekt de
// `locked`-afhankelijke auto-bevestigingsflow los van `App.tsx` — buiten een
// actieve `tracking`-wedstrijd bevestigt de banner zichzelf na een korte
// time-out; zodra `locked` waar is, gebeurt dat nooit.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/preact';
import { usePwaUpdate } from '../../src/application/pwa/usePwaUpdate';
import { PwaUpdateAdapter } from '../../src/infrastructure/pwa/PwaUpdateAdapter';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('usePwaUpdate', () => {
  it('roept adapter.init() niet aan buiten een productiebuild', () => {
    const initSpy = vi.spyOn(PwaUpdateAdapter.prototype, 'init');
    // vitest draait standaard met import.meta.env.PROD === false.
    renderHook(() => usePwaUpdate(false));
    expect(initSpy).not.toHaveBeenCalled();
  });

  it('bevestigt automatisch na de time-out zolang het apparaat niet vergrendeld is', () => {
    vi.useFakeTimers();
    const confirmSpy = vi
      .spyOn(PwaUpdateAdapter.prototype, 'confirmUpdate')
      .mockImplementation(() => undefined);
    const stateRef = { status: 'update-available' as const, registered: true };
    vi.spyOn(PwaUpdateAdapter.prototype, 'getState').mockImplementation(() => stateRef);
    vi.spyOn(PwaUpdateAdapter.prototype, 'subscribe').mockImplementation((listener) => {
      listener(stateRef);
      return () => undefined;
    });

    renderHook(() => usePwaUpdate(false, 5_000));
    expect(confirmSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('bevestigt NOOIT automatisch terwijl het apparaat vergrendeld is (actieve tracking-wedstrijd)', () => {
    vi.useFakeTimers();
    const confirmSpy = vi
      .spyOn(PwaUpdateAdapter.prototype, 'confirmUpdate')
      .mockImplementation(() => undefined);
    const stateRef = { status: 'update-available' as const, registered: true };
    vi.spyOn(PwaUpdateAdapter.prototype, 'getState').mockImplementation(() => stateRef);
    vi.spyOn(PwaUpdateAdapter.prototype, 'subscribe').mockImplementation((listener) => {
      listener(stateRef);
      return () => undefined;
    });

    renderHook(() => usePwaUpdate(true, 5_000));
    vi.advanceTimersByTime(60_000);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('annuleert een geplande auto-bevestiging zodra het apparaat alsnog vergrendeld raakt', () => {
    vi.useFakeTimers();
    const confirmSpy = vi
      .spyOn(PwaUpdateAdapter.prototype, 'confirmUpdate')
      .mockImplementation(() => undefined);
    const stateRef = { status: 'update-available' as const, registered: true };
    vi.spyOn(PwaUpdateAdapter.prototype, 'getState').mockImplementation(() => stateRef);
    vi.spyOn(PwaUpdateAdapter.prototype, 'subscribe').mockImplementation((listener) => {
      listener(stateRef);
      return () => undefined;
    });

    const { rerender } = renderHook(({ locked }) => usePwaUpdate(locked, 5_000), {
      initialProps: { locked: false },
    });
    vi.advanceTimersByTime(2_000);
    rerender({ locked: true });
    vi.advanceTimersByTime(60_000);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('confirmUpdate/retry/dismissError delegeren naar de adapter', () => {
    const confirmSpy = vi
      .spyOn(PwaUpdateAdapter.prototype, 'confirmUpdate')
      .mockImplementation(() => undefined);
    const retrySpy = vi
      .spyOn(PwaUpdateAdapter.prototype, 'retry')
      .mockImplementation(() => undefined);
    const dismissSpy = vi
      .spyOn(PwaUpdateAdapter.prototype, 'dismissError')
      .mockImplementation(() => undefined);

    const { result } = renderHook(() => usePwaUpdate(false));
    result.current.confirmUpdate();
    result.current.retry();
    result.current.dismissError();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(retrySpy).toHaveBeenCalledTimes(1);
    expect(dismissSpy).toHaveBeenCalledTimes(1);
  });
});
