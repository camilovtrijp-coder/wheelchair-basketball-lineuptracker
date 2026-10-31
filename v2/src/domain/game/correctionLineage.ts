import type { CompletedGame } from './types';

/**
 * PR 7.5c (docs/pr-7.5-plan.md §D.3/§D.4): vergelijkt de correctiegeschiedenis
 * van een lokale en een cloudkopie van DEZELFDE afgeronde wedstrijd. Puur,
 * zonder opslag of netwerk. De correctie-ID's (`corrections[].id`) zijn de
 * bron van waarheid voor "wie weet wat"; `revision` bepaalt alleen wie de
 * zichtbare winnaar is (zie `pickHigherRevision`).
 *
 * - `same`: dezelfde correcties in dezelfde volgorde (ook: beide geen).
 * - `local-ahead`: het log van de cloud is een strikt voorvoegsel van het lokale
 *   log en lokaal heeft een hogere revisie → lokale correcties moeten nog
 *   worden geüpload.
 * - `cloud-ahead`: omgekeerd → de lokale kopie kan veilig worden bijgewerkt.
 * - `diverged`: beide kanten hebben correcties die de ander niet kent (twee
 *   apparaten corrigeerden onafhankelijk), of de logs zijn anderszins niet in
 *   elkaars verlengde. Er wordt niets samengevoegd en niets overschreven.
 */
export type CorrectionLineage = 'same' | 'local-ahead' | 'cloud-ahead' | 'diverged';

/** Revisie van een wedstrijd; ontbrekend/ongeldig telt als 0 (oude data). */
export function revisionOf(game: CompletedGame): number {
  return Number.isInteger(game.revision) ? game.revision : 0;
}

function correctionIds(game: CompletedGame): string[] {
  return (game.corrections ?? []).map((c) => c.id);
}

function isPrefix(shorter: string[], longer: string[]): boolean {
  return shorter.length <= longer.length && shorter.every((id, i) => id === longer[i]);
}

export function compareCorrectionLineage(
  local: CompletedGame,
  cloud: CompletedGame,
): CorrectionLineage {
  const l = correctionIds(local);
  const c = correctionIds(cloud);
  if (l.length === c.length) return isPrefix(l, c) ? 'same' : 'diverged';
  if (l.length > c.length) {
    return isPrefix(c, l) && revisionOf(local) > revisionOf(cloud) ? 'local-ahead' : 'diverged';
  }
  return isPrefix(l, c) && revisionOf(cloud) > revisionOf(local) ? 'cloud-ahead' : 'diverged';
}

/**
 * Zichtbare winnaar bij een ID-botsing: de HOGERE `revision` wint (cloud of
 * lokaal); bij gelijke revisie de lokale kopie (huidig gedrag, inhoudelijk
 * identiek bij `same`).
 */
export function pickHigherRevision(local: CompletedGame, cloud: CompletedGame): CompletedGame {
  return revisionOf(cloud) > revisionOf(local) ? cloud : local;
}
