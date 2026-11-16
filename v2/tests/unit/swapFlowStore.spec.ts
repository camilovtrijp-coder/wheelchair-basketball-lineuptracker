import { beforeEach, describe, expect, it } from 'vitest';
import { ROTATION_PLAN_STORAGE_KEY } from '../../src/infrastructure/game/rotationPlanStore';
import {
  MAX_SWAP_FLOW_ENTRIES,
  MAX_UNCONFIRMED_SEGMENTS,
  SWAP_FLOW_STORAGE_KEY,
  clearSwapFlowState,
  confirmAllSwapTimes,
  markSwapTimeConfirmed,
  markSwapTimeUnconfirmed,
  parseSwapFlowEntries,
  readSwapFlowState,
  setUndoBlockedAction,
} from '../../src/infrastructure/game/swapFlowStore';

function raw(): string | null {
  return (
    globalThis as unknown as { window: { localStorage: Storage } }
  ).window.localStorage.getItem(SWAP_FLOW_STORAGE_KEY);
}

describe('lokale opslag van de wisselflow-toestand', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    };
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: storage },
      configurable: true,
    });
  });

  it('gebruikt een nieuwe key die geen bestaande key hergebruikt', () => {
    expect(SWAP_FLOW_STORAGE_KEY).toBe('lineup-tracker-v2-swap-flow');
    expect(SWAP_FLOW_STORAGE_KEY).not.toBe(ROTATION_PLAN_STORAGE_KEY);
  });

  it('leeg: niets open', () => {
    expect(readSwapFlowState('g1')).toEqual({
      unconfirmedSegmentIds: [],
      undoBlockedActionId: null,
    });
    expect(readSwapFlowState('')).toEqual({ unconfirmedSegmentIds: [], undoBlockedActionId: null });
  });

  it('S6/S13: onbevestigde tijden blijven oudste-eerst staan en overleven opnieuw lezen', () => {
    markSwapTimeUnconfirmed('g1', 's1');
    markSwapTimeUnconfirmed('g1', 's2');
    markSwapTimeUnconfirmed('g1', 's1'); // opnieuw: verplaatst naar achteren, geen dubbel
    expect(readSwapFlowState('g1').unconfirmedSegmentIds).toEqual(['s2', 's1']);
    markSwapTimeConfirmed('g1', 's2');
    expect(readSwapFlowState('g1').unconfirmedSegmentIds).toEqual(['s1']);
  });

  it('S10: "Klopt allemaal" wist alleen de tijden van deze wedstrijd', () => {
    markSwapTimeUnconfirmed('g1', 's1');
    markSwapTimeUnconfirmed('g2', 'x1');
    setUndoBlockedAction('g1', 'a9');
    confirmAllSwapTimes('g1');
    expect(readSwapFlowState('g1')).toEqual({
      unconfirmedSegmentIds: [],
      undoBlockedActionId: 'a9',
    });
    expect(readSwapFlowState('g2').unconfirmedSegmentIds).toEqual(['x1']);
  });

  it('bewaart de undo-blokkade en wist hem met null', () => {
    setUndoBlockedAction('g1', 'a1');
    expect(readSwapFlowState('g1').undoBlockedActionId).toBe('a1');
    setUndoBlockedAction('g1', null);
    expect(readSwapFlowState('g1').undoBlockedActionId).toBeNull();
  });

  it('clearSwapFlowState verwijdert één wedstrijd', () => {
    markSwapTimeUnconfirmed('g1', 's1');
    markSwapTimeUnconfirmed('g2', 'x1');
    clearSwapFlowState('g1');
    expect(readSwapFlowState('g1').unconfirmedSegmentIds).toEqual([]);
    expect(readSwapFlowState('g2').unconfirmedSegmentIds).toEqual(['x1']);
  });

  it('begrenst het aantal wedstrijden en het aantal open tijden', () => {
    for (let i = 0; i < MAX_SWAP_FLOW_ENTRIES + 5; i++) markSwapTimeUnconfirmed(`g${i}`, 's');
    expect(parseSwapFlowEntries(raw())).toHaveLength(MAX_SWAP_FLOW_ENTRIES);
    expect(readSwapFlowState('g0').unconfirmedSegmentIds).toEqual([]);
    for (let i = 0; i < MAX_UNCONFIRMED_SEGMENTS + 5; i++) markSwapTimeUnconfirmed('big', `s${i}`);
    const ids = readSwapFlowState('big').unconfirmedSegmentIds;
    expect(ids).toHaveLength(MAX_UNCONFIRMED_SEGMENTS);
    expect(ids.at(-1)).toBe(`s${MAX_UNCONFIRMED_SEGMENTS + 4}`);
  });

  it('kapotte of ongeldige opslag leest als niets open', () => {
    expect(parseSwapFlowEntries('{kapot')).toEqual([]);
    expect(parseSwapFlowEntries('{"a":1}')).toEqual([]);
    expect(parseSwapFlowEntries(null)).toEqual([]);
    expect(parseSwapFlowEntries(JSON.stringify([null, 5, { gameId: '' }, { gameId: 7 }]))).toEqual(
      [],
    );
    expect(
      parseSwapFlowEntries(
        JSON.stringify([
          { gameId: 'g', segmentIds: ['a', 3, '', 'a', null, 'b'], undoBlockedActionId: 5 },
          { gameId: 'h', segmentIds: 'nee' },
        ]),
      ),
    ).toEqual([
      { gameId: 'g', unconfirmedSegmentIds: ['a', 'b'], undoBlockedActionId: null },
      { gameId: 'h', unconfirmedSegmentIds: [], undoBlockedActionId: null },
    ]);
  });

  it('onbeschikbare opslag faalt stil', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: () => {
            throw new Error('geblokkeerd');
          },
          setItem: () => {
            throw new Error('geblokkeerd');
          },
        },
      },
      configurable: true,
    });
    expect(readSwapFlowState('g1').unconfirmedSegmentIds).toEqual([]);
    expect(() => markSwapTimeUnconfirmed('g1', 's1')).not.toThrow();
    expect(() => confirmAllSwapTimes('g1')).not.toThrow();
    expect(() => setUndoBlockedAction('g1', 'a')).not.toThrow();
    expect(() => clearSwapFlowState('g1')).not.toThrow();
  });
});
