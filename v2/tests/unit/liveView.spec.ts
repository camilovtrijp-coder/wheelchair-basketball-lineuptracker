import { describe, it, expect } from 'vitest';
import type { GameActionEnvelopeDocument, GameDocument } from 'firebase-base/documents';
import {
  buildLiveGameView,
  deriveLiveGameActions,
  pickActiveGameCandidate,
  type ActiveGameCandidate,
} from '../../src/application/game/liveView';
import { deriveGameHistory } from '../../src/domain/game/tracking';
import type { GameAction, GamePlayer, Segment } from '../../src/domain/game/types';

function player(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    id: `gp-${overrides.rosterId ?? 1}`,
    rosterId: 1,
    nr: '1',
    naam: 'Speler',
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
    ...overrides,
  };
}

function segment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 'seg-1',
    quarter: 1,
    beginSec: 600,
    endSec: 300,
    durSec: 300,
    lineup: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
    pf: 6,
    pa: 4,
    classSum: 14.0,
    allowed: 14.5,
    over: false,
    ...overrides,
  };
}

function envelope(overrides: Partial<GameActionEnvelopeDocument> = {}): GameActionEnvelopeDocument {
  return {
    organizationId: 'org-1',
    teamId: 'team-1',
    gameId: 'game-1',
    actionId: 'action-1',
    authorUid: 'uid-alice',
    deviceId: 'device-alice',
    writerEpoch: 0,
    sequence: 0,
    occurredAt: '2026-01-01T00:10:00.000Z',
    schemaVersion: 1,
    action: { type: 'score-delta', team: 'for', delta: 2 },
    ...overrides,
  };
}

function gameDoc(overrides: Partial<GameDocument> = {}): GameDocument {
  const players = [1, 2, 3, 4, 5].map((n) => player({ rosterId: n, nr: String(n) }));
  return {
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players,
    opponent: 'Tegenstander',
    competition: 'Competitie',
    clockDown: true,
    limitStr: '14.5',
    onCourt: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
    curQuarter: 2,
    beginSec: 600,
    endSec: 300,
    pendingSwapLineup: null,
    scoreFor: 6,
    scoreAgainst: 4,
    segmentCount: 1,
    writerUid: 'uid-alice',
    deviceId: 'device-alice',
    writerEpoch: 0,
    claimedAt: '2026-01-01T00:00:00.000Z',
    lastWriterActivityAt: '2026-01-01T00:10:40.000Z',
    revision: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:05.000Z',
    completedGameId: null,
    // Niet gebruikt door liveView.ts — alleen aanwezig om aan het
    // GameDocument-type te voldoen.
    updatedAt: null as unknown as GameDocument['updatedAt'],
    ...overrides,
  };
}

