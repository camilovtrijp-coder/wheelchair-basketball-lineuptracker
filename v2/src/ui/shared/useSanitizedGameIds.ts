import { useEffect, useMemo } from 'preact/hooks';
import { sanitizeGameSelection } from '../../domain/stats/sanitizeGameSelection';
import type { AnalysisGame } from '../../domain/stats/types';

/**
 * Gedeelde opschoning van het wedstrijdfilter voor Stats en Trends: geeft de
 * opgeschoonde selectie terug (zie `sanitizeGameSelection`) en schrijft die
 * terug naar de gedeelde state (`app/App.tsx`) zodra ze afwijkt. Zo toont ook
 * de chip "Wedstrijden (n)" het opgeschoonde aantal.
 *
 * Alleen bij een geslaagde historieleesactie (`canSanitize`): bij een leesfout
 * zegt "geen wedstrijd gevonden" niets over de selectie.
 */
export function useSanitizedGameIds(
  gameIds: Set<string> | null,
  games: readonly AnalysisGame[],
  canSanitize: boolean,
  onGameIdsChange: (next: Set<string> | null) => void,
): Set<string> | null {
  const effective = useMemo(
    () => (canSanitize ? sanitizeGameSelection(gameIds, games) : gameIds),
    [canSanitize, gameIds, games],
  );
  useEffect(() => {
    if (effective !== gameIds) onGameIdsChange(effective);
  }, [effective, gameIds, onGameIdsChange]);
  return effective;
}
