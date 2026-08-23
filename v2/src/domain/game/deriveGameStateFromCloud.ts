import { applyAction, EMPTY_HISTORY, type DerivedGameHistory } from './tracking';
import type { GameAction, Segment } from './types';

/**
 * PR 7.3b (docs/pr-7.3-plan.md §C 7.3b werk 2/5): pure afleiding van de
 * score-/segmenthistorie voor een READ-ONLY viewer, uit dezelfde
 * action-envelopes als `application/game/projectGameForCloud.ts`
 * `projectGameActions()` naar de cloud schrijft — geen Firestore-/
 * `firebase-base`-import hier, net als de rest van `domain/`. De vorm van
 * `CloudGameActionPayload`/`CloudGameActionEnvelope` is bewust structureel
 * identiek aan `firebase-base/documents`' `GameActionPayloadDocument`/
 * `GameActionEnvelopeDocument` (zelfde discriminated union, zelfde velden)
 * zodat de application-laag een `GameActionEnvelopeDocument[]` rechtstreeks
 * kan doorgeven zonder eigen mapping-stap — TypeScript's structurele typing
 * accepteert het bredere Firestore-documenttype hier zonder cast.
 *
 * De writer leidt zijn `DerivedGameHistory` af uit de LOKALE `ActiveGame.
 * actions`-array (`deriveGameHistory()`, tracking.ts) — array-volgorde is
 * daar de bron van waarheid. Een viewer heeft die lokale array niet; die
 * ontvangt actions via een Firestore-listener op de `actions`-subcollectie,
 * die ze in WILLEKEURIGE volgorde kan afleveren (initial snapshot, late
 * documenten, uit-volgorde reconnect-batches). `sequence` (de arrayindex op
 * het moment van uploaden, zie `projectGameActions()`) reconstrueert die
 * volgorde altijd deterministisch, ongeacht leveringsvolgorde.
 */

export type CloudGameActionPayload =
  | { type: 'score-delta'; team: 'for' | 'against'; delta: number }
  | { type: 'score-set'; team: 'for' | 'against'; value: number }
  | { type: 'segment-saved'; segment: Segment }
  | { type: 'segment-edited'; segmentId: string; segment: Segment }
  | { type: 'segment-deleted'; segmentId: string };

export interface CloudGameActionEnvelope {
  actionId: string;
  sequence: number;
  occurredAt: string;
  action: CloudGameActionPayload;
}

function toGameAction(envelope: CloudGameActionEnvelope): GameAction {
  const { actionId: id, occurredAt: at, action } = envelope;
  switch (action.type) {
    case 'score-delta':
      return { type: 'score-delta', id, team: action.team, delta: action.delta, at };
    case 'score-set':
      return { type: 'score-set', id, team: action.team, value: action.value, at };
    case 'segment-saved':
      return { type: 'segment-saved', id, segment: action.segment, at };
    case 'segment-edited':
      return {
        type: 'segment-edited',
        id,
        segmentId: action.segmentId,
        segment: action.segment,
        at,
      };
    case 'segment-deleted':
      return { type: 'segment-deleted', id, segmentId: action.segmentId, at };
  }
}

/**
 * Sorteert op `sequence` en dedupliceert op `actionId` (eerste occurrence
 * wint). Action-documenten zijn create-only en daarna onveranderlijk
 * (ADR-002 §"Verduidelijkingen voor fase 7" punt 1, afgedwongen door
 * firestore.rules) — een dubbele upload-retry levert dus altijd een
 * IDENTIEKE payload op onder dezelfde `actionId`, wat "eerste occurrence
 * wint" hier veilig maakt zonder een deep-equal-check zoals
 * `FirestoreGameCloudGateway.uploadActions()` die wel nodig heeft (die
 * vergelijkt een client-write tegen een bestaand document, hier vergelijken
 * we alleen listener-snapshots van hetzelfde document met zichzelf). Werkt
 * ongeacht de volgorde waarin de Firestore-listener de documenten aanlevert
 * (late/out-of-order delivery, docs/pr-7.3-plan.md §C 7.3b werk 5).
 */
export function sortCloudActions(
  actions: readonly CloudGameActionEnvelope[],
): CloudGameActionEnvelope[] {
  const byActionId = new Map<string, CloudGameActionEnvelope>();
  for (const action of actions) {
    if (!byActionId.has(action.actionId)) byActionId.set(action.actionId, action);
  }
  return [...byActionId.values()].sort((a, b) => a.sequence - b.sequence);
}

/**
 * Vouwt cloud-action-envelopes samen tot dezelfde `DerivedGameHistory`-vorm
 * als `tracking.ts` `deriveGameHistory()` voor de lokale writer aflevert —
 * dezelfde `applyAction()`-reducer, hetzelfde `EMPTY_HISTORY`-startpunt, dus
 * gegarandeerd identieke uitkomst bij gelijke actionsets (acceptatiecriterium
 * "gelijkheid van score/segmenten op A en B", docs/pr-7.3-plan.md §C 7.3b
 * werk 5) — geen tweede, divergerend berekeningspad.
 */
export function deriveCloudGameHistory(
  actions: readonly CloudGameActionEnvelope[],
): DerivedGameHistory {
  return sortCloudActions(actions).reduce(
    (state, envelope) => applyAction(state, toGameAction(envelope)),
    EMPTY_HISTORY,
  );
}
