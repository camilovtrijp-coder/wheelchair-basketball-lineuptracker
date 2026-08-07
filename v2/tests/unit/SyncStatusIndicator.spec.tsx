// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { SyncStatusIndicator } from '../../src/ui/sync/SyncStatusIndicator';
import type { SyncStatus } from '../../src/domain/syncState';

afterEach(() => cleanup());

describe('ui/sync/SyncStatusIndicator (PR 5.3c-2)', () => {
  const cases: Array<[SyncStatus, string, string]> = [
    ['lokaal-beschikbaar', 'nl', 'Lokaal beschikbaar'],
    ['wacht-op-synchronisatie', 'nl', 'Wacht op synchronisatie'],
    ['gesynchroniseerd', 'nl', 'Gesynchroniseerd'],
    ['actie-nodig', 'nl', 'Actie nodig'],
    ['actie-nodig', 'en', 'Action needed'],
  ];

  for (const [status, lang, expectedText] of cases) {
    it(`toont "${expectedText}" voor status=${status} lang=${lang}`, () => {
      const { getByTestId } = render(
        <SyncStatusIndicator lang={lang as 'nl' | 'en'} status={status} />,
      );
      const el = getByTestId('sync-status-indicator');
      expect(el.textContent).toBe(expectedText);
      expect(el.getAttribute('data-status')).toBe(status);
    });
  }
});
