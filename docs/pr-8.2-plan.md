# Voorbereidingsplan PR 8.2 — toegankelijkheid en courtside QA

Status: volledig gemerged — 8.2a (#81), 8.2b (#83) en 8.2c (#84). Dit plan
splitst roadmap-PR 8.2 in drie afzonderlijk reviewbare sub-PR's, volgt de
structuur van `docs/pr-8.1-plan.md`/`docs/pr-7.1-plan.md`, en legt vast welk
deel van de vijf roadmap-bullets (`docs/IMPLEMENTATION_PLAN.md` §13, "PR
8.2 — toegankelijkheid en courtside QA") al gedeeltelijk bestaat versus
daadwerkelijk nieuw werk is.

## A. Doel

PR 8.1 heeft de PWA-updateflow gehard; PR 8.2 is de tweede hardeningsstap
van fase 8 en richt zich op de _bruikbaarheid_ van de app tijdens een
courtside wedstrijd: een scorer die de app op een telefoon bedient, vaak met
één hand, soms met een toetsenbord/schakelaar op een tweede apparaat, op een
niet altijd nieuw toestel, en soms op een gedeeld apparaat tussen meerdere
mensen.

De architectuurreview na PR 3.2c (`docs/IMPLEMENTATION_PLAN.md` §17, rij
"Architectuurreview na PR 3.2c") heeft twee a11y-gaten bewust naar PR
8.1/8.2 doorgeschoven in plaats van vervroegd te fixen:

1. "geen zichtbare PWA-update-UX/`controllerchange`-reload voor lang
   openstaande tabs" — opgelost in PR 8.1;
2. "geen runtime-a11y-scan (axe-core) of echte keyboard-only-e2e-navigatie,
   alleen statische `jsx-a11y`-lint" — dit is expliciet PR 8.2-scope.

Onderzoek in deze voorbereidingssessie bevestigt gat 2 letterlijk. `v2/
eslint.config.js` heeft `eslint-plugin-jsx-a11y` (`^6.10.2`) actief met
`jsxA11y.configs.recommended.rules` op alle `.tsx`-bestanden — dat is de
statische baseline die al werkt en die 8.2 niet opnieuw hoeft te bouwen. Er
is echter geen `@axe-core/playwright`- of `axe-core`-dependency in `v2/
package.json` (geverifieerd: geen enkele match op "axe" in dat bestand) en
geen enkele e2e-test die toetsenbordnavigatie (`page.keyboard.press('Tab')`
e.d.) beproeft — `v2/tests/e2e/` bevat uitsluitend muis-/tikgebaseerde
interactie. Statische lint ving dus al een deel van de meest voorkomende
fouten (missende labels, non-interactieve elementen met click-handlers,
enz.), maar bewijst niets over de _samengestelde_ runtime-DOM (bijv. of een
modaal daadwerkelijk focus vangt, of de tab-volgorde door een live scorebord
logisch loopt) — precies het gat dat gat 2 benoemt.

Twee van de vijf roadmap-bullets blijken bij onderzoek al gedeeltelijk of
grotendeels bestaand functioneel gebouwd, wat de scope van 8.2 concreet
versmalt tot verificatie/hardening in plaats van nieuwbouw:

- **`prefers-reduced-motion`** staat al globaal in `v2/src/index.css`
  (regel 1413-1418): een `@media (prefers-reduced-motion: reduce) { * {
animation: none !important; transition: none !important; } }`-blok. Dit
  dekt redelijkerwijs alle huidige CSS-animaties/-transities in één keer
  (geen los per-component-werk nodig) — 8.2's taak hier is bevestigen dat
  dit blok inderdaad alle huidige geanimeerde elementen raakt en er een
  regressietest voor vastleggen, niet een nieuwe implementatie.
- **"gedeeld apparaat: vertrouwd-apparaatkeuze, uitloggen en cache
  wissen"** is grotendeels al gebouwd in eerdere fases (PR 5.x/7.3a):
  `v2/src/infrastructure/device/trustedDevice.ts` (lezen/schrijven/wissen
  van een `lineup-tracker-trusted-device`-vlag, apparaatseigenschap — blijft
  bewust staan na uitloggen), `v2/src/ui/auth/TrustedDevicePrompt.tsx` (de
  keuzeprompt) en `AuthGate.tsx`'s `handleSignOut()` (wist bij een
  onvertrouwd apparaat `wipeLocalFirebaseData()` — Firestore's
  `clearIndexedDbPersistence`). §B/§C hieronder werken uit wat hier
  concreet nog ONTBREEKT (zie §B punt 5): `wipeLocalFirebaseData()` wist
  alleen de Firestore-IndexedDB-cache, geen lokale `localStorage`-sleutels
  (roster/instellingen/spelfixtures uit ADR-000's `infrastructure/`-laag),
  en er is geen UI-pad om de vertrouwd-apparaatkeuze ná de initiële prompt
  te herzien.

Wat overblijft als daadwerkelijk nieuw, substantieel werk: een echte
axe-core-gedreven runtime-scan, een echte focus-trap/-restore-module voor
modals (`ModalDialog.tsx` heeft vandaag geen focus-trap: geverifieerd —
geen `autofocus`, geen focus-restore-logica, geen keyboard-tab-cyclus,
alleen Escape/backdrop-click sluiten), een expliciete keyboard-only-e2e-suite
voor score/wissel/context-bediening, en club-kleurcontrastcontrole — met een
belangrijke afhankelijkheidswaarschuwing daarbij (zie §B punt 4).

## B. Vastgelegde bouwkeuzes

1. **Axe-core-integratie: `@axe-core/playwright` als nieuwe e2e-suite,
   geen nieuwe test-runner.** De bestaande e2e-stack
   (`@playwright/test` `^1.62.1`) blijft de enige e2e-tool; `@axe-core/
playwright` is de enige nieuwe dependency in `v2/package.json`. Een
   nieuw bestand `v2/tests/e2e/a11y-axe.spec.ts` draait `AxeBuilder`
   tegen een vaste lijst van kernschermen (instellingen, roster, wedstrijd-
   opzet, live tracking incl. een open modaal, historie, stats/trends
   incl. een open filtermodaal) — dezelfde schermenlijst die `v2/tests/
e2e/mobile.spec.ts` en de auth-e2e-suite al aanraken, geen aparte
   nieuwe navigatiepaden bedenken. Elke scan faalt de test bij een
   `violations`-array die niet leeg is; `impact: 'minor'` mag NIET
   worden uitgesloten (een stille "alleen serieuze bevindingen"-filter
   zou precies het soort regressie verbergen die deze suite moet vangen).
   Geen scan tegen de v1-referentie (`index.html`) — die blijft
   ongewijzigd en buiten scope, zelfde afbakening als ADR-000's
   teststrategie voor v2-migratie.

   **Expliciete WCAG-tags (externe review PR #80):**
   `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a',
'wcag21aa'])` — WCAG 2.0 A/AA plus WCAG 2.1 A/AA, bewust NIET de bredere
   `axe-core`-standaardregelset (die ook `best-practice`-regels meeneemt
   die geen formele WCAG-tag hebben en dus geen stabiel, versie-onafhankelijk
   contract vormen). Vastleggen van de exacte tags voorkomt dat een
   toekomstige `axe-core`-major-upgrade (bv. 5.x → 6.x/7.x) stilzwijgend de
   gescande regelset — en dus wat "groen" betekent — laat verschuiven.

2. **Een echte focus-trap/-restore-module, in `infrastructure/a11y/`, niet
   in `ui/` of `domain/`.** Focus-trapping is fundamenteel een
   browser-DOM-concern (`document.activeElement`, `focus()`,
   `KeyboardEvent`) — geen pure domeinlogica (ADR-000: `domain/`
   importeert geen DOM-code) en geen eenmalige component-specifieke hack
   (meerdere modals — `ModalDialog.tsx`, `GamesFilterModal.tsx`,
   `TakeoverConfirmDialog.tsx` — hebben dezelfde behoefte). Nieuwe module
   `v2/src/infrastructure/a11y/focusTrap.ts`: een kleine, dependency-vrije
   klasse/functie die (a) bij activering het element onthoudt dat op dat
   moment focus had (voor restore bij sluiten), (b) focus verplaatst naar
   het eerste focusbare element in het dialoog (of het dialoog zelf als er
   geen focusbaar kind is), (c) `Tab`/`Shift+Tab` binnen de focusbare
   kinderen van het dialoog laat cyclen (geen focus die naar de
   achtergrondpagina "lekt" terwijl het dialoog open is), en (d) bij
   deactivering focus terugzet naar het onthouden element. Een nieuwe
   Preact-hook `v2/src/application/a11y/useFocusTrap.ts` (zelfde
   laagconventie als `application/pwa/usePwaUpdate.ts`: een hook in de
   applicatielaag rond een infrastructuuradapter) verbindt de module met
   `ModalDialog.tsx`, `GamesFilterModal.tsx` en `TakeoverConfirmDialog.tsx`
   — één gedeelde implementatie, geen drie losse ad-hoc-varianten.
3. **Keyboard-only-e2e-coverage is een aparte suite per interactiegebied,
   niet één alles-in-één bestand.** `v2/tests/e2e/a11y-keyboard.spec.ts`
   dekt in ieder geval: modaal openen/sluiten/tab-cyclus/focus-restore
   (bewijst de nieuwe focus-trap-module werkt in de browser, niet alleen
   unit-getest), en de live-wedstrijdbediening uit bullet 2 hieronder
   (score toekennen, wissel uitvoeren, van tabblad/context wisselen) puur
   via `page.keyboard`, zonder `page.click()`/`page.tap()`. Reden voor een
   aparte keyboard-suite naast de bestaande muis-/tikgebaseerde suites:
   dezelfde flows bestaan al als muis-e2e (`game-setup.spec.ts`,
   `mobile.spec.ts`), dus dupliceren van de complete flow-inhoud is
   overbodig — de nieuwe suite bewijst specifiek dat dezelfde uitkomst ook
   met alleen een toetsenbord bereikbaar is, niet de volledige
   business-logica opnieuw.
4. **Contrast van clubkleuren: expliciete afhankelijkheid op bug 10
   (`docs/pr-5.5c-bugfixes.md`, "10. Team-kleuren (primaire/accentkleur)
   worden nergens visueel toegepast — v1-regressie"), niet los oplosbaar.**
   Onderzoek bevestigt: `primaryColor`/`accentColor`
   (`v2/src/domain/settings/types.ts`) worden vandaag uitsluitend gelezen/
   geschreven binnen `SettingsPanel.tsx` zelf en genormaliseerd
   (`domain/settings/normalize.ts`); nergens anders in `v2/src` worden ze
   toegepast op UI-elementen (geen CSS-custom-property-injectie, geen
   inline `style`, geen thema-logica — alle knoppen gebruiken een vaste
   `.btn-primary`-stijl uit `index.css`). Een contrastcontrole
   veronderstelt een daadwerkelijk gerenderde kleur om tegen de
   achtergrond/tekstkleur te toetsen — die rendering bestaat nog niet.
   **Vastgelegde keuze:** 8.2b bouwt eerst de minimale toepassing van bug
   10 (CSS custom properties `--team-primary`/`--team-accent` op
   root-niveau, toegepast op de knoppen/headers die daadwerkelijk
   merkbaar zijn — dezelfde scope als bug 10's eigen "aparte
   implementatiestap"-aantekening). **Concrete elementenlijst (externe
   review PR #80, **gecorrigeerd in de tweede P1-review-ronde op PR #83,
   29 aug. 2026 — zie hieronder voor de reden**):** minimaal
   `.btn-primary` (alle primaire actieknoppen — startknop, opslaan,
   bevestigen) krijgt `--team-primary` als achtergrondkleur mét een
   afgeleide, wiskundig gegarandeerd leesbare knoptekst
   (`deriveButtonForeground`, zie werk 4 hieronder), en de app-header/
   `<h1>` krijgt `--team-accent` als een puur DECORATIEF accent
   (`border-left` — NIET als tekstkleur, zie de correctie hieronder) — de
   acceptatietest in 8.2b werk 3 verifieert expliciet dat minstens dít ene
   zichtbaar-merkbare element de custom property daadwerkelijk gebruikt
   (niet slechts dat de property ergens in de CSS gedefinieerd staat),
   zodat "bug 10 opgelost" niet kan worden geclaimd op basis van een
   property die nergens renderend wordt toegepast. Verdere elementen (bv.
   de PWA-updatebanner) zijn optioneel binnen dezelfde 8.2b-scope, niet
   vereist voor de acceptatiecriteria.

   **Correctie (tweede P1-review-ronde PR #83, 29 aug. 2026):** `--team-
accent` bleek NIET houdbaar als letterlijke `.app-title`-TEKSTkleur —
   geen van de tien presets uit `SettingsPanel.tsx` haalt 4,5:1 tegen de
   headerachtergrond, dus een contrastveilige afgeleide tekstvariant viel
   voor alle tien terug op hetzelfde zwart (onzichtbare accentkeuze). De
   accentkleur wordt daarom toegepast als een puur DECORATIEF accent
   (`.app-title`'s `border-left`) i.p.v. als tekstkleur — WCAG 1.4.11
   (non-text contrast) geldt niet voor zuiver decoratieve elementen, dus
   de rauwe kleur mag daar rechtstreeks. Zie `domain/settings/
colorContrast.ts` se bijgewerkte bestandscommentaar en de "twee-presets-
   geven-twee-kleuren"-e2e-tests in `settings.spec.ts`/`dark-mode-
contrast.spec.ts` voor het bewijs. `.btn-primary`'s `--team-primary`-
   toepassing (achtergrond) is ongewijzigd.

   **Vervallen (derde P2-review-ronde PR #83, 29 aug. 2026):** de
   oorspronkelijke tekst hier eiste nog een aparte, pure
   `domain/settings/`-contrastcontrolefunctie die een niet-blokkerende
   waarschuwing toont in `SettingsPanel.tsx` bij onvoldoende contrast
   (analoog aan 8.1b's PWA-readinessvarianten). Die eis is met de
   correctie hierboven overbodig geworden: `.btn-primary`'s knoptekst is
   nu wiskundig gegarandeerd ≥4,5:1 (`deriveButtonForeground`, welke
   kleur ook gekozen wordt) en `.app-title`'s accent is decoratief (geen
   WCAG-tekstcontrasteis) — een "kleurkeuze met onvoldoende contrast"-
   toestand kan voor deze twee toepassingen niet meer voorkomen, dus is er
   niets meer om voor te waarschuwen. Zie werk 4/de acceptatiecriteria
   hieronder voor de bijgewerkte, actuele eis.

5. **Gedeeld apparaat — uitbreiding, geen nieuwbouw, van de bestaande
   vertrouwd-apparaat-/uitlogflow.** Twee concrete gaten t.o.v. wat al
   bestaat (zie §A):
   - `wipeLocalFirebaseData()` (`v2/src/infrastructure/firebase/
firebaseClient.ts`) wist alleen Firestore's IndexedDB-persistentie.
     Op een onvertrouwd, gedeeld apparaat blijven na uitloggen de
     `localStorage`-sleutels uit ADR-000's laagconventie
     (`lineup-tracker-roster`, `lineup-tracker-games`,
     `lineup-tracker-settings`, enz. — de v1-compatibele sleutels die
     `infrastructure/`-repositories gebruiken) onaangeroerd staan. 8.2c
     breidt `handleSignOut()`'s onvertrouwd-apparaat-pad uit met een
     expliciete wis van diezelfde lokale-opslagsleutels — **uitsluitend**
     op het onvertrouwd-apparaatpad (`trusted === false`), nooit op een
     vertrouwd apparaat, en nooit de taal-/i18n-voorkeur
     (`lineup-tracker-lang`) of de vertrouwd-apparaatvlag zelf (die blijft
     zoals nu bewust een apparaateigenschap, zie de bestaande code-
     commentaar in `AuthGate.tsx`).

     **Expliciete witte-/zwarte-lijst (externe review PR #80), geverifieerd
     tegen de huidige codebase:**

     WEL wissen: `lineup-tracker-settings` (`domain/settings/types.ts`),
     `lineup-tracker-roster` (`domain/roster/types.ts`),
     `lineup-tracker-games` (v1-sleutel, `domain/backup/migrateV1.ts`),
     `lineup-tracker-v1` (v1-migratieblob, `domain/game/v1Migration.ts`),
     `lineup-tracker-v2-active-game:${orgId}:${teamId}`
     (`infrastructure/game/LocalStorageGameRepository.ts`),
     `lineup-tracker-v2-completed-games:${orgId}:${teamId}`
     (`infrastructure/game/LocalStorageCompletedGameRepository.ts`),
     `lineup-tracker-v2-device-id`
     (`infrastructure/device/deviceId.ts`),
     `lineup-tracker-v2-game-sync-checkpoint:${gameId}`
     (`infrastructure/game/LocalStorageGameSyncCheckpointRepository.ts`),
     `lineup-tracker-v2-pending-finalize:${orgId}:${teamId}`
     (`infrastructure/game/LocalStoragePendingFinalizeRepository.ts`),
     `lineup-tracker-v2-migration-run:${orgId}:${teamId}`
     (`infrastructure/migration/LocalStorageMigrationRunRepository.ts`).

     NOOIT wissen: `lineup-tracker-lang` (taalvoorkeur),
     `lineup-tracker-trusted-device` (de vertrouwd-apparaatvlag zelf —
     blijft een apparaateigenschap), `lineup-tracker-bootstrap-org-id`
     (bootstrap-hervattingsstatus, PR 5.x), en de
     `lineup-tracker-cloud-imported-settings`/`-roster`-vlaggen (cloud-
     import-markers — per ongeluk wissen kan een ongewenste "herimport"-
     knop triggeren bij de volgende cloud-sessie).

     **Bijgewerkt na de implementatie (P1-reviewbevinding op PR #84):** een
     eerste versie construeerde de `${orgId}:${teamId}`-gescoopte sleutels
     alleen voor de op dat moment geselecteerde context — data van een
     ANDER, eerder op dit apparaat gebruikt team bleef daardoor stilzwijgend
     staan. `infrastructure/device/clearLocalDeviceData.ts` enumereert nu
     `listBrowserStorageKeys()` (`i18n/browserStorage.ts`) en wist elke
     daadwerkelijk aanwezige sleutel die matcht met een van de expliciete
     `PREFIX`-constanten (`ACTIVE_GAME_STORAGE_KEY_PREFIX`,
     `COMPLETED_GAMES_STORAGE_KEY_PREFIX`,
     `PENDING_FINALIZE_STORAGE_KEY_PREFIX`,
     `MIGRATION_RUN_STORAGE_KEY_PREFIX`,
     `GAME_SYNC_CHECKPOINT_STORAGE_PREFIX`) of de vaste witte-lijstsleutels
     hierboven — voor ELKE org/team/gameId op dit apparaat, niet alleen de
     huidige context. Nog steeds bewust geen `localStorage.clear()` en geen
     blinde scan over de volledige storage: alleen sleutels die matchen met
     een van deze welbewust gekozen prefixen/vaste sleutels worden ooit
     verwijderd, dus een toekomstige nieuwe sleutelfamilie moet bewust aan
     deze lijst toegevoegd worden.

   - Er is vandaag geen UI-pad om de vertrouwd-apparaatkeuze ná de
     initiële `TrustedDevicePrompt` te herzien (bijv. een gedeeld
     clubtablet dat per ongeluk als "vertrouwd" is gemarkeerd). 8.2c voegt
     een herroepbare instelling toe (bijv. in `SettingsPanel.tsx` of een
     apparaatgerichte sectie) die `writeTrustedDevice()` opnieuw aanroept
     en — bij een wissel van vertrouwd naar onvertrouwd — dezelfde
     wis-/herinitialisatielogica als `handleSignOut()` triggert.
6. **Oudere doeltelefoon/viewport: expliciete keuze, geen aanname.** De
   bestaande `v2/tests/e2e/mobile.spec.ts` gebruikt een iPhone-14-viewport
   (390×844) "voor consistentie met de v1-mobiele-suite"
   (`tests/mobile-lang.spec.js`) — een gangbaar, relatief modern formaat.
   Er is nog geen viewport/toestelprofiel dat een daadwerkelijk _ouder_ of
   kleiner doeltoestel simuleert. **Voorstel, met een open vraag aan de
   eigenaar (zie §D):** een tweede viewportprofiel toevoegen op basis van
   een kleiner/ouder scherm (bijv. 375×667, het iPhone-SE-2016-/8-formaat,
   nog steeds relevant courtside-materieel) plus een Playwright
   CPU-/netwerk-throttling-profiel (`page.route()`-vertraging of
   `client.send('Network.emulateNetworkConditions', ...)` via CDP) om een
   zwakke verbinding te simuleren. Dit dekt de bullet "gangbare
   telefoonviewports, oudere doeltelefoon" gedeeltelijk (viewport +
   netwerktraagheid zijn in Playwright simuleerbaar); een daadwerkelijk
   trager _fysiek_ toestel (lagere CPU, oudere WebKit/Chromium-engine) is
   in deze sandbox niet emuleerbaar — zie §D voor de bijbehorende
   restpunt-erkenning.

   **Eigenaarschap van dit besluit (externe review PR #80):** de 375×667-
   keuze is een voorstel, geen vastgelegd feit — degene die 8.2c
   implementeert kiest het definitieve profiel, met expliciete bevestiging
   van de repo-eigenaar vóór 8.2c gemerged wordt (niet vóór implementatie
   start — dat zou de sub-PR onnodig blokkeren). Zelfde "beslissing bij een
   echte-apparaat-gate, geen aanname"-discipline als de Safari/iPadOS-
   fallbackkeuze in `docs/pr-8.1-plan.md` §B punt 6/§C 8.1c.

7. **Zwakke/offline verbinding: hergebruik het bestaande PWA-/offline-
   testfundament, geen tweede parallelle suite.** PR 8.1 heeft al
   `v2/tests/e2e/pwa.spec.ts`, `pwa-update.spec.ts` en
   `pwa-classic-fallback.spec.ts` (offline-reload, update-detectie,
   asset-consistentie) en de auth-e2e-suite heeft al
   `offline-reload-cache-write-second-client.spec.ts`/
   `completed-history-offline-cache.spec.ts`. 8.2c voegt GEEN nieuwe
   "offline werkt"-suite toe die dat overlapt — het voegt alleen een
   _zwakke, niet-onderbroken_ verbinding toe (trage maar niet nul
   bandbreedte/latentie, via CDP-netwerkemulatie) als aanvulling op de
   bestaande volledig-offline-scenario's, specifiek gericht op UI-gedrag
   tijdens een lopende, langzame sync (blijft de score-/wisselbediening
   bruikbaar terwijl een upload op de achtergrond hangt, i.p.v. te
   blokkeren of te flikkeren) — geen nieuwe testing van het
   syncprotocol zelf (dat is al 7.1c/8.1-scope).

## C. Sub-PR's

### 8.2a — focus-infrastructuur, keyboard-navigatie en axe-core-baseline

**Voltooid** (#81, gemerged).

Werk:

1. Voeg `@axe-core/playwright` toe aan `v2/package.json` (devDependency) en
   maak `v2/tests/e2e/a11y-axe.spec.ts` met een scan per kernscherm uit §B
   punt 1 (incl. een geopend modaal-scherm, vóórdat de focus-trap uit werk
   2 er is — dit legt de NULMETING vast, zodat een latere regressie
   zichtbaar wordt).
2. Bouw `v2/src/infrastructure/a11y/focusTrap.ts` (§B punt 2): activeren/
   deactiveren, eerste-focusbaar-element-detectie, Tab/Shift+Tab-cyclus,
   focus-restore. Puur DOM-API, geen Preact-import in deze laag (zelfde
   regel als `infrastructure/pwa/PwaUpdateAdapter.ts`).
3. Bouw `v2/src/application/a11y/useFocusTrap.ts` — de Preact-hook die de
   module aan een dialoog-DOM-node koppelt via een `ref`.
4. Verbind de hook met `ModalDialog.tsx`, `GamesFilterModal.tsx` en
   `TakeoverConfirmDialog.tsx`. Verwijder de bestaande
   `role="document"`/backdrop-click/Escape-afhandeling niet — de focus-trap
   is een AANVULLING, geen vervanging van het bestaande sluitgedrag.
5. Voeg `v2/tests/e2e/a11y-keyboard.spec.ts` toe met minimaal: een modaal
   openen met het toetsenbord, bevestigen dat Tab binnen het dialoog
   blijft cyclen, Escape sluit het dialoog, en focus keert terug naar het
   element dat het dialoog opende.
6. Voeg unit-tests toe voor `focusTrap.ts` (jsdom: eerste-focusbaar-
   element-detectie met geneste/verborgen/`disabled`-elementen, Tab-cyclus
   aan begin/eind, restore na deactiveren zonder dat het onthouden element
   nog in de DOM zit).

Acceptatie:

- de axe-core-scan draait tegen elk kernscherm uit §B punt 1 en faalt bij
  elke `violations`-bevinding, ook `impact: 'minor'`;
- elk van de drie bestaande modals vangt focus zodra het opent en geeft
  focus terug aan het openende element zodra het sluit, geverifieerd via
  zowel de unit-tests (`focusTrap.ts` in isolatie) als de e2e-suite (de
  daadwerkelijke browser-DOM);
- Tab/Shift+Tab binnen een open modaal verlaat het modaal nooit naar de
  achtergrondpagina;
- bestaande `ModalDialog`/`GamesFilterModal`/`TakeoverConfirmDialog`-
  component- en e2e-tests (backdrop-click, Escape, clear/done-knoppen)
  blijven ongewijzigd groen;
- unit-, type-, lint-, format- en buildcontroles zijn groen.

### 8.2b — score-/wissel-/contextbediening, clubkleurcontrast en reduced-motion

**Voltooid** (PR #83, gemerged). Werk 1 (keyboard-
bediening) bleek bij onderzoek al volledig aanwezig in `LiveTrackingPanel.tsx`
en `AuthGate.tsx`'s teamswitcher (uitsluitend `<button>`/`<select>`-
elementen) — geen codewijziging nodig, alleen het e2e-bewijs uit werk 2.
Werk 3/4 (bug 10, `domain/settings/colorContrast.ts`) en werk 5 (reduced-
motion) zijn nieuw gebouwd. `DEFAULT_SETTINGS.accentColor` is tussentijds
(eerste P1-ronde) kort vervangen geweest (`#f97316` → `#c2410c`) omdat de
toenmalige aanpak `accentColor` als `.app-title`-tekstkleur gebruikte en de
oude default de axe-core-baseline (8.2a) niet haalde — na de derde
review-ronde (zie hieronder) is die reden vervallen en staat de default
weer op `#f97316`.

**P1-review-opvolging (28 aug. 2026, PR #83):** een eerste versie van
werk 3/4 toetste alleen tegen de lichte-modus-vaste kleuren en toonde bij
onvoldoende contrast een niet-blokkerende waarschuwing — maar
`tokens.css`'s `@media (prefers-color-scheme: dark)`-blok wijzigt die vaste
kleuren, waardoor `DEFAULT_SETTINGS`'s teamkleuren in donkere modus zelf
onder de AA-drempel renderden (axe-core `color-contrast`). Opgelost door
`colorContrast.ts` te herzien naar afgeleide, wiskundig gegarandeerd
leesbare voorgrondkleuren (`pickReadableColor`/`deriveButtonForeground`/
`deriveAccentForeground`) i.p.v. een vaste-referentie-waarschuwing — de
niet-blokkerende waarschuwing zelf is daardoor vervallen (kan niet meer
voorkomen). Nieuwe `tests/e2e/dark-mode-contrast.spec.ts` reproduceert en
sluit de exacte reviewbevinding.

**Tweede P1-review-opvolging (29 aug. 2026, PR #83):** `deriveAccent-
Foreground` (hierboven) loste de dark-mode-regressie op maar bleek zelf
een regressie te introduceren: tegen de lichte headerachtergrond haalt
geen van de tien presets uit `SettingsPanel.tsx` 4,5:1, dus alle tien
vielen terug op hetzelfde zwart — de accentkeuze werd onzichtbaar in de
gangbare lichte modus. Opgelost door `accentColor` niet meer als
`.app-title`-TEKSTkleur te gebruiken (die blijft de vaste `--lt-color-fg`)
maar als een puur decoratief accent (`border-left`, geen WCAG-
tekstcontrasteis) — zie de gecorrigeerde §B punt 4 hierboven.
`deriveAccentForeground` en de dubbele lichte/donkere-headerachtergrond-
constanten zijn daardoor uit `colorContrast.ts` verwijderd (dode code);
alleen `deriveButtonForeground` (voor `.btn-primary`) blijft over. Nieuwe
e2e-assertions in `settings.spec.ts`/`dark-mode-contrast.spec.ts` bewijzen
expliciet dat twee verschillende accent-presets tot twee verschillend
gerenderde accentranden leiden.

**Derde review-opvolging (P2, 29 aug. 2026, PR #83):** twee source-of-
truth-restpunten na de tweede ronde. (1) §B punt 4 en werk 4 hieronder
spraken de nieuwe acceptatiecriteria nog tegen — beide eisten nog
expliciet de inmiddels-vervallen niet-blokkerende contrastwaarschuwing;
tekst bijgewerkt naar het huidige automatische/decoratieve contract. (2)
`DEFAULT_SETTINGS.accentColor`'s wijziging naar `#c2410c` had geen
bestaansreden meer zodra `accentColor` alleen nog decoratief wordt
toegepast (geen WCAG-tekstcontrasteis) — teruggedraaid naar het
oorspronkelijke `#f97316`, geen aparte productreden om af te wijken.

Werk:

1. Breid de bestaande live-wedstrijdcomponenten (`LiveTrackingPanel.tsx`
   en de score-/wisselknoppen daarbinnen) uit zodat elke bedienbare actie
   (score toekennen, speler wisselen, kwart/segment wisselen,
   tabblad-/contextwissel via `AuthGate.tsx`'s teamswitcher) een
   daadwerkelijk focusbaar, met het toetsenbord activeerbaar element is
   (`<button>`/`tabindex`/`Enter`+`Spatie`-activatie) — geen `<div
onClick>`-patronen die alleen op tik/klik reageren. Waar
   `jsx-a11y/click-events-have-key-events`/`no-noninteractive-element-
interactions` vandaag al via een `eslint-disable`-commentaar is
   omzeild (zoals in `ModalDialog.tsx`), wordt per geval opnieuw
   beoordeeld of dat nog nodig is na deze werkstap.
2. Voeg `v2/tests/e2e/a11y-keyboard.spec.ts` (uit 8.2a) uit met scenario's
   voor score toekennen, een wissel uitvoeren en een contextwissel,
   volledig via `page.keyboard`, zonder muis-/tikinteractie.
3. Implementeer bug 10 (`docs/pr-5.5c-bugfixes.md`, punt 10): CSS custom
   properties (`--team-primary`/`--team-accent`) op root-niveau, gezet
   vanuit `settings.primaryColor`/`accentColor`, toegepast op de
   zichtbaar merkbare UI-elementen (primaire knoppen, headers) —
   dezelfde scope als bug 10's eigen aantekening, geen volledige
   thema-herbouw.
4. **Bijgewerkt (derde P2-review-ronde PR #83, 29 aug. 2026) — vervangt de
   oorspronkelijke "waarschuwing bij onvoldoende contrast"-eis.** Voeg een
   pure `domain/settings/colorContrast.ts`-functie toe
   (`pickReadableColor`/`deriveButtonForeground`) die, gegeven een
   gekozen kleur, automatisch een wiskundig gegarandeerd leesbare
   voorgrond kiest (wit of zwart, wat de hoogste WCAG-contrastratio geeft
   — altijd ≥4.5:1 tegen elke achtergrond, zie de garantie in
   `colorContrast.ts`'s bestandscommentaar) i.p.v. de kleur tegen een
   vaste referentie te toetsen en te waarschuwen. Toegepast op
   `.btn-primary`'s knoptekst. `.app-title`'s accentkleur krijgt GEEN
   afgeleide tekstvariant (zie de correctie in §B punt 4: dat viel voor
   alle presets terug op zwart) maar wordt uitsluitend decoratief
   toegepast (`border-left`), waar WCAG-tekstcontrast niet geldt. Omdat
   beide toepassingen hierdoor altijd conform zijn, is een aparte
   niet-blokkerende contrastwaarschuwing in `SettingsPanel.tsx` niet meer
   nodig — die bestaat dus bewust niet (meer).
5. Bevestig `prefers-reduced-motion` (§A): een gerichte e2e- of
   component-test die met `prefersReducedMotion: 'reduce'`
   (Playwright-contextoptie) bevestigt dat CSS-transities/-animaties
   daadwerkelijk uitstaan op minstens één zichtbaar geanimeerd element
   (bijv. de PWA-updatebanner of modal-overlay-transitie); geen nieuwe
   CSS nodig tenzij deze test een gat blootlegt.
6. Voeg unit-tests toe voor `colorContrast.ts` (bekende kleurparen met
   bekende contrastratio's, incl. grensgevallen rond de 4.5:1-/3:1-
   drempels).

Acceptatie:

- elke live-wedstrijdactie (score, wissel, contextwissel) is met een
  toetsenbord alleen volledig uitvoerbaar, geverifieerd door de e2e-suite;
- `primaryColor`/`accentColor` hebben een zichtbaar effect in de app (bug
  10 opgelost) dat WCAG-conform blijft in beide kleurenschema's:
  `primaryColor` als `.btn-primary`-achtergrond met een afgeleide leesbare
  knoptekst, `accentColor` als `.app-title`'s decoratieve accentrand (géén
  tekstkleur — zie de tweede P1-review-opvolging hierboven) — geverifieerd
  door e2e-tests die TWEE verschillende presets instellen en bevestigen dat
  ze tot twee verschillend gerenderde accentranden leiden, niet alleen dat
  de CSS custom property verandert;
- primaryColor's afgeleide knoptekst is wiskundig gegarandeerd ≥4,5:1
  contrast tegen elke gekozen kleur (`pickReadableColor`/
  `deriveButtonForeground`, `colorContrast.ts`) — er is dus geen "keuze
  met onvoldoende contrast"-toestand meer mogelijk voor deze toepassing,
  dus ook geen aparte waarschuwing nodig (de eerdere, inmiddels vervallen
  niet-blokkerende waarschuwing ging hiervan uit);
- `prefers-reduced-motion: reduce` onderdrukt aantoonbaar animaties/
  transities op minstens één geverifieerd element;
- bestaande `SettingsPanel`-, `LiveTrackingPanel`- en
  `GameSetupPanel`-tests blijven ongewijzigd groen;
- unit-, type-, lint-, format- en buildcontroles zijn groen.

### 8.2c — gedeeld apparaat, mobiele viewports en zwakke verbinding

Werk:

1. Breid `AuthGate.tsx`'s `handleSignOut()` uit: op het onvertrouwd-
   apparaatpad (`trusted === false`) worden naast `wipeLocalFirebaseData()`
   ook de lokale `localStorage`-sleutels van roster/games/settings
   gewist (§B punt 5) — nooit de taalvoorkeur, nooit de vertrouwd-
   apparaatvlag zelf.
2. Voeg een herroepbaar vertrouwd-apparaat-instelling toe (§B punt 5,
   tweede subpunt): een UI-pad om de keuze uit `TrustedDevicePrompt` later
   te herzien, met dezelfde wis-/herinitialisatielogica bij een wissel
   naar onvertrouwd.
3. Voeg een tweede, kleiner/ouder viewportprofiel toe aan
   `v2/tests/e2e/mobile.spec.ts` of een nieuw `mobile-legacy.spec.ts`
   (§B punt 6) en draai de bestaande mobiele-viewportscenario's (of een
   representatieve subset) ook tegen dat profiel.
4. Voeg CDP-netwerkemulatie (trage, niet-onderbroken verbinding) toe aan
   minstens één live-wedstrijdscenario (§B punt 7) — bevestigt dat score-
   /wisselbediening bruikbaar blijft tijdens een langzame achtergrondsync,
   zonder de bestaande volledig-offline-suites te dupliceren. **Oorspronkelijk
   voorgesteld scenario (externe review PR #80):** via
   `client.send('Network.emulateNetworkConditions', { offline: false,
latency: 1500, downloadThroughput: <3G-achtige bandbreedte>,
uploadThroughput: <idem> })` krijgt de Firestore-writeronde van een
   scoretoekenning ~1500ms vertraging; de test bevestigt dat (a) de
   score-knop tijdens die vertraging klikbaar blijft (geen UI-lock), en
   (b) een tweede score-toekenning binnen 5 seconden na de eerste — dus
   vóórdat de eerste upload klaar is — in de juiste volgorde verwerkt
   wordt (geen dubbele/omgewisselde acties, zelfde garantie als de
   bestaande actielog-idempotentie uit PR 7.1c).

   **Bijgewerkt na implementatie-ervaring (herreview PR #84):** wáchten op
   de uiteindelijke synchronisatie-uitkomst TERWIJL de netwerkemulatie
   actief bleef, bleek in CI structureel onbeslist te blijven hangen —
   herhaaldelijk exact op elke geprobeerde testtimeout, ongeacht
   throttleprofiel (met/zonder bandbreedteplafond) of op welk moment de
   emulatie werd ingeschakeld. Waarschijnlijke oorzaak: een structurele
   onverenigbaarheid tussen Chrome DevTools' netwerkemulatie en Firestores
   lang-lopende long-polling-transport
   (`experimentalForceLongPolling: true`, `firebaseClient.ts`) in de
   CI-omgeving, geen tekort aan wachttijd. `game-sync-weak-network.spec.ts`
   gebruikt daarom `latency: 500` zonder bandbreedteplafond, observeert
   `waitForGameSyncStatus(page, 'wacht-op-synchronisatie')` (nog steeds
   onder actieve emulatie) om aantoonbaar te bewijzen dat de tweede actie
   vóór het einde van de eerste upload komt, en schakelt de emulatie pas
   daarna uit vóórdat op de uiteindelijke `'gesynchroniseerd'`-uitkomst
   gewacht wordt. Beide kernclaims (a)/(b) hierboven blijven aantoonbaar
   bewezen.

5. Voeg unit-/component-tests toe voor de nieuwe uitloglogica (§B punt 5,
   eerste subpunt: welke sleutels wél/niet gewist worden) en voor het
   herroepbare instellingspad.

Acceptatie:

- uitloggen op een onvertrouwd, gedeeld apparaat laat geen team-/roster-/
  wedstrijddata achter in `localStorage` (geverifieerd door een test die
  de sleutels vóór en ná uitloggen vergelijkt);
- de taalvoorkeur en de vertrouwd-apparaatvlag zelf overleven uitloggen
  ongewijzigd (geen regressie op het bestaande, bewust vastgelegde
  gedrag);
- een gebruiker kan de vertrouwd-apparaatkeuze op elk moment herzien,
  niet alleen bij de initiële prompt;
- minstens één courtside-representatief kleiner/ouder viewportprofiel
  draait dezelfde kernscenario's als het bestaande iPhone-14-profiel,
  zonder horizontale overflow (zelfde controle als
  `assertNoHorizontalOverflow()` in `mobile.spec.ts`);
- score-/wisselbediening blijft bruikbaar (geen vastlopende UI) tijdens
  een geëmuleerde trage verbinding met een lopende achtergrondsync;
- unit-, type-, lint-, format- en buildcontroles zijn groen.

## D. Stopregels

- Geen regressie op de bestaande, groene `jsx-a11y`-lintbaseline
  (`v2/eslint.config.js`) — elke nieuwe/aangepaste component blijft
  lintschoon zonder nieuwe `eslint-disable`-onderdrukkingen tenzij die
  even goed onderbouwd zijn als het bestaande voorbeeld in
  `ModalDialog.tsx`.
- Geen scope-vermenging met PR 8.1 (PWA-updates/herstel, al voltooid) of
  PR 8.3 (Security Rules, App Check, kosten-/back-upbeleid, privacyveilige
  logging). Een eventuele a11y-gerelateerde foutrapportage blijft — net
  als 8.1's PWA-fouten — binnen het bestaande `SyncStatus`-
  diagnosecontract waar dat al van toepassing is; er komt geen nieuw,
  ongerelateerd loggingkanaal.
- Geen harde blokkade van wedstrijdstart of -opslag op basis van een
  contrastwaarschuwing (§B punt 4/8.2b) — een onvoldoende-contrast-melding
  is altijd niet-blokkerend, zelfde "waarschuwing, geen harde eis"-regel
  als 8.1b's pre-game-readinesscheck voor apparaten zonder SW-
  ondersteuning.
- De uitgebreide `handleSignOut()`-wislogica (8.2c werk 1) raakt
  UITSLUITEND het onvertrouwd-apparaatpad; een vertrouwd apparaat behoudt
  precies het gedrag van vóór 8.2 — geen stille uitbreiding van wat een
  vertrouwd apparaat bij uitloggen verliest.
- **Expliciet open restpunt, geen fysiek apparaat beschikbaar:** deze
  ontwikkelsandbox kan geen daadwerkelijk ouder/zwakker fysiek toestel
  (lagere CPU, oudere WebKit-/Chromium-motor) emuleren, en kan geen echte
  schermlezer draaien (VoiceOver op iOS/macOS, TalkBack op Android) —
  Playwright/Chromium is hier bovendien netwerkgeblokkeerd, zelfde
  beperking als de restpunten in `docs/pr-7.3-plan.md` §C (7.3c),
  `docs/pr-7.4-plan.md` §C (7.4c) en `docs/pr-8.1-plan.md` §C (8.1c). De
  in §B/§C voorgestelde viewport-/netwerkemulatie (Playwright-
  viewportgrootte + CDP-netwerkthrottling) en de axe-core-/
  keyboard-e2e-suites zijn een aantoonbare, geautomatiseerde benadering
  van "oudere doeltelefoon" en "toegankelijk", maar vervangen geen
  daadwerkelijke schermlezer-/oud-toestel-validatie. Dat werkitem blijft
  expliciet open tot een operator met toegang tot een courtside-
  representatief oud toestel én een echte schermlezer dit uitvoert en het
  resultaat hier (of in de bestaande `docs/IMPLEMENTATION_PLAN.md`
  §17-restpuntvermelding, niet als nieuwe losse regel) vastlegt — geen PR
  in dit plan mag "toegankelijkheid geverifieerd" claimen voordat dat is
  gebeurd.
- Geen productiecutover; na 8.2 volgt eerst 8.3, en pas daarna de
  expliciete fase-8-acceptatie uit `docs/IMPLEMENTATION_PLAN.md` §13.
