import { startBlockReason, type StartBlockReason } from './setup';
import type { ActiveGame } from './types';

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
  | { kind: 'cloud-claim'; status: Extract<CloudClaimStatus, { kind: 'pending' | 'blocked' }> };

/**
 * Eerste reden waarom de wedstrijd nog niet gestart mag worden, of `null` als
 * starten mag — combineert de bestaande roster-voorwaarden
 * (`setup.ts` `startBlockReason()`) met de PR 7.3a-eis dat een cloudwedstrijd
 * vóór tip-off een serverbevestigde writerclaim heeft (docs/pr-7.3-plan.md
 * §B). Roster-redenen gaan altijd eerst: zonder 5 geldige spelers heeft een
 * claimpoging sowieso geen zin. Alleen-lokale modus (`cloudClaim.kind ===
 * 'not-required'`) blijft ongewijzigd zonder netwerk werken.
 */
export function gameStartBlockReason(
  game: ActiveGame,
  cloudClaim: CloudClaimStatus,
): GameStartBlockReason | null {
  const rosterReason = startBlockReason(game);
  if (rosterReason !== null) return { kind: 'roster', reason: rosterReason };
  if (cloudClaim.kind === 'pending' || cloudClaim.kind === 'blocked') {
    return { kind: 'cloud-claim', status: cloudClaim };
  }
  return null;
}

export function canStartGame(game: ActiveGame, cloudClaim: CloudClaimStatus): boolean {
  return gameStartBlockReason(game, cloudClaim) === null;
}
