// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useSaveStatus } from '../../src/ui/sync/useSaveStatus';

describe('useSaveStatus (PR 5.5c-bugfixes bug 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start op idle', () => {
    const { result } = renderHook(() => useSaveStatus());
    expect(result.current.status).toEqual({ kind: 'idle' });
  });

  it('notifySuccess() toont success en valt vanzelf terug naar idle', () => {
    const { result } = renderHook(() => useSaveStatus(1000));
    act(() => result.current.notifySuccess());
    expect(result.current.status).toEqual({ kind: 'success' });

    act(() => vi.advanceTimersByTime(999));
    expect(result.current.status).toEqual({ kind: 'success' });

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.status).toEqual({ kind: 'idle' });
  });

  it('notifyError() blijft staan totdat een volgende poging het overschrijft — geen auto-clear', () => {
    const { result } = renderHook(() => useSaveStatus(1000));
    act(() => result.current.notifyError('mislukt'));
    expect(result.current.status).toEqual({ kind: 'error', message: 'mislukt' });

    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.status).toEqual({ kind: 'error', message: 'mislukt' });
  });

  it('een nieuwe notifySuccess()/notifyError() annuleert een eerder lopende auto-clear-timer', () => {
    const { result } = renderHook(() => useSaveStatus(1000));
    act(() => result.current.notifySuccess());
    act(() => vi.advanceTimersByTime(500));
    act(() => result.current.notifyError('mislukt'));

    // Als de eerste timer niet geannuleerd was, zou dit alsnog naar idle springen.
    act(() => vi.advanceTimersByTime(600));
    expect(result.current.status).toEqual({ kind: 'error', message: 'mislukt' });
  });

  it('reset() zet direct terug naar idle en annuleert een lopende timer', () => {
    const { result } = renderHook(() => useSaveStatus(1000));
    act(() => result.current.notifySuccess());
    act(() => result.current.reset());
    expect(result.current.status).toEqual({ kind: 'idle' });

    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.status).toEqual({ kind: 'idle' });
  });
});
