import { describe, it, expect } from 'vitest';
import {
  clearBootstrapOrgId,
  readBootstrapOrgId,
  writeBootstrapOrgId,
} from '../../src/infrastructure/onboarding/bootstrapProgress';
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

describe('infrastructure/onboarding/bootstrapProgress', () => {
  it('geeft null terug als er geen onvoltooide bootstrap bekend is', () => {
    expect(readBootstrapOrgId(new FakeStorage())).toBeNull();
  });

  it('rondt een orgId correct af via write/read', () => {
    const storage = new FakeStorage();
    writeBootstrapOrgId(storage, 'org-123');
    expect(readBootstrapOrgId(storage)).toBe('org-123');
  });

  it('clearBootstrapOrgId wist de onvoltooide-bootstrapstatus', () => {
    const storage = new FakeStorage();
    writeBootstrapOrgId(storage, 'org-123');
    clearBootstrapOrgId(storage);
    expect(readBootstrapOrgId(storage)).toBeNull();
  });
});
