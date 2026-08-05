import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  build: { outDir: '../dist-harness' },
  // Match Playwright's baseURL expliciet; op Linux kan `localhost` naar alleen IPv6 resolven.
  server: { host: '127.0.0.1', port: 5183, strictPort: true },
  preview: { host: '127.0.0.1', port: 5183, strictPort: true },
  // Geen PWA-plugin — dit is een testpagina, niet de productie-app.
});
