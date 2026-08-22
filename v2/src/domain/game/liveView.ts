// PR 7.3b (docs/pr-7.3-plan.md §C 7.3b werk 2): pure reconstructie van een
// live, read-only `ActiveGame`-weergave uit cloudgegevens — de inverse van
// `application/game/projectGameForCloud.ts` (die `ActiveGame` NAAR de
// cloudvorm projecteert). Geen Firestore-import hier: dit bestand levert
// alleen de zuivere afleidingen die `infrastructure/game/
// FirestoreGameViewerGateway.ts` (de daadwerkelijke live-abonnementen) en de
// UI nodig hebben, in dezelfde geest als `domain/game/writerClaim.ts`.
//
// Een niet-writende viewer (apparaat B, C, ...) heeft geen eigen lokale
// `ActiveGame` voor de wedstrijd die apparaat A actief bijhoudt — v2 kent per
// apparaat precies één actieve-wedstrijdslot in `localStorage`
// (`LocalStorageGameRepository`), en `ActiveGame.id` wordt per apparaat lokaal
// gegenereerd (`domain/game/setup.ts` `newId()`). Deze functies bouwen daarom
// een ActiveGame-vormige, puur afgeleide "leesmodel"-snapshot rechtstreeks uit
// het cloud-parentdocument (`GameDocument`) en de bijbehorende
// `actions`-subcollectie — geschikt om ongewijzigd door de bestaande
// `LiveTrackingPanel`/`deriveGameHistory()` gerenderd te worden, met
// `canWrite=false` (zie `ui/game/LiveTrackingPanel.tsx`).
import type {
  GameActionEnvelopeDocument,
  GameActionPayloadDocument,
  GameDocument,
  SegmentDocument,
} from 'firebase-base/documents';
import type { ActiveGame, GameAction, Segment } from './types';

function segmentFromDocument(doc: SegmentDocument): Segment {
  return {
    id: doc.id,
    quarter: doc.quarter,
    beginSec: doc.beginSec,
    endSec: doc.endSec,
    durSec: doc.durSec,
    lineup: [...doc.lineup],
    pf: doc.pf,
    pa: doc.pa,
    classSum: doc.classSum,
    allowed: doc.allowed,
    over: doc.over,
  };
}

/**
 * Vertaalt één action-envelope terug naar een `GameAction` — de inverse van
 * `application/game/projectGameForCloud.ts`'s `projectActionPayload()`.
 * `actionId`/`occurredAt` (envelopevelden) worden `GameAction.id`/`.at`, exact
 * zoals bij het projecteren.
 */
function actionFromEnvelope(
  actionId: string,
  occurredAt: string,
  payload: GameActionPayloadDocument,
): GameAction {
  switch (payload.type) {
    case 'score-delta':
      return {
        type: 'score-delta',
        id: actionId,
        team: payload.team,
        delta: payload.delta,
        at: occurredAt,
      };
    case 'score-set':
      return {
        type: 'score-set',
        id: actionId,
        team: payload.team,
        value: payload.value,
        at: occurredAt,
      };
    case 'segment-saved':
      return {
        type: 'segment-saved',
        id: actionId,
        segment: segmentFromDocument(payload.segment),
        at: occurredAt,
      };
    case 'segment-edited':
      return {
        type: 'segment-edited',
        id: actionId,
        segmentId: payload.segmentId,
        segment: segmentFromDocument(payload.segment),
        at: occurredAt,
      };
    case 'segment-deleted':
      return {
        type: 'segment-deleted',
        id: actionId,
        segmentId: payload.segmentId,
        at: occurredAt,
      };
  }
}

/**
 * Reconstrueert `ActiveGame.actions` uit een (mogelijk out-of-order/
 * gedupliceerd geleverde) verzameling action-envelopes — nodig omdat een
 * live Firestore-`onSnapshot`-abonnement op de `actions`-subcollectie geen
 * volgorde garandeert en, over meerdere reconnects/listener-herstarts heen,
 * hetzelfde document meermaals kan aanleveren (PR 7.3b-acceptatie: "late/
 * out-of-order delivery" en "duplicated retry" moeten tot exact dezelfde
 * afgeleide historie leiden).
 *
 * Sorteervolgorde: eerst `writerEpoch` (een overname, PR 7.3c, verhoogt het
 * epoch — acties uit een latere epoch zijn per definitie later, ongeacht hun
 * eigen `sequence`, die per epoch bij 0 opnieuw begint), dan `sequence`
 * (de arrayindex in de schrijvende `ActiveGame.actions` op projectietijdstip,
 * zie `projectGameActions()`), en tot slot `actionId` als deterministische
 * tiebreaker (zou zich normaal nooit voordoen — `sequence` is uniek per
 * epoch — maar voorkomt een instabiele sorteeruitkomst bij een corrupte/
 * onverwachte gelijke `sequence`). Dedupliceert op `actionId` (create-only en
 * onveranderlijk in Firestore, dus de eerste gelezen kopie is altijd
 * semantisch gelijk aan een latere).
 */
