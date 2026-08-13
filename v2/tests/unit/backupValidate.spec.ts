// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { validateBackupData, validateEnvelope } from '../../src/domain/backup/validate';
import {
  BACKUP_TYPE,
  CURRENT_BACKUP_VERSION,
  type BackupV2Data,
} from '../../src/domain/backup/types';
import { DEFAULT_SETTINGS } from '../../src/domain/settings/types';
import type { CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';

function gamePlayer(id: string, rosterId: number): GamePlayer {
  return {
    id,
    rosterId,
    nr: String(rosterId),
    naam: `Speler ${rosterId}`,
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
  };
}

function segment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 's1',
    quarter: 1,
    beginSec: 0,
    endSec: 100,
    durSec: 100,
    lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
    pf: 2,
    pa: 1,
    classSum: 0,
    allowed: 0,
    over: false,
    ...overrides,
  };
}

function fivePlayers(): GamePlayer[] {
  return [
    gamePlayer('p1', 1),
    gamePlayer('p2', 2),
    gamePlayer('p3', 3),
    gamePlayer('p4', 4),
    gamePlayer('p5', 5),
  ];
}

function completedGame(overrides: Partial<CompletedGame> = {}): CompletedGame {
  return {
    id: 'g1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'src-1',
    opponent: 'Tegenstander',
    competition: '',
    date: '2026-01-01T10:00:00.000Z',
    players: fivePlayers(),
    segments: [segment()],
    scoreFor: 2,
    scoreAgainst: 1,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    ...overrides,
  };
}

describe('domain/backup/validate — envelope (plan §C.2-3/§G.2)', () => {
  it('verwerpt een niet-plain-object', () => {
    expect(validateEnvelope('x').errors[0]!.code).toBe('notPlainObject');
    expect(validateEnvelope(null).errors[0]!.code).toBe('notPlainObject');
  });

  it('verwerpt een verkeerd type', () => {
    expect(validateEnvelope({ type: 'other', data: {} }).errors[0]!.code).toBe('wrongType');
  });

  it('verwerpt een niet-plain-object data-veld', () => {
    expect(validateEnvelope({ type: BACKUP_TYPE, data: 'x' }).errors[0]!.code).toBe(
      'dataNotObject',
    );
  });

  it('ontbrekende version betekent v1', () => {
    const result = validateEnvelope({ type: BACKUP_TYPE, data: {} });
    expect(result.errors).toEqual([]);
    expect(result.version).toBe(1);
  });

  it('verwerpt een toekomstige/ongeldige versie', () => {
    expect(
      validateEnvelope({ type: BACKUP_TYPE, version: CURRENT_BACKUP_VERSION + 1, data: {} })
        .errors[0]!.code,
    ).toBe('invalidVersion');
    expect(validateEnvelope({ type: BACKUP_TYPE, version: 0, data: {} }).errors[0]!.code).toBe(
      'invalidVersion',
    );
    expect(validateEnvelope({ type: BACKUP_TYPE, version: NaN, data: {} }).errors[0]!.code).toBe(
      'invalidVersion',
    );
  });

  it('verwerpt een niet-geheel versienummer (bv. 1.5) — externe PR-6.6-review', () => {
    expect(validateEnvelope({ type: BACKUP_TYPE, version: 1.5, data: {} }).errors[0]!.code).toBe(
      'invalidVersion',
    );
  });

  it('accepteert de huidige versie', () => {
    const result = validateEnvelope({
      type: BACKUP_TYPE,
      version: CURRENT_BACKUP_VERSION,
      data: {},
    });
    expect(result.errors).toEqual([]);
    expect(result.version).toBe(CURRENT_BACKUP_VERSION);
  });
});

