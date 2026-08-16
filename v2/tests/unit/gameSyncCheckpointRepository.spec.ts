import { describe, it, expect } from 'vitest';
import {
  LocalStorageGameSyncCheckpointRepository,
  gameSyncCheckpointStorageKey,
} from '../../src/infrastructure/game/LocalStorageGameSyncCheckpointRepository';
import { createEmptyGameSyncCheckpoint } from '../../src/domain/game/syncCheckpoint';
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
  setItem(): never {
    throw new Error('opslag uitgeschakeld');
  }
  removeItem(): never {
    throw new Error('opslag uitgeschakeld');
  }
}

describe('infrastructure/game/LocalStorageGameSyncCheckpointRepository (PR 7.1c)', () => {
  it('read() geeft null terug als er nog geen checkpoint bestaat', () => {
    const repo = new LocalStorageGameSyncCheckpointRepository(new FakeStorage());
    expect(repo.read('game-1')).toBeNull();
  });

  it('rondt write()/read() correct af', () => {
    const repo = new LocalStorageGameSyncCheckpointRepository(new FakeStorage());
    const checkpoint = createEmptyGameSyncCheckpoint(
      'game-1',
      'org-1',
      'team-1',
      '2026-01-01T00:00:00.000Z',
    );
    expect(repo.write(checkpoint)).toBe(true);
    expect(repo.read('game-1')).toEqual(checkpoint);
  });

  it('bewaart elke wedstrijd onder een eigen sleutel (geen kruisbesmetting)', () => {
    const storage = new FakeStorage();
    const repo = new LocalStorageGameSyncCheckpointRepository(storage);
    const a = createEmptyGameSyncCheckpoint(
      'game-a',
      'org-1',
      'team-1',
      '2026-01-01T00:00:00.000Z',
    );
    const b = createEmptyGameSyncCheckpoint(
      'game-b',
      'org-1',
      'team-1',
      '2026-01-01T00:00:00.000Z',
    );
    repo.write(a);
    repo.write(b);
    expect(repo.read('game-a')?.gameId).toBe('game-a');
    expect(repo.read('game-b')?.gameId).toBe('game-b');
  });

  it('clear() verwijdert het checkpoint', () => {
    const repo = new LocalStorageGameSyncCheckpointRepository(new FakeStorage());
    const checkpoint = createEmptyGameSyncCheckpoint(
      'game-1',
      'org-1',
      'team-1',
      '2026-01-01T00:00:00.000Z',
    );
    repo.write(checkpoint);
    expect(repo.clear('game-1')).toBe(true);
    expect(repo.read('game-1')).toBeNull();
  });

  it('negeert corrupte/vervormde JSON onder de sleutel (behandeld als "geen checkpoint")', () => {
    const storage = new FakeStorage();
    storage.setItem(gameSyncCheckpointStorageKey('game-1'), '{niet-geldige-json');
    const repo = new LocalStorageGameSyncCheckpointRepository(storage);
    expect(repo.read('game-1')).toBeNull();
  });

  it('negeert een checkpoint waarvan het gameId-veld niet overeenkomt met de sleutel', () => {
    const storage = new FakeStorage();
    const mismatched = createEmptyGameSyncCheckpoint(
      'game-ANDERS',
      'org-1',
      'team-1',
      '2026-01-01T00:00:00.000Z',
    );
    storage.setItem(gameSyncCheckpointStorageKey('game-1'), JSON.stringify(mismatched));
    const repo = new LocalStorageGameSyncCheckpointRepository(storage);
    expect(repo.read('game-1')).toBeNull();
  });

  it('write()/clear() geven false terug als de opslag faalt', () => {
    const repo = new LocalStorageGameSyncCheckpointRepository(new ThrowingStorage());
    const checkpoint = createEmptyGameSyncCheckpoint(
      'game-1',
      'org-1',
      'team-1',
      '2026-01-01T00:00:00.000Z',
    );
    expect(repo.write(checkpoint)).toBe(false);
    expect(repo.clear('game-1')).toBe(false);
  });

  it('read() geeft null terug (geen throw) als de opslag faalt', () => {
    const repo = new LocalStorageGameSyncCheckpointRepository(new ThrowingStorage());
    expect(repo.read('game-1')).toBeNull();
  });

  // PR 7.2a: completedGameId is een optioneel veld op hetzelfde checkpoint.
  it('rondt een checkpoint met completedGameId gezet correct af', () => {
    const repo = new LocalStorageGameSyncCheckpointRepository(new FakeStorage());
    const checkpoint = {
      ...createEmptyGameSyncCheckpoint('game-1', 'org-1', 'team-1', '2026-01-01T00:00:00.000Z'),
      completedGameId: 'completed-1',
    };
    expect(repo.write(checkpoint)).toBe(true);
    expect(repo.read('game-1')).toEqual(checkpoint);
  });

  it('verwerpt een checkpoint met een niet-string completedGameId (behandeld als "geen checkpoint")', () => {
    const storage = new FakeStorage();
    const malformed = {
      ...createEmptyGameSyncCheckpoint('game-1', 'org-1', 'team-1', '2026-01-01T00:00:00.000Z'),
      completedGameId: 42,
    };
    storage.setItem(gameSyncCheckpointStorageKey('game-1'), JSON.stringify(malformed));
    const repo = new LocalStorageGameSyncCheckpointRepository(storage);
    expect(repo.read('game-1')).toBeNull();
  });
});
