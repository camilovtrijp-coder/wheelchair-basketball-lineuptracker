import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// 8.1c (docs/pr-8.1-plan.md §C 8.1c werk 1): naast de standaard module-
// service-worker-bundel (`sw.js`, `type: 'module'`-registratie) bouwt een
// TWEEDE, aparte `vite build`-aanroep — gestuurd via de env-variabele
// `SW_BUILD_TARGET=classic`, zie `package.json`'s `build`-script — dezelfde
// `sw.ts`-broninhoud (via het aparte `src/sw-classic.ts`-entrypoint, zie
// dat bestand se eigen commentaar) ook als classic (IIFE) bundel
// (`sw-classic.js`), voor Safari/iPadOS-versies zonder module-service-
// worker-ondersteuning (§B punt 6). `build.write: false` in die tweede
// aanroep voorkomt dat de al door de eerste aanroep geschreven app-assets
// (JS/CSS-chunks, `index.html`) opnieuw naar disk worden geschreven — de
// eerste aanroep se `dist/`-output blijft als bron voor het precache-
// manifest dienen (vite-plugin-pwa's `injectManifest` glob't rechtstreeks
// van disk, niet uit het in-memory bundle van déze tweede aanroep); alleen
// vite-plugin-pwa's eigen, aparte interne build van de service-worker zelf
// (die altijd naar disk schrijft, ongeacht `build.write`) levert
// `sw-classic.js` op.
const isClassicSwBuild = process.env.SW_BUILD_TARGET === 'classic';

export default defineConfig({
  build: isClassicSwBuild ? { write: false } : undefined,
  plugins: [
    preact(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: isClassicSwBuild ? 'sw-classic.ts' : 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
        // Elke build negeert BEIDE SW-bestandsnamen (niet alleen haar eigen
        // `swSrc`/`swDest`, die workbox-build al automatisch zelf uitsluit):
        // een tweede, leftover build (bijv. een eerdere lokale `sw-
        // classic.js` die nog op disk staat vóórdat de module-bundel
        // opnieuw gebouwd wordt) mag nooit als gewoon te precachen asset in
        // de ANDERE SW-bundel belanden.
        globIgnores: ['sw.js', 'sw-classic.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        rollupFormat: isClassicSwBuild ? 'iife' : 'es',
      },
      devOptions: {
        enabled: false,
        type: 'module',
      },
    }),
  ],
});
