import { describe, it, expect } from 'vitest';
import { LocalStorageSettingsRepository } from '../../src/infrastructure/settings/LocalStorageSettingsRepository';
import type { KeyValueStorage } from '../../src/i18n/persistence';
import {
  SETTINGS_STORAGE_KEY,
  DEFAULT_SETTINGS,
  type Settings,
} from '../../src/domain/settings/types';

class TrackingStorage implements KeyValueStorage {
  public readonly store = new Map<string, string>();
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

type SettingsLike = Settings & Record<string, unknown>;

function repoWith(initial?: SettingsLike | string) {
  const storage = new TrackingStorage();
  if (typeof initial === 'string') {
    storage.seed(SETTINGS_STORAGE_KEY, initial);
  } else if (initial) {
    storage.seed(SETTINGS_STORAGE_KEY, JSON.stringify(initial));
  }
  return { repo: new LocalStorageSettingsRepository(storage), storage };
}

describe('LocalStorageSettingsRepository', () => {
  it('read met ontbrekende key retourneert defaults zonder te schrijven', () => {
    const { repo, storage } = repoWith();
    const out = repo.read();
    expect(out).toEqual(DEFAULT_SETTINGS);
    expect(storage.accessedKeys).toEqual([SETTINGS_STORAGE_KEY]);
    expect(storage.writtenKeys).toEqual([]);
    expect(storage.removedKeys).toEqual([]);
  });

  it('read met geldige v1-data retourneert identieke waarden', () => {
    const v1: SettingsLike = {
      ...DEFAULT_SETTINGS,
      teamName: 'My Team',
      quarterCount: 6,
      primaryColor: '#ff0000',
    };
    const { repo } = repoWith(v1);
    expect(repo.read()).toEqual(v1);
  });

  it('read met onbekende keys behoudt ze', () => {
    const v1: SettingsLike = { ...DEFAULT_SETTINGS, toekomstigVeld: 'x' };
    const { repo } = repoWith(v1);
    const out = repo.read();
    expect(out['toekomstigVeld']).toBe('x');
  });

  it('read met corrupte JSON-string valt terug op defaults', () => {
    const { repo } = repoWith('{ not valid json');
    expect(repo.read()).toEqual(DEFAULT_SETTINGS);
  });

  it('read met niet-object JSON (bijv. string) valt terug op defaults', () => {
    const { repo } = repoWith(JSON.stringify('hello'));
    expect(repo.read()).toEqual(DEFAULT_SETTINGS);
  });

  it('write slaat het volledige object op en raakt geen andere keys', () => {
    const { repo, storage } = repoWith();
    repo.write({ ...DEFAULT_SETTINGS, teamName: 'B' });
    expect(storage.writtenKeys).toEqual([SETTINGS_STORAGE_KEY]);
    expect(storage.accessedKeys).toEqual([]);
    expect(storage.removedKeys).toEqual([]);
  });

  it('write behoudt onbekende keys in het opgeslagen object', () => {
    const { repo, storage } = repoWith();
    const payload: SettingsLike = {
      ...DEFAULT_SETTINGS,
      toekomstigVeld: 'bewaard',
    };
    repo.write(payload);
    const written = storage.writtenKeys[0] && storage.store.get(SETTINGS_STORAGE_KEY);
    expect(written).toBeTruthy();
    const parsed = JSON.parse(written as string) as Record<string, unknown>;
    expect(parsed['toekomstigVeld']).toBe('bewaard');
  });

  it('reset zet defaults terug en schrijft', () => {
    const v1: SettingsLike = { ...DEFAULT_SETTINGS, teamName: 'X' };
    const { repo, storage } = repoWith(v1);
    const out = repo.reset();
    expect(out).toEqual(DEFAULT_SETTINGS);
    expect(storage.writtenKeys).toEqual([SETTINGS_STORAGE_KEY]);
  });

  it('read met v1-corrupte-keys (verkeerde types in JSON) behoudt exacte bytes', () => {
    // v2 mag bestaande v1-data met verkeerde typen niet stiekem repareren
    // bij read (normalizeSettings vult alleen ontbrekende defaults aan).
    const v1Like = { ...DEFAULT_SETTINGS, useClassLimit: 'ja' } as unknown as SettingsLike;
    const { repo } = repoWith(v1Like);
    const out = repo.read();
    expect(out.useClassLimit).toBe('ja');
  });
});
