// 8.1b (docs/pr-8.1-plan.md §C 8.1b werk 1, "Hoe je de PWA-gereedheid
// bepaalt"): Preact-hook die de bestaande `pwaUpdateAdapter`-singleton
// (8.1a) hergebruikt om de PWA-/offline-gereedheidsstatus af te leiden —
// GEEN tweede, parallelle service-worker-observatiemechanisme. Zelfde
// laagconventie als `usePwaUpdate.ts`: deze hook verzamelt de
// browser-/adaptersnapshot (`'serviceWorker' in navigator`, de gedeelde
// adapterstatus) en delegeert de daadwerkelijke afleiding aan de pure
// `domain/pwa/pwaReadiness.ts`-functie — `ui/`-componenten praten nooit
// rechtstreeks met de adapter of `navigator`.
import { useEffect, useState } from 'preact/hooks';
import { pwaUpdateAdapter } from '../../infrastructure/pwa/PwaUpdateAdapter';
import { derivePwaReadinessStatus, type PwaReadinessStatus } from '../../domain/pwa/pwaReadiness';

function detectSwSupport(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/**
 * Geeft de actuele `PwaReadinessStatus` terug, reactief bijgewerkt zodra de
 * gedeelde `pwaUpdateAdapter` van status verandert. Roept `init()` NIET zelf
 * aan — die verantwoordelijkheid ligt al bij `main.tsx` (op `window load`)
 * en `usePwaUpdate()` (idempotente fallback), zie die bestanden se eigen
 * commentaar voor waarom dat cruciaal is voor de bestaande
 * offline-gereedheidstests (`tests/e2e-auth/completed-history-offline-
 * cache.spec.ts` e.a.). Deze hook abonneert alleen.
 */
export function usePwaReadiness(): PwaReadinessStatus {
  const [state, setState] = useState(() => pwaUpdateAdapter.getState());

  useEffect(() => pwaUpdateAdapter.subscribe(setState), []);

  return derivePwaReadinessStatus({
    swSupported: detectSwSupport(),
    adapterStatus: state.status,
    registered: state.registered,
  });
}
