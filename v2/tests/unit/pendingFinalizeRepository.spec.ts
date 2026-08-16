import { describe, it, expect } from 'vitest';
import {
  LocalStoragePendingFinalizeRepository,
  pendingFinalizeStorageKey,
} from '../../src/infrastructure/game/LocalStoragePendingFinalizeRepository';
import type { PendingFinalizeEntry } from '../../src/application/game/PendingFinalizeRepository';
import type { ActiveGame, CompletedGame } from '../../src/domain/game/types';
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

function game(overrides: Partial<ActiveGame> = {}): ActiveGame {
  return {
    id: 'game-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: [],
    opponent: 'Tegenstander',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: [],
    curQuarter: 1,
    beginSec: 600,
    endSec: 590,
    pendingSwapLineup: null,
    actions: [
      { type: 'score-delta', id: 'a1', team: 'for', delta: 2, at: '2026-01-01T00:00:00.000Z' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function completed(overrides: Partial<CompletedGame> = {}): CompletedGame {
  return {
    id: 'completed-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'game-1',
    opponent: 'Tegenstander',
    competition: '',
    date: '2026-01-01T02:00:00.000Z',
    players: [],
    segments: [],
    scoreFor: 10,
    scoreAgainst: 8,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    ...overrides,
  };
}

function entry(overrides: Partial<PendingFinalizeEntry> = {}): PendingFinalizeEntry {
  return { game: game(), completed: completed(), ...overrides };
}

describe('infrastructure/game/LocalStoragePendingFinalizeRepository (PR 7.2a, P1-fix externe review PR #61)', () => {
  it('list() geeft een lege array terug als er nog niets is', () => {
    const repo = new LocalStoragePendingFinalizeRepository(new FakeStorage(), 'org-1', 'team-1');
    expect(repo.list()).toEqual([]);
  });

  it('rondt add()/list() correct af — de volledige ActiveGame-actielog blijft intact', () => {
    const repo = new LocalStoragePendingFinalizeRepository(new FakeStorage(), 'org-1', 'team-1');
    const e = entry();
    expect(repo.add(e)).toBe(true);
    expect(repo.list()).toEqual([e]);
  });

  // Dit is de kern van de P1-fix: een NIEUWE repository-instantie tegen
  // DEZELFDE onderliggende storage (zoals een paginareload/app-herstart zou
  // opleveren) ziet nog steeds de openstaande afronding — de bron gaat niet
  // verloren als de in-memory `App`-state (een `useRef`) wegvalt.
  it('overleeft een nieuwe repository-instantie tegen dezelfde storage (simuleert een paginareload)', () => {
    const storage = new FakeStorage();
    const first = new LocalStoragePendingFinalizeRepository(storage, 'org-1', 'team-1');
    first.add(entry());

    const second = new LocalStoragePendingFinalizeRepository(storage, 'org-1', 'team-1');
    expect(second.list()).toEqual([entry()]);
  });

  it('add() met dezelfde completed.id overschrijft (upsert), stapelt niet', () => {
    const repo = new LocalStoragePendingFinalizeRepository(new FakeStorage(), 'org-1', 'team-1');
    repo.add(entry({ completed: completed({ scoreFor: 10 }) }));
    repo.add(entry({ completed: completed({ scoreFor: 99 }) }));
    const list = repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.completed.scoreFor).toBe(99);
  });

  it('remove() verwijdert de entry; een herhaalde remove() blijft true (no-op)', () => {
    const repo = new LocalStoragePendingFinalizeRepository(new FakeStorage(), 'org-1', 'team-1');
    repo.add(entry());
    expect(repo.remove('completed-1')).toBe(true);
    expect(repo.list()).toEqual([]);
    expect(repo.remove('completed-1')).toBe(true);
  });

  it('add() weigert een entry die niet bij deze organisatie/team hoort', () => {
    const repo = new LocalStoragePendingFinalizeRepository(new FakeStorage(), 'org-1', 'team-1');
    const foreign = entry({ completed: completed({ organizationId: 'org-2' }) });
    expect(repo.add(foreign)).toBe(false);
    expect(repo.list()).toEqual([]);
  });

  it('bewaart elk team onder een eigen sleutel (geen kruisbesmetting)', () => {
    const storage = new FakeStorage();
    const repoA = new LocalStoragePendingFinalizeRepository(storage, 'org-1', 'team-A');
    const repoB = new LocalStoragePendingFinalizeRepository(storage, 'org-1', 'team-B');
    repoA.add(
      entry({ game: game({ teamId: 'team-A' }), completed: completed({ teamId: 'team-A' }) }),
    );
    expect(repoA.list()).toHaveLength(1);
    expect(repoB.list()).toHaveLength(0);
  });

  it('negeert corrupte JSON onder de sleutel (behandeld als "geen openstaande afrondingen")', () => {
    const storage = new FakeStorage();
    storage.setItem(pendingFinalizeStorageKey('org-1', 'team-1'), '{niet-geldige-json');
    const repo = new LocalStoragePendingFinalizeRepository(storage, 'org-1', 'team-1');
    expect(repo.list()).toEqual([]);
  });

  it('filtert een individueel malformed item (bijv. ontbrekende actions) zonder de rest te verliezen', () => {
    const storage = new FakeStorage();
    storage.setItem(
      pendingFinalizeStorageKey('org-1', 'team-1'),
      JSON.stringify([entry(), { game: { id: 'game-2' }, completed: completed() }]),
    );
    const repo = new LocalStoragePendingFinalizeRepository(storage, 'org-1', 'team-1');
    expect(repo.list()).toEqual([entry()]);
  });

  it('write()/add() geven false terug als de opslag faalt', () => {
    class ThrowingStorage implements KeyValueStorage {
      getItem(): string | null {
        return null;
      }
      setItem(): never {
        throw new Error('quota overschreden');
      }
      removeItem(): never {
        throw new Error('quota overschreden');
      }
    }
    const repo = new LocalStoragePendingFinalizeRepository(
      new ThrowingStorage(),
      'org-1',
      'team-1',
    );
    expect(repo.add(entry())).toBe(false);
  });

  // P1-fix, tweede ronde (externe review PR #61): een falende/onbeschikbare
  // storage-GETTER mag `add()`/`remove()` NOOIT als "leeg, dus veilig om te
  // overschrijven" behandelen — dat zou een al aanwezige, alleen-nog-niet-
  // gelezen entry stilzwijgend wissen. Deze `FlakyStorage` laat `setItem()`
  // gewoon slagen (een echte browser-storage die tijdelijk niet leesbaar is,
  // blijft doorgaans wél schrijfbaar) terwijl `getItem()` faalt — precies het
  // scenario waarin de oude, niet-fail-closed implementatie een write op
  // basis van een foutieve lege lijst zou hebben gedaan.
  class FlakyStorage implements KeyValueStorage {
    private readonly store = new Map<string, string>();
    getShouldThrow = false;
    getItem(key: string): string | null {
      if (this.getShouldThrow) throw new Error('read mislukt');
      return this.store.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
      this.store.set(key, value);
    }
    removeItem(key: string): void {
      this.store.delete(key);
    }
  }

  it('add() overschrijft NOOIT een bestaande entry op basis van een mislukte read (fail-closed)', () => {
    const storage = new FlakyStorage();
    const repo = new LocalStoragePendingFinalizeRepository(storage, 'org-1', 'team-1');
    expect(repo.add(entry())).toBe(true);

    storage.getShouldThrow = true;
    const secondEntry = entry({
      completed: completed({ id: 'completed-2', sourceGameId: 'game-2' }),
    });
    expect(repo.add(secondEntry)).toBe(false);

    // Bewijs dat de oorspronkelijke entry nog intact staat — geen write is
    // uitgevoerd op basis van de mislukte read.
    storage.getShouldThrow = false;
    expect(repo.list()).toEqual([entry()]);
  });

  it('remove() verwijdert NOOIT de hele outbox op basis van een mislukte read (fail-closed)', () => {
    const storage = new FlakyStorage();
    const repo = new LocalStoragePendingFinalizeRepository(storage, 'org-1', 'team-1');
    repo.add(entry());

    storage.getShouldThrow = true;
    expect(repo.remove('completed-1')).toBe(false);

    storage.getShouldThrow = false;
    expect(repo.list()).toEqual([entry()]);
  });
});
