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

  it('toont geen technische details zonder details-prop', () => {
    const { queryByTestId } = render(
      <PwaActionNeededPanel
        lang="nl"
        visible={true}
        onRetry={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(queryByTestId('pwa-action-needed-details')).toBeNull();
  });

  it.each([
    ['nl', 'Technische details', 'Maak een screenshot hiervan'],
    ['en', 'Technical details', 'Take a screenshot of this'],
  ] as const)(
    'toont een dichtgeklapt, uitklapbaar blok met de details als platte tekst (%s)',
    (lang, summary, hint) => {
      const { getByTestId } = render(
        <PwaActionNeededPanel
          lang={lang}
          visible={true}
          onRetry={() => undefined}
          onDismiss={() => undefined}
          details={{
            phase: 'register',
            swUrl: '/sw.js',
            swType: 'module',
            errorName: 'SecurityError',
            errorMessage: 'redirect niet toegestaan',
            probe: {
              ok: true,
              status: 0,
              responseType: 'opaqueredirect',
              contentType: null,
              redirected: false,
            },
          }}
        />,
      );
      const block = getByTestId('pwa-action-needed-details') as HTMLDetailsElement;
      expect(block.tagName).toBe('DETAILS');
      expect(block.open).toBe(false);
      expect(block.querySelector('summary')?.textContent).toBe(summary);
      expect(block.textContent).toContain(hint);
      expect(getByTestId('pwa-action-needed-details-text').textContent).toBe(
        [
          'phase: register',
          'script: /sw.js (module)',
          'error: SecurityError: redirect niet toegestaan',
          'probe: status 0, type opaqueredirect, content-type -, redirected no',
        ].join('\n'),
      );
      // Bestaande knoppen blijven onveranderd aanwezig.
      expect(getByTestId('pwa-action-needed-retry')).toBeTruthy();
      expect(getByTestId('pwa-action-needed-dismiss')).toBeTruthy();
    },
  );
});
