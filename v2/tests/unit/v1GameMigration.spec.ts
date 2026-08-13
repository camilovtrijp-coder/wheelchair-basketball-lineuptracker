import { describe, it, expect } from 'vitest';
import { migrateV1ActiveGame } from '../../src/domain/game/v1Migration';
import { deriveGameHistory } from '../../src/domain/game/tracking';

function v1Blob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    phase: 'tracking',
    players: [
      {
        id: 1,
        nr: '4',
        naam: 'Anna',
        kl: '3.0',
        vrouw: true,
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
        jeugd: true,
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
      {
        id: 6,
        nr: '21',
        naam: 'Fay',
        kl: '1.0',
        vrouw: false,
        jeugd: false,
        participate: true,
        start: false,
      },
    ],
    onCourt: [1, 2, 3, 4, 6],
    curQuarter: 2,
    opponent: 'Testclub',
    competition: 'Test competitie',
    clockDown: true,
    limitStr: '14.5',
    beginMin: 8,
    beginSec: 30,
    endMin: 8,
    endSec: 0,
    segments: [
      {
        quarter: 1,
        beginSec: 600,
        endSec: 480,
        durSec: 120,
        lineup: [1, 2, 3, 4, 5],
        pf: 4,
        pa: 2,
        classSum: 11,
        allowed: 14.5,
        over: false,
      },
    ],
    scoreFor: 7,
    scoreAgainst: 3,
    segStartFor: 4,
    segStartAgainst: 2,
    savedAt: 1700000000000,
    ...overrides,
  };
}

