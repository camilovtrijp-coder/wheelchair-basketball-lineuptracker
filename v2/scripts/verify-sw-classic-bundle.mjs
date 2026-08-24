#!/usr/bin/env node
// 8.1c (docs/pr-8.1-plan.md §C 8.1c, acceptatie): build-outputcheck die
// bewijst dat de classic (niet-module) service-worker-bundel géén enkel
// top-level ES-module-`import`-statement bevat. Dit is precies wat een
// Safari/iPadOS-versie zonder module-service-worker-ondersteuning nodig
// heeft (`type: 'classic'`-registratie negeert `import`-syntax volledig —
// zo'n statement zou daar een silent-fail geven, geen throw). Draait als
// laatste stap van `npm run build` (ná beide `vite build`-aanroepen, zie
// `package.json`) zodat een toekomstige, stille regressie — bijv. een
// latere Workbox-versie die ergens intern `import`-syntax introduceert die
// de huidige `injectManifest`-opzet vandaag niet gebruikt — de build laat
// falen i.p.v. onopgemerkt te blijven tot een echt Safari/iPadOS-apparaat
// het ontdekt.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const distPath = resolve(process.cwd(), 'dist/sw-classic.js');

let content;
try {
  content = readFileSync(distPath, 'utf8');
} catch (err) {
  console.error(
    `verify-sw-classic-bundle: kon ${distPath} niet lezen — is 'SW_BUILD_TARGET=classic vite build' al gelopen? (${err.message})`,
  );
  process.exit(1);
}

const importLines = content
  .split('\n')
  .map((line, index) => ({ line, number: index + 1 }))
  .filter(({ line }) => /^import\s/.test(line));

if (importLines.length > 0) {
  console.error(
    'verify-sw-classic-bundle: dist/sw-classic.js bevat top-level ES-module-import-statement(en):',
  );
  for (const { line, number } of importLines) {
    console.error(`  regel ${number}: ${line}`);
  }
  console.error(
    'Een classic (type: "classic") service-worker-registratie negeert import-syntax stilzwijgend i.p.v. te falen — dit moet vóór een Safari/iPadOS-regressie worden opgevangen.',
  );
  process.exit(1);
}

console.log(
  'verify-sw-classic-bundle: OK — dist/sw-classic.js bevat geen top-level ES-module-import-statements.',
);
