// Preact-hooks rond `infrastructure/game/gameScreenPreference` (zelfde
// plaats-in-de-laag-conventie als `application/a11y/useFocusTrap.ts`).
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  getGameScreenLocks,
  readGameScreen,
  setGameScreenLock,
  subscribeGameScreen,
  subscribeGameScreenLocks,
  type GameScreen,
  type GameScreenLockKind,
  type GameScreenLocks,
} from '../../infrastructure/game/gameScreenPreference';

/** Huidige voorkeur; werkt bij als de schakelaar in het apparaatmenu wijzigt. */
export function useGameScreenPreference(): GameScreen {
  const [screen, setScreen] = useState<GameScreen>(() => readGameScreen());
  useEffect(() => subscribeGameScreen(setScreen), []);
  return screen;
}

/** Actuele wisselblokkades (voor het apparaatmenu). */
export function useGameScreenLocks(): GameScreenLocks {
  const [state, setState] = useState<GameScreenLocks>(() => getGameScreenLocks());
  useEffect(() => {
    setState(getGameScreenLocks());
    return subscribeGameScreenLocks(() => setState(getGameScreenLocks()));
  }, []);
  return state;
}

let nextOwner = 0;

/** Meldt zolang `kind` niet null is dat dit scherm niet veilig vervangen kan worden. */
export function useGameScreenLock(kind: GameScreenLockKind | null): void {
  const ownerRef = useRef<string>('');
  if (ownerRef.current === '') ownerRef.current = `game-screen-${nextOwner++}`;
  useEffect(() => {
    setGameScreenLock(ownerRef.current, kind);
  }, [kind]);
  useEffect(() => {
    const owner = ownerRef.current;
    return () => setGameScreenLock(owner, null);
  }, []);
}