describe('application/game/liveView (PR 7.3b §C 7.3b werk 2)', () => {
  describe('deriveLiveGameActions', () => {
    it('vertaalt elk actietype exact terug (inverse van projectActionPayload())', () => {
      const envelopes: GameActionEnvelopeDocument[] = [
        envelope({
          actionId: 'a-score-delta',
          sequence: 0,
          action: { type: 'score-delta', team: 'for', delta: 2 },
        }),
        envelope({
          actionId: 'a-score-set',
          sequence: 1,
          action: { type: 'score-set', team: 'against', value: 10 },
        }),
        envelope({
          actionId: 'a-segment-saved',
          sequence: 2,
          action: { type: 'segment-saved', segment: segment({ id: 'seg-a' }) },
        }),
        envelope({
          actionId: 'a-segment-edited',
          sequence: 3,
          action: {
            type: 'segment-edited',
            segmentId: 'seg-a',
            segment: segment({ id: 'seg-a', pf: 8 }),
          },
        }),
        envelope({
          actionId: 'a-segment-deleted',
          sequence: 4,
          action: { type: 'segment-deleted', segmentId: 'seg-a' },
        }),
      ];
      const actions = deriveLiveGameActions(envelopes);
      expect(actions).toEqual<GameAction[]>([
        {
          type: 'score-delta',
          id: 'a-score-delta',
          team: 'for',
          delta: 2,
          at: envelopes[0]!.occurredAt,
        },
        {
          type: 'score-set',
          id: 'a-score-set',
          team: 'against',
          value: 10,
          at: envelopes[1]!.occurredAt,
        },
        {
          type: 'segment-saved',
          id: 'a-segment-saved',
          segment: segment({ id: 'seg-a' }),
          at: envelopes[2]!.occurredAt,
        },
        {
          type: 'segment-edited',
          id: 'a-segment-edited',
          segmentId: 'seg-a',
          segment: segment({ id: 'seg-a', pf: 8 }),
          at: envelopes[3]!.occurredAt,
        },
        {
          type: 'segment-deleted',
          id: 'a-segment-deleted',
          segmentId: 'seg-a',
          at: envelopes[4]!.occurredAt,
        },
      ]);
    });

    it('sorteert op sequence, ongeacht de leveringsvolgorde (out-of-order delivery)', () => {
      const inOrder = [
        envelope({ actionId: 'a1', sequence: 0 }),
        envelope({ actionId: 'a2', sequence: 1 }),
        envelope({ actionId: 'a3', sequence: 2 }),
      ];
      const shuffled = [inOrder[2]!, inOrder[0]!, inOrder[1]!];
      expect(deriveLiveGameActions(shuffled).map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
    });

    it('dedupliceert op actionId (duplicated retry levert exact dezelfde historie)', () => {
      const once = deriveLiveGameActions([envelope({ actionId: 'a1', sequence: 0 })]);
      const twice = deriveLiveGameActions([
        envelope({ actionId: 'a1', sequence: 0 }),
        envelope({ actionId: 'a1', sequence: 0 }),
      ]);
      expect(twice).toEqual(once);
      expect(twice).toHaveLength(1);
    });

    it('een hogere writerEpoch sorteert altijd ná een lagere, ongeacht de eigen sequence', () => {
      const oldEpoch = envelope({ actionId: 'old', writerEpoch: 0, sequence: 99 });
      const newEpoch = envelope({ actionId: 'new', writerEpoch: 1, sequence: 0 });
      expect(deriveLiveGameActions([newEpoch, oldEpoch]).map((a) => a.id)).toEqual(['old', 'new']);
    });

    it('lege input levert een lege actielijst op', () => {
      expect(deriveLiveGameActions([])).toEqual([]);
    });
  });

  describe('buildLiveGameView', () => {
    it('reconstrueert een ActiveGame waarvan deriveGameHistory() dezelfde score/segmenten oplevert als het parentdocument se cache', () => {
      const envelopes: GameActionEnvelopeDocument[] = [
        envelope({
          actionId: 'a1',
          sequence: 0,
          occurredAt: '2026-01-01T00:10:00.000Z',
          action: { type: 'score-delta', team: 'for', delta: 6 },
        }),
        envelope({
          actionId: 'a2',
          sequence: 1,
          occurredAt: '2026-01-01T00:10:20.000Z',
          action: { type: 'score-delta', team: 'against', delta: 4 },
        }),
        envelope({
          actionId: 'a3',
          sequence: 2,
          occurredAt: '2026-01-01T00:10:40.000Z',
          action: { type: 'segment-saved', segment: segment() },
        }),
      ];
      const doc = gameDoc();
      const game = buildLiveGameView('game-1', doc, envelopes);

      expect(game.id).toBe('game-1');
      expect(game.organizationId).toBe(doc.organizationId);
      expect(game.teamId).toBe(doc.teamId);
      expect(game.phase).toBe(doc.phase);
      expect(game.onCourt).toEqual(doc.onCourt);
      expect(game.curQuarter).toBe(doc.curQuarter);
      expect(game.beginSec).toBe(doc.beginSec);
      expect(game.endSec).toBe(doc.endSec);
      expect(game.createdAt).toBe(doc.createdAt);
      expect(game.startedAt).toBe(doc.startedAt);

      const history = deriveGameHistory(game);
      expect(history.scoreFor).toBe(doc.scoreFor);
      expect(history.scoreAgainst).toBe(doc.scoreAgainst);
      expect(history.segments).toHaveLength(doc.segmentCount);
    });

    it('bevriest geen gedeelde referenties met het brondocument (defensieve kopieën)', () => {
      const doc = gameDoc({ pendingSwapLineup: ['gp-1', 'gp-2'] });
      const game = buildLiveGameView('game-1', doc, []);
      game.onCourt.push('intruder');
      game.pendingSwapLineup?.push('intruder');
      expect(doc.onCourt).not.toContain('intruder');
      expect(doc.pendingSwapLineup).not.toContain('intruder');
    });

    it('is puur: dezelfde invoer levert een deep-equal resultaat op, ongeacht envelopevolgorde', () => {
      const doc = gameDoc();
      const envelopes = [
        envelope({ actionId: 'a1', sequence: 0 }),
        envelope({ actionId: 'a2', sequence: 1 }),
      ];
      const first = buildLiveGameView('game-1', doc, envelopes);
      const second = buildLiveGameView('game-1', doc, [envelopes[1]!, envelopes[0]!]);
      expect(second).toEqual(first);
    });
  });

  describe('pickActiveGameCandidate', () => {
    function candidate(overrides: Partial<ActiveGameCandidate> = {}): ActiveGameCandidate {
      return {
        gameId: 'game-1',
        lastWriterActivityAt: null,
        claimedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
      };
    }

    it('levert null op voor een lege kandidatenlijst', () => {
      expect(pickActiveGameCandidate([])).toBeNull();
    });

    it('levert de enige kandidaat op (het normale geval)', () => {
      expect(pickActiveGameCandidate([candidate({ gameId: 'only' })])).toBe('only');
    });

    it('kiest de kandidaat met de meest recente lastWriterActivityAt', () => {
      const older = candidate({
        gameId: 'older',
        lastWriterActivityAt: '2026-01-01T00:00:00.000Z',
      });
      const newer = candidate({
        gameId: 'newer',
        lastWriterActivityAt: '2026-01-01T00:10:00.000Z',
      });
      expect(pickActiveGameCandidate([older, newer])).toBe('newer');
      expect(pickActiveGameCandidate([newer, older])).toBe('newer');
    });

    it('valt terug op claimedAt zolang lastWriterActivityAt nog null is', () => {
      const older = candidate({ gameId: 'older', claimedAt: '2026-01-01T00:00:00.000Z' });
      const newer = candidate({ gameId: 'newer', claimedAt: '2026-01-01T00:05:00.000Z' });
      expect(pickActiveGameCandidate([older, newer])).toBe('newer');
    });

    it('valt terug op createdAt zolang claimedAt en lastWriterActivityAt nog null zijn', () => {
      const older = candidate({ gameId: 'older', createdAt: '2026-01-01T00:00:00.000Z' });
      const newer = candidate({ gameId: 'newer', createdAt: '2026-01-01T00:05:00.000Z' });
      expect(pickActiveGameCandidate([older, newer])).toBe('newer');
    });

    it('is deterministisch bij een gelijke sleutel (tiebreak op gameId)', () => {
      const a = candidate({ gameId: 'b-game', lastWriterActivityAt: '2026-01-01T00:00:00.000Z' });
      const b = candidate({ gameId: 'a-game', lastWriterActivityAt: '2026-01-01T00:00:00.000Z' });
      expect(pickActiveGameCandidate([a, b])).toBe('a-game');
      expect(pickActiveGameCandidate([b, a])).toBe('a-game');
    });
  });
});
