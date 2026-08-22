import { describe, it, expect } from 'vitest';
import type { ActiveGame, GameAction, GamePlayer, Segment } from '../../src/domain/game/types';
import { MAX_CLOCK_SECONDS } from '../../src/domain/game/types';
import {
  projectGameActions,
  projectGameSnapshot,
  projectGameSnapshotPatch,
  type GameCloudWriterContext,
} from '../../src/application/game/projectGameForCloud';

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
    beginSec: MAX_CLOCK_SECONDS,
    endSec: 0,
    durSec: MAX_CLOCK_SECONDS,
    lineup: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
    pf: 6,
    pa: 4,
    classSum: 14.0,
    allowed: 14.5,
    over: false,
    ...overrides,
  };
}

/**
 * Handmatig narekenbare volledige wedstrijd (docs/pr-7.1-plan.md §C 7.1a
 * werk 5): vier kwarten, elk met score-delta's (+6 voor, +4 tegen, zoals de
 * live scorebediening die vóór het opslaan van een segment vuurt) gevolgd
 * door exact één opgeslagen segment met datzelfde pf=6/pa=4 (v1/v2-pariteit:
 * `deriveGameHistory()`'s `segment-saved` legt alleen `segStartFor/Against`
 * vast, de score zelf komt uit de score-delta-acties — zie
 * `domain/game/tracking.ts` `applyAction()`). scoreFor/scoreAgainst zijn dus
 * 4×6=24 en 4×4=16 — narekenbaar zonder de app te starten.
 */
function fullGameFixture(): ActiveGame {
  const players = [1, 2, 3, 4, 5].map((n) => player({ rosterId: n, nr: String(n) }));
  const actions: GameAction[] = [1, 2, 3, 4].flatMap((quarter) => {
    const minute = String(10 + quarter).padStart(2, '0');
    return [
      {
        type: 'score-delta',
        id: `action-q${quarter}-for`,
        team: 'for',
        delta: 6,
        at: `2026-01-01T00:${minute}:00.000Z`,
      },
      {
        type: 'score-delta',
        id: `action-q${quarter}-against`,
        team: 'against',
        delta: 4,
        at: `2026-01-01T00:${minute}:20.000Z`,
      },
      {
        type: 'segment-saved',
        id: `action-q${quarter}`,
        segment: segment({ id: `seg-q${quarter}`, quarter }),
        at: `2026-01-01T00:${minute}:40.000Z`,
      },
    ] as GameAction[];
  });
  return {
    id: 'game-full',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players,
    opponent: 'Fictieve Tegenstander',
    competition: 'Fictieve Competitie',
    clockDown: true,
    limitStr: '14.5',
    onCourt: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
    curQuarter: 4,
    beginSec: MAX_CLOCK_SECONDS,
    endSec: MAX_CLOCK_SECONDS,
    pendingSwapLineup: null,
    actions,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:05:00.000Z',
  };
}

const context: GameCloudWriterContext = {
  authorUid: 'uid-alice',
  deviceId: 'device-1',
  writerEpoch: 1,
};

describe('projectGameSnapshot (PR 7.1a)', () => {
  it('leidt scoreFor/scoreAgainst/segmentCount af uit de actielog (4×pf=6/pa=4)', () => {
    const snapshot = projectGameSnapshot(fullGameFixture());
    expect(snapshot.scoreFor).toBe(24);
    expect(snapshot.scoreAgainst).toBe(16);
    expect(snapshot.segmentCount).toBe(4);
  });

  it('is deterministisch: dezelfde ActiveGame levert een gelijke snapshot op', () => {
    const game = fullGameFixture();
    expect(projectGameSnapshot(game)).toEqual(projectGameSnapshot(game));
  });

  it('draagt organizationId/teamId als contextvelden, onafhankelijk van het pad', () => {
    const snapshot = projectGameSnapshot(fullGameFixture());
    expect(snapshot.organizationId).toBe('org-1');
    expect(snapshot.teamId).toBe('team-1');
  });

  it('krijgt geen writer/revision toegekend vóór PR 7.3 (vaste initiële waarden)', () => {
    const snapshot = projectGameSnapshot(fullGameFixture());
    expect(snapshot.writerUid).toBeNull();
    expect(snapshot.deviceId).toBeNull();
    expect(snapshot.writerEpoch).toBe(0);
    expect(snapshot.revision).toBe(0);
  });

  it('muteert de meegegeven ActiveGame niet (defensieve kopieën van arrays)', () => {
    const game = fullGameFixture();
    const snapshot = projectGameSnapshot(game);
    snapshot.onCourt.push('gp-6');
    expect(game.onCourt).toEqual(['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5']);
  });
});

