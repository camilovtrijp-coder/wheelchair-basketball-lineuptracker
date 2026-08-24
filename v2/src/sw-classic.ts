// 8.1c (docs/pr-8.1-plan.md §C 8.1c werk 1): apart entrypoint voor de
// classic (niet-module) service-worker-bundel. Bevat zelf géén eigen
// logica — het hergebruikt letterlijk dezelfde `sw.ts`-broninhoud via een
// gewone ES-module-`import`. Dat is bewust veilig: dit bestand wordt door
// Vite/Rollup gecompileerd met `rollupFormat: 'iife'` (zie
// `vite.config.ts`, `SW_BUILD_TARGET=classic`), en Rollup bundelt zo'n
// `import` altijd volledig in tot één zelfstandige IIFE zonder enige
// top-level `import`-statement in de OUTPUT — precies het onderscheid dat
// telt voor Safari/iPadOS-versies zonder module-service-worker-onder-
// steuning (die alleen `type: 'classic'`-registratie begrijpen). De reden
// om hiervoor een apart bronbestand te hebben i.p.v. `sw.ts` zelf tweemaal
// met een andere `rollupFormat` te bouwen: vite-plugin-pwa leidt de naam
// van het uitvoerbestand af van de naam van dit bronbestand (`sw.ts` →
// `sw.js`), dus een tweede build-target met dezelfde bronnaam zou het
// bestaande `sw.js` overschrijven i.p.v. een apart `sw-classic.js` naast
// elkaar te laten bestaan.
import './sw';
