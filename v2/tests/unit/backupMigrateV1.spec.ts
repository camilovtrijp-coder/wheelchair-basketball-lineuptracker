// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  migrateV1BackupData,
  migrateV1CompletedGame,
  retagWithContext,
  V1_GAMES_STORAGE_KEY,
} from '../../src/domain/backup/migrateV1';
import { V1_ACTIVE_GAME_STORAGE_KEY } from '../../src/domain/game/v1Migration';
import { ROSTER_STORAGE_KEY } from '../../src/domain/roster/types';
import { SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS } from '../../src/domain/settings/types';
import { LANG_STORAGE_KEY } from '../../src/i18n/strings';

function v1Player(id: number, nr: string, naam = `Speler ${nr}`) {
  return { id, nr, naam, kl: '3.0', vrouw: false, jeugd: false };
}

function v1Game(overrides: Record<string, unknown> = {}) {
  return {
    id: 'legacy-game-1',
    opponent: 'Oude tegenstander',
    competition: '',
    date: '2025-01-01T10:00:00.000Z',
    players: [
      v1Player(1, '1'),
      v1Player(2, '2'),
      v1Player(3, '3'),
      v1Player(4, '4'),
      v1Player(5, '5'),
    ],
    segments: [
      {
        quarter: 1,
        beginSec: 0,
        endSec: 100,
        durSec: 100,
        lineup: [1, 2, 3, 4, 5],
        pf: 6,
        pa: 4,
        classSum: 0,
        allowed: 0,
        over: false,
      },
    ],
    scoreFor: 6,
    scoreAgainst: 4,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    ...overrides,
  };
}

describe('domain/backup/migrateV1 — migrateV1CompletedGame (plan §D/§G.9)', () => {
  it('projecteert spelers/segmenten met rosterId-behoud en herschreven lineup-referenties', () => {
    const migrated = migrateV1CompletedGame(v1Game());
    expect(migrated).not.toBeNull();
    expect(migrated!.players).toHaveLength(5);
    expect(migrated!.players.map((p) => p.rosterId).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(migrated!.segments).toHaveLength(1);
    expect(migrated!.segments[0]!.lineup).toHaveLength(5);
    // lineup-ID's zijn herschreven naar de nieuwe game-player-UUID's, niet
    // meer de kale v1-rosterId's.
    const knownIds = new Set(migrated!.players.map((p) => p.id));
    for (const id of migrated!.segments[0]!.lineup) expect(knownIds.has(id)).toBe(true);
    expect(migrated!.scoreFor).toBe(6);
    expect(migrated!.scoreAgainst).toBe(4);
    expect(migrated!.sourceGameId).toBe('v1-import:legacy-game-1');
    // Context-vrij: retagging gebeurt pas na bevestiging.
    expect(migrated!.organizationId).toBe('');
    expect(migrated!.teamId).toBe('');
  });

  it('geeft null voor niet-plain-object input', () => {
    expect(migrateV1CompletedGame('x')).toBeNull();
    expect(migrateV1CompletedGame(null)).toBeNull();
  });
});

describe('domain/backup/migrateV1 — migrateV1BackupData (plan §D/§G.1)', () => {
  it('projecteert een volledige v1-back-up naar alle vijf secties', () => {
    const raw = {
      [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS, teamName: 'Rotterdam U23' },
      [ROSTER_STORAGE_KEY]: [
        { id: 1, nr: '1', naam: 'Anna', kl: '3.0', vrouw: false, jeugd: false },
      ],
      [LANG_STORAGE_KEY]: 'en',
      [V1_GAMES_STORAGE_KEY]: [v1Game()],
      [V1_ACTIVE_GAME_STORAGE_KEY]: {
        players: [
          v1Player(1, '1'),
          v1Player(2, '2'),
          v1Player(3, '3'),
          v1Player(4, '4'),
          v1Player(5, '5'),
        ],
        phase: 'tracking',
        onCourt: [1, 2, 3, 4, 5],
        segments: [],
        scoreFor: 0,
        scoreAgainst: 0,
      },
    };
    const data = migrateV1BackupData(raw);
    expect(data.settings?.teamName).toBe('Rotterdam U23');
    expect(data.roster).toHaveLength(1);
    expect(data.lang).toBe('en');
    expect(data.completedGames).toHaveLength(1);
    expect(data.activeGame).not.toBeNull();
    expect(data.activeGame!.phase).toBe('tracking');
  });

  it('een ontbrekende sleutel levert een afwezige (undefined) sectie op', () => {
    const data = migrateV1BackupData({ [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS } });
    expect(data.settings).toBeDefined();
    expect(data.roster).toBeUndefined();
    expect(data.activeGame).toBeUndefined();
    expect(data.completedGames).toBeUndefined();
    expect(data.lang).toBeUndefined();
  });

  it('een niet-hervatbare v1-actieve-wedstrijd (fase setup) levert geen activeGame-sectie op', () => {
    const data = migrateV1BackupData({
      [V1_ACTIVE_GAME_STORAGE_KEY]: { players: [], phase: 'setup', segments: [] },
    });
    expect(data.activeGame).toBeUndefined();
  });
});

describe('domain/backup/migrateV1 — retagWithContext (plan §D)', () => {
  it('tagt activeGame en completedGames met de bevestigde doelcontext', () => {
    const migrated = migrateV1CompletedGame(v1Game())!;
    const tagged = retagWithContext({ completedGames: [migrated] }, 'org-x', 'team-y');
    expect(tagged.completedGames![0]!.organizationId).toBe('org-x');
    expect(tagged.completedGames![0]!.teamId).toBe('team-y');
  });

  it('laat activeGame: null ongewijzigd (blijft expliciet "geen wedstrijd")', () => {
    const tagged = retagWithContext({ activeGame: null }, 'org-x', 'team-y');
    expect(tagged.activeGame).toBeNull();
  });

  it('laat een afwezige sectie afwezig', () => {
    const tagged = retagWithContext({}, 'org-x', 'team-y');
    expect(tagged.activeGame).toBeUndefined();
    expect(tagged.completedGames).toBeUndefined();
  });
});
