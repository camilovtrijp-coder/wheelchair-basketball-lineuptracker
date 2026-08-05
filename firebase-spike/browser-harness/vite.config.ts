import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  build: { outDir: '../dist-harness' },
  server: { port: 5183, strictPort: true },
  preview: { port: 5183, strictPort: true },
  // Geen PWA-plugin — dit is een testpagina, niet de productie-app.
});
