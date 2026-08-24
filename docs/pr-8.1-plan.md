# Voorbereidingsplan PR 8.1 — PWA-updates en herstel

Status: goedgekeurde bouwrichting; implementatie nog niet gestart. Dit plan
splitst roadmap-PR 8.1 in drie afzonderlijk reviewbare sub-PR's en legt de
Safari/iPadOS-module-SW-beslissing vast als expliciete, echte-apparaat-
afhankelijke poort binnen 8.1c.

## A. Doel

Fase 7 heeft het clouddatamodel, single-writer-protocol en de bestaande-
gebruikersmigratie gebouwd; PR 8.1 is de eerste PR van fase 8 en de eerste
échte hardeningsstap richting productiecutover (`docs/IMPLEMENTATION_PLAN.md`
§13, "Fase 8 — Hardening, acceptatie en cutover"). Waar fase 7 vooral tegen de
Firebase Emulator Suite is bewezen, moet 8.1 aantonen dat de app een
_courtside installatie_ overleeft: eerste installatie, offline reload en een
app-shellupdate tijdens gebruik, zonder dat een scorer midden in een
wedstrijd met een kapotte of half-bijgewerkte app komt te zitten.

Dit is geen nieuwe PWA-architectuur. ADR-000 (§"PWA-strategie") heeft al
`vite-plugin-pwa` in `injectManifest`-modus vastgelegd, met een letterlijk
behouden, doelbewust simpele cache-first `install`/`activate`/`fetch`-logica.
`v2/src/sw.ts` en de registratie in `v2/src/main.tsx` bestaan al en de
bestaande e2e-suite (`v2/tests/e2e/pwa.spec.ts`) bewijst drie dingen die al
werken en die 8.1 niet opnieuw hoeft te bouwen:

1. het manifest is bereikbaar en geldig (`/manifest.webmanifest`, naam,
   `start_url`, `display`, iconen);
2. de pagina linkt manifest, `theme-color` en `apple-touch-icon` correct;
3. de service worker wordt actief en kan de app-shell offline serveren na een
   reload.

Wat expliciet ONTBREEKT — en wat 8.1 dus daadwerkelijk toevoegt — is:

- iedere zichtbare of gecontroleerde vorm van "er is een nieuwe versie";
- een pre-game check die _PWA-/offline-assetgereedheid_ bewijst, los van de
  bestaande roster- en cloudclaim-gates;
- een vastgelegd antwoord op de Safari/iPadOS-`type: 'module'`-servicewor-
  ker-vraag die PR 3.2a al bewust naar hier heeft doorgeschoven (zie
  `docs/IMPLEMENTATION_PLAN.md` §17-statustabel, rij "PR 3.2a").

## B. Vastgelegde bouwkeuzes

1. **Huidig gedrag is stilzwijgend, niet gecontroleerd — dat is het eigenlijke
   probleem.** `v2/vite.config.ts` gebruikt `registerType: 'autoUpdate'` en
   `v2/src/sw.ts` roept ongeconditioneerd `self.skipWaiting()` aan en claimt
   clients direct op `activate`:

   ```ts
   self.skipWaiting();
   self.addEventListener("activate", () => {
     void self.clients.claim();
   });
   ```

   Dat betekent: een nieuwe service worker neemt een open tab over zodra hij
   geïnstalleerd is, zonder dat de gebruiker het ziet en zonder reload. Voor
   een statische, read-only pagina is dat onschadelijk; voor deze app, waar
   een open tab een lopende `phase === 'tracking'`-wedstrijd in-memory state
   kan dragen (zie `v2/src/app/App.tsx`, de `locked`-afleiding rond
   `game?.phase === 'tracking' || cloudClaim.kind === 'confirmed'`), is dat
   een risico: een nieuw geactiveerde SW purget de oude precache-entries
   (Workbox's `precacheAndRoute`-opschoning), waardoor een later door de
   draaiende pagina gedane lazy `import()` van een nog-niet-geladen, oud-
   gehasht chunk kan mislukken — precies de "mix van oude HTML en nieuwe
   gehashte assets" die de roadmap-bullet noemt. 8.1a vervangt de
   ongeconditioneerde auto-claim door een expliciet
   update-beschikbaar/gecontroleerde-refresh-contract (zie 8.1a hieronder).

2. **Geen mix van oude HTML en nieuwe gehashte assets.** Een nieuwe SW mag
   pas `skipWaiting`/`clients.claim()` uitvoeren na een expliciete
   gebruikersbevestiging (of automatisch alleen wanneer er zeker géén
   actieve, ongesynchroniseerde `tracking`-wedstrijd op dit apparaat draait).
   Tot die bevestiging blijft de huidige pagina volledig op haar eigen,
   consistente asset-set draaien; er wordt nooit main-thread-code van build A
   samen met een precache van build B uitgevoerd.
3. **Zichtbare updatebeschikbaarheid en gecontroleerde refresh.** Er komt een
   klein, taalgevoelig (`STRINGS`/i18n-conform) UI-element dat verschijnt
   zodra `registration.waiting` gezet is (via de standaard
   `updatefound`/`statechange`-cyclus op de registratie die `main.tsx` al
   aanmaakt), met een expliciete "nu bijwerken"-actie die `postMessage` naar
   de wachtende worker stuurt en pas ná diens `controllerchange` herlaadt.
   Buiten een actieve `tracking`-wedstrijd mag dit element ook een niet-
   opdringerige automatische variant tonen; tijdens `tracking` blijft het
   zichtbaar maar wordt de refresh nooit geforceerd (zie stopregels).
4. **Pre-game offline-readinesscheck is een nieuwe, vierde gate — niet een
   uitbreiding van de bestaande.** `gameStartBlockReason()`
   (`v2/src/domain/game/writerClaim.ts`) combineert vandaag alleen twee
   dingen: de roster-voorwaarden (`startBlockReason()` uit `setup.ts`) en de
   cloudclaimstatus (`CloudClaimStatus`, `'pending'`/`'blocked'`). Er is geen
   enkel bestaand signaal dat bewijst dat de app-shell zelf offline-klaar is
   — dat de actieve SW-registratie `active` is, de huidige build volledig
   geprecached is, en er geen wachtende maar niet-geactiveerde update tussen
   twee inconsistente asset-sets in hangt. 8.1b voegt een derde
   `GameStartBlockReason`-variant toe (`kind: 'pwa-readiness'`) die dat apart
   bewijst, met roster eerst, dan cloudclaim, dan PWA-gereedheid — dezelfde
   "eerst het goedkoopste/meest zinvolle signaal"-volgorde als de bestaande
   functie al hanteert.
5. **Herstelbare technische/syncfouten zonder wedstrijdverlies** bouwt voort
   op het bestaande syncstatuscontract (`SyncStatus` uit
   `v2/src/domain/syncState.ts`, hergebruikt door `GameSyncCoordinator`'s
   `gameSyncStatus`/diagnosedescriptor-functies, zie
   `v2/src/application/game/GameSyncCoordinator.ts`). PWA-gerelateerde fouten
   (SW-registratie mislukt, update-download mislukt, `controllerchange`
   blijft uit) worden als een nieuwe, herkenbare categorie in datzelfde
   diagnosecontract gerapporteerd — nooit als een aparte, ongerelateerde
   foutmelding die de bestaande "Actie nodig"-afhandeling omzeilt. De lokale
   actielog (fundament van PR 7.1c) blijft de bron van waarheid; een PWA-fout
   mag nooit een reden zijn om lokale acties te verwijderen of een wedstrijd
   als afgerond te markeren.
6. **Safari/iPadOS + `type: 'module'`-service-worker — vastgelegde
   beslissing en fallback.** `v2/src/main.tsx` registreert vandaag expliciet
   `navigator.serviceWorker.register('/sw.js', { scope: '/', type: 'module'
})`. Module-service-workers zijn een relatief jonge WebKit-toevoeging:
   Safari kreeg module-SW-ondersteuning pas vanaf Safari 15.4/iPadOS 15.4
   (voorjaar 2022) achter dezelfde ES-module-machinery als reguliere
   `<script type="module">`; oudere Safari/iPadOS-versies registreren de SW
   domweg niet — `register()` geeft geen duidelijke throw op alle
   faalpaden, dus het praktische symptoom is een SW die nooit `active` wordt
   in plaats van een zichtbare foutmelding, waardoor offline-gebruik en de
   nieuwe pre-game-readinesscheck (punt 4) stil blijven falen. Omdat dit team
   courtside met een niet-gecontroleerde mix aan apparaten werkt (inclusief
   oudere iPads voor scorebord/tweede-apparaat-gebruik, zie PR 7.3b/7.3c),
   mag dit niet worden aangenomen — het moet op een echt apparaat worden
   geverifieerd.

   **Vastgelegde keuze nu:** een classic (niet-module) SW-bundel is als
   fallback-doel geschikter dan "alleen precache" of "detectie + platte
   melding zonder offline-functionaliteit", omdat Workbox's
   `injectManifest`-modus zelf geen ES-module-syntax vereist — `esbuild`/Vite
   kan `sw.ts` ook naar een classic (IIFE) bundel compileren
   (`type: 'classic'`-registratie, geen `importScripts`-conflict te
   verwachten omdat de huidige `sw.ts` alleen `workbox-precaching`/
   `workbox-routing`-imports gebruikt, geen dynamische `import()` binnen de
   worker zelf). De praktische invulling (featuredetectie op
   `'serviceWorker' in navigator` + een korte runtime-check die op échte
   Safari/iPadOS al dan niet `active` wordt, vs. een build-time
   user-agent-sniff, wat fragieler is) wordt in 8.1c op een echt apparaat
   bepaald — dit is een **decision point met een echte-apparaat-gate**, geen
   voldongen feit. Zolang die verificatie niet is gedaan telt "PWA werkt op
   Safari/iPadOS" niet als bewezen (zelfde erkenning als 7.3c/7.4c al voor
   hun eigen echte-apparaat-restpunten hanteren).

