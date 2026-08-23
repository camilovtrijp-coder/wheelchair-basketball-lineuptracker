import { startBlockReason, type StartBlockReason } from './setup';
import type { ActiveGame } from './types';
import type { PwaReadinessStatus } from '../pwa/pwaReadiness';

/**
 * PR 8.1b (docs/pr-8.1-plan.md §C 8.1b werk 2): default voor het nieuwe,
 * derde `gameStartBlockReason()`-argument. Bestaande aanroepers (7.3a-tests,
 * elke plek die de functie nog met twee argumenten aanroept) krijgen zo
 * exact hetzelfde resultaat als vóór 8.1b — `'ready'` blokkeert nooit.
 */
const PWA_READY: PwaReadinessStatus = { kind: 'ready' };

/**
 * PR 7.3a (docs/pr-7.3-plan.md §B/§C 7.3a): pure writer-claim-/epochtypes.
 * Geen Firestore-import hier — de daadwerkelijke claim-/overnamelogica leeft
 * in `application/game/GameCloudGateway.ts` (poort) en
 * `infrastructure/game/FirestoreGameCloudGateway.ts` (implementatie); dit
 * bestand levert alleen de vorm + de zuivere afleidingen die de UI en de
 * coordinator nodig hebben.
 */

/** Identiteit van de actuele serverclaim op een cloudwedstrijd. */
export interface WriterIdentity {
  writerUid: string;
  deviceId: string;
  writerEpoch: number;
}

/**
 * Afgeleide claimstatus t.o.v. DIT apparaat/deze gebruiker. `'unclaimed'`:
 * nog geen enkele writer (initiële-claimpad, PR 7.1b punt 10b).  `'own'`: dit
 * apparaat/deze gebruiker is de actuele writer — mag scoren/wisselen/
 * segmenten opslaan.  `'other'`: een ANDER apparaat/andere gebruiker is de
 * actuele writer — deze sessie is read-only viewer totdat een overname
 * (`GameCloudGateway.takeoverWriter()`) slaagt.
 */
export type WriterClaimState =
  | { kind: 'unclaimed' }
  | { kind: 'own'; identity: WriterIdentity }
  | { kind: 'other'; identity: WriterIdentity };

export function deriveWriterClaimState(
  doc: { writerUid: string | null; deviceId: string | null; writerEpoch: number },
  self: { authorUid: string; deviceId: string },
): WriterClaimState {
  if (doc.writerUid == null || doc.deviceId == null) return { kind: 'unclaimed' };
  const identity: WriterIdentity = {
    writerUid: doc.writerUid,
    deviceId: doc.deviceId,
    writerEpoch: doc.writerEpoch,
  };
  if (doc.writerUid === self.authorUid && doc.deviceId === self.deviceId) {
    return { kind: 'own', identity };
  }
  return { kind: 'other', identity };
}

/**
 * Foutcodes voor een mislukte claim-/overnamepoging
 * (`GameCloudGateway.claimWriter()`/`takeoverWriter()`). Expliciet i.p.v. een
 * kale `error: unknown` zodat de pre-game-gate en een toekomstige
 * overname-bevestigingsflow (7.3c) per code een eigen NL/EN-herstelactie
 * kunnen tonen i.p.v. één generieke foutmelding.
 */
export type WriterClaimErrorCode =
  'offline' | 'stale-revision' | 'already-claimed' | 'role-denied' | 'game-completed' | 'unknown';

export interface WriterClaimFailure {
  ok: false;
  code: WriterClaimErrorCode;
  error?: unknown;
}

export interface WriterClaimSuccess {
  ok: true;
  identity: WriterIdentity;
  revision: number;
  claimedAt: string;
}

export type WriterClaimResult = WriterClaimSuccess | WriterClaimFailure;

/**
 * Cloudclaimstatus zoals de pre-game-gate (`gameStartBlockReason()` hieronder)
 * 'm nodig heeft. `'not-required'`: alleen-lokale modus (geen cloudcontext) —
 * de bestaande roster-only `startBlockReason()` blijft hier het volledige
 * verhaal. `'pending'`: cloudmodus, claimpoging nog niet afgerond. `'confirmed'`:
 * serverbevestigde eigen claim. `'blocked'`: claimpoging mislukt (zie
 * `WriterClaimErrorCode`) — nooit stilzwijgend, altijd zichtbaar via de gate.
 */
export type CloudClaimStatus =
  | { kind: 'not-required' }
  | { kind: 'pending' }
  | { kind: 'confirmed'; identity: WriterIdentity }
  | { kind: 'blocked'; code: WriterClaimErrorCode };

export type GameStartBlockReason =
  | { kind: 'roster'; reason: StartBlockReason }
  | { kind: 'cloud-claim'; status: Extract<CloudClaimStatus, { kind: 'pending' | 'blocked' }> }
  | { kind: 'pwa-readiness'; status: Extract<PwaReadinessStatus, { kind: 'broken' }> };

