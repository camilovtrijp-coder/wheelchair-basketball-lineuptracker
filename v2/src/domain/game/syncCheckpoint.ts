/**
 * Lokaal synccheckpoint voor de cloud-actielog van een wedstrijd (PR 7.1a,
 * docs/pr-7.1-plan.md §B). Geen generieke IndexedDB-outbox: de bestaande
 * `ActiveGame.actions` (zie ./types.ts) blijft de duurzame bron voor nog te
 * synchroniseren acties. Dit checkpoint onthoudt alleen welke acties al
 * server-bevestigd zijn plus de laatst bekende parent-revisie en foutstatus
 * (ADR-002 §"Verduidelijkingen voor fase 7" punt 2). Puur domeintype, geen
 * Firestore- of localStorage-afhankelijkheid — de infrastructure-adapter
 * volgt in PR 7.1c.
 */
export interface GameSyncCheckpoint {
  gameId: string;
  organizationId: string;
  teamId: string;
  /** `GameAction.id`'s die na readback server-bevestigd zijn (PR 7.1c). */
  confirmedActionIds: string[];
  /** Laatst bekende `GameDocument.revision`, voor optimistische concurrency op snapshotpatches. */
  serverRevision: number;
  /**
   * `'actie-nodig'` spiegelt bewust dezelfde term als `domain/syncState.ts`
   * (`SyncStatus`) — een geweigerde of blijvend mislukte sync is voor de
   * gebruiker hetzelfde soort herstelbare toestand als bij settings/roster.
   */
  status: 'idle' | 'actie-nodig';
  lastError?: string;
  updatedAt: string;
  /**
   * PR 7.2a (docs/pr-7.2-plan.md §C 7.2a): aanwezig zodra deze wedstrijd
   * succesvol is afgerond naar de cloud — `CompletedGame.id` van de
   * bevestigde snapshot. Hergebruikt hetzelfde per-`gameId`-checkpoint als de
   * tracking-sync hierboven (geen apart finalize-checkpoint nodig): een
   * afgeronde `ActiveGame` wordt na afronding toch niet meer als 'tracking'
   * hervat (zie `app/App.tsx` `handleFinishGame()`), dus dit veld en
   * `confirmedActionIds`/`serverRevision` conflicteren nooit met elkaar.
   * Ontbrekend/`undefined` betekent "nog niet (succesvol) afgerond naar de
   * cloud" — niet hetzelfde als "geen wedstrijd om af te ronden".
   */
  completedGameId?: string;
}

export function createEmptyGameSyncCheckpoint(
  gameId: string,
  organizationId: string,
  teamId: string,
  now: string,
): GameSyncCheckpoint {
  return {
    gameId,
    organizationId,
    teamId,
    confirmedActionIds: [],
    serverRevision: 0,
    status: 'idle',
    updatedAt: now,
  };
}

/** `true` als deze actie volgens het checkpoint al server-bevestigd is (nooit opnieuw uploaden). */
export function isActionConfirmed(checkpoint: GameSyncCheckpoint, actionId: string): boolean {
  return checkpoint.confirmedActionIds.includes(actionId);
}

/**
 * Voegt server-bevestigde action-ID's toe zonder duplicaten (idempotent —
 * een herhaalde bevestiging van dezelfde actie verandert niets).
 */
export function withConfirmedActions(
  checkpoint: GameSyncCheckpoint,
  actionIds: readonly string[],
  now: string,
): GameSyncCheckpoint {
  const merged = new Set(checkpoint.confirmedActionIds);
  for (const id of actionIds) merged.add(id);
  return { ...checkpoint, confirmedActionIds: [...merged], updatedAt: now };
}
