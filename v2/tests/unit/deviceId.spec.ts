import { describe, it, expect } from 'vitest';
import {
  DEVICE_ID_STORAGE_KEY,
  readOrCreateDeviceId,
} from '../../src/infrastructure/device/deviceId';
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

class ThrowingStorage implements KeyValueStorage {
  getItem(): string | null {
    throw new Error('opslag uitgeschakeld');
  }
  setItem(): void {
    throw new Error('opslag uitgeschakeld');
  }
  removeItem(): void {
    throw new Error('opslag uitgeschakeld');
  }
}

describe('infrastructure/device/deviceId', () => {
  it('genereert en bewaart een nieuw ID als er nog niets is opgeslagen', () => {
    const storage = new FakeStorage();
    const id = readOrCreateDeviceId(storage);
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(storage.getItem(DEVICE_ID_STORAGE_KEY)).toBe(id);
  });

  it('geeft hetzelfde ID terug bij een volgende aanroep (stabiel over reloads)', () => {
    const storage = new FakeStorage();
    const first = readOrCreateDeviceId(storage);
    const second = readOrCreateDeviceId(storage);
    expect(second).toBe(first);
  });

  it('twee losse storages krijgen elk hun eigen, verschillend ID', () => {
    const a = readOrCreateDeviceId(new FakeStorage());
    const b = readOrCreateDeviceId(new FakeStorage());
    expect(a).not.toBe(b);
  });

  it('valt terug op een in-memory ID (geen throw) als opslag volledig faalt', () => {
    const storage = new ThrowingStorage();
    expect(() => readOrCreateDeviceId(storage)).not.toThrow();
    expect(readOrCreateDeviceId(storage)).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
