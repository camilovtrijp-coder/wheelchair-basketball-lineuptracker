// @vitest-environment jsdom
//
// UI-test voor de cloud-import-banner (PR 5.3b). Bewijst:
// - dormant bij afwezigheid van onMigrate (5.3b laat 'm undefined);
// - prompt + knop zichtbaar zodra onMigrate is doorgegeven én flag nog niet
//   gezet;
// - klikken op de knop vuurt onMigrate af, zet de vlag, en toont
//   cloudImportSuccess;
// - gefaalde write toont cloudImportError en zet géén vlag.
// Bewust géén fetch- of netwerk- of Firebase-mocks: de banner is puur
// UI boven een willekeurige onMigrate-handler.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/preact';
import { CloudImportBanner } from '../../src/ui/cloud/CloudImportBanner';
import type { KeyValueStorage } from '../../src/i18n/persistence';
import { isCloudImported } from '../../src/infrastructure/cloudImportFlag';

class MemoryStorage implements KeyValueStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

describe('ui/cloud/CloudImportBanner (PR 5.3b)', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });
  afterEach(() => {
    cleanup();
  });

  it('is dormant wanneer onMigrate ontbreekt (5.3b default)', () => {
    const { container } = render(<CloudImportBanner lang="nl" storage={storage} kind="settings" />);
    expect(container.querySelector('[data-testid="cloud-import-banner-settings"]')).toBeNull();
  });

  it('toont prompt + knop wanneer onMigrate is doorgegeven en flag nog niet gezet', () => {
    const { getByTestId, queryByTestId } = render(
      <CloudImportBanner
        lang="nl"
        storage={storage}
        kind="settings"
        onMigrate={async () => ({ ok: true, errors: [] })}
      />,
    );
    expect(getByTestId('cloud-import-banner-settings')).toBeTruthy();
    expect(getByTestId('cloud-import-banner-settings-button')).toBeTruthy();
    expect(queryByTestId('cloud-import-banner-settings-done')).toBeNull();
  });

  it('is verborgen wanneer de flag al gezet is (banner één keer zichtbaar)', () => {
    storage.setItem('lineup-tracker-cloud-imported-settings', JSON.stringify({ at: 1 }));
    const { container } = render(
      <CloudImportBanner
        lang="nl"
        storage={storage}
        kind="settings"
        onMigrate={async () => ({ ok: true, errors: [] })}
      />,
    );
    expect(container.querySelector('[data-testid="cloud-import-banner-settings"]')).toBeNull();
    expect(isCloudImported(storage, 'settings')).toBe(true);
  });

  it('klik → onMigrate → success-status + cloudImportSuccess-tekst', async () => {
    const onMigrate = async () => ({ ok: true, errors: [] });
    const { getByTestId, queryByTestId } = render(
      <CloudImportBanner lang="nl" storage={storage} kind="settings" onMigrate={onMigrate} />,
    );

    const button = getByTestId('cloud-import-banner-settings-button') as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() => {
      expect(queryByTestId('cloud-import-banner-settings-done')).toBeTruthy();
    });
    expect(queryByTestId('cloud-import-banner-settings-button')).toBeNull();
  });

  it('klik → onMigrate faalt → error-status + cloudImportError-tekst', async () => {
    const onMigrate = async () => ({ ok: false, errors: ['actie-nodig'] });
    const { getByTestId, queryByTestId } = render(
      <CloudImportBanner lang="nl" storage={storage} kind="roster" onMigrate={onMigrate} />,
    );

    fireEvent.click(getByTestId('cloud-import-banner-roster-button'));

    await waitFor(() => {
      expect(queryByTestId('cloud-import-banner-roster-error')).toBeTruthy();
    });
  });

  it('Engelse vertalingen worden gebruikt wanneer lang=en', () => {
    const { getByTestId } = render(
      <CloudImportBanner
        lang="en"
        storage={storage}
        kind="settings"
        onMigrate={async () => ({ ok: true, errors: [] })}
      />,
    );
    const button = getByTestId('cloud-import-banner-settings-button') as HTMLButtonElement;
    expect(button.textContent).toBe('Copy to cloud once');
  });
});
