// @vitest-environment jsdom
//
// 8.1a (§B punt 5, externe review PR #74): het herstelbare-foutpad voor
// mislukte SW-registratie/blijvend uitblijvende controllerchange — een
// eigen component, niet vermengd met de update-beschikbaar-banner.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { PwaActionNeededPanel } from '../../src/ui/sync/PwaActionNeededPanel';

afterEach(() => cleanup());

describe('PwaActionNeededPanel', () => {
  it('rendert niets wanneer niet zichtbaar', () => {
    const { container } = render(
      <PwaActionNeededPanel
        lang="nl"
        visible={false}
        onRetry={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(container.querySelector('[data-testid="pwa-action-needed-panel"]')).toBeNull();
  });

  it('toont Opnieuw proberen/Negeren en roept de juiste handler aan', () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      <PwaActionNeededPanel lang="nl" visible={true} onRetry={onRetry} onDismiss={onDismiss} />,
    );
    fireEvent.click(getByTestId('pwa-action-needed-retry'));
    fireEvent.click(getByTestId('pwa-action-needed-dismiss'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