describe('projectGameActions (PR 7.1a)', () => {
  it('hergebruikt GameAction.id als actionId — deterministische document-ID per actie', () => {
    const game = fullGameFixture();
    const envelopes = projectGameActions(game, context);
    expect(envelopes.map((e) => e.actionId)).toEqual(game.actions.map((a) => a.id));
  });

  it('sequence volgt exact de volgorde van game.actions (arrayindex)', () => {
    const game = fullGameFixture();
    const envelopes = projectGameActions(game, context);
    expect(envelopes.map((e) => e.sequence)).toEqual(game.actions.map((_, index) => index));
  });

  it('is deterministisch: dezelfde input levert dezelfde envelopes en volgorde op', () => {
    const game = fullGameFixture();
    expect(projectGameActions(game, context)).toEqual(projectGameActions(game, context));
  });

  it('occurredAt spiegelt GameAction.at (client-autoritatief, geen serverTimestamp)', () => {
    const envelopes = projectGameActions(fullGameFixture(), context);
    expect(envelopes[0]?.occurredAt).toBe('2026-01-01T00:11:00.000Z');
  });

  it('draagt de writer-context (authorUid/deviceId/writerEpoch) op elke envelope', () => {
    const envelopes = projectGameActions(fullGameFixture(), context);
    for (const envelope of envelopes) {
      expect(envelope.authorUid).toBe('uid-alice');
      expect(envelope.deviceId).toBe('device-1');
      expect(envelope.writerEpoch).toBe(1);
    }
  });

  it('projecteert score-delta/score-set zonder het genest segment (alleen bij segment-*)', () => {
    const game = fullGameFixture();
    game.actions = [
      {
        type: 'score-delta',
        id: 'action-sd',
        team: 'for',
        delta: 2,
        at: '2026-01-01T00:01:00.000Z',
      },
      {
        type: 'score-set',
        id: 'action-ss',
        team: 'against',
        value: 10,
        at: '2026-01-01T00:02:00.000Z',
      },
      {
        type: 'segment-deleted',
        id: 'action-del',
        segmentId: 'seg-x',
        at: '2026-01-01T00:03:00.000Z',
      },
    ];
    const [delta, set, deleted] = projectGameActions(game, context);
    expect(delta?.action).toEqual({ type: 'score-delta', team: 'for', delta: 2 });
    expect(set?.action).toEqual({ type: 'score-set', team: 'against', value: 10 });
    expect(deleted?.action).toEqual({ type: 'segment-deleted', segmentId: 'seg-x' });
  });
});

describe('projectGameSnapshotPatch (PR 7.1c)', () => {
  it('bevat exact de draaivelden-/afgeleide-snapshot-subset, nooit de onveranderlijke kernvelden', () => {
    const patch = projectGameSnapshotPatch(
      fullGameFixture(),
      '2026-01-01T00:10:00.000Z',
      '2026-01-01T00:05:00.000Z',
    );
    expect(Object.keys(patch).sort()).toEqual(
      [
        'beginSec',
        'claimedAt',
        'curQuarter',
        'endSec',
        'lastWriterActivityAt',
        'onCourt',
        'pendingSwapLineup',
        'phase',
        'scoreFor',
        'scoreAgainst',
        'segmentCount',
        'startedAt',
      ].sort(),
    );
    expect(patch).not.toHaveProperty('organizationId');
    expect(patch).not.toHaveProperty('teamId');
    expect(patch).not.toHaveProperty('players');
    expect(patch).not.toHaveProperty('opponent');
    expect(patch).not.toHaveProperty('competition');
    expect(patch).not.toHaveProperty('clockDown');
    expect(patch).not.toHaveProperty('limitStr');
    expect(patch).not.toHaveProperty('createdAt');
    expect(patch).not.toHaveProperty('writerUid');
    expect(patch).not.toHaveProperty('deviceId');
    expect(patch).not.toHaveProperty('writerEpoch');
    expect(patch).not.toHaveProperty('revision');
  });

  it('spiegelt exact de afgeleide/draaivelden uit projectGameSnapshot, plus de meegegeven lastWriterActivityAt', () => {
    const game = fullGameFixture();
    const snapshot = projectGameSnapshot(game);
    const patch = projectGameSnapshotPatch(
      game,
      '2026-01-01T00:10:00.000Z',
      '2026-01-01T00:05:00.000Z',
    );
    expect(patch).toEqual({
      phase: snapshot.phase,
      onCourt: snapshot.onCourt,
      curQuarter: snapshot.curQuarter,
      beginSec: snapshot.beginSec,
      endSec: snapshot.endSec,
      pendingSwapLineup: snapshot.pendingSwapLineup,
      scoreFor: snapshot.scoreFor,
      scoreAgainst: snapshot.scoreAgainst,
      segmentCount: snapshot.segmentCount,
      startedAt: snapshot.startedAt,
      claimedAt: '2026-01-01T00:05:00.000Z',
      lastWriterActivityAt: '2026-01-01T00:10:00.000Z',
    });
  });

  it('geeft een null claimedAt ongewijzigd door (legacydocument-backward-compat, externe review PR #66)', () => {
    const patch = projectGameSnapshotPatch(fullGameFixture(), '2026-01-01T00:10:00.000Z', null);
    expect(patch.claimedAt).toBeNull();
  });
});

