/**
 * Keuze van het wedstrijdscherm (Klassiek of Compact; bouwplan besluit 7).
 * Uitsluitend een voorkeur van dit apparaat, onder één eigen key (nieuwe key;
 * geen bestaande key of gebruikersdata geraakt). Nooit onderdeel van
 * `ActiveGame`, het datacontract, CSV of cloudsync. Patroon van
 * `infrastructure/theme/theme.ts`: ontbrekende, ongeldige of onbeschikbare
 * storage valt stil terug op Klassiek.
 *
 * Daarnaast een klein in-memory register van "wisselblokkades": een scherm met
 * een onbevestigde wissel of open venster meldt dat hier, zodat de schakelaar
 * in het apparaatmenu niet midden in een bewerking van scherm wisselt. Dit is
 * puur UI-toestand en wordt nergens opgeslagen.
 */
export type GameScreen = 'classic' | 'compact';

export const GAME_SCREEN_STORAGE_KEY = 'lineup-tracker-v2-game-screen';

export function parseGameScreen(raw: string | null | undefined): GameScreen {
  return raw === 'compact' ? 'compact' : 'classic';
}

export function readGameScreen(): GameScreen {
  try {
    return parseGameScreen(window.localStorage.getItem(GAME_SCREEN_STORAGE_KEY));
  } catch {
    return 'classic';
  }
}

type PreferenceListener = (screen: GameScreen) => void;
const preferenceListeners = new Set<PreferenceListener>();

export function subscribeGameScreen(listener: PreferenceListener): () => void {
  preferenceListeners.add(listener);
  return () => {
    preferenceListeners.delete(listener);
  };
}

/** Bewaart de keuze en meldt ze aan luisteraars (ook als opslaan faalt: dan geldt ze voor deze sessie). */
export function storeGameScreen(screen: GameScreen): void {
  try {
    window.localStorage.setItem(GAME_SCREEN_STORAGE_KEY, screen);
  } catch {
    // Onbeschikbare storage: de keuze geldt dan alleen voor deze sessie.
  }
  preferenceListeners.forEach((listener) => listener(screen));
}

// ---------- wisselblokkades ----------

/** `swap`: onbevestigde wissel (ook een opgeslagen `pendingSwapLineup`); `dialog`: open venster/bewerking. */
export type GameScreenLockKind = 'swap' | 'dialog';

export interface GameScreenLocks {
  swap: boolean;
  dialog: boolean;
}

const locks = new Map<string, GameScreenLockKind>();
const lockListeners = new Set<() => void>();

export function setGameScreenLock(owner: string, kind: GameScreenLockKind | null): void {
  const before = locks.get(owner) ?? null;
  if (before === kind) return;
  if (kind == null) locks.delete(owner);
  else locks.set(owner, kind);
  lockListeners.forEach((listener) => listener());
}

export function getGameScreenLocks(): GameScreenLocks {
  const kinds = new Set(locks.values());
  return { swap: kinds.has('swap'), dialog: kinds.has('dialog') };
}

export function subscribeGameScreenLocks(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => {
    lockListeners.delete(listener);
  };
}
