// Exporteert de nog niet server-bevestigde lokale acties van één wedstrijd
// als downloadbaar .json-bestand (PR 7.3c, docs/pr-7.3-plan.md §C 7.3c werk
// 2/3). Zelfde ontwerp als `infrastructure/sync/exportPendingPayload.ts`
// (PR 5.3c-2) voor settings/roster: `buildPendingGameActionsEnvelope()` is
// puur en apart getest, `downloadPendingGameActions()` is de enige plek met
// DOM-bijwerkingen (Blob/URL/click).
//
// Geen hergebruik van settings/roster se v1-backup-envelop hier — acties zijn
// geen v1-localStorage-concept, dus een eigen, zelfbeschrijvend
// `lineup-tracker-game-actions`-formaat i.p.v. een verkeerd passend
// `data.lineup-tracker-*`-veld. `gameId`/`organizationId`/`teamId` staan er
// altijd bij zodat het fragment ondubbelzinnig bij de juiste wedstrijd/team
// hoort, ook los van de bestandsnaam.

import type { GameAction } from '../../domain/game/types';

export interface PendingGameActionsEnvelope {
  type: 'lineup-tracker-game-actions';
  version: 1;
  exportedAt: string;
  gameId: string;
  organizationId: string;
  teamId: string;
  actions: GameAction[];
}

export function buildPendingGameActionsEnvelope(
  gameId: string,
  organizationId: string,
  teamId: string,
  actions: readonly GameAction[],
  now: () => string = () => new Date().toISOString(),
): PendingGameActionsEnvelope {
  return {
    type: 'lineup-tracker-game-actions',
    version: 1,
    exportedAt: now(),
    gameId,
    organizationId,
    teamId,
    actions: [...actions],
  };
}

export function downloadPendingGameActions(
  gameId: string,
  organizationId: string,
  teamId: string,
  actions: readonly GameAction[],
): void {
  const envelope = buildPendingGameActionsEnvelope(gameId, organizationId, teamId, actions);
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `game-${gameId}-actie-nodig-${Date.now()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
