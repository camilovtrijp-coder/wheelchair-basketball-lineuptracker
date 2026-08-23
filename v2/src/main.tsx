import { render } from 'preact';
import { AuthGate } from './app/AuthGate';
import { readTrustedDevice } from './infrastructure/device/trustedDevice';
import { browserStorage } from './i18n/browserStorage';
import { initFirebase } from './infrastructure/firebase/firebaseClient';
import { FirebaseAuthGateway } from './infrastructure/auth/FirebaseAuthGateway';
import { pwaUpdateAdapter } from './infrastructure/pwa/PwaUpdateAdapter';
import './index.css';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Root element #app niet gevonden');
}

// Stap 5 voegt de vertrouwd-apparaatprompt toe; tot die tijd starten we
// onvertrouwd (memory-only cache), zodat er zonder expliciete toestemming
// geen Firestore-data lokaal blijft hangen.
const trustedDevice = readTrustedDevice(browserStorage) ?? false;
const { auth } = initFirebase(trustedDevice);
const authGateway = new FirebaseAuthGateway(auth);

render(<AuthGate authGateway={authGateway} />, root);

// 8.1a (docs/pr-8.1-plan.md §C 8.1a werk 2): de directe
// `navigator.serviceWorker.register()`-aanroep die hier vroeger stond, is
// overgenomen door `infrastructure/pwa/PwaUpdateAdapter` — die levert de
// update-detectie-/gecontroleerde-refresh-flow op die hier eerder volledig
// ontbrak. `main.tsx` blijft wél zelf verantwoordelijk voor het STARTEN van
// die registratie, op exact hetzelfde `window`-`load`-moment als vóór
// 8.1a: `application/pwa/usePwaUpdate.ts` mount pas binnen `App`, dat zelf
// pas ná login + org-/teamselectie rendert (zie `AuthGate` hierboven) — een
// regressie gevonden in PR #75-CI liet zien dat registratie zonder deze
// expliciete aanroep hier pas na teamselectie zou beginnen i.p.v. bij
// paginaload, wat bestaande offline-gereedheidstests brak
// (`tests/e2e-auth/completed-history-offline-cache.spec.ts` e.a.). De
// singleton-adapter is dezelfde instantie die `usePwaUpdate()` later
// abonneert; `.init()` is idempotent, dus een eventuele latere aanroep
// vanuit die hook is een veilige no-op.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    pwaUpdateAdapter.init();
  });
}