describe('domain/game/v1Migration', () => {
  describe('migrateV1ActiveGame', () => {
    it('geeft null voor een niet-hervatbare v1-opzet (v1: init()s voorwaarde)', () => {
      expect(
        migrateV1ActiveGame({ phase: 'setup', players: [], segments: [] }, 'org-1', 'team-1'),
      ).toBeNull();
      expect(migrateV1ActiveGame(null, 'org-1', 'team-1')).toBeNull();
      expect(migrateV1ActiveGame('niet-een-object', 'org-1', 'team-1')).toBeNull();
      expect(migrateV1ActiveGame({ phase: 'tracking' }, 'org-1', 'team-1')).toBeNull(); // geen players-array
    });

    it('hervat via segments.length > 0, ook zonder phase === "tracking" (v1-pariteit)', () => {
      const migrated = migrateV1ActiveGame(v1Blob({ phase: undefined }), 'org-1', 'team-1');
      expect(migrated).not.toBeNull();
      expect(migrated?.phase).toBe('tracking');
    });

    it('tagt de wedstrijd met de gegeven organisatie/team-context en zet v2-only velden', () => {
      const migrated = migrateV1ActiveGame(v1Blob(), 'org-1', 'team-1');
      expect(migrated?.organizationId).toBe('org-1');
      expect(migrated?.teamId).toBe('team-1');
      expect(migrated?.phase).toBe('tracking');
      expect(migrated?.pendingSwapLineup).toBeNull();
      expect(typeof migrated?.id).toBe('string');
    });

    it('geeft elke speler een stabiele, unieke game-player-UUID los van rosterId (v1 had er maar één)', () => {
      const migrated = migrateV1ActiveGame(v1Blob(), 'org-1', 'team-1')!;
      expect(migrated.players).toHaveLength(6);
      const ids = migrated.players.map((p) => p.id);
      expect(new Set(ids).size).toBe(6);
      expect(migrated.players.map((p) => p.rosterId)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(migrated.players[0]).toMatchObject({
        rosterId: 1,
        nr: '4',
        naam: 'Anna',
        kl: '3.0',
        vrouw: true,
        jeugd: false,
        participate: true,
        start: true,
      });
    });

    it('remapt onCourt en segment-lineups van v1-rugnummerloze ID naar de nieuwe GamePlayer-UUID', () => {
      const migrated = migrateV1ActiveGame(v1Blob(), 'org-1', 'team-1')!;
      const idByRoster = new Map(migrated.players.map((p) => [p.rosterId, p.id]));
      expect(migrated.onCourt).toEqual([1, 2, 3, 4, 6].map((n) => idByRoster.get(n)));

      const history = deriveGameHistory(migrated);
      expect(history.segments).toHaveLength(1);
      expect(history.segments[0]?.lineup).toEqual([1, 2, 3, 4, 5].map((n) => idByRoster.get(n)));
    });

    it('slaat onbekende ID’s in onCourt/lineup stilzwijgend over i.p.v. te crashen', () => {
      const migrated = migrateV1ActiveGame(v1Blob({ onCourt: [1, 2, 999] }), 'org-1', 'team-1')!;
      expect(migrated.onCourt).toHaveLength(2);
    });

    it('reconstrueert score/segStart exact via de actielog (segment-delta gevolgd door segment-saved, plus de lopende delta)', () => {
      const migrated = migrateV1ActiveGame(v1Blob(), 'org-1', 'team-1')!;
      const history = deriveGameHistory(migrated);

      // v1: scoreFor=7, scoreAgainst=3, segStartFor=4, segStartAgainst=2 (segment 1 pf=4/pa=2, live delta 3/1 sindsdien).
      expect(history.scoreFor).toBe(7);
      expect(history.scoreAgainst).toBe(3);
      expect(history.segStartFor).toBe(4);
      expect(history.segStartAgainst).toBe(2);
      expect(history.segments).toHaveLength(1);
      expect(history.segments[0]).toMatchObject({
        quarter: 1,
        beginSec: 600,
        endSec: 480,
        durSec: 120,
        pf: 4,
        pa: 2,
        classSum: 11,
        allowed: 14.5,
        over: false,
      });
    });

    it('reconstrueert ook correct zonder nog-lopende (ongesavede) score-delta', () => {
      const migrated = migrateV1ActiveGame(
        v1Blob({ scoreFor: 4, scoreAgainst: 2, segStartFor: 4, segStartAgainst: 2 }),
        'org-1',
        'team-1',
      )!;
      const history = deriveGameHistory(migrated);
      expect(history.scoreFor).toBe(4);
      expect(history.scoreAgainst).toBe(2);
      expect(history.segStartFor).toBe(4);
      expect(history.segStartAgainst).toBe(2);
    });

    it('reconstrueert een wedstrijd zonder enig segment, uitsluitend uit de lopende score', () => {
      const migrated = migrateV1ActiveGame(
        v1Blob({ segments: [], scoreFor: 5, scoreAgainst: 1, segStartFor: 0, segStartAgainst: 0 }),
        'org-1',
        'team-1',
      )!;
      const history = deriveGameHistory(migrated);
      expect(history.segments).toHaveLength(0);
      expect(history.scoreFor).toBe(5);
      expect(history.scoreAgainst).toBe(1);
      expect(history.segStartFor).toBe(0);
      expect(history.segStartAgainst).toBe(0);
    });

    it('combineert v1s losse beginMin/beginSec en endMin/endSec tot v2s enkele beginSec/endSec', () => {
      const migrated = migrateV1ActiveGame(v1Blob(), 'org-1', 'team-1')!;
      expect(migrated.beginSec).toBe(8 * 60 + 30);
      expect(migrated.endSec).toBe(8 * 60 + 0);
    });

    it('zet createdAt/startedAt op basis van v1s savedAt (ms epoch), niet op v2-only null', () => {
      const migrated = migrateV1ActiveGame(v1Blob(), 'org-1', 'team-1')!;
      expect(migrated.createdAt).toBe(new Date(1700000000000).toISOString());
      expect(migrated.startedAt).toBe(new Date(1700000000000).toISOString());
    });

    it('valt terug op nu als savedAt ontbreekt, i.p.v. te crashen', () => {
      const migrated = migrateV1ActiveGame(v1Blob({ savedAt: undefined }), 'org-1', 'team-1')!;
      expect(() => new Date(migrated.startedAt as string)).not.toThrow();
      expect(migrated.startedAt).not.toBeNull();
    });
  });
});
