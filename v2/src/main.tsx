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

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', type: 'module' }).catch((err) => {
      console.error('Service worker registratie mislukt', err);
    });
  });
}
