import { describe, it, expect } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { resolveAppRepositories } from '../../src/infrastructure/repositories/resolveAppRepositories';
import { selectRepositories } from '../../src/infrastructure/repositories/selectRepositories';
import { LocalAsyncSettingsRepository } from '../../src/infrastructure/settings/LocalAsyncSettingsRepository';
import { LocalAsyncRosterRepository } from '../../src/infrastructure/roster/LocalAsyncRosterRepository';
import { FirestoreSettingsRepository } from '../../src/infrastructure/settings/FirestoreSettingsRepository';
import { FirestoreRosterRepository } from '../../src/infrastructure/roster/FirestoreRosterRepository';
import { GameSyncCoordinator } from '../../src/application/game/GameSyncCoordinator';
import { FirestoreGameViewerGateway } from '../../src/infrastructure/game/FirestoreGameViewerGateway';
import type { KeyValueStorage } from '../../src/i18n/persistence';
import type { AuthUser } from '../../src/domain/auth/types';
import type { SelectedContext } from '../../src/domain/organizations/types';

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

function fakeDb(): Firestore {
  return {} as Firestore;
}

const user: AuthUser = { uid: 'uid-1', email: 'a@example.test', emailVerified: true };
const context: SelectedContext = { orgId: 'org-1', teamId: 'team-1' };

describe('infrastructure/repositories/resolveAppRepositories (PR 5.3c-1)', () => {
  it("kind:'local' levert LocalAsync*Repository-wrappers en mode:'local'", () => {
    const storage = new MemoryStorage();
    const selection = selectRepositories({
      authUser: null,
      selectedContext: null,
      trustedDevice: false,
      firestoreDb: fakeDb(),
      storage,
    });
    const resolved = resolveAppRepositories(selection, storage);
    expect(resolved.mode).toBe('local');
    expect(resolved.settings).toBeInstanceOf(LocalAsyncSettingsRepository);
    expect(resolved.roster).toBeInstanceOf(LocalAsyncRosterRepository);
    expect(resolved.gameSync).toBeNull();
    expect(resolved.gameWriterContext).toBeNull();
    expect(resolved.gameViewer).toBeNull();
  });

  it("kind:'cloud' geeft de Firestore-adapters uit de selectie ongewijzigd door en mode:'cloud'", () => {
    const storage = new MemoryStorage();
    const selection = selectRepositories({
      authUser: user,
      selectedContext: context,
      trustedDevice: true,
      firestoreDb: fakeDb(),
      storage,
    });
    const resolved = resolveAppRepositories(selection, storage);
    expect(resolved.mode).toBe('cloud');
    expect(resolved.settings).toBeInstanceOf(FirestoreSettingsRepository);
    expect(resolved.roster).toBeInstanceOf(FirestoreRosterRepository);
    expect(resolved.gameSync).toBeInstanceOf(GameSyncCoordinator);
    expect(resolved.gameViewer).toBeInstanceOf(FirestoreGameViewerGateway);
    expect(resolved.gameWriterContext).toEqual({
      authorUid: user.uid,
      deviceId: expect.any(String),
      writerEpoch: 0,
    });
    if (selection.kind === 'cloud') {
      expect(resolved.settings).toBe(selection.settings);
      expect(resolved.roster).toBe(selection.roster);
      expect(resolved.gameSync).toBe(selection.gameSync);
    } else {
      throw new Error('selectie moet cloud zijn');
    }
  });

  it("kind:'cloud' hergebruikt hetzelfde apparaat-ID over meerdere selectRepositories()-aanroepen", () => {
    const storage = new MemoryStorage();
    const first = selectRepositories({
      authUser: user,
      selectedContext: context,
      trustedDevice: true,
      firestoreDb: fakeDb(),
      storage,
    });
    const second = selectRepositories({
      authUser: user,
      selectedContext: context,
      trustedDevice: true,
      firestoreDb: fakeDb(),
      storage,
    });
    if (first.kind !== 'cloud' || second.kind !== 'cloud') {
      throw new Error('selecties moeten cloud zijn');
    }
    expect(second.gameWriterContext.deviceId).toBe(first.gameWriterContext.deviceId);
  });

  it('twee lokale resoluties delen geen adapter-instantie (verse LocalStorage*Repository per aanroep)', () => {
    const storage = new MemoryStorage();
    const a = resolveAppRepositories({ kind: 'local' }, storage);
    const b = resolveAppRepositories({ kind: 'local' }, storage);
    expect(a.settings).not.toBe(b.settings);
    expect(a.roster).not.toBe(b.roster);
  });
});
