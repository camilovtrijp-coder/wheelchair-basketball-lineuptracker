import { describe, it, expect } from 'vitest';
import {
  completedGamesStorageKey,
  LocalStorageCompletedGameRepository,
} from '../../src/infrastructure/game/LocalStorageCompletedGameRepository';
import { createBrowserStorage } from '../../src/i18n/browserStorage';
import type { KeyValueStorage } from '../../src/i18n/persistence';
import type { CompletedGame } from '../../src/domain/game/types';

class TrackingStorage implements KeyValueStorage {
  public readonly store = new Map<string, string>();
  public failNextWrite = false;
  public failNextRead = false;

  getItem(key: string): string | null {
    if (this.failNextRead) {
      this.failNextRead = false;
      throw new Error('storage unavailable');
    }
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('quota exceeded');
    }
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  seed(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function completedGame(overrides: Partial<CompletedGame> = {}): CompletedGame {
  return {
    id: 'g1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'active-1',
    opponent: 'Tegenstander',
    competition: '',
    date: '2026-01-01T12:00:00.000Z',
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

describe('completedGamesStorageKey', () => {
  it('is per organisatie/team uniek, net als activeGameStorageKey', () => {
    expect(completedGamesStorageKey('org-1', 'team-1')).toBe(
      'lineup-tracker-v2-completed-games:org-1:team-1',
    );
    expect(completedGamesStorageKey('org-1', 'team-1')).not.toBe(
      completedGamesStorageKey('org-1', 'team-2'),
    );
  });
});

describe('LocalStorageCompletedGameRepository', () => {
  it('list() geeft een lege array terug zonder opgeslagen data', () => {
    const repo = new LocalStorageCompletedGameRepository(new TrackingStorage(), 'org-1', 'team-1');
    expect(repo.list()).toEqual([]);
  });

  it('add() voegt nieuwste eerst toe (v1-pariteit: unshift)', () => {
    const storage = new TrackingStorage();
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    expect(repo.add(completedGame({ id: 'g1' }))).toBe(true);
    expect(repo.add(completedGame({ id: 'g2' }))).toBe(true);
    expect(repo.list().map((g) => g.id)).toEqual(['g2', 'g1']);
  });

  it('add() weigert een wedstrijd die niet bij dit organisatie/team hoort', () => {
    const repo = new LocalStorageCompletedGameRepository(new TrackingStorage(), 'org-1', 'team-1');
    expect(repo.add(completedGame({ teamId: 'team-2' }))).toBe(false);
    expect(repo.list()).toEqual([]);
  });

  it('remove() verwijdert precies de wedstrijd met dit ID', () => {
    const storage = new TrackingStorage();
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    repo.add(completedGame({ id: 'g1' }));
    repo.add(completedGame({ id: 'g2' }));
    expect(repo.remove('g1')).toBe(true);
    expect(repo.list().map((g) => g.id)).toEqual(['g2']);
  });

  it('remove() van een onbestaand ID is een no-op die true teruggeeft', () => {
    const storage = new TrackingStorage();
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    repo.add(completedGame({ id: 'g1' }));
    expect(repo.remove('does-not-exist')).toBe(true);
    expect(repo.list().map((g) => g.id)).toEqual(['g1']);
  });

  it('filtert corrupte of verkeerd-getagde items uit een gelezen lijst, i.p.v. alles te verwerpen', () => {
    const storage = new TrackingStorage();
    const key = completedGamesStorageKey('org-1', 'team-1');
    storage.seed(
      key,
      JSON.stringify([
        completedGame({ id: 'valid' }),
        { id: 'missing-fields' },
        completedGame({ id: 'wrong-team', teamId: 'team-2' }),
      ]),
    );
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    expect(repo.list().map((g) => g.id)).toEqual(['valid']);
  });

  it('geeft een lege array terug bij niet-JSON of niet-array data', () => {
    const storage = new TrackingStorage();
    const key = completedGamesStorageKey('org-1', 'team-1');
    storage.seed(key, 'not json');
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    expect(repo.list()).toEqual([]);

    storage.seed(key, JSON.stringify({ not: 'an array' }));
    expect(repo.list()).toEqual([]);
  });

  it('add() geeft false terug bij een opslagfout en verandert de lijst niet', () => {
    const storage = new TrackingStorage();
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    storage.failNextWrite = true;
    expect(repo.add(completedGame())).toBe(false);
    expect(repo.list()).toEqual([]);
  });

  it('remove() geeft false terug bij een opslagfout', () => {
    const storage = new TrackingStorage();
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    repo.add(completedGame({ id: 'g1' }));
    storage.failNextWrite = true;
    expect(repo.remove('g1')).toBe(false);
  });

  it('add() weigert te schrijven als de voorafgaande read faalt, i.p.v. de bestaande historie te overschrijven', () => {
    // Reproductie van de externe PR-6.3-review: een storage-readfout mag nooit als "leeg"
    // behandeld worden, anders overschrijft add() de bestaande, wél nog aanwezige historie.
    const storage = new TrackingStorage();
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    repo.add(completedGame({ id: 'old' }));

    storage.failNextRead = true;
    expect(repo.add(completedGame({ id: 'new' }))).toBe(false);

    expect(repo.list().map((g) => g.id)).toEqual(['old']);
  });

  it('remove() weigert te schrijven als de voorafgaande read faalt, i.p.v. alles te wissen', () => {
    const storage = new TrackingStorage();
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    repo.add(completedGame({ id: 'old' }));

    storage.failNextRead = true;
    expect(repo.remove('old')).toBe(false);

    expect(repo.list().map((g) => g.id)).toEqual(['old']);
  });

  it('add() weigert te schrijven als de bestaande data corrupt (niet-array) is, i.p.v. die te vervangen', () => {
    const storage = new TrackingStorage();
    const key = completedGamesStorageKey('org-1', 'team-1');
    storage.seed(key, JSON.stringify({ not: 'an array' }));
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');

    expect(repo.add(completedGame({ id: 'new' }))).toBe(false);
    // De corrupte raw data blijft ongewijzigd staan (quarantaine i.p.v. stil overschrijven).
    expect(storage.getItem(key)).toBe(JSON.stringify({ not: 'an array' }));
  });

  it('add() weigert te schrijven bij een echte getItem()-fout op het daadwerkelijke browserStorage-productiepad', () => {
    // Herreview-regressietest (externe PR-6.3-review, aug. 2026): de vorige
    // TrackingStorage-tests hierboven omzeilen `createBrowserStorage()` — die
    // adapter vertaalt in de standaardmodus élke getItem()-fout naar `null`,
    // waardoor readAll() dat ten onrechte als "leeg" zou lezen. Deze test
    // gebruikt daarom de daadwerkelijke adapter met `swallowGetItemErrors:
    // false` (zie App.tsx: `strictReadBrowserStorage`, exact hiervoor
    // geïntroduceerd) en een backing Storage waarvan getItem() één keer
    // gooit terwijl setItem() daarna gewoon slaagt.
    const key = completedGamesStorageKey('org-1', 'team-1');
    const backingStore = new Map<string, string>();
    backingStore.set(key, JSON.stringify([completedGame({ id: 'old' })]));

    let failNextRead = true;
    const backing = {
      getItem(k: string) {
        if (failNextRead) {
          failNextRead = false;
          throw new Error('storage unavailable');
        }
        return backingStore.get(k) ?? null;
      },
      setItem(k: string, value: string) {
        backingStore.set(k, value);
      },
      removeItem(k: string) {
        backingStore.delete(k);
      },
    } as unknown as Storage;

    const storage = createBrowserStorage(() => backing, { swallowGetItemErrors: false });
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');

    expect(repo.add(completedGame({ id: 'new' }))).toBe(false);
    expect(JSON.parse(backingStore.get(key)!).map((g: CompletedGame) => g.id)).toEqual(['old']);
  });

  it('add() weigert te schrijven bij een tijdelijk falende storage-GETTER (niet alleen een falende methode)', () => {
    // Herreview-regressietest (externe PR-6.3-review, aug. 2026, ronde 2): de
    // vorige test hierboven dekte alleen een falende `Storage.getItem()`-
    // METHODE op een wél verkregen storage. `getStorage()` zelf kan ook maar
    // één keer falen (bv. een tijdelijke SecurityError) en daarna weer een
    // werkende storage teruggeven — exact het scenario uit de review.
    const key = completedGamesStorageKey('org-1', 'team-1');
    const backingStore = new Map<string, string>();
    backingStore.set(key, JSON.stringify([completedGame({ id: 'old' })]));
    const backing = {
      getItem: (k: string) => backingStore.get(k) ?? null,
      setItem: (k: string, value: string) => backingStore.set(k, value),
      removeItem: (k: string) => backingStore.delete(k),
    } as unknown as Storage;

    let failNextGetter = true;
    const storage = createBrowserStorage(
      () => {
        if (failNextGetter) {
          failNextGetter = false;
          throw new Error('SecurityError: storage temporarily unavailable');
        }
        return backing;
      },
      { swallowGetItemErrors: false },
    );
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');

    expect(repo.add(completedGame({ id: 'new' }))).toBe(false);
    expect(JSON.parse(backingStore.get(key)!).map((g: CompletedGame) => g.id)).toEqual(['old']);
  });

  it('add() weigert te schrijven bij een blijvend onbeschikbare storage-getter (permanent null)', () => {
    const storage = createBrowserStorage(() => null, { swallowGetItemErrors: false });
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');

    expect(repo.add(completedGame({ id: 'new' }))).toBe(false);
  });

  it('houdt teams strikt gescheiden (zelfde isolatie als de actieve wedstrijd)', () => {
    const storage = new TrackingStorage();
    const repoA = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    const repoB = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-2');
    repoA.add(completedGame({ id: 'g1', teamId: 'team-1' }));
    repoB.add(completedGame({ id: 'g2', teamId: 'team-2' }));
    expect(repoA.list().map((g) => g.id)).toEqual(['g1']);
    expect(repoB.list().map((g) => g.id)).toEqual(['g2']);
  });
});

describe('LocalStorageCompletedGameRepository.safeList (PR 6.4 §A.2)', () => {
  it('geeft "missing" terug bij een nog nooit aangemaakte sleutel (lege opslag)', () => {
    const repo = new LocalStorageCompletedGameRepository(new TrackingStorage(), 'org-1', 'team-1');
    expect(repo.safeList()).toEqual({ status: 'missing', games: [] });
  });

  it('geeft "ok" terug voor een leesbare, niet-lege lijst', () => {
    const storage = new TrackingStorage();
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    repo.add(completedGame({ id: 'g1' }));
    expect(repo.safeList()).toEqual({ status: 'ok', games: [completedGame({ id: 'g1' })] });
  });

  it('geeft "error" terug bij een corrupte JSON-payload en levert NOOIT de "ok"-tak met games=[]', () => {
    const storage = new TrackingStorage();
    const key = completedGamesStorageKey('org-1', 'team-1');
    storage.seed(key, 'not-json');
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    expect(repo.safeList()).toEqual({ status: 'error', games: [] });
  });

  it('geeft "error" terug bij een niet-array JSON-payload', () => {
    const storage = new TrackingStorage();
    const key = completedGamesStorageKey('org-1', 'team-1');
    storage.seed(key, JSON.stringify({ not: 'an array' }));
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    expect(repo.safeList()).toEqual({ status: 'error', games: [] });
  });

  it('geeft "error" terug bij een gefaalde getItem() op het productie-strict browserStorage-pad', () => {
    const key = completedGamesStorageKey('org-1', 'team-1');
    const backingStore = new Map<string, string>();
    backingStore.set(key, JSON.stringify([completedGame({ id: 'old' })]));
    let failNextRead = true;
    const backing = {
      getItem: (k: string) => {
        if (failNextRead) {
          failNextRead = false;
          throw new Error('storage unavailable');
        }
        return backingStore.get(k) ?? null;
      },
      setItem: (k: string, v: string) => backingStore.set(k, v),
      removeItem: (k: string) => backingStore.delete(k),
    } as unknown as Storage;
    const storage = createBrowserStorage(() => backing, { swallowGetItemErrors: false });
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    expect(repo.safeList()).toEqual({ status: 'error', games: [] });
  });

  it('geeft "error" terug bij een blijvend onbeschikbare storage-getter', () => {
    const storage = createBrowserStorage(() => null, { swallowGetItemErrors: false });
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    expect(repo.safeList()).toEqual({ status: 'error', games: [] });
  });

  it('filtert corrupte items uit een wél leesbare array zonder de hele lijst ongeldig te maken', () => {
    const storage = new TrackingStorage();
    const key = completedGamesStorageKey('org-1', 'team-1');
    storage.seed(key, JSON.stringify([completedGame({ id: 'valid' }), { id: 'missing-fields' }]));
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    expect(repo.safeList().status).toBe('ok');
    expect(repo.safeList().games.map((g) => g.id)).toEqual(['valid']);
  });
});

describe('LocalStorageCompletedGameRepository.safeListStrict (externe PR-6.6-review, aug. 2026)', () => {
  // safeList() blijft het permissieve UI-contract (één beschadigd item
  // verbergt de rest niet, zie de test hierboven) — safeListStrict() is de
  // striktere, uitsluitend voor back-up-export/-snapshot bedoelde variant:
  // een enkel afgekeurd item maakt de HELE lijst 'error', want een export/
  // herstelback-up die zo'n item gewoon weglaat ziet er ten onrechte
  // volledig uit.
  it('meldt error zodra ook maar één item gefilterd wordt, waar safeList() datzelfde item stil filtert', () => {
    const storage = new TrackingStorage();
    const key = completedGamesStorageKey('org-1', 'team-1');
    storage.seed(key, JSON.stringify([completedGame({ id: 'valid' }), { id: 'missing-fields' }]));
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    expect(repo.safeList().status).toBe('ok');
    expect(repo.safeListStrict!()).toEqual({ status: 'error', games: [] });
  });

  it('meldt error bij een context-mismatched item (andere organizationId/teamId dan de sleutel)', () => {
    const storage = new TrackingStorage();
    const key = completedGamesStorageKey('org-1', 'team-1');
    storage.seed(
      key,
      JSON.stringify([completedGame({ id: 'mismatched', organizationId: 'org-ANDER' })]),
    );
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    expect(repo.safeListStrict!()).toEqual({ status: 'error', games: [] });
  });

  it('meldt ok/missing net als safeList() zolang niets gefilterd wordt', () => {
    const storage = new TrackingStorage();
    const key = completedGamesStorageKey('org-1', 'team-1');
    const repoEmpty = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    expect(repoEmpty.safeListStrict!()).toEqual({ status: 'missing', games: [] });

    storage.seed(key, JSON.stringify([completedGame({ id: 'valid' })]));
    const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
    expect(repo.safeListStrict!()).toEqual({
      status: 'ok',
      games: [completedGame({ id: 'valid' })],
    });
  });
});
