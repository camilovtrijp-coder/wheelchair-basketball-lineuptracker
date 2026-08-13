import { describe, it, expect } from 'vitest';
import { createBrowserStorage } from '../../src/i18n/browserStorage';

class FakeStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new Error('SecurityError');
  };
  return {
    get length(): number {
      return 0;
    },
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  } as unknown as Storage;
}

describe('createBrowserStorage', () => {
  it('rondt get/set/remove af via een werkende storage', () => {
    const backing = new FakeStorage();
    const storage = createBrowserStorage(() => backing);

    storage.setItem('a', '1');
    expect(storage.getItem('a')).toBe('1');

    storage.setItem('a', '2');
    expect(storage.getItem('a')).toBe('2');

    storage.removeItem('a');
    expect(storage.getItem('a')).toBeNull();
  });

  it('geeft null terug en werpt niet wanneer de storage-getter zelf throwt', () => {
    const storage = createBrowserStorage(() => {
      throw new Error('SecurityError: storage disabled');
    });

    expect(storage.getItem('x')).toBeNull();
    expect(() => storage.setItem('x', 'y')).not.toThrow();
    expect(() => storage.removeItem('x')).not.toThrow();
  });

  it('geeft null terug en werpt niet wanneer de storage-getter null teruggeeft', () => {
    const storage = createBrowserStorage(() => null);

    expect(storage.getItem('x')).toBeNull();
    expect(() => storage.setItem('x', 'y')).not.toThrow();
    expect(() => storage.removeItem('x')).not.toThrow();
  });

  it('geeft null terug en werpt niet wanneer getItem() op een verkregen storage zelf throwt', () => {
    const storage = createBrowserStorage(() => throwingStorage());

    expect(storage.getItem('x')).toBeNull();
  });

  it('laat een echte schrijffout (bv. quota overschreden) van een verkregen storage doorwerpen', () => {
    const backing = new FakeStorage();
    const quotaExceeded = () => {
      throw new Error('QuotaExceededError');
    };
    const failingWrites = {
      ...backing,
      setItem: quotaExceeded,
      removeItem: quotaExceeded,
    } as unknown as Storage;
    const storage = createBrowserStorage(() => failingWrites);

    expect(() => storage.setItem('x', 'y')).toThrow();
    expect(() => storage.removeItem('x')).toThrow();
  });

  describe('{ swallowGetItemErrors: false } (externe PR-6.3-review, aug. 2026)', () => {
    it('laat een echte getItem()-fout van een verkregen storage doorwerpen i.p.v. naar null te vertalen', () => {
      const storage = createBrowserStorage(() => throwingStorage(), {
        swallowGetItemErrors: false,
      });

      expect(() => storage.getItem('x')).toThrow();
    });

    it('geeft nog steeds null terug (werpt niet) wanneer de storage-getter zelf faalt of null teruggeeft', () => {
      const storageFromThrowingGetter = createBrowserStorage(
        () => {
          throw new Error('SecurityError: storage disabled');
        },
        { swallowGetItemErrors: false },
      );
      expect(storageFromThrowingGetter.getItem('x')).toBeNull();

      const storageFromNullGetter = createBrowserStorage(() => null, {
        swallowGetItemErrors: false,
      });
      expect(storageFromNullGetter.getItem('x')).toBeNull();
    });

    it('rondt get/set/remove nog steeds normaal af via een werkende storage', () => {
      const backing = new FakeStorage();
      const storage = createBrowserStorage(() => backing, { swallowGetItemErrors: false });

      storage.setItem('a', '1');
      expect(storage.getItem('a')).toBe('1');
      storage.removeItem('a');
      expect(storage.getItem('a')).toBeNull();
    });
  });
});