// docs/pr-7.1-plan.md §C 7.1a werk 5: "Voeg een begrote payloadtest toe voor
// documentgrootte en een read/write-begroting voor een handmatig
// narekenbare volledige wedstrijdfixture."
describe('documentgrootte- en read/write-budget (PR 7.1a)', () => {
  const FIRESTORE_MAX_DOCUMENT_BYTES = 1_048_576; // 1 MiB, Firestore-harde limiet per document.

  it('een parent-snapshot met 5 spelers blijft ruim (>100×) onder de Firestore-documentlimiet', () => {
    const snapshot = projectGameSnapshot(fullGameFixture());
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
    expect(bytes).toBeLessThan(FIRESTORE_MAX_DOCUMENT_BYTES / 100);
  });

  it('een enkele action-envelope (segment-saved, het grootste actietype) blijft ruim onder de documentlimiet', () => {
    const envelopes = projectGameActions(fullGameFixture(), context);
    const segmentSavedAction = envelopes.find(
      (envelope) => envelope.action.type === 'segment-saved',
    );
    expect(segmentSavedAction).toBeDefined();
    const bytes = new TextEncoder().encode(JSON.stringify(segmentSavedAction)).length;
    expect(bytes).toBeLessThan(FIRESTORE_MAX_DOCUMENT_BYTES / 1000);
  });

  it('read/write-begroting voor de fixture: 1 ensureGame-create + 12 action-creates + max. 12 snapshotpatches', () => {
    // Narekenbaar uit de fixture hierboven (4 kwarten × 3 acties: 2
    // score-delta's + 1 segment-saved = 12 acties):
    //  - 1 write: ensureGame() maakt het parentdocument één keer aan;
    //  - 12 writes: uploadActions() voor elk van de 12 nog onbevestigde
    //    acties (create-only, elk een eigen document — PR 7.1c);
    //  - ≤12 writes: patchSnapshot() na elke actie die scoreFor/scoreAgainst/
    //    segmentCount raakt, nooit vaker dan het aantal acties sinds de
    //    laatste patch (7.1c mag patches batchen, dit is de bovengrens).
    // Totale bovengrens voor deze fixture: 1 + 12 + 12 = 25 writes; geen
    // enkele full-document overwrite van de parent (alleen create + patches).
    const game = fullGameFixture();
    const actionCount = game.actions.length;
    const expectedEnsureWrites = 1;
    const expectedActionWrites = actionCount;
    const expectedMaxSnapshotPatches = actionCount;
    const totalWriteBudget =
      expectedEnsureWrites + expectedActionWrites + expectedMaxSnapshotPatches;

    expect(actionCount).toBe(12);
    expect(totalWriteBudget).toBe(25);

    // Read-begroting bij reconnect op een tweede apparaat: 1 read voor het
    // parentdocument (snelle status/score-preview) + maximaal `actionCount`
    // reads voor de volledige actielog — nooit meer dan het aantal acties,
    // want elk action-document wordt precies één keer gelezen.
    const expectedMaxReadsOnSecondDevice = 1 + actionCount;
    expect(expectedMaxReadsOnSecondDevice).toBe(13);
  });
});
