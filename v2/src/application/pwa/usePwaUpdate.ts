// 8.1a (docs/pr-8.1-plan.md §C 8.1a werk 2/3): Preact-hook die
// `infrastructure/pwa/PwaUpdateAdapter` aan `App.tsx`/de nieuwe
// PWA-update-UI koppelt — zelfde plaats-in-de-laag-conventie als
// `application/sync/useSyncStatus.ts` (een Preact-hook in de
// applicatielaag, rond een infrastructuuradapter).
//
// De adapter wordt hier één keer per hook-instance aangemaakt
// (`useRef`) — de constructor raakt `navigator.serviceWorker` NIET aan
// (zie die klasse se eigen docstring), dus dit is veilig ook in
// jsdom-componenttests zonder `serviceWorker`-global. `init()` wordt pas in
// een mount-effect aangeroepen, en alleen als (a) de build productie is
// (`import.meta.env.PROD` — zelfde gate als de vroegere `main.tsx`-
// registratie, voorkomt een 404 op een niet-gebouwde `/sw.js` tijdens
// `vite dev`) en (b) de browser servicewerkers ondersteunt.
import { useEffect, useRef, useState } from 'preact/hooks';
import { PwaUpdateAdapter, type PwaUpdateStatus } from '../../infrastructure/pwa/PwaUpdateAdapter';

export interface PwaUpdateHookState {
  status: PwaUpdateStatus;
  /** Werk 3/4: bevestigt de update — verstuurt SKIP_WAITING en herlaadt pas
   * ná de daaropvolgende `controllerchange`. */
  confirmUpdate: () => void;
  /** Herstelpad voor een mislukte registratie/blijvend uitblijvende
   * `controllerchange` (`status === 'error'`). */
  retry: () => void;
  dismissError: () => void;
}

// Werk 3 (§C 8.1a, §B punt 3): buiten een actieve `tracking`-wedstrijd mag
// de banner zichzelf niet-opdringerig automatisch bevestigen na een korte
// time-out. Vast, niet configureerbaar vanuit de UI — bewust kort genoeg om
// niet als "onzichtbaar geactiveerd" te voelen (de banner blijft die hele
// tijd zichtbaar, zie `ui/pwa/PwaUpdateBanner.tsx`), lang genoeg om de
// gebruiker de kans te geven zelf te bevestigen of de pagina te verlaten.
export const AUTO_CONFIRM_DELAY_MS = 8_000;

/**
 * `locked`: dezelfde afleiding als `App.tsx`'s bestaande
 * `game?.phase === 'tracking' || cloudClaim.kind === 'confirmed'` — zolang
 * dat waar is, blijft bevestigen altijd handmatig (stopregel §D: "geen
 * stille SW-overname tijdens een actieve tracking-wedstrijd").
 */
export function usePwaUpdate(
  locked: boolean,
  autoConfirmDelayMs: number = AUTO_CONFIRM_DELAY_MS,
): PwaUpdateHookState {
  const adapterRef = useRef<PwaUpdateAdapter | null>(null);
  if (adapterRef.current === null) {
    adapterRef.current = new PwaUpdateAdapter();
  }
  const adapter = adapterRef.current;

  const [status, setStatus] = useState<PwaUpdateStatus>(() => adapter.getState().status);

  useEffect(() => adapter.subscribe((state) => setStatus(state.status)), [adapter]);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    adapter.init();
  }, [adapter]);

  // Werk 3: niet-opdringerige auto-bevestiging buiten een actieve
  // tracking-wedstrijd. Herevalueert bij elke `locked`-wijziging — wordt
  // het apparaat tijdens de wachttijd alsnog vergrendeld (bijv. de
  // gebruiker start de wedstrijd terwijl de banner al zichtbaar was), dan
  // annuleert de cleanup de timer en blijft bevestigen handmatig.
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  useEffect(() => {
    if (status !== 'update-available' || locked) return undefined;
    const timer = setTimeout(() => {
      if (!lockedRef.current) adapter.confirmUpdate();
    }, autoConfirmDelayMs);
    return () => clearTimeout(timer);
  }, [status, locked, adapter, autoConfirmDelayMs]);

  return {
    status,
    confirmUpdate: () => adapter.confirmUpdate(),
    retry: () => adapter.retry(),
    dismissError: () => adapter.dismissError(),
  };
}
