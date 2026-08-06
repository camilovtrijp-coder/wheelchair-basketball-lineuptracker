import { describe, it, expect } from 'vitest';
import {
  TRUSTED_DEVICE_STORAGE_KEY,
  clearTrustedDevice,
  readTrustedDevice,
  writeTrustedDevice,
} from '../../src/infrastructure/device/trustedDevice';
import type { KeyValueStorage } from '../../src/i18n/persistence';

class FakeStorage implements KeyValueStorage {
  private readonly store = new Map<string, string>();
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

describe('infrastructure/device/trustedDevice', () => {
  it('geeft null terug als er nog niets is opgeslagen (onbeantwoord)', () => {
    expect(readTrustedDevice(new FakeStorage())).toBeNull();
  });

  it('rondt true en false correct af via write/read', () => {
    const storage = new FakeStorage();

    writeTrustedDevice(storage, true);
    expect(readTrustedDevice(storage)).toBe(true);

    writeTrustedDevice(storage, false);
    expect(readTrustedDevice(storage)).toBe(false);
  });

  it('negeert onbekende opgeslagen waarden en behandelt ze als onbeantwoord', () => {
    const storage = new FakeStorage();
    storage.setItem(TRUSTED_DEVICE_STORAGE_KEY, 'garbage');
    expect(readTrustedDevice(storage)).toBeNull();
  });

  it('clearTrustedDevice zet de vraag terug naar onbeantwoord', () => {
    const storage = new FakeStorage();
    writeTrustedDevice(storage, true);
    clearTrustedDevice(storage);
    expect(readTrustedDevice(storage)).toBeNull();
  });
});
