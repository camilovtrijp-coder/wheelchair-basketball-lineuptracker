/// <reference lib="webworker" />

import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// 8.1a (docs/pr-8.1-plan.md §C 8.1a werk 1): bericht-gestuurd
// skipWaiting-contract i.p.v. het vroegere ongeconditioneerde
// `self.skipWaiting()`. Een nieuwe worker blijft standaard in
// `waiting`-status zolang er al een oudere, actieve worker een tab bedient
// (standaard Service-Worker-gedrag) en activeert alleen na een expliciet
// `{ type: 'SKIP_WAITING' }`-bericht vanuit de pagina — gestuurd door
// `infrastructure/pwa/PwaUpdateAdapter.confirmUpdate()`, zelf pas aangeroepen
// na expliciete gebruikersbevestiging (of automatisch buiten een actieve
// `tracking`-wedstrijd, zie die adapter/`application/pwa/usePwaUpdate.ts`).
// Nooit meer stilzwijgend.
//
// Een EERSTE installatie (nog geen bestaande controller/oudere worker)
// activeert nog steeds vanzelf zodra `install()` klaar is — dat is
// standaard Service-Worker-gedrag zonder concurrerende oude worker, daar is
// geen `skipWaiting()` voor nodig — en blijft dus ongewijzigd t.o.v. vóór
// 8.1a (`v2/tests/e2e/pwa.spec.ts`'s "wordt actief en kan app-shell offline
// serveren"-scenario blijft hierdoor groen).
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

self.addEventListener('activate', () => {
  void self.clients.claim();
});

precacheAndRoute(self.__WB_MANIFEST);

const navigationHandler = createHandlerBoundToURL('/index.html');
registerRoute(new NavigationRoute(navigationHandler));
