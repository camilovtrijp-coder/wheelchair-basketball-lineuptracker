import { describe, it, expect } from 'vitest';
import {
  activeGameStorageKey,
  LocalStorageGameRepository,
  V1_GAME_MIGRATED_FLAG_KEY,
} from '../../src/infrastructure/game/LocalStorageGameRepository';
import { V1_ACTIVE_GAME_STORAGE_KEY } from '../../src/domain/game/v1Migration';
import type { KeyValueStorage } from '../../src/i18n/persistence';
import { MAX_CLOCK_SECONDS, type ActiveGame } from '../../src/domain/game/types';

function v1Blob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    phase: 'tracking',
    players: [
      {
        id: 1,
        nr: '4',
        naam: 'Anna',
        kl: '3.0',
        vrouw: false,
        jeugd: false,
        participate: true,
        start: true,
      },
      {
        id: 2,
        nr: '7',
        naam: 'Bo',
        kl: '1.5',
        vrouw: false,
        jeugd: false,
        participate: true,
        start: true,
      },
      {
        id: 3,
        nr: '9',
        naam: 'Cas',
        kl: '4.5',
        vrouw: false,
        jeugd: false,
        participate: true,
        start: true,
      },
      {
        id: 4,
        nr: '11',
        naam: 'Dee',
        kl: '2.0',
        vrouw: false,
        jeugd: false,
        participate: true,
        start: true,
      },
      {
        id: 5,
        nr: '15',
        naam: 'Eef',
        kl: '3.5',
        vrouw: false,
        jeugd: false,
        participate: true,
        start: true,
      },
    ],
    onCourt: [1, 2, 3, 4, 5],
    curQuarter: 1,
    opponent: 'V1 tegenstander',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    beginMin: 10,
    beginSec: 0,
    endMin: 10,
    endSec: 0,
    segments: [],
    scoreFor: 4,
    scoreAgainst: 2,
    segStartFor: 0,
    segStartAgainst: 0,
    savedAt: 1700000000000,
    ...overrides,
  };
}

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

  it('retourneert null wanneer de opgeslagen organizationId/teamId niet overeenkomt met de sleutel-context', () => {
    // Reproduceert de externe PR-6.1-review (aug. 2026): een payload die (door
    // een toekomstige bug of handmatige bewerking) onder de verkeerde
    // organisatie/team-sleutel terecht is gekomen, mag niet stilzwijgend voor
    // dát team gelezen worden.
    const storage = new TrackingStorage();
    const mismatched = activeGame({ organizationId: 'org-ANDER', teamId: 'team-ANDER' });
    storage.seed(activeGameStorageKey('org-1', 'team-1'), JSON.stringify(mismatched));
    const repo = new LocalStorageGameRepository(storage, 'org-1', 'team-1');

    expect(repo.read()).toBeNull();
  });

  it('safeRead() meldt status:error (niet ok/null) bij een context-mismatch — externe PR-6.6-review', () => {
    // De sleutel zelf is al organisatie/team-specifiek: data eronder met een
    // ANDERE organizationId/teamId is dus mistagged/corrupt, geen bewijs
    // van "geen wedstrijd voor deze context". Een back-up-snapshot/-export
    // gebaseerd op `status:'ok', game:null` zou deze corrupte staat
    // stilzwijgend als lege snapshot behandelen.
    const storage = new TrackingStorage();
    const mismatched = activeGame({ organizationId: 'org-ANDER', teamId: 'team-ANDER' });
    storage.seed(activeGameStorageKey('org-1', 'team-1'), JSON.stringify(mismatched));
    const repo = new LocalStorageGameRepository(storage, 'org-1', 'team-1');

    const result = repo.safeRead();
    expect(result.status).toBe('error');
    expect(result.game).toBeNull();
  });

  describe('v1-compatibiliteit (docs/IMPLEMENTATION_PLAN.md §11, PR 6.1-review, aug. 2026)', () => {
    // Twee stappen (detecteren/bevestigen) i.p.v. automatisch adopteren: v1
    // kende geen organisatie/teamcontext, dus de code kan zelf niet bewijzen
    // welk team het juiste doel is — willekeurig het eerst-geopende team laten
    // "winnen" zou een echte kans op fout-toegewezen wedstrijddata zijn.

    it('read() adopteert nooit automatisch — een v1-wedstrijd verschijnt pas na expliciete confirmV1Migration()', () => {
      const storage = new TrackingStorage();
      storage.seed(V1_ACTIVE_GAME_STORAGE_KEY, JSON.stringify(v1Blob()));
      const repo = new LocalStorageGameRepository(storage, 'org-1', 'team-1');

      expect(repo.read()).toBeNull();
      expect(storage.getItem(activeGameStorageKey('org-1', 'team-1'))).toBeNull();
    });

    it('detectV1Migration() toont een voorstel getagd met de huidige context, zonder iets te schrijven', () => {
      const storage = new TrackingStorage();
      storage.seed(V1_ACTIVE_GAME_STORAGE_KEY, JSON.stringify(v1Blob()));
      const repo = new LocalStorageGameRepository(storage, 'org-1', 'team-1');

      const candidate = repo.detectV1Migration();

      expect(candidate).not.toBeNull();
      expect(candidate?.phase).toBe('tracking');
      expect(candidate?.organizationId).toBe('org-1');
      expect(candidate?.teamId).toBe('team-1');
      expect(candidate?.opponent).toBe('V1 tegenstander');
      expect(storage.getItem(activeGameStorageKey('org-1', 'team-1'))).toBeNull();
      expect(storage.getItem(V1_GAME_MIGRATED_FLAG_KEY)).toBeNull();
    });

    it('detectV1Migration() blijft hetzelfde voorstel tonen voor een ander team, zolang niemand bevestigd heeft', () => {
      const storage = new TrackingStorage();
      storage.seed(V1_ACTIVE_GAME_STORAGE_KEY, JSON.stringify(v1Blob()));
      const repoA = new LocalStorageGameRepository(storage, 'org-1', 'team-a');
      const repoB = new LocalStorageGameRepository(storage, 'org-1', 'team-b');

      expect(repoA.detectV1Migration()?.teamId).toBe('team-a');
      // team A opende eerst, maar bevestigde niet — team B moet het voorstel
      // nog steeds kunnen zien en voor zichzelf claimen.
      expect(repoB.detectV1Migration()?.teamId).toBe('team-b');
    });

    it('confirmV1Migration() persisteert de wedstrijd en blokkeert daarna adoptie door een ander team', () => {
      const storage = new TrackingStorage();
      storage.seed(V1_ACTIVE_GAME_STORAGE_KEY, JSON.stringify(v1Blob()));
      const repoA = new LocalStorageGameRepository(storage, 'org-1', 'team-a');
      const repoB = new LocalStorageGameRepository(storage, 'org-1', 'team-b');

      const candidateA = repoA.detectV1Migration()!;
      expect(repoA.confirmV1Migration(candidateA)).toBe(true);

      expect(repoA.read()).toEqual(candidateA);
      expect(storage.getItem(V1_GAME_MIGRATED_FLAG_KEY)).not.toBeNull();
      // Team B kan de wedstrijd na bevestiging door team A niet meer claimen.
      expect(repoB.detectV1Migration()).toBeNull();
      expect(repoB.read()).toBeNull();
    });

    it('confirmV1Migration() faalt als zowel de wedstrijd- als de markeer-write mislukken', () => {
      const failing: KeyValueStorage = {
        getItem: (key) => (key === V1_ACTIVE_GAME_STORAGE_KEY ? JSON.stringify(v1Blob()) : null),
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
        removeItem: () => {},
      };
      const repo = new LocalStorageGameRepository(failing, 'org-1', 'team-1');
      const candidate = repo.detectV1Migration()!;

      expect(repo.confirmV1Migration(candidate)).toBe(false);
    });

    it('confirmV1Migration() draait de al geslaagde wedstrijd-write terug als de globale claim-write daarna faalt', () => {
      // Reproduceert de derde herreview (aug. 2026): de wedstrijdwrite gebeurt
      // vóór de markeer-write. Als alleen de tweede faalt, mag dit team niet
      // alsnog lijken de wedstrijd te hebben zonder de bijbehorende globale
      // claim — anders zou detectV1Migration() dezelfde v1-wedstrijd ook nog
      // aan een ander team aanbieden terwijl dit team 'm al lokaal "heeft".
      const storage = new TrackingStorage();
      storage.seed(V1_ACTIVE_GAME_STORAGE_KEY, JSON.stringify(v1Blob()));
      const selectivelyFailing: KeyValueStorage = {
        getItem: (key) => storage.getItem(key),
        setItem: (key, value) => {
          if (key === V1_GAME_MIGRATED_FLAG_KEY) {
            throw new Error('QuotaExceededError');
          }
          storage.setItem(key, value);
        },
        removeItem: (key) => storage.removeItem(key),
      };
      const repo = new LocalStorageGameRepository(selectivelyFailing, 'org-1', 'team-1');
      const candidate = repo.detectV1Migration()!;

      expect(repo.confirmV1Migration(candidate)).toBe(false);

      // De net gedane wedstrijd-write is teruggedraaid: dit team heeft géén
      // half-bevestigde wedstrijd liggen, en de globale claim is ook nooit gezet.
      expect(storage.getItem(activeGameStorageKey('org-1', 'team-1'))).toBeNull();
      expect(storage.getItem(V1_GAME_MIGRATED_FLAG_KEY)).toBeNull();
      expect(repo.read()).toBeNull();
    });

    it('na een mislukte bevestiging (claim-write faalt) is een latere, geslaagde poging veilig — geen duplicatie of dataverlies', () => {
      const storage = new TrackingStorage();
      storage.seed(V1_ACTIVE_GAME_STORAGE_KEY, JSON.stringify(v1Blob()));
      let failMarkerWrite = true;
      const flakyThenWorking: KeyValueStorage = {
        getItem: (key) => storage.getItem(key),
        setItem: (key, value) => {
          if (key === V1_GAME_MIGRATED_FLAG_KEY && failMarkerWrite) {
            throw new Error('QuotaExceededError');
          }
          storage.setItem(key, value);
        },
        removeItem: (key) => storage.removeItem(key),
      };
      const repo = new LocalStorageGameRepository(flakyThenWorking, 'org-1', 'team-1');
      const candidate = repo.detectV1Migration()!;

      expect(repo.confirmV1Migration(candidate)).toBe(false);
      expect(repo.detectV1Migration()).not.toBeNull(); // nog steeds te retrying, geen dataverlies

      failMarkerWrite = false;
      expect(repo.confirmV1Migration(candidate)).toBe(true);

      expect(repo.read()).toEqual(candidate);
      expect(storage.getItem(V1_GAME_MIGRATED_FLAG_KEY)).not.toBeNull();
      // Geen duplicatie: nog altijd precies één opgeslagen wedstrijd voor dit team.
      expect(repo.detectV1Migration()).toBeNull();
    });

    it('confirmV1Migration() weigert een voorstel dat niet bij dit team hoort (integriteitscheck)', () => {
      const storage = new TrackingStorage();
      const repo = new LocalStorageGameRepository(storage, 'org-1', 'team-1');
      const staleCandidate = activeGame({
        phase: 'tracking',
        organizationId: 'org-ANDER',
        teamId: 'team-ANDER',
      });

      expect(repo.confirmV1Migration(staleCandidate)).toBe(false);
      expect(storage.getItem(activeGameStorageKey('org-1', 'team-1'))).toBeNull();
      expect(storage.getItem(V1_GAME_MIGRATED_FLAG_KEY)).toBeNull();
    });

    it('detectV1Migration() levert niets voor een niet-hervatbare v1-opzet (v1-pariteit: alleen phase tracking of segments > 0)', () => {
      const storage = new TrackingStorage();
      storage.seed(
        V1_ACTIVE_GAME_STORAGE_KEY,
        JSON.stringify(v1Blob({ phase: 'setup', segments: [] })),
      );
      const repo = new LocalStorageGameRepository(storage, 'org-1', 'team-1');

      expect(repo.detectV1Migration()).toBeNull();
    });
  });
});
