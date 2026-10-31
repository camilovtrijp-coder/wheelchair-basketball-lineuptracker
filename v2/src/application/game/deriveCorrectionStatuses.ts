// PR 7.6a (docs/pr-7.6-plan.md §D.2): correctiestatus per gecorrigeerde
// wedstrijd, afgeleid uit de optionele poortmethode
// `CompletedGameRepository.correctionSyncStatus`. Leest alleen lokaal geheugen
// en lokale opslag van de composite: geen Firestore-lezing.

import type { CompletedGame } from '../../domain/game/types';
import type { CompletedGameRepository, CorrectionSyncStatus } from './CompletedGameRepository';

export type CorrectionStatusMap = Record<string, CorrectionSyncStatus | null>;

const EMPTY: CorrectionStatusMap = {};

/** Alleen wedstrijden met een correctielog krijgen een status; de rest blijft weg. */
export function deriveCorrectionStatuses(
  repo: Pick<CompletedGameRepository, 'correctionSyncStatus'>,
  games: readonly CompletedGame[],
): CorrectionStatusMap {
  const read = repo.correctionSyncStatus;
  if (typeof read !== 'function') return EMPTY;
  const out: CorrectionStatusMap = {};
  for (const game of games) {
    if ((game.corrections?.length ?? 0) === 0) continue;
    const status = read.call(repo, game.id);
    if (status !== null) out[game.id] = status;
  }
  return out;
}

/** Zelfde inhoud = zelfde referentie, zodat een notificatie zonder statuswijziging niet herrendert. */
export function sameCorrectionStatuses(a: CorrectionStatusMap, b: CorrectionStatusMap): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}
