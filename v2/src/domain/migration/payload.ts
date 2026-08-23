import type { Settings } from '../settings/types';
import type { Roster } from '../roster/types';
import type { ActiveGame, CompletedGame } from '../game/types';
import { payloadHash } from './fingerprint';

/**
 * PR 7.4a: canonicale hashpayloads — sluiten bewust context-/bookkeeping-
 * velden uit (`organizationId`/`teamId`/`revision`/`id`) zodat de hash van
 * eenzelfde INHOUD in de bron- en doelcontext (twee verschillende org/team-
 * strings) toch gelijk uitkomt — nodig om "cloud-tegenhanger bestaat al met
 * dezelfde inhoud" (`alreadyPresentIdentical`) correct te herkennen. De
 * INFRASTRUCTURE-laag die het bestaande cloudsnapshot opbouwt
 * (`FirestoreCloudMigrationInventoryGateway`) gebruikt exact dezelfde
 * functies hier, zodat beide kanten altijd hetzelfde hashformaat gebruiken —
 * geen twee divergerende hashimplementaties.
 */

export function settingsPayloadHash(settings: Settings & Record<string, unknown>): string {
  return payloadHash(settings);
}

export function rosterPayloadHash(roster: Roster): string {
  return payloadHash(roster);
}

/**
 * Alleen bedoeld voor een `phase: 'setup'`-wedstrijd (§B: `tracking` wordt
 * nooit als bulkitem meegenomen, zie `preview.ts`) — `organizationId`/`teamId`
 * bewust uitgesloten, zie header hierboven. Bouwt een EXPLICIETE veldenlijst
 * i.p.v. de volledige `ActiveGame` te spreiden, zodat exact hetzelfde
 * formaat herbruikbaar is voor een cloud-`GameDocument` (die geen `actions`
 * kent — die leven in de `actions`-subcollectie, zie
 * `FirestoreCloudMigrationInventoryGateway.ts`): `actions` wordt hier altijd
 * expliciet `[]` gehasht, nooit `game.actions` zelf. Dat is voor
 * `phase: 'setup'` geen verlies aan precisie — `domain/game/types.ts`'s
 * `ActiveGame.actions`-docstring legt vast dat die array "leeg [blijft] tot
 * de eerste `tracking`-handeling", dus een setup-fase wedstrijd heeft per
 * domeininvariant altijd `actions: []`.
 */
export function activeGamePayloadHash(game: ActiveGame): string {
  return payloadHash({
    phase: game.phase,
    players: game.players,
    opponent: game.opponent,
    competition: game.competition,
    clockDown: game.clockDown,
    limitStr: game.limitStr,
    onCourt: game.onCourt,
    curQuarter: game.curQuarter,
    beginSec: game.beginSec,
    endSec: game.endSec,
    pendingSwapLineup: game.pendingSwapLineup,
    createdAt: game.createdAt,
    startedAt: game.startedAt,
    actions: [] as unknown[],
  });
}

/**
 * Structureel identiek aan de velden die `activeGamePayloadHash()` hierboven
 * gebruikt — bewust een LOKALE structural type i.p.v. een import van
 * `firebase-base`'s `GameDocument` (domain/ blijft vrij van elke
 * package-afhankelijkheid, zie `domain/organizations/types.ts`'s docstring
 * voor precies dezelfde reden). De infrastructure-laag
 * (`FirestoreCloudMigrationInventoryGateway.ts`) geeft een `GameDocument`
 * hier gewoon aan door — die voldoet structureel aan deze vorm.
 */
export interface ActiveGameCloudPayloadFields {
  phase: 'setup' | 'tracking';
  players: unknown;
  opponent: string;
  competition: string;
  clockDown: boolean;
  limitStr: string;
  onCourt: unknown;
  curQuarter: number;
  beginSec: number;
  endSec: number;
  pendingSwapLineup: unknown;
  createdAt: string;
  startedAt: string | null;
}

/** Zie `ActiveGameCloudPayloadFields` — `actions` altijd `[]`, zelfde
 * domeininvariant-redenering als `activeGamePayloadHash()` hierboven. */
export function activeGameCloudPayloadHash(doc: ActiveGameCloudPayloadFields): string {
  return payloadHash({
    phase: doc.phase,
    players: doc.players,
    opponent: doc.opponent,
    competition: doc.competition,
    clockDown: doc.clockDown,
    limitStr: doc.limitStr,
    onCourt: doc.onCourt,
    curQuarter: doc.curQuarter,
    beginSec: doc.beginSec,
    endSec: doc.endSec,
    pendingSwapLineup: doc.pendingSwapLineup,
    createdAt: doc.createdAt,
    startedAt: doc.startedAt,
    actions: [] as unknown[],
  });
}

export function completedGamePayloadHash(game: CompletedGame): string {
  const { id: _id, organizationId: _o, teamId: _t, revision: _r, ...contentOnly } = game;
  void _id;
  void _o;
  void _t;
  void _r;
  return payloadHash(contentOnly);
}