/**
 * Eerste reden waarom de wedstrijd nog niet gestart mag worden, of `null` als
 * starten mag — combineert de bestaande roster-voorwaarden
 * (`setup.ts` `startBlockReason()`) met de PR 7.3a-eis dat een cloudwedstrijd
 * vóór tip-off een serverbevestigde writerclaim heeft (docs/pr-7.3-plan.md
 * §B), en (PR 8.1b, docs/pr-8.1-plan.md §B punt 4/§C 8.1b) de PWA-/offline-
 * gereedheid van de app-shell zelf. Volgorde is bewust "eerst het
 * goedkoopste/meest zinvolle signaal": roster eerst (zonder 5 geldige
 * spelers heeft een claim-/readinesscheck sowieso geen zin), dan cloudclaim,
 * dan PWA-gereedheid. Alleen-lokale modus (`cloudClaim.kind ===
 * 'not-required'`) blijft ongewijzigd zonder netwerk werken. `pwaReadiness`
 * is optioneel met een `'ready'`-default zodat bestaande aanroepers
 * (7.3a-tests, elke plek die de functie nog met twee argumenten aanroept)
 * exact hetzelfde resultaat blijven krijgen — geen regressie op 7.3a-gedrag
 * (8.1b-acceptatiecriterium). Alleen `pwaReadiness.kind === 'broken'`
 * blokkeert ooit — `'unsupported'`/`'registering'`/`'update-pending'` zijn
 * bewust nooit een blokkerende reden (stopregel §D: geen harde eis die
 * apparaten zonder SW-ondersteuning volledig uitsluit).
 */
export function gameStartBlockReason(
  game: ActiveGame,
  cloudClaim: CloudClaimStatus,
  pwaReadiness: PwaReadinessStatus = PWA_READY,
): GameStartBlockReason | null {
  const rosterReason = startBlockReason(game);
  if (rosterReason !== null) return { kind: 'roster', reason: rosterReason };
  if (cloudClaim.kind === 'pending' || cloudClaim.kind === 'blocked') {
    return { kind: 'cloud-claim', status: cloudClaim };
  }
  if (pwaReadiness.kind === 'broken') {
    return { kind: 'pwa-readiness', status: pwaReadiness };
  }
  return null;
}

export function canStartGame(
  game: ActiveGame,
  cloudClaim: CloudClaimStatus,
  pwaReadiness: PwaReadinessStatus = PWA_READY,
): boolean {
  return gameStartBlockReason(game, cloudClaim, pwaReadiness) === null;
}

/**
 * PR 7.3b regressiefix (docs/pr-7.3-plan.md §C 7.3b): bepaalt of een
 * `'other'`-writerclaim TIJDENS ACTIEVE TRACKING een ECHTE, epoch-bevorderde
 * overname is (`GameCloudGateway.takeoverWriter()`, PR 7.3a — altijd exact
 * +1 op `writerEpoch`), i.p.v. een gelijk-epoch writerUid/deviceId-mismatch
 * op het serverdocument. Dat laatste is een corrupte/anomale staat — vandaag
 * vanuit de client onbereikbaar, alleen via de Admin SDK te simuleren (PR
 * 7.1c `game-sync-claim-conflict.spec.ts`) — die de cloud-sync als
 * 'actie-nodig' moet melden maar de lokale schrijf-UI NOOIT mag blokkeren:
 * dat is een bewust, getest ontwerp-invariant sinds PR 7.1c/7.3a.
 *
 * `ownClaim` is de bevestigde `CloudClaimStatus` van DIT apparaat
 * (`ensureWriterClaim()`, pre-game-gate) — het epoch dat dit apparaat zelf
 * claimde bij tip-off is de betrouwbare baseline, NIET een statische
 * `GameCloudWriterContext.writerEpoch` (die blijft vóór een claim altijd op
 * 0 staan, zie `infrastructure/repositories/selectRepositories.ts`).
 * Ontbreekt die bevestiging nog (`ownClaim.kind !== 'confirmed'`, bijv. een
 * pagina-herlaad midden in tracking vóórdat een verse claim opnieuw
 * bevestigd is) dan is er geen betrouwbare eigen-epoch-baseline — val dan
 * terug op de oude platte `writerClaim.kind === 'other'`-vergelijking:
 * conservatief liever onterecht read-only tonen dan een ECHTE overname
 * missen zonder baseline.
 *
 * Alleen relevant tijdens tracking (`app/App.tsx`'s eigen
 * `isSelfBlockedByOtherWriter`). De pre-game-gate zelf
 * (`gameStartBlockReason()` hierboven, en daarmee `deriveWriterClaimState()`)
 * blijft bewust de platte vergelijking gebruiken — vóór tip-off is elke
 * writerUid/deviceId-mismatch een legitieme "iemand anders heeft al
 * geclaimd, start niet", los van welk epoch dat andere apparaat draagt.
 */
export function isEpochPromotedTakeover(
  claim: WriterClaimState,
  ownClaim: CloudClaimStatus,
): boolean {
  if (claim.kind !== 'other') return false;
  if (ownClaim.kind !== 'confirmed') return true;
  return claim.identity.writerEpoch > ownClaim.identity.writerEpoch;
}
