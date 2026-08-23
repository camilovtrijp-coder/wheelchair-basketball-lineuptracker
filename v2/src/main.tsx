import { render } from 'preact';
import { AuthGate } from './app/AuthGate';
import { readTrustedDevice } from './infrastructure/device/trustedDevice';
import { browserStorage } from './i18n/browserStorage';
import { initFirebase } from './infrastructure/firebase/firebaseClient';
import { FirebaseAuthGateway } from './infrastructure/auth/FirebaseAuthGateway';
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
// `navigator.serviceWorker.register()`-aanroep die hier stond, is
// overgenomen door `infrastructure/pwa/PwaUpdateAdapter`, aangestuurd via
// `application/pwa/usePwaUpdate.ts` binnen `App` (ná de eerste mount, nooit
// vanuit een adapter-constructor — zie die klasse se eigen docstring voor
// waarom dat vastligt, externe review PR #74). Dat levert bovendien de
// update-detectie-/gecontroleerde-refresh-flow op die hier vroeger volledig
// ontbrak.
