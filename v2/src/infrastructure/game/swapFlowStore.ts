/**
 * Lokale UI-toestand van de wisselflow (Rustig-bouwplan R1): welke wisseltijden
 * nog bevestigd moeten worden en na welke actie "ongedaan maken" uit staat.
 * Bewust alleen op dit apparaat, per wedstrijd-ID, onder één NIEUWE eigen key
 * (geen bestaande key of gebruikersdata geraakt). Nooit onderdeel van
 * `ActiveGame`, het datacontract, CSV of cloudsync. Patroon van
 * `rotationPlanStore.ts`: onbeschikbare, kapotte of ongeldige storage valt stil
 * terug op "niets open". Een tweede apparaat ziet dus gewone tijden.
 *
 * Opslagvorm: JSON-array van `{ gameId, segmentIds, undoBlockedActionId }`,
 * oudste eerst, begrensd op `MAX_SWAP_FLOW_ENTRIES`. Alleen id's, geen spelersdata.
 */
export const SWAP_FLOW_STORAGE_KEY = 'lineup-tracker-v2-swap-flow';

export const MAX_SWAP_FLOW_ENTRIES = 20;
/** Meer open bevestigingen dan dit kan in een wedstrijd niet voorkomen; begrenst corrupte data. */
export const MAX_UNCONFIRMED_SEGMENTS = 50;

export interface SwapFlowState {
  /** Segment-id's met een voorlopige tijd, oudste eerst. */
  unconfirmedSegmentIds: string[];
  /** Laatste actie waarna "ongedaan maken" uit staat (zie `undoLastAction`). */
  undoBlockedActionId: string | null;
}

interface Entry extends SwapFlowState {
  gameId: string;
}

const EMPTY: SwapFlowState = { unconfirmedSegmentIds: [], undoBlockedActionId: null };

export function parseSwapFlowEntries(raw: string | null | undefined): Entry[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries: Entry[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const { gameId, segmentIds, undoBlockedActionId } = item as {
        gameId?: unknown;
        segmentIds?: unknown;
        undoBlockedActionId?: unknown;
      };
      if (typeof gameId !== 'string' || gameId.length === 0) continue;
      const ids = Array.isArray(segmentIds)
        ? [
            ...new Set(
              segmentIds.filter((id): id is string => typeof id === 'string' && id.length > 0),
            ),
          ].slice(0, MAX_UNCONFIRMED_SEGMENTS)
        : [];
      entries.push({
        gameId,
        unconfirmedSegmentIds: ids,
        undoBlockedActionId:
          typeof undoBlockedActionId === 'string' && undoBlockedActionId.length > 0
            ? undoBlockedActionId
            : null,
      });
    }
    return entries;
  } catch {
    return [];
  }
}

function readEntries(): Entry[] {
  try {
    return parseSwapFlowEntries(window.localStorage.getItem(SWAP_FLOW_STORAGE_KEY));
  } catch {
    return [];
  }
}

function writeEntries(entries: Entry[]): void {
  const stored = entries.map((e) => ({
    gameId: e.gameId,
    segmentIds: e.unconfirmedSegmentIds,
    undoBlockedActionId: e.undoBlockedActionId,
  }));
  window.localStorage.setItem(SWAP_FLOW_STORAGE_KEY, JSON.stringify(stored));
}

/** Toestand van deze wedstrijd; bij elk probleem "niets open". */
export function readSwapFlowState(gameId: string): SwapFlowState {
  if (!gameId) return { ...EMPTY, unconfirmedSegmentIds: [] };
  const found = readEntries().find((e) => e.gameId === gameId);
  return found
    ? {
        unconfirmedSegmentIds: [...found.unconfirmedSegmentIds],
        undoBlockedActionId: found.undoBlockedActionId,
      }
    : { ...EMPTY, unconfirmedSegmentIds: [] };
}

function update(gameId: string, change: (state: SwapFlowState) => SwapFlowState): void {
  if (!gameId) return;
  try {
    const all = readEntries();
    const current = all.find((e) => e.gameId === gameId) ?? { gameId, ...EMPTY };
    const next = change({
      unconfirmedSegmentIds: [...current.unconfirmedSegmentIds],
      undoBlockedActionId: current.undoBlockedActionId,
    });
    const others = all.filter((e) => e.gameId !== gameId);
    writeEntries([...others, { gameId, ...next }].slice(-MAX_SWAP_FLOW_ENTRIES));
  } catch {
    // Onbeschikbare storage: de toestand geldt dan alleen voor deze sessie.
  }
}

/** Markeert de tijd van een segment als voorlopig (achteraan = nieuwste). Faalt stil. */
export function markSwapTimeUnconfirmed(gameId: string, segmentId: string): void {
  if (!segmentId) return;
  update(gameId, (s) => ({
    ...s,
    unconfirmedSegmentIds: [
      ...s.unconfirmedSegmentIds.filter((id) => id !== segmentId),
      segmentId,
    ].slice(-MAX_UNCONFIRMED_SEGMENTS),
  }));
}

/** Tijd van één segment is bevestigd (of het segment bestaat niet meer). Faalt stil. */
export function markSwapTimeConfirmed(gameId: string, segmentId: string): void {
  update(gameId, (s) => ({
    ...s,
    unconfirmedSegmentIds: s.unconfirmedSegmentIds.filter((id) => id !== segmentId),
  }));
}

/** "Klopt allemaal": alle open tijden van deze wedstrijd zijn bevestigd. Faalt stil. */
export function confirmAllSwapTimes(gameId: string): void {
  update(gameId, (s) => ({ ...s, unconfirmedSegmentIds: [] }));
}

/** Zet (of wist met `null`) de actie waarna "ongedaan maken" uit staat. Faalt stil. */
export function setUndoBlockedAction(gameId: string, actionId: string | null): void {
  update(gameId, (s) => ({ ...s, undoBlockedActionId: actionId }));
}

/** Verwijdert alle wisselflow-toestand van één wedstrijd (bijv. na afronden). Faalt stil. */
export function clearSwapFlowState(gameId: string): void {
  if (!gameId) return;
  try {
    writeEntries(readEntries().filter((e) => e.gameId !== gameId));
  } catch {
    // Onbeschikbare storage: niets te wissen.
  }
}
