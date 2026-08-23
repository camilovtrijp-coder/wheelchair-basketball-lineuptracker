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
  applicatielaag rond een infrastructuuradapter). Maakt de adapter één keer
  aan (`useRef`) — veilig in jsdom-componenttests zonder
  `serviceWorker`-global, precies de garantie die de constructor-restrictie
  hierboven bedoelt. Roept `init()` pas in een mount-effect aan, en
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
  aanroep is verwijderd; die verantwoordelijkheid ligt nu volledig bij
  `PwaUpdateAdapter`/`usePwaUpdate`.
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
  build" door de al gebouwde `dist/sw.js`-bytes via `page.route()` met een
  testcomment te wijzigen ZODRA de eerste worker al actief is, en roept
  `registration.update()` aan om de browsers eigen byte-vergelijking te
  triggeren — geen mock van het updatemechanisme zelf, alleen van de bron
  van de "nieuwe" bytes. Bevestigt: de banner verschijnt zodra
  `registration.waiting` gezet is; een marker die alleen een reload
  overleeft bewijst dat de oude pagina tot bevestiging op haar eigen,
  consistente asset-set blijft draaien; na een klik op "Nu bijwerken" volgt
  precies één `load`-event en is de marker weg (echte reload, niet slechts
  een client-side statuswissel); ten slotte is de registratie `active`
  zonder overgebleven `waiting`-worker.
  **Kon in deze sessie niet lokaal worden uitgevoerd** —
  Playwright/Chromium is in deze ontwikkelsandbox netwerkgeblokkeerd
  (`npx playwright install chromium` geeft 403, zelfde beperking als
  7.3c/7.4c se restpunten). Echte verificatie loopt via de bestaande v2-e2e-
  CI-job (GitHub Actions, met voorgeïnstalleerde Chromium). Dit werkitem
  blijft in die zin openstaand tot een CI-run het bevestigt — net als de
  bestaande echte-apparaat-/CI-afhankelijke restpunten in
  `docs/pr-7.3-plan.md`/`docs/pr-7.4-plan.md`.
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