export function deriveLiveGameActions(
  envelopes: readonly GameActionEnvelopeDocument[],
): GameAction[] {
  const byActionId = new Map<string, GameActionEnvelopeDocument>();
  for (const envelope of envelopes) {
    if (!byActionId.has(envelope.actionId)) byActionId.set(envelope.actionId, envelope);
  }
  const ordered = [...byActionId.values()].sort((a, b) => {
    if (a.writerEpoch !== b.writerEpoch) return a.writerEpoch - b.writerEpoch;
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    if (a.actionId < b.actionId) return -1;
    if (a.actionId > b.actionId) return 1;
    return 0;
  });
  return ordered.map((envelope) =>
    actionFromEnvelope(envelope.actionId, envelope.occurredAt, envelope.action),
  );
}

/**
 * Bouwt de volledige read-only `ActiveGame`-weergave: de "draaivelden" komen
 * rechtstreeks van het parentdocument (die worden al met echte veldpatches
 * gesynchroniseerd, zie `projectGameSnapshotPatch()`), `actions` wordt
 * hierboven afgeleid uit de subcollectie. Puur — geen `Date.now()`/
 * `crypto.randomUUID()` — dezelfde `(gameId, doc, envelopes)` levert altijd
 * dezelfde `ActiveGame` op, ongeacht de volgorde waarin `envelopes` is
 * aangeleverd.
 */
export function buildLiveGameView(
  gameId: string,
  doc: GameDocument,
  envelopes: readonly GameActionEnvelopeDocument[],
): ActiveGame {
  return {
    id: gameId,
    organizationId: doc.organizationId,
    teamId: doc.teamId,
    phase: doc.phase,
    players: doc.players.map((player) => ({ ...player })),
    opponent: doc.opponent,
    competition: doc.competition,
    clockDown: doc.clockDown,
    limitStr: doc.limitStr,
    onCourt: [...doc.onCourt],
    curQuarter: doc.curQuarter,
    beginSec: doc.beginSec,
    endSec: doc.endSec,
    pendingSwapLineup: doc.pendingSwapLineup ? [...doc.pendingSwapLineup] : null,
    actions: deriveLiveGameActions(envelopes),
    createdAt: doc.createdAt,
    startedAt: doc.startedAt,
  };
}

/** Minimale velden die `pickActiveGameCandidate()` hieronder nodig heeft — een
 * projectie van `GameDocument` plus het padgebonden `gameId`, zodat deze
 * functie geen volledig document (met o.a. `players`) hoeft te ontvangen om
 * te kunnen kiezen. */
export interface ActiveGameCandidate {
  gameId: string;
  lastWriterActivityAt: string | null;
  claimedAt: string | null;
  createdAt: string;
}

/**
 * Kiest, uit de (doorgaans lege of enkelvoudige) resultaatset van de
 * discoveryquery in `FirestoreGameViewerGateway`
 * (`phase=='tracking' && completedGameId==null`), de meest recent actieve
 * kandidaat. Bij precies één kandidaat (het normale geval — één team heeft
 * hooguit één actieve schrijver tegelijk, zie `app/App.tsx`'s
 * "geen nieuwe lokale claimpoging zolang een andere wedstrijd al actief is"-
 * gate) is dit een triviale keuze; bij een theoretische race (twee apparaten
 * die elk een ANDER, nog niet server-bevestigd `gameId` claimden vóórdat deze
 * gate elders greep) wint de kandidaat met de meest recente
 * `lastWriterActivityAt` (of, zolang die nog `null` is — vlak na de initiële
 * claim, vóór de eerste draaiveldpatch — `claimedAt`, en anders `createdAt`),
 * met `gameId` als deterministische tiebreaker. Puur, geen Firestore-import.
 */
export function pickActiveGameCandidate(candidates: readonly ActiveGameCandidate[]): string | null {
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort((a, b) => {
    const aKey = a.lastWriterActivityAt ?? a.claimedAt ?? a.createdAt;
    const bKey = b.lastWriterActivityAt ?? b.claimedAt ?? b.createdAt;
    if (aKey !== bKey) return aKey < bKey ? 1 : -1;
    return a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0;
  });
  return ranked[0]!.gameId;
}
