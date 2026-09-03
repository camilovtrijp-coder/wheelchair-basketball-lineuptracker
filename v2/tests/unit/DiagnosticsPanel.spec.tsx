// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { DiagnosticsPanel } from '../../src/ui/diagnostics/DiagnosticsPanel';
import { InMemoryDiagnostics } from '../../src/infrastructure/diagnostics/diagnostics';

afterEach(() => cleanup());

describe('DiagnosticsPanel', () => {
  it('toont de privacyuitleg en een lege, niet-downloadbare Nederlandse sessie', () => {
    const diagnostics = new InMemoryDiagnostics();
    const { getByTestId, getByText } = render(
      <DiagnosticsPanel lang="nl" diagnostics={diagnostics} />,
    );

    expect(getByTestId('diagnostics-count').textContent).toContain('0');
    expect(getByTestId('diagnostics-download').hasAttribute('disabled')).toBe(true);
    expect(getByTestId('diagnostics-clear').hasAttribute('disabled')).toBe(true);
    expect(getByText(/geen spelersgegevens/i)).toBeTruthy();
  });

  it('reageert live op events en wist uitsluitend de in-memory diagnose', () => {
    const diagnostics = new InMemoryDiagnostics(() => new Date('2026-08-31T10:00:00.000Z'));
    const { getByTestId } = render(<DiagnosticsPanel lang="en" diagnostics={diagnostics} />);

    act(() => {
      diagnostics.record({ area: 'settings', code: 'settings-listener-failed' });
    });
    expect(getByTestId('diagnostics-count').textContent).toContain('1');
    expect(getByTestId('diagnostics-download').hasAttribute('disabled')).toBe(false);

    act(() => {
      fireEvent.click(getByTestId('diagnostics-clear'));
    });
    expect(getByTestId('diagnostics-count').textContent).toContain('0');
    expect(diagnostics.snapshot()).toEqual([]);
  });
});
