import { describe, it, expect, beforeEach } from 'vitest';
import {
  isCloudImported,
  markCloudImported,
  clearCloudImported,
} from '../../src/infrastructure/cloudImportFlag';
import type { KeyValueStorage } from '../../src/i18n/persistence';

class TrackingStorage implements KeyValueStorage {
  readonly store = new Map<string, string>();
  public readonly accessedKeys: string[] = [];
  public readonly writtenKeys: string[] = [];
  public readonly removedKeys: string[] = [];

  getItem(key: string): string | null {
    this.accessedKeys.push(key);
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writtenKeys.push(key);
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.removedKeys.push(key);
    this.store.delete(key);
  }
  seed(key: string, value: string): void {
    this.store.set(key, value);
  }
}

const SETTINGS_FLAG = 'lineup-tracker-cloud-imported-settings';
const ROSTER_FLAG = 'lineup-tracker-cloud-imported-roster';

describe('infrastructure/cloudImportFlag', () => {
  let storage: TrackingStorage;
  beforeEach(() => {
    storage = new TrackingStorage();
  });

  it('isCloudImported retourneert false zonder flag', () => {
    expect(isCloudImported(storage, 'settings')).toBe(false);
    expect(isCloudImported(storage, 'roster')).toBe(false);
  });

  it('markCloudImported zet een aparte flag-key voor settings en roster', () => {
    markCloudImported(storage, 'settings', 1700000000000);
    markCloudImported(storage, 'roster', 1700000001000);

    expect(isCloudImported(storage, 'settings')).toBe(true);
    expect(isCloudImported(storage, 'roster')).toBe(true);
    expect(storage.writtenKeys).toEqual([SETTINGS_FLAG, ROSTER_FLAG]);
    expect(storage.writtenKeys).not.toContain('lineup-tracker-settings');
    expect(storage.writtenKeys).not.toContain('lineup-tracker-roster');
  });

  it('raakt de v1-data-keys NIET — strikt gescheiden', () => {
    storage.seed('lineup-tracker-settings', '{"teamName":"X"}');
    storage.seed('lineup-tracker-roster', '[]');

    markCloudImported(storage, 'settings');
    markCloudImported(storage, 'roster');

    expect(storage.store.get('lineup-tracker-settings')).toBe('{"teamName":"X"}');
    expect(storage.store.get('lineup-tracker-roster')).toBe('[]');
  });

  it('clearCloudImported verwijdert de flag zonder de v1-key te raken', () => {
    storage.seed('lineup-tracker-settings', '{"teamName":"X"}');
    markCloudImported(storage, 'settings');
    clearCloudImported(storage, 'settings');

    expect(isCloudImported(storage, 'settings')).toBe(false);
    expect(storage.store.get('lineup-tracker-settings')).toBe('{"teamName":"X"}');
  });

  it('isCloudImported geeft false terug als getItem een throw geeft (defensief)', () => {
    const throwStorage: KeyValueStorage = {
      getItem: () => {
        throw new Error('storage broken');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(isCloudImported(throwStorage, 'settings')).toBe(false);
  });

  it('markCloudImported negeert falende setItem (niet-blokkerend)', () => {
    const throwStorage: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => undefined,
    };
    expect(() => markCloudImported(throwStorage, 'settings')).not.toThrow();
  });
});
