import { describe, it, expect } from 'vitest';
import {
  SELECTED_CONTEXT_STORAGE_KEY,
  clearSelectedContext,
  readSelectedContext,
  writeSelectedContext,
} from '../../src/infrastructure/context/selectedContext';
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

describe('infrastructure/context/selectedContext', () => {
  it('geeft null terug als er nog niets is opgeslagen', () => {
    expect(readSelectedContext(new FakeStorage())).toBeNull();
  });

  it('rondt een context correct af via write/read', () => {
    const storage = new FakeStorage();
    writeSelectedContext(storage, { orgId: 'org-rotterdam', teamId: 'team-1' });
    expect(readSelectedContext(storage)).toEqual({ orgId: 'org-rotterdam', teamId: 'team-1' });
  });

  it('behandelt niet-parsebare JSON als niets opgeslagen', () => {
    const storage = new FakeStorage();
    storage.setItem(SELECTED_CONTEXT_STORAGE_KEY, 'niet-json{{');
    expect(readSelectedContext(storage)).toBeNull();
  });

  it('behandelt geldige JSON met de verkeerde vorm als niets opgeslagen', () => {
    const storage = new FakeStorage();
    storage.setItem(SELECTED_CONTEXT_STORAGE_KEY, JSON.stringify({ orgId: 'org-rotterdam' }));
    expect(readSelectedContext(storage)).toBeNull();
  });

  it('clearSelectedContext verwijdert de opgeslagen context', () => {
    const storage = new FakeStorage();
    writeSelectedContext(storage, { orgId: 'org-rotterdam', teamId: 'team-1' });
    clearSelectedContext(storage);
    expect(readSelectedContext(storage)).toBeNull();
  });
});
