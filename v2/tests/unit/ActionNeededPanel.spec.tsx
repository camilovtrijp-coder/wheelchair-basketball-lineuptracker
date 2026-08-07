// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { ActionNeededPanel } from '../../src/ui/sync/ActionNeededPanel';
import { DEFAULT_SETTINGS } from '../../src/domain/settings/types';
import type { PendingAction } from '../../src/application/sync/useSyncStatus';

afterEach(() => cleanup());

describe('ui/sync/ActionNeededPanel (PR 5.3c-2)', () => {
  it('rendert niets wanneer pending leeg is', () => {
    const { container } = render(
      <ActionNeededPanel
        lang="nl"
        pending={[]}
        onRetry={() => undefined}
        onDismiss={() => undefined}
        onExport={() => undefined}
      />,
    );
    expect(container.querySelector('[data-testid="action-needed-panel"]')).toBeNull();
  });

  it('toont per pending-item retry/negeer/exporteer-knoppen die de juiste handler met de kind aanroepen', () => {
    const pending: PendingAction[] = [
      { kind: 'settings', payload: { ...DEFAULT_SETTINGS } },
      { kind: 'roster', payload: [] },
    ];
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const onExport = vi.fn();
    const { getByTestId } = render(
      <ActionNeededPanel
        lang="nl"
        pending={pending}
        onRetry={onRetry}
        onDismiss={onDismiss}
        onExport={onExport}
      />,
    );

    expect(getByTestId('action-needed-settings')).toBeTruthy();
    expect(getByTestId('action-needed-roster')).toBeTruthy();

    fireEvent.click(getByTestId('action-needed-retry-settings'));
    expect(onRetry).toHaveBeenCalledWith('settings');

    fireEvent.click(getByTestId('action-needed-dismiss-roster'));
    expect(onDismiss).toHaveBeenCalledWith('roster');

    fireEvent.click(getByTestId('action-needed-export-settings'));
    expect(onExport).toHaveBeenCalledWith('settings');
  });

  it('gebruikt Engelse knoplabels wanneer lang=en', () => {
    const pending: PendingAction[] = [{ kind: 'settings', payload: { ...DEFAULT_SETTINGS } }];
    const { getByTestId } = render(
      <ActionNeededPanel
        lang="en"
        pending={pending}
        onRetry={() => undefined}
        onDismiss={() => undefined}
        onExport={() => undefined}
      />,
    );
    expect((getByTestId('action-needed-retry-settings') as HTMLButtonElement).textContent).toBe(
      'Retry',
    );
    expect((getByTestId('action-needed-dismiss-settings') as HTMLButtonElement).textContent).toBe(
      'Dismiss',
    );
    expect((getByTestId('action-needed-export-settings') as HTMLButtonElement).textContent).toBe(
      'Export',
    );
  });
});