describe('domain/backup/validate — validateBackupData (plan §C.5/§G.3-4)', () => {
  it('een leeg data-object levert emptyData op', () => {
    expect(validateBackupData({})).toEqual([{ code: 'emptyData' }]);
  });

  it('een gedeeltelijke, geldige back-up (alleen settings) is geldig', () => {
    const data: BackupV2Data = { settings: { ...DEFAULT_SETTINGS } };
    expect(validateBackupData(data)).toEqual([]);
  });

  it('ongeldige settings (ontbrekend veld) wordt geweigerd', () => {
    const { teamName: _drop, ...incomplete } = { ...DEFAULT_SETTINGS };
    void _drop;
    const errors = validateBackupData({ settings: incomplete as never });
    expect(errors.some((e) => e.code === 'settingsInvalid')).toBe(true);
  });

  it('dubbele roster-ID wordt geweigerd', () => {
    const roster = [
      { id: 1, nr: '1', naam: 'A', kl: '3.0', vrouw: false, jeugd: false },
      { id: 1, nr: '2', naam: 'B', kl: '3.0', vrouw: false, jeugd: false },
    ];
    const errors = validateBackupData({ roster });
    expect(errors.some((e) => e.code === 'rosterDuplicateId')).toBe(true);
  });

  it('onbekende lineupreferentie in een segment wordt geweigerd', () => {
    const game = completedGame({
      segments: [segment({ lineup: ['p1', 'p2', 'p3', 'p4', 'unknown-id'] })],
    });
    const errors = validateBackupData({ completedGames: [game] });
    expect(errors.some((e) => e.code === 'gameUnknownLineupPlayer')).toBe(true);
  });

  it('verkeerde lineupgrootte wordt geweigerd', () => {
    const game = completedGame({ segments: [segment({ lineup: ['p1', 'p2', 'p3'] })] });
    const errors = validateBackupData({ completedGames: [game] });
    expect(errors.some((e) => e.code === 'gameInvalidLineupSize')).toBe(true);
  });

  it('niet-positieve segmentduur wordt geweigerd', () => {
    const game = completedGame({ segments: [segment({ durSec: 0 })] });
    const errors = validateBackupData({ completedGames: [game] });
    expect(errors.some((e) => e.code === 'gameInvalidDuration')).toBe(true);
  });

  it('negatieve punten worden geweigerd', () => {
    const game = completedGame({ segments: [segment({ pa: -1 })] });
    const errors = validateBackupData({ completedGames: [game] });
    expect(errors.some((e) => e.code === 'gameInvalidScore')).toBe(true);
  });

  it('een volledig geldige completedGames-sectie is geldig', () => {
    expect(validateBackupData({ completedGames: [completedGame()] })).toEqual([]);
  });

  it('activeGame: null is geldig (expliciet "geen wedstrijd")', () => {
    expect(validateBackupData({ activeGame: null })).toEqual([]);
  });

  it('ongeldige taal wordt geweigerd', () => {
    expect(validateBackupData({ lang: 'fr' as never })).toEqual([{ code: 'langInvalid' }]);
  });

  it('een CompletedGame met ontbrekende topvelden (sourceGameId/opponent/competition/quarterCount/periodLabel/useClassLimit) wordt geweigerd — externe PR-6.6-review', () => {
    const minimal = {
      id: 'g1',
      date: '2026-01-01T10:00:00.000Z',
      players: fivePlayers(),
      segments: [segment()],
      scoreFor: 2,
      scoreAgainst: 1,
    };
    const errors = validateBackupData({ completedGames: [minimal as unknown as CompletedGame] });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((e) => e.code === 'gameInvalid')).toBe(true);
  });

  it('een niet-object segment-item (null) crasht niet en levert een vertaalde validatiefout op — externe PR-6.6-review', () => {
    const game = completedGame({ segments: [null as unknown as Segment] });
    expect(() => validateBackupData({ completedGames: [game] })).not.toThrow();
    const errors = validateBackupData({ completedGames: [game] });
    expect(errors.some((e) => e.code === 'gameInvalid')).toBe(true);
  });
});