## C. Sub-PR's

### 8.1a — update-detectie, gecontroleerde refresh en asset-consistentie

Werk:

1. Vervang de ongeconditioneerde `self.skipWaiting()`/`clients.claim()` in
   `v2/src/sw.ts` door een bericht-gestuurd contract: de worker wacht default
   in `waiting`-status; hij `skipWaiting`t alleen na een expliciet
   `postMessage`-commando vanuit de pagina (of automatisch wanneer de pagina
   bij het opstarten al weet dat er geen actieve `tracking`-wedstrijd is —
   zie werk 3).
2. Voeg een klein `infrastructure/pwa/`-adapter toe die de registratie uit
   `main.tsx` overneemt, luistert op `updatefound`/`installing`-
   `statechange`, en een reactieve "update beschikbaar"-status blootlegt
   zonder dat UI-componenten rechtstreeks met `navigator.serviceWorker`
   praten (zelfde laagregel als ADR-000: `ui/` praat via `application/`,
   geen rechtstreekse browser-API's in componenten). De adapter roept
   `navigator.serviceWorker` NOOIT rechtstreeks aan in z'n constructor —
   registratie/luisteraars starten pas via een expliciete `init()`-aanroep
   (of na eerste mount), zodat bestaande App-componenttests (die `jsdom`
   gebruiken en zich vandaag niets van `serviceWorker` aantrekken, bv.
   `AppGameCloudViewer.spec.tsx`) niet ongemerkt breken zodra deze adapter
   er komt (externe review PR #74).
3. Voeg een klein, i18n-conform UI-element toe (banner/toast) dat verschijnt
   zodra `registration.waiting` gezet is, met een "nu bijwerken"-actie.
   Buiten een `tracking`-wedstrijd mag deze zich ook automatisch na een korte
   time-out zelf bevestigen; zodra er een actieve `tracking`-wedstrijd op dit
   apparaat is (dezelfde `locked`-afleiding als `App.tsx` al gebruikt) blijft
   de actie altijd handmatig. Deze updatebanner is een EIGEN, aparte UI-
   locatie — niet via `ActionNeededPanel` (dat blijft gereserveerd voor
   sync-acties op wedstrijd-/back-updata, zie 7.1c/7.2c/7.4b). Een mislukte
   SW-install of een blijvend uitblijvende `controllerchange` na een
   bevestigde `skipWaiting`-aanroep is wél een herstelbaar foutscenario en
   loopt via `ActionNeededPanel` (of een equivalent herstelpad binnen
   hetzelfde `SyncStatus`-diagnosecontract, zie punt 5 hierboven) — de twee
   mogen niet door elkaar gaan lopen (externe review PR #74).
4. Na `postMessage({ type: 'SKIP_WAITING' })` en de daaropvolgende
   `controllerchange` voert de pagina een gecontroleerde `location.reload()`
   uit — nooit een reload buiten die volgorde om, en nooit tijdens een
   onopgeslagen lokale mutatie (zie stopregels).
5. Voeg emulator-/browserniveau e2e toe die een tweede build simuleert
   (bijv. een test-only SW-versiebump), bevestigt dat de banner verschijnt,
   dat de oude pagina tot bevestiging op haar eigen consistente asset-set
   blijft draaien, en dat na bevestiging exact één reload plaatsvindt met de
   nieuwe assets.

Acceptatie:

- een tweede tab/build-versie activeert nooit stilzwijgend zonder dat de
  gebruiker het kon zien;
- de bestaande `pwa.spec.ts`-scenario's (manifest, links, offline-reload)
  blijven ongewijzigd groen;
- geen enkele reload vindt plaats terwijl een `tracking`-wedstrijd op dit
  apparaat actief is, tenzij de gebruiker expliciet bevestigt;
- unit-, type-, lint-, format- en buildcontroles zijn groen.

**Geïmplementeerd:**

- `v2/src/sw.ts`: het vroegere ongeconditioneerde `self.skipWaiting()` is
  vervangen door een `message`-listener die alleen op `{ type:
'SKIP_WAITING' }` reageert. `self.clients.claim()` op `activate` blijft
  ongewijzigd (dat claimt uitsluitend AL open tabs zodra `activate`
  daadwerkelijk vuurt — geen skipWaiting-omzeiling). Een eerste installatie
  (geen concurrerende oude worker) activeert nog steeds vanzelf zonder
  `skipWaiting()` nodig te hebben (standaard Service-Worker-gedrag) — dit is
  precies waarom `v2/tests/e2e/pwa.spec.ts`'s bestaande "wordt actief"-
  scenario ongewijzigd blijft werken (geverifieerd op de `dist/sw.js`-
  buildoutput na `npm run build`: bevat de nieuwe `message`-listener, geen
  losstaande `skipWaiting()`-aanroep meer).
- `v2/src/infrastructure/pwa/PwaUpdateAdapter.ts` (nieuw): de klasse die de
  registratie uit `main.tsx` overneemt. De constructor raakt
  `navigator.serviceWorker` NOOIT aan — alleen `init()` doet dat, en `init()`
  is idempotent (een tweede aanroep zonder tussentijdse `retry()` is een
  no-op). Reactief via een simpel `subscribe()`/`getState()`-contract (geen
  Preact-import in deze laag). Vier statussen: `idle` |
  `update-available` (`registration.waiting` gezet, of een installerende
  worker wordt `installed` terwijl er al een controller is — dat tweede pad
  dekt een update die aankomt terwijl de pagina al open staat) | `reloading`
  (na `confirmUpdate()`, wachtend op `controllerchange`) | `error`
  (mislukte registratie, OF een `controllerchange` die
  `CONTROLLERCHANGE_TIMEOUT_MS` = 15s uitbleef na een bevestigde
  `skipWaiting`-aanroep). `confirmUpdate()` stuurt `{ type: 'SKIP_WAITING'
}` naar `registration.waiting` en herlaadt UITSLUITEND op de
  daaropvolgende `controllerchange` van deze eigen bevestiging (een
  `controllerchange` zonder voorafgaande eigen `confirmUpdate()` — bijv. een
  andere tab die zelf bijwerkt — wordt genegeerd) en exact één keer (een
  `reloadRequested`-vlag beschermt tegen een dubbele browserfire). De
  reload-functie is injecteerbaar (`reload: () => void` in de constructor,
  default `location.reload()`) — puur voor testbaarheid, geen gedragswijziging.
- `v2/src/application/pwa/usePwaUpdate.ts` (nieuw): Preact-hook, zelfde
  laagconventie als `application/sync/useSyncStatus.ts` (een hook in de
  applicatielaag rond een infrastructuuradapter). Gebruikt de gedeelde
  `pwaUpdateAdapter`-singleton (zie hieronder, "CI-regressie ontdekt en
  gefixed") i.p.v. per hook-mount een eigen instantie aan te maken — de
  constructor raakt `navigator.serviceWorker` NOOIT aan, dus het importeren
  van de singleton blijft veilig in jsdom-componenttests zonder
  `serviceWorker`-global, precies de garantie die de constructor-restrictie
  hierboven bedoelt. Roept `init()` zelf ook aan in een mount-effect
  (idempotent, dus veilig naast `main.tsx`'s eigen `.init()`-aanroep), en
  uitsluitend als `import.meta.env.PROD` waar is (zelfde gate als de
  vroegere `main.tsx`-registratie, voorkomt een 404 op een niet-gebouwde
  `/sw.js` tijdens `vite dev`) én `'serviceWorker' in navigator`. Werk 3's
  niet-opdringerige auto-bevestiging (`AUTO_CONFIRM_DELAY_MS` = 8s) zit hier:
  een `setTimeout` die alleen loopt terwijl `status === 'update-available'`
  én `locked === false`; een `locked`-wijziging tijdens het wachten annuleert
  de timer via de effect-cleanup (unit-getest).
- `v2/src/ui/pwa/PwaUpdateBanner.tsx` (nieuw): de update-beschikbaar-banner —
  een EIGEN, aparte UI-locatie (niet via `ActionNeededPanel`). Rendert
  uitsluitend bij `status === 'update-available' | 'reloading'`, nooit bij
  `'error'`. Toont een andere, taalgevoelige tekst afhankelijk van `locked`
  (de knop zelf blijft in beide gevallen identiek werkend) — puur om de
  gebruiker duidelijk te maken of bijwerken automatisch gebeurt of wacht tot
  de wedstrijd is afgerond.
- `v2/src/ui/sync/PwaActionNeededPanel.tsx` (nieuw): het herstelbare-
  foutpad (mislukte SW-install / blijvend uitblijvende `controllerchange`),
  bewust een aparte component naast `ActionNeededPanel.tsx` — zelfde
  `action-needed-*`-CSS-klassen en dezelfde "Opnieuw proberen"/"Negeren"-
  vertaalsleutels (hergebruikt, geen duplicaat), maar NIET in
  `ActionNeededPanel`'s eigen `PendingAction`-lijst opgenomen. Reden: dat
  contract (`application/sync/useSyncStatus.ts`) is specifiek voor een te
  herzenden settings-/roster-PAYLOAD (`retry()` schrijft 'm opnieuw) — een
  PWA-registratiefout heeft geen payload, alleen een registratie om opnieuw
  te proberen. Dit is het "equivalente herstelpad binnen hetzelfde
  `SyncStatus`-diagnosecontract" waar het plan het over heeft: zelfde
  `actie-nodig`-semantiek/UI-taal, geen nieuw ongerelateerd foutkanaal, en
  bewust NIET vermengd met `PwaUpdateBanner` (dat dekt een ander scenario).
- `v2/src/app/App.tsx`: de bestaande inline `locked`-afleiding
  (`game?.phase === 'tracking' || cloudClaim.kind === 'confirmed'`, eerder
  alleen binnen één effect gebruikt voor `onGameLockChange`) is opgetild tot
  een gewone render-variabele en hergebruikt als `usePwaUpdate(locked)`'s
  argument — één bron van waarheid voor "is dit apparaat vergrendeld",
  geen tweede, potentieel uit de pas lopende afleiding. Banner en
  foutpaneel worden direct onder de header gerenderd (vóór de tab-nav) —
  zichtbaar ongeacht welk tabblad actief is.
- `v2/src/main.tsx`: de directe `navigator.serviceWorker.register(...)`-
  aanroep is vervangen door `pwaUpdateAdapter.init()` op hetzelfde
  `window`-`load`-moment als vóór 8.1a — zie "CI-regressie ontdekt en
  gefixed" hieronder voor waarom dit expliciet hier moet blijven staan i.p.v.
  volledig aan `usePwaUpdate`/`App` overgelaten te worden.
- `v2/src/i18n/strings.ts`: nieuwe sleutels `pwaUpdateAvailable`,
  `pwaUpdateAvailableLocked`, `pwaUpdateReloading`, `pwaUpdateConfirmBtn`,
  `pwaActionNeededTitle`, `pwaActionNeededMessage` — in beide taalblokken
  (nl/en), `actionNeededRetryBtn`/`actionNeededDismissBtn` bewust hergebruikt
  i.p.v. gedupliceerd (zie `PwaActionNeededPanel.tsx` hierboven).
- `v2/src/index.css`: `.pwa-update-banner` — zelfde ruimte-/rand-tokens als
  `.action-needed-panel`, eigen klasse (geen gedeelde stijl-identiteit met
  het foutpaneel, dat blijft bewust op `.action-needed-panel` zelf).
- Tests (allemaal nieuw, allemaal groen —
  `npx vitest run`: 91 bestanden/866 tests):
  `tests/unit/PwaUpdateAdapter.spec.ts` (13 tests: constructor-restrictie,
  init-idempotentie, update-available via beide paden, mislukte registratie,
  confirmUpdate→controllerchange→exact-één-reload, een niet-eigen
  controllerchange wordt genegeerd, de 15s-timeout→`error`, retry/
  dismissError, subscribe/unsubscribe), `tests/unit/usePwaUpdate.spec.ts`
  (5 tests: geen `init()` buiten productie, auto-bevestiging met/zonder
  lock, annulering bij een lock-wijziging tijdens het wachten, delegatie
  van de drie acties), `tests/unit/PwaUpdateBanner.spec.tsx` (4 tests),
  `tests/unit/PwaActionNeededPanel.spec.tsx` (2 tests).
- `v2/tests/e2e/pwa-update.spec.ts` (nieuw, werk 5): simuleert een "tweede
  build" door het al gebouwde `dist/sw.js`-bestand rechtstreeks op DISK
  (via `node:fs`, in het Playwright-testproces zelf) een testcomment te
  laten krijgen ZODRA de eerste worker al actief is, en roept
  `registration.update()` aan om de browsers eigen byte-vergelijking te
  triggeren — geen mock van het updatemechanisme zelf, alleen van de bron
  van de "nieuwe" bytes; het bestand wordt in een `finally`-blok
  teruggezet zodat latere tests in dezelfde CI-run een ongewijzigde
  `sw.js` blijven zien. Bevestigt: de banner verschijnt zodra
  `registration.waiting` gezet is; een marker die alleen een reload
  overleeft bewijst dat de oude pagina tot bevestiging op haar eigen,
  consistente asset-set blijft draaien; na een klik op "Nu bijwerken" volgt
  precies één `load`-event en is de marker weg (echte reload, niet slechts
  een client-side statuswissel); ten slotte is de registratie `active`
  zonder overgebleven `waiting`-worker.
  **Kon in deze sessie niet lokaal worden uitgevoerd** —
  Playwright/Chromium is in deze ontwikkelsandbox netwerkgeblokkeerd
  (`npx playwright install chromium` geeft 403, zelfde beperking als
  7.3c/7.4c se restpunten). Verificatie liep via de bestaande v2-e2e-CI-job
  (GitHub Actions, met voorgeïnstalleerde Chromium) — zie hieronder voor de
  twee CI-rondes die daadwerkelijk nodig waren om dit werkitem te laten
  slagen.

**CI-regressie ontdekt en gefixed (twee rondes, alleen via GitHub Actions
mogelijk aangezien Playwright hier niet lokaal draait):**

1. **Netwerkinterceptie werkte niet.** De eerste versie van
   `pwa-update.spec.ts` probeerde de "nieuwe" `sw.js`-bytes te leveren via
   eerst `page.route('**/sw.js', ...)`, daarna (na de eerste CI-faal) via
   `page.context().route(...)` — beide faalden identiek: de banner
   verscheen nooit (`registration.waiting` bleef leeg). Chromium's
   browser-interne update-checkfetch voor een geregistreerde service
   worker bleek in de praktijk niet interceptbaar via een van beide
   Playwright-routing-API's in deze CI-omgeving. Opgelost door de "tweede
   build" niet via netwerkinterceptie te simuleren, maar door het echte,
   op disk gebouwde `dist/sw.js`-bestand te wijzigen dat de
   preview-server (`vite preview`) rechtstreeks serveert — zie de
   testbeschrijving hierboven.
2. **Echte regressie in de registratietiming.** Na fix 1 slaagde
   `pwa-update.spec.ts` zelf, maar een bestaande, ongerelateerde test
   (`tests/e2e-auth/completed-history-offline-cache.spec.ts`, scenario "een
   team dat nog nooit geopend is") faalde nieuw. Root cause: vóór 8.1a
   registreerde `main.tsx` de service worker onvoorwaardelijk op het
   `window`-`load`-event, volledig los van login/contextselectie. Na 8.1a's
   eerste implementatie gebeurde initialisatie alleen nog via
   `usePwaUpdate()`'s mount-effect — en die hook mount pas binnen `App`,
   dat zelf pas ná login + org-/teamselectie rendert (`AuthGate` staat
   daarvóór). Resultaat: op een nog nooit geopend team begon
   SW-registratie pas ná teamselectie i.p.v. bij paginaload, wat de
   bestaande offline-gereedheidsaanname van die test (en van
   `offline-reload-cache-write-second-client.spec.ts`) brak. Opgelost door
   `PwaUpdateAdapter` een gedeelde singleton te maken
   (`pwaUpdateAdapter`, geëxporteerd uit `PwaUpdateAdapter.ts`) die
   `main.tsx` zelf op `window load` initialiseert — exact dezelfde timing
   als vóór 8.1a — terwijl `usePwaUpdate()` dezelfde instantie alleen nog
   abonneert (en voor de zekerheid ook zelf `init()` aanroept, idempotent,
   dus veilig als dubbele aanroep). Deze fix is lokaal geverifieerd
   (`npx vitest run`: 91 bestanden/866 tests groen, `npx tsc -b`/`eslint`/
   `prettier -c`/`npm run build` allemaal schoon) en gepusht als derde
   commit op PR #75; de eerstvolgende CI-run bevestigde dat zowel
   `pwa-update.spec.ts` als `completed-history-offline-cache.spec.ts`
   (en de rest van beide suites, 91 `test:e2e`- + 67 `test:e2e:auth`-tests)
   weer groen zijn.

- **Bewuste scope-afbakening t.o.v. het plan**: `vite.config.ts`'s
  `registerType: 'autoUpdate'` is NIET aangepast/verwijderd. Die optie stuurt
  `vite-plugin-pwa`'s eigen, hier niet-gebruikte auto-registratiescript aan
  (`injectRegister: null` staat al vóór 8.1a vast — de registratie is
  altijd al volledig handmatig, eerst in `main.tsx`, nu in
  `PwaUpdateAdapter`); met `injectRegister: null` heeft `registerType` in de
  praktijk geen effect. Laten staan i.p.v. verwijderen voorkomt een
  ongerelateerde configwijziging in een sub-PR die daar niet over gaat; een
  latere opruiming kan dit desgewenst meenemen.
- **Geen wijziging aan `GameSetupPanel.tsx`/`gameStartBlockReason()`** — dat
  is expliciet 8.1b-scope (de vierde `GameStartBlockReason`-variant), hier
  bewust niet vooruitgelopen.

### 8.1b — pre-game offline-readinesscheck

Werk:

1. Voeg een `PwaReadinessStatus`-type en een pure afleidfunctie toe in een
   nieuwe module `domain/pwa/` — bewust GEEN plek naast `writerClaim.ts`:
   die module gaat specifiek over het single-writer-protocol
   (writer-claims/epochs), terwijl PWA-gereedheid een orthogonale
   infrastructuurdimensie is; een aparte module houdt `writerClaim.ts`'s
   single-responsibility schoon en maakt het makkelijker om later (bv. in
   8.3) extra PWA-readiness-signalen toe te voegen zonder die module op te
   blazen (externe review PR #74). Onderscheid minimaal:
   geen-service-worker-ondersteuning, registratie nog bezig, actief en
   geprecached, en "wachtende update aanwezig" (die laatste blokkeert een
   nieuwe wedstrijdstart niet, maar wordt getoond zodat de gebruiker kan
   kiezen vóór tip-off bij te werken in plaats van midden in de wedstrijd).
2. Breid `GameStartBlockReason` in `v2/src/domain/game/writerClaim.ts` uit
   met een derde variant (`kind: 'pwa-readiness'`) en werk
   `gameStartBlockReason()` bij zodat roster eerst, dan cloudclaim, dan
   PWA-gereedheid wordt gecontroleerd — bestaande aanroepers
   (`GameSetupPanel.tsx`, `App.tsx`) passen hun al-bestaande switch/if-keten
   op `GameStartBlockReason.kind` uit, geen nieuwe losse gate ernaast.
3. Toon in `GameSetupPanel.tsx` een concrete, vertaalde melding per
   deelstatus (bijv. "app wordt nog geïnstalleerd, probeer opnieuw" vs.
   "geen offline-ondersteuning gedetecteerd op dit apparaat") — nooit een
   generieke "kan niet starten".
4. Alleen-lokale modus zonder service-worker-ondersteuning (bijv. een browser
   die PWA's niet ondersteunt) blokkeert een wedstrijdstart NIET — de
   readinesscheck is een waarschuwing/zichtbaarheidscontract, geen harde eis
   die apparaten zonder SW-ondersteuning volledig uitsluit; alleen een
   _aantoonbaar kapotte_ registratie (mislukte install op een apparaat dat
   wél ondersteuning claimt) blokkeert.
5. Voeg unit-tests toe voor alle combinaties van roster/cloudclaim/PWA-status
   en een component-/e2e-test die bevestigt dat `GameSetupPanel` de juiste
   melding toont per status.

Acceptatie:

- `gameStartBlockReason()` blijft voor bestaande roster-/cloudclaim-only-
  scenario's exact hetzelfde resultaat geven (geen regressie op 7.3a-gedrag);
- een apparaat met een kapotte SW-registratie krijgt een concrete, herstel-
  bare melding vóór tip-off in plaats van pas tijdens de wedstrijd te falen;
- geen enkel apparaat zonder SW-ondersteuning wordt onterecht volledig
  geblokkeerd;
- unit-, type-, lint-, format- en buildcontroles zijn groen; bestaande
  7.3a-tests voor `gameStartBlockReason()`/`canStartGame()` blijven groen.

**Geïmplementeerd:**

- `v2/src/domain/pwa/pwaReadiness.ts` (nieuw): puur, geen Firebase-/
  browser-API-imports — bewust een EIGEN module, niet naast
  `domain/game/writerClaim.ts` (zie §B punt 4). `PwaReadinessStatus` heeft
  vijf deelstatussen: `unsupported` (`'serviceWorker' in navigator ===
false`, blokkeert nooit), `registering` (SW-ondersteuning aanwezig maar
  nog geen geslaagde registratie), `ready` (actief en geregistreerd, geen
  wachtende update), `update-pending` (`registration.waiting`/reloading —
  blokkeert een nieuwe wedstrijdstart NIET, puur een zichtbaarheidssignaal
  vóór tip-off) en `broken` (adapter meldt `status: 'error'` op een
  apparaat dat wél SW-ondersteuning claimt — de ENIGE blokkerende
  deelstatus). De pure `derivePwaReadinessStatus()` neemt een plat
  `PwaReadinessSnapshot` (`swSupported`, `adapterStatus`, `registered`) —
  `adapterStatus` is een eigen, losstaand literal-uniontype
  (`PwaAdapterStatusSnapshot`), bewust NIET geïmporteerd uit
  `infrastructure/pwa/PwaUpdateAdapter.ts` (ADR-000-laagregel: `domain/`
  importeert nooit uit `infrastructure/`, ook geen puur type-only import).
- `v2/src/infrastructure/pwa/PwaUpdateAdapter.ts`: `PwaUpdateAdapterState`
  kreeg een additief `registered: boolean`-veld — nodig om `registering`
  (nog geen geslaagde registratie) te onderscheiden van `ready` (wél), die
  de adapter allebei als `status: 'idle'` rapporteerde vóór deze wijziging.
  Afgeleid via een nieuwe `buildState()`-helper uit `this.registration !==
null` (één bron van waarheid, geen los bijgehouden vlag die uit de pas
  kan lopen). Alle bestaande `setState({status: ...})`-aanroepen zijn
  vervangen door `setState(this.buildState(...))`; `retry()` zet nu ook
  `this.registration = null` terug zodat een timeout-fout (registratie was
  al geslaagd, alleen `controllerchange` bleef uit) na een retry niet
  onterecht `registered: true` blijft rapporteren. Puur additief — bestaande
  consumenten (`PwaUpdateBanner`, `PwaActionNeededPanel`, `usePwaUpdate`)
  lezen alleen `status` en zijn ongewijzigd.
- `v2/src/application/pwa/usePwaReadiness.ts` (nieuw): Preact-hook, zelfde
  laagconventie als `usePwaUpdate.ts`. Hergebruikt de gedeelde
  `pwaUpdateAdapter`-singleton (8.1a) — GEEN tweede, parallelle
  service-worker-observatie (zie "Hoe je de PWA-gereedheid bepaalt" in de
  sessieopdracht). Abonneert alleen (`subscribe()`); roept `init()` NIET
  zelf aan — die verantwoordelijkheid blijft bij `main.tsx`/`usePwaUpdate()`
  (zie 8.1a's eigen "CI-regressie"-sectie voor waarom die timing kritiek
  is). Verzamelt `'serviceWorker' in navigator` en de adapterstatus, en
  delegeert de afleiding aan `derivePwaReadinessStatus()`.
- `v2/src/domain/game/writerClaim.ts`: `GameStartBlockReason` kreeg een
  derde variant, `{ kind: 'pwa-readiness'; status: Extract<PwaReadinessStatus,
{kind:'broken'}> }`. `gameStartBlockReason()`/`canStartGame()` kregen een
  DERDE, OPTIONELE parameter `pwaReadiness` met een `{kind:'ready'}`-default
  — bestaande aanroepers (7.3a-tests, elke plek die de functie nog met twee
  argumenten aanroept) krijgen daardoor exact hetzelfde resultaat als vóór
  8.1b (bewezen in `tests/unit/writerClaim.spec.ts`'s nieuwe "geen derde
  argument"-test). Controlevolgorde blijft roster → cloudclaim → PWA-
  gereedheid, zoals het plan voorschrijft; alleen `pwaReadiness.kind ===
'broken'` blokkeert ooit.
- `v2/src/ui/game/GameSetupPanel.tsx`: nieuwe verplichte prop `pwaReadiness:
PwaReadinessStatus`. Een nieuwe `pwaReadinessMessageKey()`-functie
  mapt elke deelstatus (behalve `ready`) naar een eigen, vertaalde
  informatieregel (`data-testid="game-pwa-readiness"`, `role="alert"` alleen
  bij `broken`) — zichtbaar ONGEACHT of die status daadwerkelijk blokkeert
  (werk 3: nooit een generieke "kan niet starten", ook niet voor de
  niet-blokkerende `unsupported`/`registering`/`update-pending`-statussen).
  `startButtonLabel()` toont bij `reason.kind === 'pwa-readiness'` dezelfde
  concrete `pwaReadinessBroken`-tekst als de infoparagraaf — één bericht,
  geen tweede, afwijkende formulering.
- `v2/src/app/App.tsx`: roept `usePwaReadiness()` aan en geeft het resultaat
  door aan `GameSetupPanel` als nieuwe `pwaReadiness`-prop.
- `v2/src/i18n/strings.ts`: nieuwe sleutels `pwaReadinessUnsupported`,
  `pwaReadinessRegistering`, `pwaReadinessUpdatePending`,
  `pwaReadinessBroken` — in beide taalblokken (nl/en).
- **Bewuste scope-afbakening t.o.v. het plan**: geen wijziging aan `App.tsx`
  buiten het doorgeven van de nieuwe prop — `App.tsx` had vóór 8.1b geen
  eigen switch/if-keten op `GameStartBlockReason.kind` (alleen
  `GameSetupPanel` doet dat), dus "bestaande aanroepers passen hun keten
  uit" (werk 2) was in de praktijk alleen op `GameSetupPanel.tsx` van
  toepassing.
- Tests (allemaal nieuw of uitgebreid, allemaal groen — `npx vitest run`:
  93 bestanden/893 tests):
  `tests/unit/pwaReadiness.spec.ts` (5 tests: alle vijf deelstatussen, incl.
  prioriteit van `unsupported`/`error` boven de andere signalen),
  `tests/unit/usePwaReadiness.spec.ts` (6 tests: alle deelstatussen via de
  hook, plus een test die bewijst dat de hook `init()` NIET zelf aanroept),
  `tests/unit/writerClaim.spec.ts` (7 nieuwe tests in een eigen
  `describe`-blok: het regressiebewijs zonder derde argument, alle
  niet-blokkerende statussen × roster-klaar/cloudclaim-confirmed, de
  blokkerende `broken`-status, en roster-/cloudclaim-voorrang boven
  `broken`), `tests/unit/GameSetupPanel.spec.tsx` (7 nieuwe tests in een
  eigen `describe`-blok: elke deelstatus se boodschap en blokkeergedrag,
  plus roster-/cloudclaim-voorrang), `tests/unit/PwaUpdateAdapter.spec.ts`
  (1 nieuwe test voor `registered: true` na een geslaagde registratie
  zonder wachtende update; twee bestaande `toEqual({status:'idle'})`-
  assertions uitgebreid met `registered: false`),
  `tests/unit/usePwaUpdate.spec.ts` (drie bestaande `stateRef`-fixtures
  uitgebreid met `registered: true` — puur een typefix, geen gedragswijziging).
- **Geen apart e2e-bestand toegevoegd** — bewuste afwijking van werk 5's
  "component-/e2e-test" (het plan biedt expliciet die keuze: "een
  component-/e2e-test"). `GameSetupPanel.spec.tsx`'s nieuwe `describe`-blok
  dekt alle vijf deelstatussen inclusief de blokkerende `broken`-status
  end-to-end door de component heen (props → `gameStartBlockReason()` →
  gerenderde knoptekst/infoparagraaf), wat voor dit werkitem voldoende is:
  een browser-e2e zou de PWA-registratie zelf moeten forceren naar
  `error`/`registering`/`unsupported` via dezelfde disk-manipulatietruc als
  `pwa-update.spec.ts` (8.1a), terwijl de daadwerkelijke af te leiden logica
  (`derivePwaReadinessStatus`) en de UI-verbruikslaag (`GameSetupPanel`)
  al apart, puur en volledig getest zijn — een e2e zou vooral bewijzen dat
  de bedrading (`usePwaReadiness` → `App.tsx` → `GameSetupPanel`) klopt, en
  dat pad is ongewijzigd van hetzelfde patroon dat `pwa.spec.ts`/
  `pwa-update.spec.ts` al voor `usePwaUpdate`/`PwaUpdateBanner` bewijzen.
  Kan alsnog worden toegevoegd als een latere sessie dat expliciet nodig
  acht.
- Alle bestaande e2e-tests die op `game-start-btn`'s exacte tekst
  controleren (`tests/e2e/game-setup.spec.ts`,
  `tests/e2e/game-sync-local-mode-no-network.spec.ts`) blijven ongewijzigd
  correct: `pwaReadiness` blokkeert alleen bij `broken` (een daadwerkelijk
  mislukte SW-registratie), wat in een normale CI-browserrun met werkend
  netwerk niet optreedt — geen van deze bestanden hoefde te worden
  aangepast.

### 8.1c — Safari/iPadOS-validatie en fallbackregistratie

Werk:

1. Bouw de classic-SW-fallback (§B punt 6): een build-target dat `sw.ts` ook
   als niet-module-bundel produceert, en een featuredetectie/registratiepad
   in de 8.1a-adapter dat op basis van een korte runtime-capability-check
   (niet alleen user-agent-sniffing) kiest tussen `type: 'module'` en de
   classic bundel.
2. Documenteer en implementeer het gedegradeerde pad wanneer zelfs de
   classic-SW-registratie op een specifiek apparaat faalt: geen crash, geen
   silent-fail-schijnpariteit — een zichtbare, vertaalde melding dat offline-
   gebruik op dit apparaat niet gegarandeerd is, met de pre-game-
   readinesscheck (8.1b) die dat expliciet meeneemt als eigen deelstatus.
3. **Echte-apparaat-validatie op minstens één courtside-representatief
   Safari/iPadOS-toestel** (de exacte iOS/iPadOS-versies die het team
   daadwerkelijk gebruikt): installatie via "Zet op beginscherm", eerste
   offline reload, app-shellupdate-flow uit 8.1a, en de pre-game-
   readinesscheck uit 8.1b. **Dit kan niet in deze ontwikkelsandbox worden
   uitgevoerd** (geen fysieke iOS/iPadOS-hardware of Safari-instance
   beschikbaar) — zelfde erkenning als de echte-apparaat-restpunten in
   `docs/pr-7.3-plan.md` §C (7.3c) en `docs/pr-7.4-plan.md` §C (7.4c/werk 5).
   Dit werkitem blijft expliciet open tot iemand met toegang tot echte
   Safari/iPadOS-hardware het uitvoert en het resultaat hier vastlegt. Zelfde
   eigenaarschap als de al bestaande iOS-restpuntvermelding in
   `docs/IMPLEMENTATION_PLAN.md` §17 (rij "Fase 7", 5.5c-poort: "iOS-kant
   expliciet, apart openstaand — geen Apple-apparaat beschikbaar bij de
   eigenaar") — geen nieuw, ongerelateerd trackingpunt aanmaken; als dit
   werkitem klaar is, werk die bestaande §17-vermelding bij i.p.v. een
   tweede, losse iOS-regel toe te voegen (externe review PR #74).
4. Werk §B punt 6 van dit document bij met het daadwerkelijke
   verificatieresultaat (welke iOS/iPadOS-versies getest, module-SW of
   classic-fallback gebruikt, eventuele resterende beperkingen) zodra werk 3
   is uitgevoerd — dit plan mag niet als "Safari-vraag afgehandeld" gelden
   voordat dat resultaat hier staat.

Acceptatie:

- de classic-SW-fallback-bundel bouwt en draait tegen dezelfde
  `pwa.spec.ts`-achtige emulatorscenario's als de module-variant
  (Chromium-gebaseerde e2e kan de fallback-registratie zelf al valideren,
  ook zonder echte Safari-hardware);
- de classic-SW-bundel bevat geen enkel top-level ES-module-`import`-
  statement (verifieerbaar via een eenvoudige build-outputcheck, bv.
  `grep -E '^import '` op de gebundelde `sw`-output) — voorkomt een
  toekomstige, stille regressie als een latere Workbox-versie ergens
  intern `import`-syntax introduceert die de huidige `injectManifest`-opzet
  vandaag niet gebruikt (externe review PR #74);
- een apparaat waar zowel module- als classic-SW-registratie faalt krijgt een
  zichtbare, vertaalde melding en blokkeert nooit stilzwijgend alleen-lokaal
  gebruik van roster/instellingen;
- de echte-Safari/iPadOS-validatie (werk 3) staat als expliciet open
  restpunt totdat een operator met fysieke toegang die heeft uitgevoerd en
  gedocumenteerd — pas dan mag "Safari + iPadOS-ondersteuning geverifieerd"
  in `docs/IMPLEMENTATION_PLAN.md` §17 als voltooid worden genoteerd.

**Geïmplementeerd:**

- `v2/src/infrastructure/pwa/PwaUpdateAdapter.ts`: nieuwe geëxporteerde
  functie `detectModuleServiceWorkerSupport()` — een korte runtime-
  capability-check (GEEN user-agent-sniffing, zoals §B punt 6 expliciet
  vereist), gebaseerd op de bekende feature-detectietruc voor module-
  `Worker`s: een `WorkerOptions`-object met een `type`-getter die alleen
  wordt aangeroepen als de UA de eigenschap daadwerkelijk uitleest (wat
  alleen UA's met module-Workerondersteuning doen); een UA zonder die
  ondersteuning negeert de onbekende optie stilzwijgend en roept de getter
  dus nooit aan. Module-service-workers draaien op dezelfde ES-module-
  machinery als reguliere `type: 'module'`-`Worker`s (§B punt 6), dus is dit
  een betrouwbare proxy zonder zelf al een service worker te moeten
  registreren — vermijdt precies het "`register()` geeft geen duidelijke
  throw op alle faalpaden"-risico dat §B punt 6 beschrijft. Retourneert
  `true` (module-ondersteuning aannemen, hetzelfde gedrag als vóór 8.1c)
  wanneer `Worker` niet bestaat of de detectie zelf een throw geeft — o.a.
  het geval in jsdom-componenttests, die geen `Worker`-global hebben, dus
  geen van de bestaande 8.1a-/8.1b-tests hoefde te veranderen.
- `PwaUpdateAdapter`'s constructor kreeg twee nieuwe, injecteerbare
  parameters (zelfde testbaarheidspatroon als het bestaande `reload`-
  argument): `classicSwUrl` (default `/sw-classic.js`) en
  `supportsModuleServiceWorker` (default de echte capability-check
  hierboven). `init()` roept de capability-check ÉÉN keer aan, vóór de
  registratiepoging zelf, en kiest daarmee definitief tussen de module- en
  de classic-bundel — bewust GEEN "probeer module, val terug op classic bij
  een mislukte poging"-keten: een module-SW-registratie die niet lukt geeft
  vaak geen throw (§B punt 6), dus wachten op een gefaalde registratie-
  promise om alsnog naar classic over te schakelen zou juist op de
  apparaten waar dit ertoe doet nooit vuren. Faalt de op basis van de
  capability-check gekozen registratie zelf alsnog (een échte netwerk-/
  scope-fout), dan is dat een aantoonbaar kapotte registratie — geen tweede
  fallbackpoging, gewoon `status: 'error'` (werk 2).
- `v2/src/sw-classic.ts` (nieuw): apart, zeer klein entrypoint dat
  letterlijk dezelfde `sw.ts`-broninhoud hergebruikt via `import './sw'`.
  Nodig omdat `vite-plugin-pwa` de naam van het uitvoerbestand afleidt van
  de naam van het brongebruikte bestand (`sw.ts` → `sw.js`) — een tweede
  build-target met dezelfde bronnaam zou het bestaande `sw.js` overschrijven
  in plaats van een apart `sw-classic.js` ernaast te laten bestaan.
- `v2/vite.config.ts`: een tweede, losse `vite build`-aanroep — gestuurd via
  de nieuwe env-variabele `SW_BUILD_TARGET=classic` (zie `package.json`) —
  bouwt `sw-classic.ts` met `rollupFormat: 'iife'` i.p.v. `'es'`, en met
  `build.write: false` zodat de al door de eerste aanroep geschreven
  app-assets (JS/CSS-chunks, `index.html`) niet opnieuw naar disk worden
  geschreven; alleen vite-plugin-pwa's eigen, aparte interne SW-build (die
  altijd naar disk schrijft, ongeacht `build.write`) levert `sw-classic.js`
  op. `globIgnores: ['sw.js', 'sw-classic.js']` toegevoegd zodat geen van
  beide builds de SW-bundel van de ANDERE als gewoon te precachen asset
  meeneemt. Lokaal geverifieerd: beide bundels precachen exact dezelfde
  asset-URL's (bytegelijke manifestlijst, alleen het SW-bestand zelf
  verschilt in formaat).
- `v2/package.json`: `build`-script uitgebreid tot
  `tsc -b && vite build && SW_BUILD_TARGET=classic vite build && node
scripts/verify-sw-classic-bundle.mjs` — de classic-bundel wordt bij elke
  `npm run build` daadwerkelijk (opnieuw) geproduceerd en gecontroleerd, niet
  als losstaand, makkelijk te vergeten extra commando.
- `v2/scripts/verify-sw-classic-bundle.mjs` (nieuw): de build-outputcheck
  uit het acceptatiecriterium — leest `dist/sw-classic.js` en faalt de build
  (`process.exit(1)`, met de exacte regelnummers) zodra er een top-level
  `^import\s`-statement in staat. Draait als laatste stap van `npm run
build`. Lokaal geverifieerd (`npm run build`): `verify-sw-classic-bundle:
OK — dist/sw-classic.js bevat geen top-level ES-module-import-statements.`
- `v2/eslint.config.js`: nieuw `files: ['scripts/**/*.mjs']`-blok met alleen
  `globals.node` (geen `globals.browser`) — deze build-outputcheck-scripts
  draaien rechtstreeks onder Node, niet als browser-/appcode.
- `v2/src/domain/pwa/pwaReadiness.ts`: GEEN nieuwe, zesde deelstatus voor
  "zowel module- als classic-SW-registratie mislukt" (werk 2) — de
  bestaande `broken`-deelstatus dekt dit al exact: `swSupported` blijft op
  zo'n apparaat `true` (`'serviceWorker' in navigator` is aanwezig, alleen
  de registratie zelf faalt) en `adapterStatus: 'error'` is precies hetzelfde
  signaal als elke andere aantoonbaar kapotte registratie — de oorzaak
  (module vs. classic vs. allebei geprobeerd) is voor de pre-game-gate
  irrelevant, alleen het eindresultaat telt. `pwaReadinessBroken`-vertaling
  (nl/en) aangescherpt van "de offline-gereedheidscheck is mislukt" naar
  "offline-gebruik is op dit apparaat niet gegarandeerd" — expliciet maakt
  dat dit apparaatspecifiek is, niet een algemene storing; alleen-lokaal
  roster-/instellingengebruik blijft buiten wedstrijdstart gewoon werken
  (stopregel §D).
- Tests (allemaal groen — `npx vitest run`: 93 bestanden/900 tests):
  `PwaUpdateAdapter.spec.ts` kreeg 3 nieuwe tests (registreert classic bij
  ontbrekende module-ondersteuning, registreert module bij wél
  ondersteuning, meldt `error` bij een mislukte classic-registratie met
  precies één `register()`-aanroep — geen tweede fallbackpoging) plus een
  eigen `describe`-blok van 4 tests voor `detectModuleServiceWorkerSupport()`
  zelf (geen `Worker`-global, een "oude" fake-UA die de `type`-getter nooit
  uitleest, een "moderne" fake-UA die 'm wél uitleest, een throwende
  `Worker`-constructor). `GameSetupPanel.spec.tsx` bijgewerkt voor de
  aangescherpte `pwaReadinessBroken`-tekst.
- `v2/tests/e2e/pwa-classic-fallback.spec.ts` (nieuw, werk 1/acceptatie):
  forceert de capability-check naar "geen module-ondersteuning" via
  `page.addInitScript()` (dus vóór enige app-/adaptercode draait) door de
  globale `Worker`-constructor te vervangen door een fake die de
  `type`-optie-getter nooit uitleest — exact het capability-detectiesignaal
  dat de adapter zelf gebruikt. Bewust GEEN netwerkinterceptie van de
  service-worker-registratie zelf: 8.1a's CI toonde dat zowel `page.route()`
  als `page.context().route()` de browser-interne SW-update-checkfetch niet
  betrouwbaar onderscheppen (zie `pwa-update.spec.ts`'s eigen
  moduledocstring) — hier wordt daarom een laag gemockt die ver van de
  servicewerker-netwerkmachinery af staat: puur de JS-level capability-
  probe die de adapter aanroept vóórdat 'ie ooit
  `navigator.serviceWorker.register()` aanroept. Bevestigt: de geregistreerde
  worker se `scriptURL` bevat `/sw-classic.js` (niet het standaard `/sw.js`-
  pad), en dezelfde offline-app-shell-serving als het bestaande
  `pwa.spec.ts`-modulescenario werkt ook via de classic-fallback.
  **Kon in deze sessie niet lokaal worden uitgevoerd** (Playwright/Chromium
  is in deze ontwikkelsandbox netwerkgeblokkeerd, zelfde beperking als
  7.3c/7.4c/8.1a se restpunten) — verificatie loopt via de bestaande
  v2-e2e-CI-job.
- **Werkitem 3 (echte-Safari/iPadOS-hardwarevalidatie): expliciet NIET
  uitgevoerd, blijft open.** Deze ontwikkelsandbox heeft geen fysieke
  iOS/iPadOS-hardware of Safari-browserinstance — precies de situatie die
  het plan al voorzag. Zodra een operator met toegang tot een courtside-
  representatief Safari/iPadOS-toestel dit uitvoert (installatie via "Zet
  op beginscherm", eerste offline reload, de 8.1a-updateflow, de
  8.1b-readinesscheck — nu ook geverifieerd tegen de daadwerkelijke
  module-of-classic-keuze die dat toestel krijgt), wordt het resultaat hier
  in §B punt 6 vastgelegd (werk 4) en de bestaande §17-rij in
  `docs/IMPLEMENTATION_PLAN.md` bijgewerkt — geen nieuwe, losse iOS-regel.
  §B punt 6 blijft daarom letterlijk ongewijzigd staan als open
  beslispunt totdat dat resultaat er is.
- Lokale verificatie (orchestrerende sessie, na een onderbroken
  achtergrond-agent-run die op de spendlimiet liep vlak vóór de
  verificatiestap): `npx vitest run` — 93 bestanden/900 tests groen;
  `npx tsc -b` — schoon; `npx eslint .` — schoon (na het toevoegen van het
  `scripts/**/*.mjs`-eslintblok en het verwijderen van twee ongebruikte
  fake-Worker-constructorparameters, beide hierboven al genoemd);
  `npx prettier -c .` — schoon; `npm run build` — beide bundels gebouwd,
  bytegelijke precache-manifesten, `verify-sw-classic-bundle.mjs` bevestigt
  geen top-level `import` in `dist/sw-classic.js`.

## D. Stopregels

- Geen stille SW-overname (`skipWaiting`/`clients.claim()`) tijdens een
  actieve `tracking`-wedstrijd op dit apparaat; de bestaande game-lock uit
  PR 7.3a (`App.tsx`'s `locked`-afleiding op `phase === 'tracking'` of
  bevestigde cloudclaim) geldt ook voor SW-updates — een update mag die
  vergrendeling nooit omzeilen door alsnog te herladen.
- Geen geforceerde `location.reload()` buiten de expliciete
  `postMessage`-→-`controllerchange`-volgorde uit 8.1a; geen reload die een
  onopgeslagen lokale mutatie kan verliezen.
- Geen Safari/iPadOS-fallbackbeslissing die als "opgelost" wordt
  gepresenteerd zonder de echte-apparaat-verificatie uit 8.1c werk 3; totdat
  die is uitgevoerd blijft het een aanname, geen bewezen feit.
- Geen uitbreiding van de pre-game-readinesscheck tot een harde eis die
  apparaten zonder SW-ondersteuning volledig van alleen-lokaal gebruik
  uitsluit — dat zou de bestaande "alleen-lokale modus blijft werken"-
  garantie (ADR-000, PR 6.6 §B) doorbreken.
- Geen scope-vermenging met PR 8.2 (toegankelijkheid/courtside-QA buiten
  PWA-updates zelf) of PR 8.3 (Security Rules, App Check, kosten/back-
  upbeleid); PWA-gerelateerde foutrapportage in 8.1 blijft binnen het
  bestaande `SyncStatus`-diagnosecontract, geen nieuw, ongerelateerd
  loggingkanaal dat op 8.3's privacyveilige-logging-eis vooruitloopt.
- Geen productiecutover; na 8.1 volgen eerst 8.2 en 8.3, en pas daarna de
  expliciete fase-8-acceptatie uit `docs/IMPLEMENTATION_PLAN.md` §13.

## E. Post-merge review (minimax, PR #75–#78)

PR 75/76/77/78 (heel PR 8.1 + de roadmap-update) zijn gemerged vóórdat de
externe review geplaatst kon worden — een afwijking van de afgesproken
volgorde (eerst review, dan mergen). De review is alsnog uitgevoerd tegen de
gemergede staat op `main`; dit is de vastlegging daarvan, zodat de
bevindingen niet alleen in de chatgeschiedenis blijven staan.

**Verdict: geen blokkers.** Architectuur, laagscheiding en teststrategie
volgen het 8.1-plan getrouw; alle CI groen op alle vier PR's; geen hotfix of
revert vereist.

Vijf niet-blokkerende observaties, elk hieronder met de gekozen opvolging:

1. **`pwaUpdateAdapter`-singleton is ongetest als singleton** (alleen losse
   `new PwaUpdateAdapter()`-instanties zijn unit-getest) —
   **doorgeschoven naar PR 8.3**: als 8.3 extra PWA-diagnose toevoegt, dan
   een `forTesting()`/reset-methode op de adapter overwegen. Geen actie in
   8.1 zelf; de reviewer beval dit expliciet als 8.3-follow-up aan, niet als
   iets om nu nog aan een al gemergede PR toe te voegen.
2. **`usePwaUpdate`'s effect-dependency op `autoConfirmDelayMs`** —
   reviewer bevestigt expliciet "geen bug, alleen goed om te weten" (de
   enige aanroeper, `App.tsx`, geeft nooit een dynamische waarde door).
   **Geen actie.**
3. **`verify-sw-classic-bundle.mjs`'s `/^import\s/`-regex mist een geneste
   `import` die toevallig aan het begin van een regel staat** (praktisch
   risico klein bij de huidige Workbox-versie) — **doorgeschoven naar
   PR 8.3**: bij een toekomstige Workbox-upgrade een breder patroon
   overwegen (bv. `/\bimport\b[^=]*\bfrom\b/`). Geen actie nu.
4. **`App.tsx`'s `locked`-const staat nu vóór de `useEffect` i.p.v. erin**
   (nodig omdat `usePwaUpdate(locked)` dezelfde waarde nodig heeft) —
   zuiver een leesbaarheidsobservatie, functioneel correct bevestigd.
   **Geen actie.**
5. **`docs/IMPLEMENTATION_PLAN.md` is nog niet prettier-clean** — een
   pre-existing probleem van vóór PR 78 (bevestigd via `git stash`-
   vergelijking, niet door PR 78 veroorzaakt). Reviewer: "niet urgent,
   1-commit-PR waardig zodra er een docs-only moment is." **Nog niet
   ingepland** — wordt opgepakt zodra er expliciet om gevraagd wordt of bij
   een volgend docs-only-moment.

**Procesconclusie:** vanaf nu wordt geen enkele PR meer automatisch
gemerged zodra CI groen is — eerst wordt op een geplaatste review gewacht,
pas daarna mergen (zie ook de PR 8.3-sectie in
`docs/IMPLEMENTATION_PLAN.md` §13 voor de twee hierboven genoemde
follow-uppunten).
