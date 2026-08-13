import { deriveGameHistory } from './tracking';
import type { ActiveGame, CompletedGame } from './types';

function newId(): string {
  return crypto.randomUUID();
}

/** Instellingen die op het afrondmoment bevroren worden op `CompletedGame` — een
 * smalle projectie van `Settings`, zodat dit domein niet van `domain/settings`
 * afhangt (zelfde reden als `ClassificationConfig` in `tracking.ts`). */
export interface FinishGameSettings {
  quarterCount: number;
  periodLabel: string;
  useClassLimit: boolean;
}

/** v1: de guard binnen `finishGame()` — alleen afronden met minstens één
 * afgeleid segment. */
export function canFinishGame(game: ActiveGame): boolean {
  return deriveGameHistory(game).segments.length > 0;
}

/**
 * v1: `finishGame()`. Bevriest de uit de actielog afgeleide score/segmenten
 * tot een onveranderlijke `CompletedGame`-snapshot. Geeft `null` terug
 * wanneer nog niet afgerond mag worden (zie `canFinishGame`) — de aanroeper
 * beslist zelf wat daarmee te doen (v1: de knop is dan disabled/no-op).
 */
export function finishGame(game: ActiveGame, settings: FinishGameSettings): CompletedGame | null {
  if (!canFinishGame(game)) return null;
  const history = deriveGameHistory(game);
  return {
    id: newId(),
    organizationId: game.organizationId,
    teamId: game.teamId,
    sourceGameId: game.id,
    opponent: game.opponent,
    competition: game.competition,
    date: new Date().toISOString(),
    players: game.players.map((p) => ({ ...p })),
    segments: history.segments,
    scoreFor: history.scoreFor,
    scoreAgainst: history.scoreAgainst,
    quarterCount: settings.quarterCount,
    periodLabel: settings.periodLabel,
    useClassLimit: settings.useClassLimit,
  };
}
