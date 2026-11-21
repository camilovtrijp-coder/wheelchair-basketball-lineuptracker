// Preact-hook rond `infrastructure/game/rotationPlanStore` (zelfde
// plaats-in-de-laag-conventie als `useGameScreen.ts`).
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { RotationPlan } from '../../domain/game/rotationPlan';
import {
  clearPlanForGame,
  readPlanForGame,
  readPreviousPlan,
  storePlanForGame,
} from '../../infrastructure/game/rotationPlanStore';

export interface RotationPlanState {
  plan: RotationPlan | null;
  /** Bewaart het schema voor deze wedstrijd (lokaal op dit apparaat) en werkt de weergave bij. */
  savePlan: (next: RotationPlan) => void;
  /** Wist het schema van deze wedstrijd van dit apparaat (gespeelde segmenten blijven ongemoeid). */
  clearPlan: () => void;
  /** Meest recente schema van een andere wedstrijd, als startpunt. */
  readPrevious: () => RotationPlan | null;
}

/** Schema van de actieve wedstrijd; wisselt mee als het wedstrijd-ID verandert. */
export function useRotationPlan(gameId: string): RotationPlanState {
  const [state, setState] = useState(() => ({ id: gameId, plan: readPlanForGame(gameId) }));
  useEffect(() => {
    if (state.id !== gameId) setState({ id: gameId, plan: readPlanForGame(gameId) });
  }, [gameId, state.id]);
  const plan = state.id === gameId ? state.plan : readPlanForGame(gameId);
  const savePlan = useCallback(
    (next: RotationPlan) => {
      storePlanForGame(gameId, next);
      setState({ id: gameId, plan: next });
    },
    [gameId],
  );
  const clearPlan = useCallback(() => {
    clearPlanForGame(gameId);
    setState({ id: gameId, plan: null });
  }, [gameId]);
  const readPrevious = useCallback(() => readPreviousPlan(gameId), [gameId]);
  return { plan, savePlan, clearPlan, readPrevious };
}
