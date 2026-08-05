import { describe, it, expect } from 'vitest';
import { LocalStorageRosterRepository } from '../../src/infrastructure/roster/LocalStorageRosterRepository';
import type { KeyValueStorage } from '../../src/i18n/persistence';
import { ROSTER_STORAGE_KEY, type Roster } from '../../src/domain/roster/types';

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

function repoWith(initial?: Roster | string) {
  const storage = new TrackingStorage();
  if (typeof initial === 'string') {
    storage.seed(ROSTER_STORAGE_KEY, initial);
  } else if (initial) {
    storage.seed(ROSTER_STORAGE_KEY, JSON.stringify(initial));
  }
  return { repo: new LocalStorageRosterRepository(storage), storage };
}

const PLAYER = { id: 1, nr: '7', naam: 'Jan', kl: '3.0', vrouw: false, jeugd: false };

describe('LocalStorageRosterRepository', () => {
  it('read met ontbrekende key retourneert een lege lijst zonder te schrijven', () => {
    const { repo, storage } = repoWith();
    expect(repo.read()).toEqual([]);
    expect(storage.accessedKeys).toEqual([ROSTER_STORAGE_KEY]);
    expect(storage.writtenKeys).toEqual([]);
  });

  it('read met geldige v1-data retourneert identieke spelers', () => {
    const { repo } = repoWith([PLAYER]);
    expect(repo.read()).toEqual([PLAYER]);
  });

  it('read met onbekende velden op een speler behoudt ze', () => {
    const withExtra = { ...PLAYER, toekomstigVeld: 'x' };
    const { repo } = repoWith([withExtra] as unknown as Roster);
    const out = repo.read();
    expect((out[0] as Record<string, unknown>).toekomstigVeld).toBe('x');
  });

  it('read met corrupte JSON-string valt terug op een lege lijst', () => {
    const { repo } = repoWith('{ not valid json');
    expect(repo.read()).toEqual([]);
  });

  it('read met niet-array JSON valt terug op een lege lijst', () => {
    const { repo } = repoWith(JSON.stringify({ not: 'an array' }));
    expect(repo.read()).toEqual([]);
  });

  it('write slaat alleen bekende teamvelden op en retourneert true', () => {
    const { repo, storage } = repoWith();
    const withExtra = { ...PLAYER, start: false, participate: true } as unknown as Roster[number];
    const ok = repo.write([withExtra]);
    expect(ok).toBe(true);
    const written = JSON.parse(storage.store.get(ROSTER_STORAGE_KEY) as string);
    expect(written).toEqual([PLAYER]);
  });

  it('write raakt geen andere keys aan', () => {
    const { repo, storage } = repoWith();
    repo.write([PLAYER]);
    expect(storage.writtenKeys).toEqual([ROSTER_STORAGE_KEY]);
    expect(storage.accessedKeys).toEqual([]);
    expect(storage.removedKeys).toEqual([]);
  });

  it('write retourneert false wanneer de opslag faalt', () => {
    const failingStorage: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    const repo = new LocalStorageRosterRepository(failingStorage);
    expect(repo.write([PLAYER])).toBe(false);
  });

  it('read met v1-corrupte-typen behoudt exacte waarden', () => {
    const corrupt = { ...PLAYER, vrouw: 'ja' } as unknown as Roster[number];
    const { repo } = repoWith([corrupt]);
    const out = repo.read();
    expect(out[0]?.vrouw).toBe('ja');
  });
});
