import { render } from 'preact';
import { App } from './app/App';
import './index.css';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Root element #app niet gevonden');
}
render(<App />, root);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', type: 'module' }).catch((err) => {
      console.error('Service worker registratie mislukt', err);
    });
  });
}
