import { describe, it, expect } from 'vitest';
import {
  activeGameStorageKey,
  LocalStorageGameRepository,
} from '../../src/infrastructure/game/LocalStorageGameRepository';
import type { KeyValueStorage } from '../../src/i18n/persistence';
import { MAX_CLOCK_SECONDS, type ActiveGame } from '../../src/domain/game/types';

class TrackingStorage implements KeyValueStorage {
  public readonly store = new Map<string, string>();
  public readonly writtenKeys: string[] = [];

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writtenKeys.push(key);
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  seed(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function activeGame(overrides: Partial<ActiveGame> = {}): ActiveGame {
  return {
    id: 'game-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'setup',
    players: [],
    opponent: '',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: [],
    curQuarter: 1,
    beginSec: 0,
    endSec: 0,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    ...overrides,
  };
}

describe('infrastructure/game/LocalStorageGameRepository', () => {
  it('leest null als er nog niets is opgeslagen', () => {
    const storage = new TrackingStorage();
    const repo = new LocalStorageGameRepository(storage, 'org-1', 'team-1');
    expect(repo.read()).toBeNull();
  });

  it('schrijft en leest een actieve wedstrijd terug', () => {
    const storage = new TrackingStorage();
    const repo = new LocalStorageGameRepository(storage, 'org-1', 'team-1');
    const game = activeGame({ opponent: 'Team B' });

    expect(repo.write(game)).toBe(true);
    expect(repo.read()).toEqual(game);
  });

  it('bewaart pendingSwapLineup — een crash tijdens een onbevestigde wissel verliest de vorige opstelling niet', () => {
    const storage = new TrackingStorage();
    const repo = new LocalStorageGameRepository(storage, 'org-1', 'team-1');
    const game = activeGame({
      phase: 'tracking',
      onCourt: ['p1', 'p2', 'p3', 'p4', 'p6'],
      pendingSwapLineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
    });

    repo.write(game);

    expect(repo.read()?.pendingSwapLineup).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('gebruikt een aparte sleutel per organisatie/team — een contextwissel raakt andere teams niet', () => {
    const storage = new TrackingStorage();
    const repoA = new LocalStorageGameRepository(storage, 'org-1', 'team-a');
    const repoB = new LocalStorageGameRepository(storage, 'org-1', 'team-b');

    const gameA = activeGame({ id: 'game-a', teamId: 'team-a', opponent: 'Team A tegenstander' });
    repoA.write(gameA);

    expect(repoB.read()).toBeNull();
    expect(repoA.read()).toEqual(gameA);
    expect(activeGameStorageKey('org-1', 'team-a')).not.toBe(
      activeGameStorageKey('org-1', 'team-b'),
    );
  });

  it('retourneert null bij corrupte JSON zonder te crashen', () => {
    const storage = new TrackingStorage();
    storage.seed(activeGameStorageKey('org-1', 'team-1'), '{niet geldig json');
    const repo = new LocalStorageGameRepository(storage, 'org-1', 'team-1');
    expect(repo.read()).toBeNull();
  });

  it('migreert een PR-6.1-wedstrijd zonder curQuarter/beginSec/endSec/pendingSwapLineup/actions in plaats van hem als ongeldig te lezen', () => {
    // Vóór PR 6.2 kon een wedstrijd al phase 'tracking' hebben zonder deze
    // velden. Zonder migratie zou read() hier null teruggeven en zou de
    // aanroeper (App.tsx) stilzwijgend een verse opzet aanmaken en de
    // opgeslagen wedstrijd overschrijven — een bevestigde wedstrijd kwijt.
    const legacyGame = {
      id: 'legacy-1',
      organizationId: 'org-1',
      teamId: 'team-1',
      phase: 'tracking',
      players: [],
      opponent: 'Legacy tegenstander',
      competition: '',
      clockDown: true,
      limitStr: '14.5',
      onCourt: ['p1', 'p2', 'p3', 'p4', 'p5'],
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:05:00.000Z',
    };
    const storage = new TrackingStorage();
    storage.seed(activeGameStorageKey('org-1', 'team-1'), JSON.stringify(legacyGame));
    const repo = new LocalStorageGameRepository(storage, 'org-1', 'team-1');

    const result = repo.read();

    expect(result).not.toBeNull();
    expect(result?.opponent).toBe('Legacy tegenstander');
    expect(result?.onCourt).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(result?.curQuarter).toBe(1);
    expect(result?.beginSec).toBe(MAX_CLOCK_SECONDS);
    expect(result?.endSec).toBe(MAX_CLOCK_SECONDS);
    expect(result?.pendingSwapLineup).toBeNull();
    expect(result?.actions).toEqual([]);
  });

  it('retourneert null als de opgeslagen vorm geen geldige ActiveGame is', () => {
    const storage = new TrackingStorage();
    storage.seed(activeGameStorageKey('org-1', 'team-1'), JSON.stringify({ foo: 'bar' }));
    const repo = new LocalStorageGameRepository(storage, 'org-1', 'team-1');
    expect(repo.read()).toBeNull();
  });

  it('write() retourneert false als de opslag faalt (bijv. quota)', () => {
    const storage: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    const repo = new LocalStorageGameRepository(storage, 'org-1', 'team-1');
    expect(repo.write(activeGame())).toBe(false);
  });
});
