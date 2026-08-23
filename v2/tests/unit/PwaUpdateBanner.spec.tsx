// @vitest-environment jsdom
//
// 8.1a: de update-banner is een eigen, aparte UI-locatie — rendert
// uitsluitend de update-available/reloading-statussen, nooit 'error' (dat
// gaat via PwaActionNeededPanel.spec.tsx).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { PwaUpdateBanner } from '../../src/ui/pwa/PwaUpdateBanner';

afterEach(() => cleanup());

describe('PwaUpdateBanner', () => {
  it('rendert niets in idle/error-status', () => {
    const { container: idleContainer } = render(
      <PwaUpdateBanner lang="nl" status="idle" locked={false} onConfirm={() => undefined} />,
    );
    expect(idleContainer.querySelector('[data-testid="pwa-update-banner"]')).toBeNull();

    const { container: errorContainer } = render(
      <PwaUpdateBanner lang="nl" status="error" locked={false} onConfirm={() => undefined} />,
    );
    expect(errorContainer.querySelector('[data-testid="pwa-update-banner"]')).toBeNull();
  });

  it('toont de bevestigingsknop bij update-available en roept onConfirm aan', () => {
    const onConfirm = vi.fn();
    const { getByTestId } = render(
      <PwaUpdateBanner lang="nl" status="update-available" locked={false} onConfirm={onConfirm} />,
    );
    const button = getByTestId('pwa-update-confirm');
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('verbergt de knop tijdens reloading', () => {
    const { container } = render(
      <PwaUpdateBanner lang="nl" status="reloading" locked={false} onConfirm={() => undefined} />,
    );
    expect(container.querySelector('[data-testid="pwa-update-confirm"]')).toBeNull();
    expect(container.querySelector('[data-testid="pwa-update-banner"]')).not.toBeNull();
  });

  it('toont een andere tekst zodra het apparaat vergrendeld is (actieve tracking-wedstrijd)', () => {
    const { getByTestId, unmount } = render(
      <PwaUpdateBanner
        lang="nl"
        status="update-available"
        locked={true}
        onConfirm={() => undefined}
      />,
    );
    const lockedText = getByTestId('pwa-update-banner').textContent;
    unmount();

    const { getByTestId: getByTestIdUnlocked } = render(
      <PwaUpdateBanner
        lang="nl"
        status="update-available"
        locked={false}
        onConfirm={() => undefined}
      />,
    );
    expect(lockedText).not.toEqual(getByTestIdUnlocked('pwa-update-banner').textContent);
  });
});
