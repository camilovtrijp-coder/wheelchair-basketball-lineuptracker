// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { LastModified } from '../../src/ui/sync/LastModified';

afterEach(() => cleanup());

describe('LastModified (PR 5.4b)', () => {
  const updatedAt = Date.UTC(2026, 7, 9, 12, 34);

  it('rendert niets zonder serverbevestigde timestamp', () => {
    const { queryByTestId } = render(<LastModified lang="nl" testId="last-modified" />);
    expect(queryByTestId('last-modified')).toBeNull();
  });

  it('toont een gelokaliseerde NL- en EN-labeltekst', () => {
    const { getByTestId, rerender } = render(
      <LastModified lang="nl" updatedAt={updatedAt} testId="last-modified" />,
    );
    expect(getByTestId('last-modified').textContent).toContain('Laatst gewijzigd:');

    rerender(<LastModified lang="en" updatedAt={updatedAt} testId="last-modified" />);
    expect(getByTestId('last-modified').textContent).toContain('Last modified:');
  });
});
