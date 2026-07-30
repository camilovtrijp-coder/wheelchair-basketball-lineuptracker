import { render } from 'preact';
import { App } from './app/App';
import './index.css';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Root element #app niet gevonden');
}
render(<App />, root);
