// PR 7.3b (docs/pr-7.3-plan.md §C 7.3b werk 2/3): bewijst de pure combinatie
// van parent-/actions-/foutstaat tot één `GameCloudViewerSnapshot` — de
// writerclaim t.o.v. dit apparaat, de afgeleide historie en de cache-/
// serveractualiteitsindicator.
import { describe, it, expect } from 'vitest';
import {
  createEmptyGameCloudViewerSnapshot,
  deriveGameCloudViewerSnapshot,
} from '../../src/application/game/GameCloudViewerState';
import type { GameDocument } from 'firebase-base/documents';

const SELF = { authorUid: 'uid-self', deviceId: 'device-self' };
const OTHER = { authorUid: 'uid-other', deviceId: 'device-other' };

function parentDoc(writer: { authorUid: string; deviceId: string } | null): GameDocument {
  return {
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: [],
    opponent: '',
    competition: '',
    clockDown: false,
    limitStr: '',
    onCourt: [],
    curQuarter: 1,
    beginSec: 0,
    endSec: 0,
    pendingSwapLineup: null,
    scoreFor: 4,
    scoreAgainst: 2,
    segmentCount: 0,
    writerUid: writer?.authorUid ?? null,
    deviceId: writer?.deviceId ?? null,
    writerEpoch: writer ? 1 : 0,
    claimedAt: writer ? '2026-01-01T10:00:00.000Z' : null,
    lastWriterActivityAt: writer ? '2026-01-01T10:00:00.000Z' : null,
    revision: 3,
    createdAt: '2026-01-01T09:00:00.000Z',
    startedAt: '2026-01-01T09:30:00.000Z',
    completedGameId: null,
    // updatedAt is een Firestore Timestamp in het echte document — hier
    // ongebruikt door deriveGameCloudViewerSnapshot(), dus een simpele cast
    // volstaat.
    updatedAt: {} as GameDocument['updatedAt'],
  };
}

const SERVER_META = { fromCache: false, hasPendingWrites: false };
const CACHE_META = { fromCache: true, hasPendingWrites: false };

describe('application/game/GameCloudViewerState (PR 7.3b)', () => {
  it('createEmptyGameCloudViewerSnapshot(): laadstaat vóór de eerste snapshot', () => {
    const snap = createEmptyGameCloudViewerSnapshot();
    expect(snap.loading).toBe(true);
    expect(snap.parent).toBeNull();
    expect(snap.writerClaim).toEqual({ kind: 'unclaimed' });
    expect(snap.freshness).toBe('server');
  });

  it('writerClaim "own" wanneer dit apparaat de actuele writer is', () => {
    const snap = deriveGameCloudViewerSnapshot({
      parent: parentDoc(SELF),
      parentMeta: SERVER_META,
      actions: [],
      actionsMeta: SERVER_META,
      hadError: false,
      self: SELF,
    });
    expect(snap.writerClaim.kind).toBe('own');
    expect(snap.loading).toBe(false);
    expect(snap.freshness).toBe('server');
  });

  it('writerClaim "other" wanneer een ANDER apparaat de actuele writer is', () => {
    const snap = deriveGameCloudViewerSnapshot({
      parent: parentDoc(OTHER),
      parentMeta: SERVER_META,
      actions: [],
      actionsMeta: SERVER_META,
      hadError: false,
      self: SELF,
    });
    expect(snap.writerClaim).toEqual({
      kind: 'other',
      identity: { writerUid: OTHER.authorUid, deviceId: OTHER.deviceId, writerEpoch: 1 },
    });
  });

  it('writerClaim "unclaimed" zolang niemand de wedstrijd geclaimd heeft', () => {
    const snap = deriveGameCloudViewerSnapshot({
      parent: parentDoc(null),
      parentMeta: SERVER_META,
      actions: [],
      actionsMeta: SERVER_META,
      hadError: false,
      self: SELF,
    });
    expect(snap.writerClaim).toEqual({ kind: 'unclaimed' });
  });

  it('freshness "cache" zodra minstens één stream nog niet server-bevestigd is', () => {
    const snap = deriveGameCloudViewerSnapshot({
      parent: parentDoc(OTHER),
      parentMeta: SERVER_META,
      actions: [],
      actionsMeta: CACHE_META,
      hadError: false,
      self: SELF,
    });
    expect(snap.freshness).toBe('cache');
  });

  it('freshness "error" na een listenerfout, ook als de laatste bekende meta "server" was', () => {
    const snap = deriveGameCloudViewerSnapshot({
      parent: parentDoc(OTHER),
      parentMeta: SERVER_META,
      actions: [],
      actionsMeta: SERVER_META,
      hadError: true,
      self: SELF,
    });
    expect(snap.freshness).toBe('error');
    // Laatst bekende stand blijft zichtbaar — geen crash/lege staat na een fout.
    expect(snap.parent).not.toBeNull();
  });

  it('leidt de historie af uit de meegegeven actions (delegeert naar deriveCloudGameHistory)', () => {
    const snap = deriveGameCloudViewerSnapshot({
      parent: parentDoc(OTHER),
      parentMeta: SERVER_META,
      actions: [
        {
          actionId: 'a1',
          sequence: 0,
          occurredAt: '2026-01-01T10:00:00.000Z',
          action: { type: 'score-delta', team: 'for', delta: 2 },
        },
      ],
      actionsMeta: SERVER_META,
      hadError: false,
      self: SELF,
    });
    expect(snap.history.scoreFor).toBe(2);
    expect(snap.history.scoreAgainst).toBe(0);
  });

  it('review-fix (minimax, PR #68 punt 2): freshness is NIET "server" zolang de actions-listener nog geen enkele snapshot leverde, ook al is de parent al server-bevestigd', () => {
    const snap = deriveGameCloudViewerSnapshot({
      parent: parentDoc(OTHER),
      parentMeta: SERVER_META,
      actions: [],
      actionsMeta: null,
      hadError: false,
      self: SELF,
    });
    expect(snap.freshness).not.toBe('server');
    expect(snap.freshness).toBe('cache');
  });

  it('review-fix (minimax, PR #68 punt 2): freshness is NIET "server" zolang de parent-listener nog geen enkele snapshot leverde, ook al is actions al server-bevestigd', () => {
    const snap = deriveGameCloudViewerSnapshot({
      parent: null,
      parentMeta: null,
      actions: [],
      actionsMeta: SERVER_META,
      hadError: false,
      self: SELF,
    });
    expect(snap.freshness).not.toBe('server');
    expect(snap.freshness).toBe('cache');
  });

  it('self: null (defensief) valt terug op een lege identiteit i.p.v. te crashen', () => {
    const snap = deriveGameCloudViewerSnapshot({
      parent: parentDoc(OTHER),
      parentMeta: SERVER_META,
      actions: [],
      actionsMeta: SERVER_META,
      hadError: false,
      self: null,
    });
    expect(snap.writerClaim.kind).toBe('other');
  });
});
