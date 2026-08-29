# Implementatieplan — Wheelchair Basketball Lineup Tracker

Status: actief implementatieplan voor afzonderlijke v2-/herbouwrepository
Repository: `camilovtrijp-coder/wheelchair-basketball-lineuptracker`
Oorspronkelijke basis: `main` op commit `e2684047985d13740b913938887ea692a6c44dc7`
Laatst gevalideerd: `main` op commit `f781e71e0c063abb9a4959b5cbc8d3f2a739eab0`
Bijgewerkt: 22 augustus 2026

## 1. Doel

In deze afzonderlijke repository een robuuste v2 van de Lineup Tracker bouwen, zonder de werkende productie-app of de productie-repository te benaderen of aan te passen. De in deze v2-repository aanwezige kopie van de app, plus uitsluitend door de eigenaar aangeleverde screenshots, exports en beschrijvingen, vormen de gedrags- en productreferentie. De nieuwe app moet bestaand wedstrijdgedrag, lokale gegevens, offline werking en CSV-compatibiliteit aantoonbaar behouden voordat een eventuele overstap plaatsvindt.

De volgorde is bewust:

1. huidig gedrag aantoonbaar vastleggen;
2. gegevensopslag en import beveiligen;
3. een settings/team-walking-skeleton in de modulaire frontend bouwen;
4. vroeg een veilige cloud-, tenancy- en synchronisatiearchitectuur kiezen;
5. cloud en multi-device eerst met settings/team bewijzen;
6. daarna de wedstrijd-, historie-, stats- en trendsflows herbouwen;
7. wedstrijdsync, migratie, toegankelijkheid en cutover afzonderlijk valideren;
8. multi-organisatie vanaf het platformfundament ondersteunen en pas na stabiele
   productie self-service groei en aanvullende productfuncties bouwen.

## 2. Huidige uitgangssituatie

Deze repository is bewust aangemaakt als veilige v2-/herbouwomgeving. De werkende en gepubliceerde app wordt elders beheerd. De locatie van die productiebron hoeft niet in deze repository of in agentinstructies te worden vastgelegd.

De meegekomen app is een browserlokale, installeerbare PWA en dient hier als functionele referentie. De belangrijkste eigenschappen zijn:

- wedstrijd-, team- en instellingsdata in `localStorage`;
- geen backend of synchronisatie;
- offline app-shell via `sw.js`;
- Nederlands en Engels;
- CSV-export en JSON-back-up/import;
- team-, wedstrijd-, stats-, trends- en historie-tabbladen;
- eventuele bestaande Netlify-configuratie is voor deze roadmap niet leidend en valt buiten scope;
- het grootste deel van CSS, HTML en JavaScript staat in `index.html`;
- de deterministische Playwright-suite dekt de kernflows, berekeningen, mobiel/taal, back-up/import en migratiefouten met assertions; screenshots zijn aanvullend.

## 3. Niet-onderhandelbare randvoorwaarden

Iedere implementatietaak moet aan deze regels voldoen:

- Behoud bestaande `localStorage`-keys en opgeslagen gebruikersdata, tenzij een expliciete en geteste migratie is toegevoegd.
- Behoud de bestaande Nederlandse CSV-kolommen en hun betekenis.
- Verander geen berekeningen zonder vooraf vastgelegde voorbeelden en tests.
- Voeg in fase 0 tot en met 3 geen backend, analytics, tracking of externe gegevensoverdracht toe.
- Voeg pas een backend toe nadat het architectuurbesluit uit fase 4 expliciet is goedgekeurd.
- Spelersgegevens, classificaties en wedstrijddata blijven tot en met fase 3
  uitsluitend lokaal op het toestel; daarna blijven ze altijd lokaal
  beschikbaar voor offline gebruik en synchroniseren ze alleen binnen de
  goedgekeurde cloudfase.
- Ook na database-introductie moet een wedstrijd zonder netwerk gestart, bijgehouden en afgerond kunnen worden.
- Behoud offline gebruik en installeerbaarheid als PWA.
- Behoud Nederlands en Engels; nieuwe zichtbare tekst moet in beide talen bestaan.
- Behoud werking op smalle mobiele schermen en met touchbediening.
- Gebruik geen externe runtime-dependency als dezelfde functie eenvoudig lokaal kan blijven.
- Vermijd één grote PR. Lever iedere fase op in kleine, afzonderlijk controleerbare PR’s.
- Werk nooit rechtstreeks op `main`.
- De productie-repository valt volledig buiten scope: niet opzoeken, openen, clonen, fetchen, vergelijken of wijzigen; maak daar ook geen branch, issue, comment, commit of PR.
- Vraag de eigenaar om een gerichte screenshot, export of beschrijving wanneer de lokale referentiekopie onvoldoende informatie bevat.
- Publiceer of deploy deze repository niet zonder een afzonderlijk expliciet besluit over cutover en hosting.
- Voeg vóór PR 5.5 geen nieuwe Netlify-specifieke code of controles toe;
  deployment wordt afzonderlijk goedgekeurd.
- Plaats nooit een Firebase service-accountkey, Admin SDK-credential,
  databasebeheersleutel, `service_role`-sleutel of ander geheim in browsercode,
  Git, build-output of logs.
- Beveilig iedere Firestore-route met geteste organisatie-, team- en
  rolgebonden Security Rules; test een eventuele Supabase-terugval met RLS.
- Gebruik één globale gebruikersidentiteit met app-level organisaties, teams en
  memberships; maak geen Firebase-project per club.
- Cloudmigratie is opt-in en mag een bestaande lokale wedstrijd of back-up nooit stilzwijgend verwijderen.

## 4. Definitie van gereed

Een taak is pas gereed wanneer:

- de afgesproken acceptatiecriteria aantoonbaar zijn behaald;
- relevante Playwright-tests slagen;
- bestaande tests nog slagen;
- er geen onverwachte console-errors zijn;
- de app na herladen dezelfde geldige status toont;
- Nederlandse en Engelse interfacepaden zijn gecontroleerd;
- mobiele weergave is gecontroleerd;
- bij wijzigingen aan caching of assets een platformneutrale productiebuild en offline app-shell zijn gecontroleerd;
- de PR beschrijft wat veranderde, welke risico’s bestaan en hoe is getest.
- bij databasewerk ook toegangsregels, migraties, constraints en negatieve autorisatietests zijn gecontroleerd;
- bij synchronisatiewerk ook offline wijzigingen, opnieuw verbinden, dubbele verzending en conflicten zijn getest.

## 5. Fase 0 — Inventarisatie van de lokale referentiekopie

### Doel

Eerst het werkelijke datamodel, de berekeningen en risicovolle statusovergangen van de in deze repository aanwezige referentiekopie beschrijven. Nog niets herstructureren. Zoek of benader de productie-repository niet.

### Taken

- Breng alle `localStorage`-keys en opgeslagen objectvormen in kaart.
- Beschrijf de levenscyclus van een wedstrijd: leeg, voorbereid, gestart, wissel in behandeling, segment opgeslagen en afgerond.
- Breng afgeleide waarden in kaart, waaronder score, speeltijd, plus/min, lineupcodes en classificatiesom.
- Documenteer CSV- en JSON-contracten.
- Benoem plekken waar spelers-ID’s, lineups en historische wedstrijden naar elkaar verwijzen.
- Benoem impliciete aannames, bijvoorbeeld precies vijf spelers op het veld.
- Maak onderscheid tussen bestaand gedrag, gewenste v2-verandering en nog onbevestigde aanname.
- Stel een functionele compatibiliteitsmatrix op waarmee de nieuwe app later naast de werkende app kan worden vergeleken.
- Noteer ontbrekende productie-informatie als vraag voor de eigenaar; probeer deze niet zelfstandig uit externe repositories te halen.

### Oplevering

- `docs/architecture/current-state.md`
- `docs/data-contracts.md`
- `docs/product-compatibility-matrix.md`
- Geen productiewijzigingen.

### Acceptatiecriteria

- Elk persistent veld heeft type, betekenis en standaardwaarde.
- Elke berekening heeft minimaal één handmatig narekenbaar voorbeeld.
- Risico’s bij verwijderen, importeren, wisselen en hervatten zijn expliciet beschreven.
- De productie-repository is niet geïdentificeerd, benaderd of genoemd.
- Voor ieder bestaand hoofdscherm staat welke functionaliteit v2 moet behouden, wijzigen of bewust laten vervallen.

### Modeladvies

`opencode-go/qwen3.7-plus` voor de inventarisatie; optioneel `opencode-go/glm-5.2` voor een tweede beoordeling van het datamodel.

## 6. Fase 1 — Betrouwbare functionele tests

### Doel

Het huidige gedrag vastleggen voordat structuur of dataopslag verandert.

### PR 1.1 — Deterministische testbasis

- Maak een herbruikbare Playwright-helper die een geldig team en instellingen plaatst.
- Gebruik vaste spelers-ID’s, rugnummers, namen en classificaties.
- Zorg dat iedere test met schone browseropslag begint.
- Vermijd conditionele stappen die geruisloos belangrijke paden overslaan.

Acceptatiecriteria:

- Tests starten altijd vanuit dezelfde toestand.
- Een test faalt duidelijk wanneer de wedstrijd niet kan starten.
- Screenshots zijn aanvullend; assertions bepalen slagen of falen.

### PR 1.2 — Volledige wedstrijdflow

Test minimaal:

- team invoeren en sorteren op rugnummer;
- deelnemers en vijf starters kiezen;
- wedstrijd starten;
- punten voor en tegen registreren;
- één en meerdere gelijktijdige wissels bevestigen;
- wissel op nul seconden zonder leeg segment;
- segment bewerken en verwijderen;
- score opnieuw afleiden uit segmenten;
- wedstrijd afronden;
- wedstrijd terugvinden in Historie;
- correcte totalen in Stats en Trends.

Gebruik een klein, handmatig narekenbaar scenario. Controleer minimaal:

- score = som van segmentpunten;
- plus/min = punten voor minus punten tegen;
- totale lineup-minuten = gespeelde wedstrijdminuten;
- totale speler-minuten = vijf maal de gespeelde wedstrijdminuten;
- lineupcode bevat vijf oplopend gesorteerde rugnummers.

### PR 1.3 — Hervatten, back-up en import

Test minimaal:

- pagina herladen tijdens een lopende wedstrijd;
- hervatten met dezelfde score, spelers en segmenten;
- export van een volledige JSON-back-up;
- import in een lege browsercontext;
- behoud van team, instellingen en geschiedenis;
- afwijzen van ongeldige JSON zonder bestaande data te beschadigen.

### PR 1.4 — Mobiele en taaltests

- Voeg minimaal één gangbare telefoonviewport toe.
- Test kernflow in het Nederlands.
- Test minimaal navigatie, hoofdlabels en nieuwe foutmeldingen in het Engels.
- Controleer dat tweecijferige rugnummers zichtbaar blijven.

### PR 1.5 — GitHub Actions CI

- Voeg een workflow toe die bij pull requests en pushes naar `main` draait.
- Voer `npm ci` uit.
- Installeer Chromium voor Playwright.
- Voer `npm test` uit.
- Bewaar bij testfouten het Playwright-rapport als artifact.
- Wijzig geen productiecode en voeg geen deployment toe.

### PR 1.6 — Dekking van fase-1-acceptatiegaten

Vult de gaten die in de onafhankelijke review na PR 1.5 zijn geconstateerd,
zonder productiecode te wijzigen:

- meerdere gelijktijdige wissels bevestigen;
- wissel op nul seconden zonder leeg segment;
- deelnemers en vijf starters expliciet kiezen;
- geïmporteerde historie zichtbaar in de interface;
- Engelse foutmelding bij ongeldige back-up;
- touch-viewport voor kritieke wedstrijdacties;
- lineupcode bevat exact vijf oplopend gesorteerde rugnummers;
- totale speler-minuten = vijf maal gespeelde wedstrijdminuten;
- plus/min = punten voor min punten tegen (expliciet);
- syntactisch geldige JSON met ongeldig schema (`data` als string) mag geen
  bestaande `BACKUP_KEYS` verwijderen en mag geen bevestigingsdialoog tonen.

De laatste testcase staat bekend als P0-1 uit de review. Omdat dit een
productcode-bug is, werd die testcase in PR 1.6 als `test.fail()` gemarkeerd.
PR 1.7 lost P0-1 op door `payload.data` structureel te valideren.

### Modeladvies

`opencode-go/kimi-k2.7-code` voor implementatie. Laat de berekeningsassertions zo mogelijk reviewen met `opencode-go/glm-5.2`.

## 7. Fase 2 — Data-integriteit en migraties

Status: voltooid via PR #9, #10 en #12, met review-opvolging in PR #13 en #14.

### Doel

Voorkomen dat toekomstige wijzigingen lokale wedstrijdgeschiedenis of back-ups onbruikbaar maken.

### PR 2.1 — Expliciete schemaversie

- Voeg een schemaversie toe aan geëxporteerde back-ups.
- Definieer de huidige opgeslagen vorm als versie 1.
- Zorg dat oudere data zonder versie gecontroleerd als versie 1 wordt gelezen.
- Verander bestaande opslag zo weinig mogelijk.

### PR 2.2 — Importvalidatie

- Valideer de volledige import vóórdat bestaande browserdata wordt overschreven.
- Controleer vereiste collecties, typen en referenties.
- Toon een begrijpelijke foutmelding in Nederlands en Engels.
- Log geen spelers- of wedstrijddata naar externe diensten.

### PR 2.3 — Migratieraamwerk

- Voeg een kleine, pure migratiefunctie toe: `migrate(data, fromVersion, toVersion)`.
- Maak migraties opeenvolgend en herhaalbaar.
- Voeg fixtures toe voor oude, huidige, ongeldige en toekomstige versies.
- Weiger een onbekende toekomstige versie veilig.

### Acceptatiecriteria

- Een mislukte import laat de bestaande data functioneel intact.
- Een bestaande geldige back-up blijft importeerbaar.
- Migraties kunnen zonder DOM of browser worden getest.

### Modeladvies

`opencode-go/glm-5.2` voor ontwerp en risicobeoordeling; `opencode-go/kimi-k2.7-code` voor de afgebakende implementatie.

## 8. Fase 3 — Frontend-walking-skeleton

### Doel

De eerste echte verticale v2-flow bouwen en daarmee de grenzen uit ADR-000
bewijzen. De v1-`index.html` blijft een gedragsreferentie; de nieuwe UI wordt
opnieuw ontworpen als componenten en use-cases en niet regel voor regel vertaald.

### PR 3.1 — minimale scaffold

Status: voltooid via PR #16.

### PR 3.2a — technisch fundament

Scope:

- splits browser- en Node/config-TypeScript (`tsconfig.app.json` en
  `tsconfig.node.json` of aantoonbaar gelijkwaardig);
- maak runtime-i18n typeveilig, behoud wisselen tussen Nederlands en Engels
  zonder reload en bewaar alleen `lineup-tracker-lang`;
- voeg de v2-Playwright-harness toe naast de bestaande v1-suite;
- voeg `vite-plugin-pwa` in `injectManifest`-modus toe met manifest, iconen en
  een controleerbare service worker;
- leg de CSS-basis vast met gewone CSS/CSS Modules en centrale design tokens;
  voeg nog geen Tailwind, componentbibliotheek of router toe;
- voeg statische toegankelijkheidslinting toe voor JSX en controleer minstens
  toegankelijke namen, documenttaal en toetsenbordbereikbaarheid van de
  shellbediening.

Buiten scope:

- instellingen, spelers of wedstrijden opslaan;
- Firebase/Supabase, Netlify-configuratie of externe gegevensoverdracht;
- bundle-analysetooling zonder concrete regressie.

Acceptatiecriteria:

- `lint`, formattering, Vitest, v2-Playwright en productiebuild draaien in CI;
- de app kan worden geïnstalleerd en na één online bezoek offline herladen;
- een NL/EN-wissel werkt zonder reload en na reload blijft de keuze behouden;
- v1-`localStorage` behalve de taalkey blijft onaangeraakt;
- de v1-Playwright-suite blijft groen.

### PR 3.2b — verticale flow Instellingen

Scope:

- definieer `Settings`, defaults, decoder/validatie en pure normalisatie;
- definieer `SettingsRepository` als application-port en use-cases voor lezen
  en wijzigen;
- implementeer een localStorage-adapter voor exact
  `lineup-tracker-settings`;
- bouw de instellingen-UI met volledige v1-veldpariteit: teamnaam, logo,
  kleuren, periodes en optionele classificatie-/bonusinstellingen;
- gebruik autosave met blur of korte debounce en toon herstelbare
  validatiefouten in NL en EN;
- voeg unit-, repository- en Playwright-tests toe.

Buiten scope:

- teamspelers, lineupcode, wedstrijdstate en cloudopslag;
- een nieuwe opslagkey of stil gewijzigde settingsvorm.

Acceptatiecriteria:

- geldige bestaande v1-instellingen verschijnen correct in v2;
- wijzigen en herladen behoudt exact dezelfde betekenis en sleutel;
- corrupte opslag wordt veilig afgehandeld zonder andere keys te wijzigen;
- UI importeert geen concrete localStorage-adapter;
- touch-, toetsenbord-, NL- en EN-paden zijn getest.

### PR 3.2c — verticale flow Team

Scope:

- definieer `Player`/`Roster`, stabiele speler-ID's en pure validatieregels;
- definieer `RosterRepository` en use-cases voor toevoegen, wijzigen,
  sorteren en verwijderen;
- implementeer een localStorage-adapter voor exact
  `lineup-tracker-roster`;
- bouw de Team-UI met rugnummer, naam, classificatie en beide categorievlaggen;
- behoud numerieke rugnummersortering en het bestaande gedrag bij duplicaten;
- blokkeer of bevestig verwijdering volgens het gedocumenteerde referentiegedrag,
  zonder wedstrijdkeys te muteren;
- voeg unit-, repository- en Playwright-tests toe.

Buiten scope:

- deelnemers/starters, lineupcode, live wedstrijd, historie of cloud;
- mutatie van `lineup-tracker-v1` of `lineup-tracker-games`.

Acceptatiecriteria:

- een bestaande v1-roster wordt zonder migratieverlies getoond;
- toevoegen, wijzigen, sorteren en verwijderen blijven na reload correct;
- de volledige settings/team-flow werkt offline op een telefoonviewport;
- laaggrenzen, i18n, PWA en beide testsoorten zijn in één walking skeleton
  aantoonbaar bewezen;
- v1 blijft ongewijzigd en alle bestaande regressietests blijven groen.

### Poort na PR 3.2c

Voer een expliciete architectuurreview uit. Beoordeel importgrenzen,
opslagcompatibiliteit, PWA-updategedrag, mobiele bediening, toegankelijkheid en
testdekking. Ga niet direct verder met alle overige HTML-schermen. Eerst volgt
fase 4, zodat cloud- en synchronisatiekeuzes vroeg genoeg invloed hebben op IDs,
repositories en het wedstrijdmodel.

## 9. Fase 4 — Firebase-, offline- en autorisatiebesluiten

### Doel

De voorkeursroute **Netlify + Firebase Authentication + Cloud Firestore**
formaliseren en met fictieve data toetsen vóórdat complexe wedstrijdflows worden
gebouwd. Supabase wordt alleen onderzocht als een vooraf gedefinieerde harde
Firebase-gate faalt. Er wordt nog geen productieproject of deployment gemaakt.

### PR 4.1 — ADR-001 clouddata en hosting

Maak `docs/architecture/adr-001-cloud-data-platform.md`:

- leg Firebase Auth + Firestore vast als voorkeursbackend en Netlify als
  afzonderlijke frontendhost;
- vergelijk de beslissende verschillen met Supabase en een eigen API;
- valideer actuele regio, DPA/AVG, quota, prijsplan, back-ups, herstel en exit;
- leg vast dat development, staging en productie aparte Firebase-projecten
  gebruiken en previews nooit productie benaderen;
- definieer de meetbare gates voor eventuele terugval naar Supabase.

### PR 4.2 — ADR-002 offline synchronisatie

Maak `docs/architecture/adr-002-offline-sync-strategy.md`:

- Firestore `persistentLocalCache` op vertrouwde Chrome-, Safari- en
  Firefox-apparaten, met duidelijke fallback bij onbeschikbaarheid;
- `fromCache`/pending-write metadata vertalen naar `Lokaal beschikbaar`,
  `Wacht op synchronisatie`, `Gesynchroniseerd` en `Actie nodig`;
- clientgegenereerde UUID's en append-only wedstrijdacties in plaats van één
  overschreven wedstrijdmegadocument;
- objectgerichte conflicten, tombstones en herstel bij latere rule-weigering;
- één actieve scorer, read-only meekijkers en expliciete overname;
- pre-game offline-readinesscheck voor app-shell, sessie, context, roster en
  instellingen.

### PR 4.3 — ADR-003 organisaties, teams en autorisatie

Maak `docs/architecture/adr-003-tenancy-and-authorization.md`:

- één globale Firebase-gebruiker met memberships bij meerdere organisaties en
  teams; geen Firebase-project of formele Firebase-tenant per club;
- hiërarchie `organizations/{organizationId}/teams/{teamId}` met seizoenen,
  spelers, wedstrijden en acties onder de teamcontext;
- rollen `organizationOwner`, `organizationAdmin`, `coach`, `scorer`, `viewer`;
- zelf eerste organisatie/team maken; verdere toegang via uitnodiging van
  owner/admin;
- leg de uitnodigingsacceptatie vast zonder client-side self-grant; bewijs de
  gekozen invitation-document/Rules-flow in de Emulator of motiveer een nauw
  begrensde serverfunctie en vraag vóór Blaze-gebruik expliciete goedkeuring;
- Security Rules op deterministische membershippaden en querycontracten die
  dezelfde organisatie-/teamscope afdwingen;
- laatste eigenaar, intrekken van toegang, account-/teamverwijdering,
  bewaartermijnen en minimale persoonsgegevens.

### PR 4.4 — begrensde Firebase-spike

- gebruik Firebase Emulator Suite en uitsluitend fictieve data;
- implementeer één settings- en één rosterdocument via de bestaande
  repository-ports;
- bewijs offline wijzigen, reload, reconnect en teruglezen op een tweede client;
- bewijs twee organisaties voor één gebruiker met verschillende rollen;
- test verboden cross-organisatiequery, self-promotion en schrijven per rol;
- simuleer intrekking terwijl een write queued is en behoud de geweigerde actie
  herstelbaar;
- documenteer reads/writes, documentvormen, noodzakelijke indexes en resterende
  kosten-/exportrisico's; verwijder of isoleer spikecode na het besluit.

### Harde beslisgates

Firebase wordt definitief geaccepteerd wanneer:

- gecachte settings/teamdata offline leesbaar en schrijfbaar blijven;
- synchronisatie na reconnect geen stille duplicaten of verliezen veroorzaakt;
- Security Rules de volledige rol- en organisatie-isolatiematrix afdwingen;
- queries, export, verwijdering en verwachte statistiekvolumes beheersbaar zijn;
- een ongecachete context offline niet als leeg team wordt getoond;
- de eigenaar kosten, regio, gegevensverwerking en herstel accepteert.

Faalt één gate, stop dan verdere platformbouw en voer dezelfde spike uit met
Supabase + IndexedDB/outbox. De vergelijking gebruikt dezelfde flows en
acceptatiecriteria, niet alleen platformfeatures op papier.

### Acceptatiecriteria

- ADR-001 t/m ADR-003 zijn expliciet geaccepteerd;
- de spike en Emulator-tests zijn reproduceerbaar en gebruiken fictieve data;
- de gekozen oplossing en verworpen alternatieven zijn meetbaar onderbouwd;
- productie-Firebase, Netlify-deployment en echte spelersdata blijven buiten
  scope.

## 10. Fase 5 — Firebase-platformfundament en multi-organisatiepilot

### Doel

Cloud, authenticatie, autorisatie, offline caching en contextwisselen aantonen
met de al gebouwde settings/team-flow. Multi-organisatie is hier kernscope en
niet uitgesteld tot een latere groeifase.

### PR 5.1 — reproduceerbare Firebase-basis

- Firebase CLI-configuratie, Firestore Rules, indexes en emulatorconfig in Git;
- projectconfig voor development/staging/production zonder echte IDs of
  credentials in tests;
- Firestore-converters/decoders en typed documentcontracten;
- fictieve seeddata voor twee organisaties, drie teams en alle rollen;
- positieve en negatieve Rules-tests in CI;
- geen Admin SDK/service-accountkey in browsercode of clienttests.

Acceptatiecriteria:

- emulator en tests starten vanaf een schone checkout;
- een gebruiker kan zichzelf niet promoveren of een membership schrijven;
- organisatie A kan organisatie B via geen toegestane query lezen of wijzigen.

### PR 5.2 — authenticatie, onboarding en contextwisselaar

- e-mail/wachtwoord; optioneel Google-login; aanmelden, sessieherstel en uitloggen;
- eerste organisatie/team aanmaken na nieuwe registratie;
- uitnodiging accepteren en memberships voor meerdere organisaties/teams tonen;
- contextwisselaar met rol per team en uitsluitend geautoriseerde contexten;
- duidelijke states voor offline, niet-ingelogd, toegang ingetrokken, lege en
  ongecachete context;
- keuze `vertrouwd apparaat` voor persistente cache en expliciete lokale
  gegevenswissing bij uitloggen op een gedeeld apparaat.

Acceptatiecriteria:

- één account wisselt tussen Rotterdam Basketball en de Nederlandse
  Basketball Bond zonder opnieuw in te loggen;
- verschillende rollen per team worden correct toegepast;
- intrekken bij organisatie A verandert toegang tot organisatie B niet;
- eerste login of ongecachete context vraagt duidelijk om netwerk.

### PR 5.3 — Firestore-cache en settings/team-sync

- Firebase-adapters achter bestaande `SettingsRepository` en
  `RosterRepository`; UI importeert geen Firebase SDK;
- persistent local cache alleen na vertrouwd-apparaatkeuze en fallback naar
  memory/lokale modus bij niet-ondersteunde browsers;
- geteste, opt-in kopie van geldige v1-localStorage naar de gekozen teamcontext;
- syncstatussen op basis van cache- en pending-write metadata;
- geweigerde queued writes worden `Actie nodig`, lokaal herstelbaar en
  exporteerbaar;
- v1-localStorage standaard niet verwijderen; pas na serverbevestiging,
  verificatie en downloadbare back-up kan later worden opgeruimd.

Acceptatiecriteria:

- settings/roster werken offline na een eenmalige online voorbereiding;
- reload/crash verliest geen lokaal bevestigde wijziging;
- dezelfde wijziging verschijnt na reconnect exact één keer op apparaat B;
- een ongecachete context wordt niet als lege roster geïnterpreteerd.

### PR 5.4 — multi-organisatie- en twee-apparatenpilot

- voer de volledige autorisatiematrix uit voor owner, admin, coach, scorer en
  viewer;
- wijzig settings/roster op apparaat A offline en lees ze na reconnect op B;
- wissel op beide apparaten tussen minstens twee organisaties en drie teams;
- trek één membership in terwijl een write queued is;
- test gelijktijdige niet-conflicterende writes en een bewust conflict;
- leg werkelijk Firestore-verbruik voor de pilotscenario's vast.

Acceptatiecriteria:

- cross-organisatietoegang en self-promotion mislukken aantoonbaar;
- rolgrenzen zijn zowel in UI als Security Rules afgedwongen;
- conflict of rule-weigering veroorzaakt geen stil dataverlies;
- de gebruiker ziet bron, actualiteit en syncstatus van data.

### PR 5.5 — Netlify staging en GitHub-flow

**Mag zonder hostingopdracht (5.5a, eigenaarsbesluit 10 aug. 2026 — zie
`docs/pr-5.5-plan.md`):** Firebase-webconfig per deploycontext structureren
in de broncode (`resolveWebConfig()`, env-gestuurd, default blijft de
huidige emulator-development-modus). Dit is een pure applicatielaag-refactor
zonder Netlify-bestanden, zonder echte project-secrets en zonder gedragswijziging
in CI/dev — geen "hostingwijziging" in de zin van AGENTS.md §"Veiligheidsgrenzen"
regel 40.

**Mag eveneens zonder hostingopdracht (5.5b-config, eigenaarsbesluit 12 aug.
2026 — zie `docs/pr-5.5-plan.md` §E.6):** base directory, `npm run build` en
`dist` vastleggen in een eigen `v2/netlify.toml` (los van het onaangeraakte
root-`netlify.toml` voor v1). Net als 5.5a heeft dit geen hostingeffect
zolang er geen Netlify-site bestaat die het bestand leest — er wordt geen
site aangemaakt of aan GitHub gekoppeld.

Alleen na afzonderlijke expliciete hostingopdracht (5.5b-activatie/5.5c):

- maak de Netlify-site voor v2 aan en koppel die aan GitHub met "Base
  directory" = `v2`, zodat `v2/netlify.toml` wordt gelezen;
- maak GitHub-gekoppelde Deploy Previews voor pull requests;
- controleer of het bestaande Netlify-account een legacy- of credit-based plan
  gebruikt en leg quota/kosten vast; geen betaalde upgrade of auto-recharge;
- wijs Deploy Previews uitsluitend naar development/staging Firebase, nooit
  productie;
- injecteer de Firebase-webconfig per deploycontext via Netlify
  environment-variables (bouwt voort op de 5.5a-structuur);
- controleer PWA-headers, directe assetroutes en offline reload;
- publiceer nog niet naar het bestaande productieadres.

### Fase-acceptatie

- twee browsers/apparaten delen settings/team zonder lokaal dataverlies;
- één account gebruikt veilig meerdere organisaties en teams;
- Emulator-tests bewijzen organisatie-, team- en rolisolatie;
- hosting en backend blijven los vervangbare adapters;
- geen productieomgeving is aangemaakt of gepubliceerd zonder aparte opdracht.

## 11. Fase 6 — Overige v1-flows modulair herbouwen

### Doel

Nu de volledige architectuurketen is bewezen, de rest van de monoliet in kleine
verticale flows vervangen. Elke PR levert UI, domain, application,
infrastructure en tests voor één gebruikersdoel. Alle data hoort aantoonbaar bij
de actieve organisatie/teamcontext.

### PR 6.1 — wedstrijdopzet

- deelnemers, precies vijf starters, tegenstander, competitie, klokrichting en
  classificatielimiet;
- stabiele wedstrijd- en game-player-UUID's en historische spelersnapshot;
- startvalidatie en hervatten van een reeds gestarte (fase 'tracking')
  wedstrijd — exacte v1-pariteit: een nog niet gestarte opzet (fase 'setup')
  overleeft een reload bewust NIET en wordt vers vanaf de actuele roster
  herderived, precies zoals v1's `init()`;
- actieve organisatie/teamcontext verplicht opslaan (eigen sleutel per
  organisatie/team, zie infrastructure/game/LocalStorageGameRepository.ts);
  het hárd vergrendelen van de contextwisselaar tijdens een lopende wedstrijd
  is bewust doorgeschoven naar PR 7.3, samen met single-writer-sync;
- v1-key (`lineup-tracker-v1`) blijft tijdens de compatibiliteitsperiode
  leesbaar: een nog actieve v1-wedstrijd wordt bij een lege v2-load als
  voorstel getoond (`ui/game/V1MigrationPrompt.tsx`), getagd met de actuele
  organisatie/teamcontext — v1 kende zelf geen organisatie/teamcontext, dus
  alleen de gebruiker kan bevestigen dat dit het juiste doelteam is; pas ná
  expliciete bevestiging wordt de wedstrijd geschreven en de (niet-per-team)
  migratievlag gezet (zie domain/game/v1Migration.ts,
  infrastructure/game/LocalStorageGameRepository.ts);
- alleen rollen met de aparte `canWriteGameData`-bevoegdheid (owner, admin,
  coach, scorer — zie domain/organizations/teamAccess.ts) mogen de
  wedstrijd-UI schrijven; dit is een eigen, ruimere bevoegdheid dan
  `canManageTeamData` (roster/instellingen), zodat een scorer wél
  wedstrijdacties mag uitvoeren zonder roster/instellingen te mogen bewerken.

### PR 6.2 — live wedstrijd offline-first

- scorebediening, klok/segmenttijd, wissels en classificatiewaarschuwing;
- pure segment-, score-, speeltijd- en lineupberekeningen;
- iedere bevestigde handeling als lokale, append-only actie met unieke ID;
- vliegtuigmodus en app-crash mogen geen bevestigde actie verliezen;
- score en status zijn reproduceerbaar uit acties; nog geen multi-writer.

### PR 6.3 — afronden, historie en export

- afgeronde wedstrijd plus afleidbare snapshot bewaren;
- historie, detail en verwijderen volgens het vastgelegde beleid;
- afgeronde wedstrijd standaard onveranderlijk;
- byte-exact gelijk Nederlands CSV-contract;
- semantisch gelijk JSON-back-upcontract of expliciet gemigreerde versie.

### PR 6.4 — statistieken

Voorbereidingsplan: [`docs/pr-6.4-plan.md`](pr-6.4-plan.md).

- lineupcombinaties, on/off, plus/min, speeltijd en per-10-minuten;
- handmatig narekenbare fixtures;
- totalen blijven afleidbaar uit bronacties/segmenten en niet alleen caches;
- meet Firestore-querykosten, maar bouw nog geen cloudbrede rapportagelaag.

### PR 6.5 — trends

Voorbereidingsplan: [`docs/pr-6.5-plan.md`](pr-6.5-plan.md).

- chronologische spelertrends, gemiddelde speeltijd en plus/min;
- lopende wedstrijd als voorlopig datapunt volgens v1-gedrag;
- mobiele weergave en lege/partiële/cachedata duidelijk onderscheiden.

### PR 6.6 — back-up, import en lokale migratie

Voorbereidingsplan: [`docs/pr-6.6-plan.md`](pr-6.6-plan.md).

- bestaande v1-back-up valideren en veilig migreren;
- preview vóór import en automatische downloadbare back-up;
- gebruiker kiest expliciet doelorganisatie en doelteam;
- lege, oude, gedeeltelijke, dubbele en mislukte migratie testen;
- alleen-lokale modus blijft mogelijk zolang de gebruiker cloud niet kiest.

### Acceptatiecriteria

- de compatibiliteitsmatrix is per flow afgedekt;
- CSV is byte-exact en JSON semantisch compatibel;
- volledige wedstrijd kan lokaal/offline worden gespeeld en afgerond;
- actieve wedstrijd kan niet stil van organisatie/team wisselen;
- geen UI-component praat rechtstreeks met Firestore, IndexedDB of localStorage.

## 12. Fase 7 — Wedstrijdsync en migratie naar gedeeld gebruik

### Doel

De complexe wedstrijddata pas synchroniseren nadat zowel de live lokale flow als
de eenvoudige settings/team-sync bewezen zijn.

### Aanbevolen uitvoeringsvolgorde en gates

De bouw volgt één expliciete keten. Voltooide PR's 5.3 en 5.4 worden niet
opnieuw gebouwd, maar staan bewust vooraan omdat hun bewezen contracten en
resterende praktijkpoorten fase 7 begrenzen:

1. **PR 5.3 — voltooid fundament:** async settings/roster-repositories,
   persistente cache, syncstatus en `Actie nodig`; de oorspronkelijke #27-gate
   is gesloten op de gedocumenteerde verkleinde scope.
2. **PR 5.4 — voltooid pilotbewijs:** twee devices, contextisolatie,
   conflict/reload, queued revoke en field-patchbehoud. Echte mobiele
   pending-write-reload en billable stagingmeting blijven open voor 5.5c.
3. **PR 7.0 — dit documentatiepakket:** ADR-verduidelijking en uitvoerbare
   plannen voor 7.1–7.4; geen productcode of deployment.
4. **PR 7.1a → 7.1b → 7.1c:** cloudcontracten/checkpoint → Rules/queries →
   coordinator/idempotente sync.
5. **Praktijkpoort 5.5b-activatie + 5.5c:** alleen na afzonderlijke
   hostingopdracht de v2-stagingsite en Firebase-staging activeren; daarna de
   echte iOS/Android-offline-reload en billable Firestore-baseline uitvoeren.
   Zonder deze poort mag emulatorontwikkeling verder, maar fase-7-acceptatie
   niet als voltooid worden gemarkeerd.
6. **PR 7.2a → 7.2b → 7.2c:** completed upload → cloudhistorie → tombstones en
   twee-device-pilot.
7. **PR 7.3a → 7.3b → 7.3c:** writerclaim/epoch → live viewer-sync → expliciete
   overname/recovery/echte apparaten.
8. **PR 7.4a → 7.4b → 7.4c:** inventarisatie/preview → hervatbare coordinator →
   migratie-UI/e2e.
9. Sluit fase 7 pas nadat de volledige fase-acceptatie én de uit 5.3/5.4
   overgenomen praktijkpoorten aantoonbaar zijn uitgevoerd; ga daarna naar
   fase 8.

### PR 7.1 — Firestore-wedstrijdmodel

Voorbereidingsplan: [`docs/pr-7.1-plan.md`](pr-7.1-plan.md).

Sub-PR's: 7.1a cloudcontracten/converters/checkpoint; 7.1b Security Rules en
queries; 7.1c `GameSyncCoordinator` en idempotente upload.

- `games/{gameId}` voor identiteit/status/snapshot en
  `games/{gameId}/actions/{actionId}` voor append-only bronacties;
- actions dragen auteur, client-ID, volgnummer, tijd en organisatie/teamcontext;
- historische spelergegevens blijven onveranderlijk;
- score, plus/min en speeltijd blijven reproduceerbaar;
- documentgrootte, indexes, reads/writes en exportbaarheid worden getest.

### PR 7.2 — afgeronde wedstrijden synchroniseren

Voorbereidingsplan: [`docs/pr-7.2-plan.md`](pr-7.2-plan.md).

Sub-PR's: 7.2a idempotent afronden/uploadstatus; 7.2b cloudhistorie/tweede
apparaat; 7.2c tombstones en pilotbewijs.

- clientgegenereerde IDs maken retries idempotent;
- voortgang en herstelbare foutstatus;
- verwijdering met tombstone en bewaarbeleid;
- historie op een tweede apparaat beschikbaar;
- afgeronde wedstrijd standaard onveranderlijk.

### PR 7.3 — actieve wedstrijd single-writer

Voorbereidingsplan: [`docs/pr-7.3-plan.md`](pr-7.3-plan.md).

Sub-PR's, alle drie **geïmplementeerd** (zie §17-statustabel +
`docs/pr-7.3-plan.md` §C): 7.3a writerclaim/epoch/pre-game-gate (#66); 7.3b
live writer-sync en read-only viewer (#68); 7.3c overname/recovery/echte-
apparaatvalidatie (#69) — de overname-UI/-bevestigingsflow en emulator-e2e
zijn gebouwd; de ECHTE-apparaat-validatie (iOS/Android-hardware) kon niet in
de sandbox worden uitgevoerd en staat expliciet open voor fase-7-acceptatie.

- expliciet scorer-eigenaarschap/lease met auditvelden;
- andere apparaten read-only met zichtbare cache-/serveractualiteit;
- expliciete overname met revisiecontrole en sterke bevestiging;
- verlies van netwerk blokkeert de actieve scorer niet;
- dubbele of late actions veranderen score/segmenten niet;
- organisatie/teamcontext blijft gedurende de wedstrijd vergrendeld.

### PR 7.4 — bestaande gebruiker naar cloud

Voorbereidingsplan: [`docs/pr-7.4-plan.md`](pr-7.4-plan.md).

Sub-PR's, alle drie **geïmplementeerd** (zie §17-statustabel +
`docs/pr-7.4-plan.md` §C): 7.4a inventarisatie/mapping/preview (#70); 7.4b
hervatbare migratiecoordinator (#71); 7.4c migratie-UI en volledige e2e (#72)
— de staging-pilot met fictieve data (billable reads/writes) kon niet in de
sandbox worden uitgevoerd en staat expliciet open voor fase-7-acceptatie.

- toon vooraf te migreren teams, spelers en wedstrijden;
- laat account, doelorganisatie en doelteam bevestigen;
- deterministische mapping voorkomt duplicaten bij opnieuw proberen;
- rollback en lokale back-up blijven beschikbaar;
- cloudmigratie is opt-in en wist de bron niet automatisch.

### Acceptatiecriteria

- een wedstrijd kan volledig in vliegtuigmodus worden gespeeld en afgerond;
- na reconnect staan acties en wedstrijd exact één keer in Firestore;
- apparaat B kan veilig meekijken en alleen na overname schrijven;
- conflicten of rule-weigeringen zijn zichtbaar en herstelbaar;
- Security Rules beschermen alle wedstrijd- en actionpaden per context en rol.

## 13. Fase 8 — Hardening, acceptatie en cutover

### PR 8.1 — PWA-updates en herstel

**Voltooid** (alle drie sub-PR's gemerged: 8.1a #75, 8.1b #76, 8.1c #77 —
zie §17-statustabel + de "Geïmplementeerd"-secties in
`docs/pr-8.1-plan.md`). **Expliciet open restpunt**: de echte
Safari/iPadOS-hardwarevalidatie van de 8.1c-classic-SW-fallback (geen
Apple-apparaat beschikbaar bij de eigenaar) — zelfde open punt als de
bestaande iOS-regel bij Fase 7, geen tweede, losse trackingregel.

Voorbereidingsplan: [`docs/pr-8.1-plan.md`](pr-8.1-plan.md).

- eerste installatie, offline reload en app-shellupdate;
- geen mix van oude HTML en nieuwe gehashte assets;
- zichtbare updatebeschikbaarheid en gecontroleerde refresh;
- pre-game offline-readinesscheck;
- herstelbare technische/syncfouten zonder wedstrijdverlies;
- **Safari + iPadOS-ondersteuning verifiëren** voor de in PR 3.2a gekozen `type: 'module'` service-worker-registratie (Workbox-precache + NavigationRoute); module-SW heeft historisch beperkte ondersteuning in WebKit en vereist een echte Safari-test voordat dit als "PWA werkt" kan worden afgevinkt;
- **fallback-strategie** bepalen wanneer Safari geen module-SW accepteert (klassieke SW, alleen precache, of detectie + gebruikersmelding), en die keuze vastleggen voordat productie-cutover plaatsvindt.

### PR 8.2 — toegankelijkheid en courtside QA

**Deels voltooid**: 8.2a (focus-infrastructuur, keyboard-navigatie,
axe-core-baseline) gemerged (#81). 8.2b (score-/wissel-/contextbediening,
clubkleurcontrast, reduced-motion) gemerged (#83). 8.2c (gedeeld apparaat,
mobiele viewports, zwakke verbinding) geïmplementeerd — herroepbare
vertrouwd-apparaat-instelling + expliciete localStorage-wislijst bij
uitloggen/wissel naar onvertrouwd, tweede (375×667) mobiel viewportprofiel,
CDP-netwerkemulatie voor een lopende score-sync. Zie §17-statustabel +
`docs/pr-8.2-plan.md`.

Voorbereidingsplan: [`docs/pr-8.2-plan.md`](pr-8.2-plan.md).

- focusvolgorde, modal focus trap/restore en zichtbare focus;
- score-, wissel- en contextbediening met touch en toetsenbord;
- contrast van clubkleuren en `prefers-reduced-motion`;
- gangbare telefoonviewports, oudere doeltelefoon en zwakke/offline verbinding;
- gedeeld apparaat: vertrouwd-apparaatkeuze, uitloggen en cache wissen.

### PR 8.3 — beveiliging, privacy, kosten en beheer

**Follow-ups uit de post-merge review van PR 8.1** (`docs/pr-8.1-plan.md`
§E, minimax-review op PR #75–#78, niet-blokkerend): (1) een
`forTesting()`/reset-methode op `PwaUpdateAdapter` overwegen als 8.3 extra
PWA-diagnose toevoegt aan de gedeelde singleton; (2) `verify-sw-classic-
bundle.mjs`'s importdetectieregex verbreden bij een toekomstige
Workbox-upgrade.

- volledige Emulator Rules-suite en review zonder open hoge bevindingen;
- rate limits/misbruikscenario's, App Check-besluit en privacyveilige logging;
- organisatie-export, account-/organisatieverwijdering, back-up en herstelproef;
- Firestore-gebruik meten en budgetwaarschuwingen configureren;
- Spark/Blaze-keuze, regio, DPA, afhankelijkheden en platformvoorwaarden
  opnieuw valideren; betaalde functies alleen na expliciete goedkeuring.

### PR 8.4 — parallelle acceptatie

- dezelfde fictieve wedstrijden in v1 en v2 vergelijken;
- score, minuten, lineups, CSV, back-up, historie, stats en trends gelijk;
- coachtest op echte doelapparaten en met twee organisatiecontexten, maar zonder
  echte data in Git of logs;
- cutover- en rollbackplan met exact te publiceren build/SHA.

### PR 8.5 — productie-cutover

Alleen na afzonderlijke expliciete goedkeuring:

- Netlify-productieconfig en afzonderlijk Firebase-productieproject controleren;
- Security Rules, indexes, toegestane authproviders, quota en alerts verifiëren;
- exacte commit publiceren en toegang/headers/offline gedrag verifiëren;
- rollbackpad en lokale back-up beschikbaar houden;
- v1 pas in een latere aparte PR archiveren of verwijderen.

## 14. Fase 9 — Groei na de multi-organisatiebasis

De basis voor meerdere organisaties, teams en verschillende coachrollen bestaat
al sinds fase 5. Deze fase begint pas na stabiele productie en voegt schaal- en
self-servicefuncties toe op basis van echte gebruikersvragen.

Mogelijke afzonderlijke producttracks:

1. uitgebreide self-service organisatieaanmaak, uitnodigingen en
   eigendomsoverdracht;
2. meerdere teams, seizoensarchivering en bonds-/programmahiërarchie;
3. coachdashboard en organisatiebrede rapporten;
4. datakwaliteitscontroles en auditgeschiedenis;
5. deelbare rapporten met expliciet privacy- en toegangsmodel;
6. veilige server-side Airtable-/andere integraties;
7. quota, kostenbewaking, support- en beheertools;
8. aggregatie-/analyticslaag of datawarehouse wanneer Firestore-queries niet
   meer doelmatig zijn;
9. echte multi-writer wedstrijdbediening, alleen als single-writer aantoonbaar
   onvoldoende is.

Iedere track krijgt een eigen productbesluit, AVG-beoordeling, ADR waar nodig,
kleine PR's en exit-/verwijderstrategie.

## 15. Werkwijze voor OpenCode

### Eén taak per sessie

Geef OpenCode niet de opdracht om het hele plan in één keer uit te voeren. Gebruik per sessie één PR-doel met expliciete grenzen.

### Standaardopdracht

Gebruik voor iedere taak dit sjabloon:

```text
Lees eerst README.md, docs/IMPLEMENTATION_PLAN.md en relevante tests.

Werk uitsluitend aan: <taak of PR-nummer uit het plan>.

Voor je code wijzigt:
1. inspecteer de relevante code en beschrijf kort de huidige werking;
2. benoem risico's voor localStorage, CSV, offline werking en i18n;
3. geef een klein uitvoeringsplan;
4. stop als de gevraagde taak een grotere architectuurkeuze vereist.

Randvoorwaarden:
- behoud bestaande localStorage-data en CSV-contracten;
- geen backend, tracking of externe gegevensoverdracht buiten de expliciet goedgekeurde roadmapfase;
- Nederlands en Engels bij zichtbare teksten;
- voeg gerichte tests toe;
- wijzig geen niet-gerelateerde code;
- werk op een aparte branch;
- maak geen commit of PR voordat tests zijn uitgevoerd en de diff is samengevat.

Oplevering:
- implementatie;
- gerichte tests;
- overzicht van gewijzigde bestanden;
- uitgevoerde controles en resultaten;
- bekende beperkingen of open risico's.
```

### Eerste aanbevolen opdracht

```text
Lees README.md, AGENTS.md, docs/IMPLEMENTATION_PLAN.md,
docs/architecture/adr-000-frontend-architecture.md, de root-testconfiguratie en
v2/package.json.

Voer uitsluitend PR 3.2a uit. Voeg nog geen settings-, roster-, Firebase- of
Netlify-implementatie toe.

Realiseer de gesplitste TypeScript-configuratie, typeveilige runtime-i18n,
v2-Playwright-harness, injectManifest-PWA, centrale CSS-tokens en statische
toegankelijkheidslinting. Behoud uitsluitend lineup-tracker-lang en raak de
overige v1-localStorage-keys niet aan.

Voer lint, formatter-check, Vitest, v2-Playwright, productiebuild en de volledige
v1-Playwright-suite uit. Bewijs installatie/offline reload en NL/EN-wissel met
gerichte assertions. Rapporteer wijzigingen, testresultaten en open risico's.
```

### Tweede aanbevolen opdracht

```text
Start alleen nadat PR 3.2a is gemerged en opnieuw groen is gevalideerd.
Voer uitsluitend PR 3.2b uit docs/IMPLEMENTATION_PLAN.md uit.

Bouw de volledige Instellingen-flow via SettingsRepository en application-
use-cases, met exact lineup-tracker-settings als opslagkey. Behoud de v1-vorm,
NL/EN en offline gedrag. Voeg nog geen roster, wedstrijd, Firebase of Netlify toe.
Voer alle acceptatiecriteria en regressietests uit en rapporteer exact resultaat.
```

### Derde aanbevolen opdracht

```text
Start alleen nadat PR 3.2b is gemerged en opnieuw groen is gevalideerd.
Voer uitsluitend PR 3.2c uit docs/IMPLEMENTATION_PLAN.md uit.

Bouw de Team-flow via RosterRepository en application-use-cases, met exact
lineup-tracker-roster als opslagkey. Behoud sortering, IDs, classificatievelden,
NL/EN en offline gedrag. Raak wedstrijd- en historiekeys niet aan en voeg nog
geen Firebase of Netlify toe. Voer alle acceptatiecriteria en regressietests uit.
Stop na PR 3.2c bij de architectuurreview; begin fase 4 niet automatisch.
```

## 16. Modelstrategie

- Dagelijkse implementatie: `opencode-go/kimi-k2.7-code`.
- Goedkoop bulkwerk, testvarianten en mechanische documentatie: `opencode-go/deepseek-v4-flash`.
- Verkenning en documentanalyse: `opencode-go/qwen3.7-plus`.
- Moeilijke architectuur, migraties en onafhankelijke review: `opencode-go/glm-5.2`.
- Laat risicovolle code bij voorkeur controleren door een andere modelfamilie dan waarmee deze is geschreven.

## 17. Voortgang bijhouden

Gebruik GitHub Issues of een kleine tabel in dit bestand. Issues zijn beter zodra meerdere wijzigingen parallel of verspreid over langere tijd plaatsvinden.

| Onderdeel | Status | Issue/PR | Opmerking |
|---|---|---|---|
| Fase 0 — inventarisatie | Voltooid |  | current-state.md, data-contracts.md, product-compatibility-matrix.md |
| PR 1.1 — testbasis | Voltooid |  | fixtures.js, ui.spec.js deterministisch |
| PR 1.2 — wedstrijdflow | Voltooid |  | full-game.spec.js met scenario en totalen |
| PR 1.3 — hervatten en back-up | Voltooid |  | backup-resume.spec.js met resume, export, import, invalid |
| PR 1.4 — mobiel en taal | Voltooid |  | mobile-lang.spec.js met iPhone viewport, NL/EN flows |
| PR 1.5 — GitHub Actions CI | Voltooid | #6 | .github/workflows/ci.yml, Playwright tests in CI |
| PR 1.6 — fase-1-dekking | Voltooid | #7 | coverage-gaps.spec.js; P0-1 was tijdelijk als `test.fail()` vastgelegd en is in PR #8 opgelost |
| PR 1.7 — importveiligheid | Voltooid | #8 | `isPlainObject` validatie in index.html; P0-1 opgelost |
| PR 2.1 — schemaversie | Voltooid | #9 | `SCHEMA_VERSION` + `lineup-tracker-schema-version`; toekomstige versies geweigerd |
| PR 2.2 — importvalidatie | Voltooid | #10, #14 | `validateBackupData()` met type-checks, referentie-checks, lege-data-detectie; vertaalbare foutmeldingen. Review-opvolging: type-checks toegevoegd voor `game`-velden (string/getal/boolean/array); dubbele `t()`-aanroep op reeds-vertaalde submeldingen verwijderd in `validateBackupData`/`validateGames` |
| PR 2.3 — migratieframework | Voltooid | #12, #13 | `migrateBackup()` met `MIGRATIONS` map; automatisch in importflow; veilige weigering bij falende migratie; testisolatie en contract verduidelijkt in follow-up |
| Fase 2 — data-integriteit | Voltooid | #9, #10, #12–#14 | Schemaversie, inhoudelijke validatie en migratieraamwerk zijn aanwezig en getest |
| ADR-000 — frontendarchitectuur | Voltooid | #15 | `docs/architecture/adr-000-frontend-architecture.md`: Preact + TypeScript + Vite, laaggrenzen, i18n/PWA/teststrategie, gecorrigeerde migratievolgorde |
| PR 3.1 — v2 scaffold | Voltooid | #16 | `v2/` met Vite/Preact/TS-strict/ESLint9/Prettier/Vitest, triviale NL/EN-pagina met `aria-label` en `<html lang>`-sync, één sanity-test, `engines: node>=24`. v1 ongewijzigd. CI uitgebreid met Prettier-check, Vitest en Vite build naast Playwright. Geen lege mappen onder `src/`. `vite-plugin-pwa` bewust uitgesteld naar de eerste verticale flow (instellingen/team) per walking-skeleton-valideringspoort in ADR-000 |
| PR 3.2a — technisch fundament | Voltooid | #18 | TypeScript-grens, typed i18n, v2-Playwright, injectManifest-PWA, CSS-tokens en a11y-lint. Volgpunten in dezelfde PR verwerkt: `browserStorage` vangt throws van de `localStorage`-property-access af; `import.meta.env.PROD`-guard in `main.tsx`. Safari + iPadOS-module-SW-verificatie blijft bewust een aandachtspunt voor PR 8.1 |
| PR 3.2b — Instellingen | Voltooid | #19, #20 | Volledige instellingenflow via `SettingsRepository`-application-port en bestaande `lineup-tracker-settings`-key. Review-opvolging (#20): expliciete save i.p.v. write-per-toetsaanslag, zichtbare `settingsSaveError` bij mislukte write, logo-groottelimiet, werkende "aangepaste kleur"-knop |
| PR 3.2c — Team | Voltooid | #21 | Volledige rosterflow via `RosterRepository`-application-port en bestaande `lineup-tracker-roster`-key; whitelist-op-write spiegelt v1-`saveRoster` exact. Review-opvolging in dezelfde PR: aparte `rosterSaveError`-key, `addPlayer`-nr-gedrag gedocumenteerd, `removePlayer`-edge-case-tests |
| Architectuurreview na PR 3.2c | Voltooid | #22 | Poort uit §8 uitgevoerd: importgrenzen en opslagcompatibiliteit bewezen schoon. Mobiele-viewport-gat gevonden én gedicht (#22): ontbrekende `box-sizing:border-box` veroorzaakte 32px horizontale overflow op telefoonformaat sinds PR 3.2a, plus 3 nieuwe mobiele e2e-tests. Twee gaten bewust **niet** vervroegd, blijven PR 8.1/8.2-scope: (1) geen zichtbare PWA-update-UX/`controllerchange`-reload voor lang openstaande tabs; (2) geen runtime-a11y-scan (axe-core) of echte keyboard-only-e2e-navigatie, alleen statische `jsx-a11y`-lint |
| Fase 3 — frontend-walking-skeleton | Voltooid | #15, #16, #18–#22 | ADR-000, scaffold en 3.2a-c volledig gerealiseerd en gereviewd; poort na PR 3.2c doorlopen |
| PR 4.1 — ADR-001 clouddataplatform | Voltooid | #23 | `docs/architecture/adr-001-cloud-data-platform.md`: Firebase Auth + Firestore + Netlify, Supabase als begrensde fallback. Regio/AVG/quota/prijsplan/back-ups/exit geverifieerd (aug. 2026); AVG-aandachtspunt (Auth-metadata mogelijk buiten EU ondanks `eur3`-Firestore-data) door eigenaar expliciet geaccepteerd met documentatie. Back-upbeleid bewust uitgesteld naar PR 8.3 |
| PR 4.2 — ADR-002 offline-sync | Voltooid | #24 | `docs/architecture/adr-002-offline-sync-strategy.md`: syncstatuscontract (4 toestanden), append-only wedstrijdacties met clientgegenereerde UUID's i.p.v. één overschreven megadocument, tombstones, single-writer-model, pre-game-offline-readinesscheck. Single-tab persistence door eigenaar geaccepteerd als startaanname |
| PR 4.3 — ADR-003 tenancy/autorisatie | Voltooid | #25 | `docs/architecture/adr-003-tenancy-and-authorization.md`: datamodel (uid als membership-doc-ID), rollentabel, Rules-only-uitnodigingsflow zonder Cloud Function/Blaze (create/accept/claim in drie stappen met `email_verified`-mitigatie tegen self-grant), door eigenaar geaccepteerd. "Laatste eigenaar niet Rules-afgedwongen" bewust aanvaard als application-laag-beperking |
| PR 4.4 — begrensde Firebase-spike | Voltooid; #27 en #28 later gesloten in respectievelijk PR 5.3d (#36) en PR 5.1 (#29) | #26, #27, #28 | `firebase-spike/` zelfstandige workspace; Firebase Emulator Suite (Firestore :8080, Auth :9099), fictieve data, geen echt GCP-project. Bewijst: offline edit/reconnect/tweede cliënt (Playwright); volledige rol- en organisatie-isolatiematrix (Vitest + rules-unit-testing); Rules-only uitnodigingsflow (create/accept/claim); intrekking-tijdens-queued-write (Node- en browser-variant). Herreviewcorrecties: admin→owner-beveiliging, strikte intrekkingstest, ongecachete offline-test, atomaire invitation-claim, subscribe()-DEFAULT_SETTINGS-fix, type-check en volledige spike-CI. 45 rules + 3 e2e = 48 tests. Eigenaarbesluit 5 aug. 2026: GO voor Fase 5; offline volledige reload (#27) en cross-org querytests (#28) waren op dat moment PARTIAL/OPEN en werden in een latere fase gesloten — zie PR 5.3d-rij en PR 5.1-rij. Zie `firebase-spike/docs/SPIKE_REPORT.md` |
| Fase 4 — cloud/sync/tenancy-ADR's | Voltooid | #23–#26 | ADR-001, ADR-002 en ADR-003 geaccepteerd en empirisch getoetst via PR 4.4; onafhankelijke herreview en go/no-go afgerond. Beide begrensde vervolg-gates #27 en #28 zijn later gesloten in respectievelijk PR 5.3d (#36) en PR 5.1 (#29) |
| Fase 5 — platformpilot settings/team | **Voltooid** (acceptatiefase gesloten, eigenaarsbesluit 16 aug. 2026); PR 5.1 t/m 5.4 voltooid, #27 gesloten op verkleinde scope (zie PR 5.3-rij), #28 gesloten in PR 5.1; 5.5a/5.5b voltooid incl. echte staging-activatie, 5.5c afgerond met één expliciet open punt | #31 | Firebase Emulator/Rules, Auth, multi-organisatiecontext, offline cache, twee apparaten en echte Netlify-staging (`basketball-tracker-staging`, project `wheelchair-basketball-tracker`). De vijf `Fase-acceptatie`-bullets in §10 hierboven zijn stuk voor stuk aantoonbaar gehaald. **Expliciet openstaand, bewust geaccepteerd**: 5.5c's eigen "iOS/Android 2/2"-subcriterium (`docs/pr-5.5-plan.md` §D) is alleen voor Android gehaald — geen Apple-apparaat beschikbaar bij de eigenaar; blokkeert de sluiting van Fase 5 niet, blijft apart bijgehouden tot een iOS-apparaat beschikbaar is (bijv. gecombineerd met PR 8.1). Zie `docs/pr-5.5-onderzoeksrapport.md` §C |
| PR 5.3 — Firestore-cache, settings/team-sync, harde gate #27 | Voltooid (PR #36, head 95a5639+); #27 gesloten op verkleinde scope, eigenaarsbesluit camilovtrijp-coder 8 aug. 2026 | #27 | `v2/tests/e2e-auth/offline-reload-cache-write-second-client.spec.ts` bewijst automatisch in CI: (1) app-shell laadt zonder netwerk (PWA); (2) gecachte team/settings blijven zichtbaar na offline reload, geen stille lege standaard; (3) offline write → syncstatus-indicator direct "wacht-op-synchronisatie" (schrijfcontract herzien, zie `domain/syncState.ts` — write() awaitte voorheen `setDoc()`'s eigen promise en bleef offline onbeperkt pending) → reconnect → tweede cliënt ziet de servervaarde; (4) een nooit-gecachete teamcontext toont offline nooit stilzwijgend een leeg team. **Bewuste scopeverkleining t.o.v. de oorspronkelijke #27-eis:** de combinatie "offline schrijven + herladen terwijl nog offline met die write nog pending" wordt niet meer automatisch getest — die combinatie gaf een geverifieerde, herhaalbare hang van Firestore's `getDocFromCache()`/`onSnapshot` op het beschreven document (emulator, Playwright/CDP-offline-simulatie), maar een handmatig protocol op een echt apparaat (Windows-laptop, genuine netwerkonderbreking via vliegtuigmodus, 2/2 schone runs) toonde geen enkele hang bij exact dat scenario. Volledig onderzoek, inclusief het handmatige protocol en de nog openstaande beperkingen (geen mobiele apparaatklasse, geen productie-Firestore getest): `docs/pr-5.3d-onderzoeksrapport.md` §A–§I. Onafhankelijke review vóór merge vond en corrigeerde: `dismiss()` liet de syncstatus-indicator "hangen" op de laatst gezette waarde i.p.v. terug te springen naar gesynchroniseerd; `reset()` liep buiten de sync-status-tracking om (een geweigerde reset gaf geen actie-nodig); geen bescherming tegen een state-update na unmount als `settled` nog niet was opgelost; een generatieteller per schrijfkind voorkomt dat een late, ingehaalde write-uitkomst een nieuwere overschrijft. |
| PR 5.1 — reproduceerbare Firebase-basis | Voltooid; issue #28 gesloten | #28, #29 | Nieuwe workspace `firebase/` (naast `v2/` en de ongewijzigde `firebase-spike/`): Firebase CLI-config, `firestore.rules` (geport uit de spike + `uid`-veld op `organizationMembers`), `firestore.indexes.json` (collection-group-override op `organizationMembers.uid`), typed documentcontracten/converters (`src/documents/`), seeddata voor 2 organisaties/3 teams/alle 5 rollen, en een Rules-/unit-testsuite (53 Rules-tests + 23 convertertests = 76) in een nieuwe CI-job `firebase-base`. Issue #28 opgelost met een empirisch bewezen querycontract (`firebase/docs/QUERY_CONTRACT.md`): de enige toegestane query is `collectionGroup('organizationMembers').where('uid','==',eigenUid)`, geautoriseerd via een aparte recursieve-wildcard Rules-match — een geneste, padgebonden regel bleek voor `collectionGroup`-LIST-queries empirisch niet te volstaan ("No matching allow statements"), ongeacht de voorwaarde erin. Onafhankelijke review (#29) vond en corrigeerde drie punten vóór merge: (P1, blocker) het `uid`-veld was bij create beschermd maar niet bij owner/admin-update — nu expliciet vergrendeld met negatieve tests inclusief een outsider-contextquery-check; (P2) `firebase-spike/tests/rules/offline-revocation-node.spec.ts` (3 intrekkingstests) was niet overgezet — nu geport naar `firebase/tests/rules/`; `reads-writes-accounting.spec.ts` (kostenmeting, geen gedragsregressie) blijft bewust spike-only en wordt hier niet herhaald; (P2) de documentconverters waren type-projecties zonder runtime-validatie — nu met echte grensvalidatie (`src/documents/validation.ts`) en 16 negatieve tests voor malformed serverdata. Buiten scope: auth-/contextwisselaar-UI (PR 5.2), Firebase-adapters in `v2/` en offline-cache-bewijs (PR 5.3/#27), echt GCP-project, Netlify |
| PR 5.2 — authenticatie, onboarding en contextwisselaar | Voltooid; issue #31 gesloten; alle vier acceptatiecriteria bewezen | #30, #31 | `v2/` bouwt voort op `firebase/` (hergebruikt de geteste converters/validatie uit die workspace via npm-workspaces; alleen rol-/statusenums zijn lokaal gedupliceerd in `domain/` om de dependency-vrije domeinlaag-eis te bewaren, met een syncronisatietest die drift bewaakt). E-mail/wachtwoord-auth (Google-login bewust uitgesteld, nog geen echt GCP-project); `AuthGate` stuurt via de pure `deriveAppState()`-state-machine tussen login/signup, vertrouwd-apparaatprompt, onboarding van de eerste organisatie/team, contextwisselaar, geweigerde/ingetrokken/ongecachete/offline-states en de bestaande `App`. Uitnodigingen lopen via een link (orgId+invitationId als queryparameters), niet via e-mailverzending (bestaat niet) of handmatige codes. Vertrouwd-apparaatkeuze bepaalt `persistentLocalCache` vs. `memoryLocalCache`; uitloggen op een niet-vertrouwd apparaat wist lokale Firestore-data expliciet, maar laat de laatst-gekozen context bewust staan (apparaatvoorkeur, geen sessie-eigenschap) zodat herinloggen direct terug in de app komt. Architectuurbeslissing tijdens deze PR: de bestaande, emulator-vrije v2-e2e-suite (settings/roster/i18n/mobiel/pwa) kwam door `AuthGate` niet meer voorbij het loginscherm; in plaats van de gate te ontkoppelen kregen die 33 tests een automatische login-fixture (`tests/e2e/fixtures.ts`) en verhuisden ze naar een nieuwe CI-job (`v2-e2e`) die wél de Emulator Suite nodig heeft. Nieuwe `tests/e2e-auth/`-suite bewijst de vier PR 5.2-acceptatiecriteria end-to-end: contextwissel tussen twee organisaties met correcte rollen zonder herinloggen; volledige uitnodigingsmatrix (pending/ingetrokken/al-geaccepteerd/niet-geverifieerd); intrekking bij organisatie A raakt organisatie B niet, ook niet als A de actieve context was; ongecachete context zonder netwerk toont een expliciete foutmelding. Drie opeenvolgende onafhankelijke reviewrondes vonden en corrigeerden: (ronde 1, head 168d65c) drie P1's — contextwisselaar toonde elk team van de organisatie aan elk lid i.p.v. alleen aantoonbaar geautoriseerde teams (`TeamAccess.isExplicitlyAuthorized`); `deriveAppState` valideerde alleen het organisatiemembership, niet het geselecteerde team (`validateSelectedTeam`, bewust fail-open bij een netwerkfout per ADR-002); de bootstrap van de eerste organisatie was niet herstelbaar bij een gedeeltelijke mislukking (`resumeOrgId`) — plus één P2, verouderde async teamresponses in `ContextSwitcher` genegeerd via een `requestId`-guard; (ronde 2, head 435239d) `orgId` werd pas ná de `setDoc`-await toegekend i.p.v. ervoor (hersteld, met een failure-pathtest die specifiek de EERSTE write laat falen) en de race-guard had nog geen regressietest (toegevoegd: `tests/unit/ContextSwitcher.spec.tsx`, eerste component-render-test in de suite, met `@testing-library/preact`/`jsdom`). Ronde 1 signaleerde ook dat team-only leden — uitsluitend een `teamMembers`-document, geen `organizationMembers` — volledig onzichtbaar bleven in de contextwisselaar; eerst apart getrackt als issue #31 i.p.v. stilzwijgend gedicht, na eigenaarbesluit (6 aug. 2026: dit is een letterlijk PR 5.2-acceptatiecriterium, geen uitbreidende scope) alsnog in dezelfde PR opgelost — met hetzelfde bewezen querycontractpatroon als issue #28: een gedenormaliseerd `uid`-veld op `teamMembers` (enforced bij create én update) achter een eigen recursieve-wildcard Rules-match en collectionGroup-index, en een gedenormaliseerd `orgName`-veld op het teamdocument zodat een team-only lid de organisatienaam kan zien zonder dat `organizations/{orgId}`-reads verbreed worden. Nieuwe `listMyTeamOnlyContexts()`/`mergeMemberships()` in `v2/` en `tests/e2e-auth/team-only-membership.spec.ts` bewijzen een account met uitsluitend `teamMembers` end-to-end, inclusief een tweede team-only organisatie (multi-orgquery) en een derde, volledig ontoegankelijke organisatie die niet lekt. Ronde 3 (head 530503e) beoordeelde de #31-implementatie als correct, getest en gedocumenteerd; drie niet-blokkerende observaties genoteerd: een zwakke negatieve collectionGroup-test kan met een expliciete documentlijst-assertie sterker; een `for`-lus met losse `getDoc()`-calls in `listMyTeamOnlyContexts` is bij de huidige schaal (1–3 teams) geen probleem maar kan later met `Promise.all` sneller; `orgName` synchroniseert bewust niet mee bij een latere organisatienaamwijziging (gedocumenteerd in `firebase/src/documents/team.ts` en `QUERY_CONTRACT.md`) — pas relevant zodra een toekomstige fase organisatienaamwijziging via de UI toestaat, dan alsnog sync-logica toevoegen. Tijdens het debuggen bleek de lokale Firestore Emulator (v1.22.0) intern te degraderen bij langdurig hergebruik binnen één proces (herhaalde handmatige reseeds/reruns gaven sporadisch een onverklaarbare "evaluation error" op `get()`/`getAfter()`-Rules, verdwenen volledig op een verse emulator-herstart) — geen app- of Rules-bug; CI start per run een verse emulator, dus dit raakt de pipeline niet. `firebase-admin/auth` laadt niet onder Playwright Test's modulelader; uid-opzoek in testfixtures gaat daarom via de Auth-emulators eigen `accounts:signInWithPassword`-REST-endpoint. Getest op een schone emulator-herstart, CI groen op exact head `530503e`: `firebase-base` (25 unit- + 63 Rules-tests), v2 (126 unit-, 33 e2e- en 18 e2e-auth-tests, tsc/eslint/prettier/build) |
| PR 5.4 — Realtime twee apparaten | Voltooid via #37, #40 en #41; twee-device delivery, conflict/reload, queued revoke, non-conflicting updates, contextwissels en een reproduceerbare emulatorproxy (15 client-reads en 7 writes over vier scenario's) zijn vastgelegd in het rapport. Echte mobiele netwerkvalidatie en billable Firebase-metingen blijven gates voor PR 5.5. | #37, #40, #41 | `docs/pr-5.4-onderzoeksrapport.md` |
| PR 5.5a — Firebase-webconfig-externalisatie | Voltooid | #43 | `resolveWebConfig()`/`resolveEmulatorConfig()`/`resolveDeployContext()` in `v2/src/infrastructure/firebase/webConfig.ts`; default-pad (geen `VITE_DEPLOY_CONTEXT`) blijft bitwise de emulator, bestaande tests ongewijzigd groen. Geen Netlify, geen echt project. Zie `docs/pr-5.5-plan.md` §C (5.5a) |
| PR 5.5b — Netlify-config + Deploy Previews | Voltooid, incl. site-koppeling/activatie (15-16 aug. 2026) | #58, #59 | `v2/netlify.toml` (nieuw, apart van root-`netlify.toml` — één root-bestand kan geen twee `[build]`-tabellen bevatten): build/publish, `VITE_DEPLOY_CONTEXT` per Netlify-context (production/deploy-preview/branch-deploy), PWA-headers, SPA-fallback-redirect. Geen nieuwe Netlify-site aangemaakt of gekoppeld — dat gebeurt pas op een later, door de eigenaar gekozen moment. Root-`netlify.toml` (v1) kreeg een verwijzende commentaarregel én, na verificatie van Netlify's creditmodel, een `ignore`-filter zodat v1 alleen nog herbouwt bij daadwerkelijk v1-relevante padwijzigingen — v1's build-command/publish zelf blijven ongewijzigd. Geverifieerde correctie op de eerste activatiechecklist: Deploy Previews/branch deploys kosten 0 credits en mogen dus vanaf het begin aan staan; alleen een productie-deploy (merge naar `main`, 15 credits) is de eigenlijke credit-gevoelige stap. Details en bronnen: `docs/pr-5.5-plan.md` §E.6–§E.7. **Activatie (15-16 aug. 2026):** echt staging-Firebase-project `wheelchair-basketball-tracker` aangemaakt (Firestore `eur3`, Auth e-mail/wachtwoord, Rules/indexes gedeployed); nieuwe Netlify-site `basketball-tracker-staging` gekoppeld via de monorepo-wizard. Eerste twee deploy-pogingen faalden (#59): Netlify's monorepo-detectie verplaatst de working directory niet naar `v2/` (blijft repo-root) terwijl de root npm-workspaces gebruikt, dus `npm run build` vond geen script — gefixt met `--workspace=v2`; `publish = "dist"` bleek daardoor ook root-relatief opgelost te worden — gefixt naar `publish = "v2/dist"`. Geverifieerde, werkende URL: PR #59's Deploy Preview. Eigenaarsbesluiten: "Stop builds" (geen automatische productie-deploy per merge, bewust handmatig triggeren) en Visitor access op "Private" (alleen Netlify-teamleden). Volledig verslag: `docs/pr-5.5-onderzoeksrapport.md` §B.1 |
| PR 5.5c — handmatig iOS/Android-protocol + verbruiksmeting | **Voltooid, acceptatiefase gesloten** (eigenaarsbesluit 16 aug. 2026); Android 2/2 schoon; iOS expliciet, apart openstaand (geen Apple-apparaat beschikbaar) — blokkeert sluiting niet |  | Volledig verslag: `docs/pr-5.5-onderzoeksrapport.md`. §B (testfixtures A/B/C/D, geen service-accountkey, zie protocol §B), §C.1 (offline/reload, Android 2 rondes × 2 sub-runs = 4/4 schoon, geen reload-hang — wel een nieuw structureel fenomeen: offline paginaherlaad toont altijd "geen lokale kopie" ondanks gecachete teamdata, zie bugfixes-PR bug 6), §C.2 (role-matrix-UI positief/negatief geverifieerd), §D (5 synthetische flows + deletes tegen echte staging-Firestore, ruim binnen gratis Spark-quotum). Tijdens uitvoering 10 losse applicatiebugs gevonden (missend opslaan-feedback, v1-regressie teamkleuren zonder visueel effect, en meer) — vastgelegd in `docs/pr-5.5c-bugfixes.md`; bugs 1-9 inmiddels gefixt (PR #60), bug 10 (team-kleuren) bewust uitgesteld naar de toekomstige Fase 8-thema-implementatie |
| PR 6.1 — wedstrijdopzet | Voltooid |  | `domain/game/types.ts`+`setup.ts` (pure functies, v1-pariteit `canStart()`/`startGame()`), `application/game/` (lokale `GameRepository`-port + usecases), `infrastructure/game/LocalStorageGameRepository.ts` (per-organisatie/team-sleutel, nog geen Firestore-adapter — die komt in PR 7.1), `ui/game/GameSetupPanel.tsx`, nieuwe "Wedstrijd"-tab in `App.tsx`. Elke speler krijgt een stabiele game-player-UUID los van het roster-ID (historische snapshot); de wedstrijd zelf een stabiele UUID. Belangrijke v1-pariteitsbevinding tijdens implementatie: v1's `init()` hervat een opgeslagen wedstrijd alléén als ze al gestart is (`phase==="tracking"` of segmenten bestaan) — een nog-niet-gestarte opzet wordt bij elke (her)load bewust genegeerd en vers vanaf de actuele roster afgeleid, ook al staat ze in de opslag. v2 spiegelt dat exact (eerst geïmplementeerd als "alles altijd hervatten", door e2e-tests tegen de emulator gecorrigeerd). "Vergrendelen" van de organisatie/teamcontext na start is voor dit moment beperkt tot opslag-isolatie per team (een contextwissel kan een andere teams actieve wedstrijd niet overschrijven); een harde UI-blokkade van de contextwisselaar tijdens een lopende wedstrijd is bewust doorgeschoven naar PR 7.3, samen met single-writer-sync. 27 nieuwe unit-tests (`gameSetup.spec.ts`, `gameRepository.spec.ts`) en 5 nieuwe e2e-tests (`game-setup.spec.ts`); volledige v2-unit- (276), v2-e2e- (38) en v1-Playwright-suite (61) blijven groen. **Tweede bugfixronde na externe review van PR 6.1 zelf** (aug. 2026, zes bevindingen, alle zes geverifieerd): (1) een `scorer` kreeg dezelfde `canManageTeamData`-bevoegdheid als roster/instellingen voor de wedstrijd-UI, terwijl ADR-003 `scorer` expliciet "wedstrijdacties schrijven, roster niet beheren" toekent — opgelost met een aparte, ruimere `canWriteGameData`-bevoegdheid (owner/admin/coach/scorer) op `TeamAccess`/`validateSelectedTeam()`, doorgegeven als `canWriteGame`-prop naast het bestaande `canWrite`; (2) de v1-sleutel (`lineup-tracker-v1`) werd nooit gelezen voor een actieve wedstrijd, ondanks de expliciete "v1-key blijft leesbaar"-eis hierboven — opgelost met adoptie vanuit v1 bij een lege v2-opslag (`domain/game/v1Migration.ts`: reconstrueert v1's segmenten/score volledig via de PR-6.2-actielog, inclusief losse-min/sec- naar seconden-conversie en ID-remapping naar stabiele game-player-UUID's); (3) een opgeslagen wedstrijd werd nooit gecontroleerd op overeenkomst tussen de opgeslagen `organizationId`/`teamId` en de sleutel-context waaronder ze gelezen werd — opgelost met een expliciete match-check in `read()` (mismatch = ongeldig, net als corrupte data); (4)/(5) twee bevindingen bleken doelbewuste, al eerder gedocumenteerde ontwerpkeuzes waarvan alleen de roadmap-tekst hierboven ambigu was (het "vergrendelen"-punt en het "hervatten van een voorbereide wedstrijd"-punt) — de roadmaptekst hierboven is verduidelijkt, geen gedragswijziging. **Derde herreview** (aug. 2026) wees terecht op een gat in fix (2): de eerste, automatische versie adopteerde de v1-wedstrijd stilzwijgend in welk team dan ook het eerst met een lege v2-opslag geladen werd — v1 kende geen organisatie/teamcontext, dus de code kon niet bewijzen dat dat het juiste doelteam was. Opgelost door detectie en adoptie in twee stappen te knippen: `GameRepository.detectV1Migration()` toont een niet-opgeslagen voorstel getagd met de huidige context (nieuw scherm `ui/game/V1MigrationPrompt.tsx` op het Wedstrijd-tabblad, met tegenstander/doel-team/stand en een expliciete bevestigknop; de hint verwijst naar de bestaande contextwisselknop voor het verkeerde team), en pas `GameRepository.confirmV1Migration()` schrijft de wedstrijd en zet de (nu diagnostische, JSON-) migratievlag — zolang niemand bevestigt blijft elk team het voorstel zien en kan willekeurig welk team het alsnog voor zichzelf claimen. 20 nieuwe unit-tests (`v1GameMigration.spec.ts` nieuw, uitbreidingen in `gameRepository.spec.ts`/`teamAccess.spec.ts`), 5 nieuwe e2e-auth-tests (`role-matrix-ui.spec.ts` uitgebreid met een Game-kolom) en 3 nieuwe e2e-tests (`v1-game-migration.spec.ts` nieuw: voorstel i.p.v. auto-adoptie, blijft onbevestigd na reload, bevestigen persisteert en toont het live-scherm); volledige v2-unit-suite nu 320 tests, v2-e2e-suite nu 48, v2-e2e-auth-suite 44, alle groen. **Vierde herreview** (aug. 2026) vond twee resterende gaten in de tweestapsoplossing: (a) `confirmV1Migration()` deed de wedstrijd-write en de globale claim-write als twee losse, niet-atomaire localStorage-writes — als alleen de tweede (de claimvlag) faalde, retourneerde de functie toch `true`, waardoor de globale claim kon ontbreken terwijl dit team de wedstrijd al lokaal leek te hebben (een ander team zou 'm dan via `detectV1Migration()` alsnog aangeboden krijgen: twee teams die beide denken de wedstrijd te bezitten); (b) het bevestigingsscherm toonde alleen de teamnaam, niet de organisatienaam, wat bij gelijknamige teams in twee organisaties geen ondubbelzinnig doel is — precies de situatie waarin deze prompt de gebruiker moet kunnen vertrouwen. Beide opgelost: `confirmV1Migration()` draait de wedstrijd-write terug (`removeItem`) als de claim-write daarna faalt, zodat een mislukte bevestiging altijd volledig ongedaan gemaakt is (veilig om opnieuw te proberen, geen duplicatie of dataverlies); een nieuwe integriteitscheck weigert een `game` waarvan `organizationId`/`teamId` niet bij de repositorycontext hoort (`read()` had deze bescherming al, `confirmV1Migration()` nog niet); `V1MigrationPrompt` toont nu organisatienaam + teamnaam samen (`AuthGate.tsx` geeft de membershipnaam door, met `organizationId` als technische fallback zoals gevraagd). 6 nieuwe/aangepaste unit-tests in `gameRepository.spec.ts` (rollback bij een mislukte claim-write, veilige retry zonder duplicatie, integriteitscheck) en een nieuw component-testbestand `V1MigrationPrompt.spec.tsx` (5 tests, waaronder twee organisaties met gelijknamige teams die aantoonbaar verschillende doelen tonen); volledige v2-unit-suite nu 328 tests, v2-e2e- en v2-e2e-auth-suite ongewijzigd (48/44), alle groen |
| PR 6.2 — live wedstrijd offline-first | Voltooid |  | `domain/game/tracking.ts` (nieuw): scoren, klok/segmenttijd, wissels en classificatie als pure functies + een append-only actielog (`GameAction`: `score-delta`/`score-set`/`segment-saved`/`segment-edited`/`segment-deleted`, elk met eigen UUID) waaruit score en segmenten reproduceerbaar zijn via `deriveGameHistory()` — het lokale fundament voor de Firestore-actielog van PR 7.1. Bewust géén actielog-entries: de huidige opstelling (`onCourt`), het lopende kwart en de begin/eind-kloktijd van het nog-open segment blijven, net als in v1, direct gemuteerde en meteen gepersisteerde "draaivelden" op `ActiveGame` — elk segment legt zijn eigen kwart/tijden al onveranderlijk vast zodra het wordt opgeslagen. `ui/game/LiveTrackingPanel.tsx` (nieuw, grootste UI-component tot nu toe): scorebediening (select + snelknoppen +1/+2/+3/−1 per team), wisselflow (tikken op vloer/bank-speler, "Klaar met wisselen" → kloktijd-modal, "Annuleer"), classificatiesom/-balk/-waarschuwing, kwartselectie, segment vastleggen met begintijd/eindtijd-selects, segmentenlijst met bewerk-/verwijder-modal (herberekent de lopende score met behoud van de nog-niet-opgeslagen live-delta, v1: `recalcRunningScore()`). Eerste modals in v2: toegankelijke overlay-opbouw met een echte `<button>`-backdrop (i.p.v. een klikbare `<div>`) om aan `jsx-a11y` te voldoen. 21 nieuwe unit-tests (`gameTracking.spec.ts`, inclusief een handmatig narekenbaar meerdere-segmenten-scenario) en 7 nieuwe e2e-tests (`game-tracking.spec.ts`: score, direct segment opslaan, ongeldige duur blijft geblokkeerd, volledige wisselflow, segment bewerken/verwijderen, classificatiewaarschuwing); twee bestaande PR 6.1-e2e-assertions die nog naar de oude plaatshoudertekst verwezen zijn bijgewerkt naar het echte live-scherm. Volledige v2-unit- (297), v2-e2e- (45) en v2-e2e-auth-suite (39) blijven groen; v1-Playwright-suite ongewijzigd (niet geraakt). **Bugfixronde na externe review van PR #46** (drie bevindingen, alle drie geverifieerd en opgelost vóór merge): (1) `LocalStorageGameRepository.read()` verwierp een opgeslagen PR-6.1-wedstrijd zonder `curQuarter`/`beginSec`/`endSec`/`pendingSwapLineup`/`actions` als ongeldig, waarna de aanroeper stilzwijgend een verse opzet aanmaakte en de opgeslagen wedstrijd overschreef — opgelost met een losse structurele shape-check (`isActiveGameShape`) plus een lossless backfill (`normalizeActiveGame`); (2) `pendingSwapLineup` (de snapshot van vóór een nog niet bevestigd blokje wissels) bestond alleen als component-`useState` in `LiveTrackingPanel`, dus verloor een reload/crash tijdens een onbevestigde wissel de grens tussen "vóór" en "ná" — opgelost door het veld naar `ActiveGame` te verplaatsen (direct gemuteerd en gepersisteerd, net als `onCourt`); (3) `browserStorage.ts` slikte élke fout van `setItem`/`removeItem`, dus retourneerde `LocalStorageGameRepository.write()` altijd `true`, ook bij een echte quotafout — opgelost door alleen falen van de storage-*getter* zelf (of een `null`-storage) te slikken, en falen van de verkregen storage's eigen methoden te laten propageren; `LiveTrackingPanel` toont nu ook een zichtbare opslagfoutmelding (`saveError`, mirrors `GameSetupPanel`). 3 nieuwe regressietests in `gameRepository.spec.ts` (legacy-migratie, pendingSwapLineup-persistentie) en 2 in `browserStorage.spec.ts`; volledige v2-unit-suite nu 300 tests, v2-e2e-suite ongewijzigd 45 tests, beide groen |
| PR 6.5 — trends | Voltooid; gemerged via PR #51 (squash, commit `70fd818`) | #51 | Voorbereidingsplan: `docs/pr-6.5-plan.md`. `domain/trends/computePlayerTrends.ts` + `chartModels.ts` (pure, DOM-vrij; hergebruikt PR 6.4's `AnalysisGame`/rosterId-normalisatie, geen tweede normalisatiepad), `application/trends/buildTrendViewModels.ts` (kleine usecase die trend- en chartviewmodels uit de gedeelde `AnalysisScope` bouwt), `ui/trends/TrendsPanel.tsx` (nieuwe "Trends"-tab in `App.tsx`) met toegankelijke inline-SVG plus/min-lijngrafiek en speeltijdbalken (symmetrische nul-as, gedeeld minutenmaximum, altijd een tekstalternatief via de uitklapbare wedstrijdlijst), per-10-toggle en rugnummer→minuten→plus/min-sorteercyclus als eigen, niet-gedeelde tab-state. Het wedstrijdfilter (`gameIds`) is gedeeld met Stats: `ui/shared/GamesFilterModal.tsx` en `ui/shared/ModalDialog.tsx` zijn uit `StatsPanel.tsx` geëxtraheerd (bestaande `stats-games-modal`/`stats-game-row-*`/`stats-game-check-*`-testid's bewust ongewijzigd gelaten) en de `Set<string>\|null`-selectie is naar `App.tsx` getild (`statsGameIds`), zodat een wijziging op één tab onmiddellijk op de andere geldt. Exacte v1-pariteit bewaard: per-punt-per-10-normalisatie (`pm*600/sec` per wedstrijd, pas daarna gemiddeld — niet één normalisatie over de opgetelde seconden), afgeronde wedstrijden chronologisch oud→nieuw met de actieve wedstrijd altijd als voorlopig laatste punt, en een verwijderde historische speler krijgt nooit een eigen trendkaart. PARTIAL-segmenten (onbekende spelersreferentie) worden net als Stats volledig uitgesloten en apart geteld; dataherkomst (`local-complete`/`cache`/`partial`/`error`) blijft in het viewmodel onderscheidbaar zodat een latere cache nooit stilzwijgend als volledige serverdata wordt voorgesteld. 26 nieuwe unit-tests (`trendsComputePlayerTrends.spec.ts`, `trendsChartModels.spec.ts`) dekken Voorbeeld 4, rosterId-identiteit over verschillende game-player-UUID's, niet-meegedaan-versus-nul-plus/min, chronologie/voorlopig-punt, gedeeld filter, sorteercyclus, gedeeld minutenmaximum en de verwijderde-speler/PARTIAL-contracten; een nieuwe e2e-suite (`tests/e2e/trends.spec.ts`) dekt kaart/gemiddelden, per-10, sorteercyclus, uitklaplijst, gedeeld filter, voorlopig actief punt, 320px en NL/EN. **Onafhankelijke review op PR #51** (exact head `78880c9`, alle vier CI-jobs groen op die SHA) vond en corrigeerde drie punten vóór verdere merge-overweging: (1) de test met het label "Voorbeeld 4" gebruikte niet de vastgelegde fixture uit `docs/product-compatibility-matrix.md` en bewees dus niet het daar vastgelegde acceptatiegetal (+3,0 raw / +7,5 per-10-per-punt) — de test is herschreven met de letterlijke matrixfixture (twee segmenten in wedstrijd A die samen tot pm 0 optellen, één segment in wedstrijd B met pm +6, plus een expliciete niet-speel-segment per wedstrijd) en asserteert nu zowel het raw-gemiddelde als apart het v1-per-punt-per-10-contract (bewust niet de 6,7-Stats-aggregatie); (2) `statsGameIds` (het gedeelde filter) werd niet gereset bij een organisatie/teamwissel — `AuthGate` hergebruikt dezelfde `App`-instance met nieuwe props, dus een selectie uit team A bleef actief in team B en toonde daar ten onrechte "0 wedstrijden" i.p.v. v1's standaard "alles"; opgelost door `setStatsGameIds(null)` toe te voegen aan hetzelfde context-afhankelijke effect dat completed games/history al reset, bewezen in een nieuw regressiebestand `StatsGameFilterContextReset.spec.tsx`; (3) de per-punt-waarden van de lijn-/balkgrafiek waren vóór het uitklappen van de wedstrijdlijst niet in de accessibility tree aanwezig (alleen een algemene grafieknaam) — beide grafieken hebben nu een permanente (niet van de uitklapstaat afhankelijke) screenreader-only `aria-describedby`-lijst met datum/tegenstander/waarde/voorlopig per punt, bewezen in zowel een uitgebreide e2e-assertie (accessible name + puntwaarden zonder uitklappen) als impliciet via de bestaande viewmodel-tests. **Tweede reviewronde** (exact head `ac9ab06`, alle vier CI-jobs opnieuw groen op die SHA) vond nog twee punten: (a) de nieuwe contextwisseltest was een false positive — team A (na deselectie: 1 wedstrijd geselecteerd) en team B (toevallig ook 1 wedstrijd) toonden bij zowel de correcte reset (`null`) als een foutieve stale `Set` dezelfde knoptekst "(1)", dus de teller alleen bewees niets; vervangen door een assertie op de daadwerkelijke checkbox-state in de modal (`stats-game-check-gB-1` moet aan staan), en de test is expliciet gecontroleerd om te falen wanneer `setStatsGameIds(null)` tijdelijk verwijderd wordt (bevestigd: faalt met "expected false to be true" zonder de fix, slaagt ermee); (b) deze statusrij en het "Voltooid"-label liepen vooruit op de werkelijke PR-status terwijl #51 nog draft/open was — hierboven gecorrigeerd. `tsc -b`, `eslint`, `prettier -c`, volledige v2-unit-suite (52 bestanden, 435 tests) en de productiebuild zijn groen geverifieerd na deze tweede reviewronde. CI op PR #51 was groen op head `ac9ab06`; de nieuwe commit met de checkbox-gebaseerde test moet nog een eigen groene CI-run doorlopen vóór merge |
| PR 6.6 — back-up, import en lokale migratie | Voltooid; gemerged via PR #52 (squash, commit `834c740`) | #52 | Voorbereidingsplan: `docs/pr-6.6-plan.md`. Eigenaarsbesluiten §E.1-4 bevestigd ongewijzigd (13 aug. 2026) vóór implementatiestart. Nieuwe laag `domain/backup/` (pure, DOM-vrij): `types.ts` (v2-schema `version: 2` met benoemde secties settings/roster/activeGame/completedGames/lang), `validate.ts` (envelope- + sectievalidatie met gestructureerde foutcodes, alles-of-niets per aanwezige sectie — v1-pariteit), `migrateV1.ts` (`migrateV1BackupData()`/`migrateV1CompletedGame()` spiegelen `domain/game/v1Migration.ts`'s rosterId-behoud-projectie exact, plus `retagWithContext()` die organisatie/team pas NA bevestiging toekent), `preview.ts` (`buildImportPreview()`: replace-per-onderdeel-effect, eigenaarsbesluit §E.2 — afwezige sectie = clear, taal is uitzondering: afwezig = ongewijzigd, geen teamdata), `export.ts` (`buildBackupPayload()`/`backupFilename()`), `parse.ts` (envelope → migratie → validatie in één pure pijplijn). `application/backup/BackupCoordinator.ts`: schrijft in vaste volgorde (settings → roster → historie → actieve wedstrijd → taal) via de bestaande `syncStatus.saveSettings`/`saveRoster` (dus automatisch lokale/cloudmodus, eigenaarsbesluit §E.3) en `GameRepository`/`CompletedGameRepository`, verifieert elke stap met een readback, en rolt bij de EERSTE fout alle al gelukte stappen terug naar een vooraf vastgelegde snapshot — nooit een gedeeltelijk succes. Idempotentie bij retry loopt via `CompletedGameRepository.replaceAll()` (nieuwe, expliciet bulk-vervangende methode, net als `GameRepository.clear()` — beide toegevoegd aan de bestaande poorten conform plan §F 6.6b) i.p.v. een aparte dedupe-sleutel: een herhaalde import van dezelfde back-up vervangt de doellijst identiek i.p.v. te stapelen. `infrastructure/backup/`: `readBackupFile.ts` (10 MiB-limiet vóór FileReader/parse) en `downloadBackupFile.ts`. `ui/backup/BackupPanel.tsx`: nieuwe sectie ín het Instellingen-tabblad (niet een aparte nav-tab), export-knop, bestandskiezer, preview-kaart met doelteam + per-sectie-effect, bevestig-/annuleerknoppen, automatische download van een herstelback-up van de HUIDIGE doeldata vóór er geschreven wordt, en een falen-/succesmelding met het hersteljournaal. Bevoegdheid hergebruikt de bestaande `canWrite`-prop (== `canManageTeamData`, eigenaarsbesluit §E.4) — geen nieuw capabilitycontract nodig. Bewuste scopekeuze t.o.v. het volledige plan: de "doelorganisatie/doelteam kiezen"-stap (§C.7) is de AL-actieve context uit de bestaande contextwisselaar (PR 5.2) met een expliciete zichtbare bevestiging, geen aparte org/team-picker-widget in de back-upflow zelf — een cross-team-import kan door eerst van team te wisselen. 47 nieuwe unit-tests (`backupValidate.spec.ts`, `backupMigrateV1.spec.ts`, `backupPreview.spec.ts`, `backupExportRoundtrip.spec.ts`, `BackupCoordinator.spec.ts`) dekken envelope-/sectievalidatie, v1-projectie (spelers/segmenten/rosterId-behoud), v2-roundtrip, replace-per-onderdeel-effecten, succesvolle import, falen-op-elke-stap-met-rollback (nooit vals succes) en idempotente retry via `replaceAll`. Een nieuwe e2e-suite (`tests/e2e/backup.spec.ts`) dekt export-download, preview → bevestiging → herstelback-updownload → geschreven data, annuleren, corrupt/leeg/referentieel-ongeldig bestand. `tsc -b`, `eslint`, `prettier -c`, volledige v2-unit-suite (56 bestanden, 474 tests) en de productiebuild zijn groen geverifieerd in deze sessie; de nieuwe en bestaande Playwright-e2e-specs zijn geschreven maar niet uitgevoerd (vereisen de Firebase Auth-/Firestore-emulator plus seeddata, niet beschikbaar in deze sessie) — vóór merge alsnog tegen de emulator draaien. **Onafhankelijke review op PR #52** vond 5 punten, waarvan 4 als merge-blokkerend (P1) gemarkeerd: (1) capability/doelcontext werd onvoldoende afgedwongen — opgelost door in `BackupPanel.tsx` een `PreviewTarget` (organizationId/teamId/canWrite) aan de preview-state te binden en een `useEffect` die de preview annuleert zodra deze props tijdens een openstaande preview wijzigen (contextwissel of rolwijziging zónder remount, exact hoe `AuthGate`/`App` een teamwissel doorvoert), plus expliciete herchecks van `canWrite` in `handleExport`/`handleFileChosen`/`handleConfirmImport` als defense-in-depth naast de gedisablede knoppen; bewezen in een nieuw `tests/unit/BackupPanel.spec.tsx` (canWrite-knopstaat, contextwissel-tijdens-preview, canWrite-wijziging-tijdens-preview) en twee nieuwe e2e-capabilitytests met de al-bestaande seedgebruikers dave (scorer) en erin (viewer). (2) validatie/migratie was niet fail-closed tegen de 5 door de reviewer aangeleverde corrupte-inputprobes — `domain/backup/validate.ts` is herschreven met expliciete `isPlainObject`-guards vóór elke veldtoegang op array-items (segments/players/completedGames/activeGame) en `Number.isInteger`-versiecontrole; `domain/backup/migrateV1.ts` faalt nu closed (retourneert `null`/verzamelt fouten) op ontbrekend/onjuist-getypeerd `id`/`date`/spelers/segmenten i.p.v. stil te defaulten, en genereert deterministische ID's (`v1-import:<legacyId>:...`) i.p.v. `crypto.randomUUID()` zodat een herhaalde migratie idempotent blijft. (3) snapshot/export kon een leesfout stilzwijgend als lege data behandelen — nieuwe `GameRepository.safeRead()`/`CompletedGameRepository.safeList()` (statusonderscheid `'ok'|'error'`, zelfde patroon als PR 6.4's `CompletedGamesReadResult`) vervangen `read()`/`list()` in `captureSnapshot()` en `BackupPanel`'s exportpad; bij een leesfout wordt niets gedownload of geschreven. (4) rollback/readback had gaten — `BackupCoordinator.ts` vergelijkt readbacks nu met een canonieke diepe gelijkheidscontrole (`stableStringify`/`deepEqual`, sleutel-gesorteerd) i.p.v. gedeeltelijke veldvergelijkingen, rolt bij falen ELKE aangeraakte sectie terug inclusief de net gefaalde sectie zelf (niet alleen voorgaande successen), en rapporteert een mislukte hersteldwrite eerlijk als `'rollbackFailed'` i.p.v. altijd `'rolledBack'`. Alle vier punten zijn gedekt door permanente regressietests (`BackupCoordinator.spec.ts` uitgebreid naar 12 tests inclusief hersteldwrite-van-de-falende-stap-zelf en `rollbackFailed`-pad; `backupMigrateV1.spec.ts`/`backupValidate.spec.ts` uitgebreid met de letterlijke reviewerprobes). Punt 5 (testdekking) is deels geadresseerd: `tests/e2e/backup.spec.ts` uitgebreid met een hersteljournaal-zichtbaarheidstest, een idempotente-retrytest en scorer/viewer-capabilitytests. Na deze ronde: `tsc -b`, `eslint`, `prettier -c` en de volledige v2-unit-suite (57 bestanden, 492 tests) zijn groen geverifieerd; de e2e-specs blijven ongedraaid in deze sandbox (geen Firebase-emulator) — vóór merge tegen de emulator draaien. **Herreview op PR #52** (head `f387304`, alle vier CI-jobs groen) vond drie resterende P1-datablokkers plus een nog open acceptatiepunt: (1) een cloudimport meldde succes zodra `useSyncStatus`'s `saveSettings`/`saveRoster` de write LOKAAL geaccepteerd hadden, zonder op serverbevestiging (`settled`) te wachten — bij een latere Rules-afwijzing kon dat een al gemeld "import geslaagd" alsnog gedeeltelijk ongedaan maken; `BackupCoordinator.ts` schrijft settings/roster nu rechtstreeks via `settingsRepo.write()`/`rosterRepo.write()` en wacht zelf, begrensd (`IMPORT_SETTLE_TIMEOUT_MS` = 15s, nooit onbeperkt — dekt ook het gedocumenteerde issue-#27-gate waarbij `settled` offline nooit resolvet), op `settled` vóór een stap als `'written'` telt; de `saveSettings`/`saveRoster`-velden zijn uit `BackupCoordinatorDeps`/`BackupPanelProps` verwijderd. (2) v1-migratie was nog niet volledig fail-closed: `lineup-tracker-settings: null`/`lineup-tracker-roster: "not-an-array"`/een ongeldige taal vielen via `normalizeSettings()`/`normalizeRoster()` stil terug op defaults/leeg/weggelaten, en een structureel malformed actieve wedstrijd was niet te onderscheiden van v1's legitieme "opzet nog niet gestart"-uitzondering; `migrateV1BackupData()` valideert nu de VORM van elke sectie vóór normalisatie (plain object/array/geldige taalcode/`isPlausibleV1ActiveGame()`) en faalt met `migrationFailed` i.p.v. te defaulten. Daarnaast is `domain/backup/validate.ts` uitgebreid met de nog ontbrekende v2-veldcontroles: `Segment.classSum/allowed/over`, `durSec`-tijdconsistentie (`=== |endSec-beginSec|`), alle `ActiveGame`-draaivelden (`curQuarter`/`beginSec`/`endSec`/`clockDown`/`limitStr`), `pendingSwapLineup`-referenties, en structurele validatie van elk `actions`-item (inclusief het embedded `Segment` in `segment-saved`/`segment-edited`). (3) `safeRead()`/`safeList()` konden aanwezige-maar-corrupte data nog stil als "ontbreekt"/gefilterd behandelen: een context-mismatch op de al org/team-specifieke actieve-wedstrijd-sleutel gaf `status:'ok', game:null` i.p.v. `'error'` (nu gefixed in `LocalStorageGameRepository`), en `safeList()`'s bewust permissieve één-item-filtert-de-rest-niet-contract (nodig voor Stats/Historie-UI) werd ook voor back-up-doeleinden gebruikt; nieuwe, strikte `CompletedGameRepository.safeListStrict()` (optioneel poortlid, valt terug op `safeList()`/`list()`) geeft `status:'error'` zodra ook maar één item wordt afgekeurd, en wordt nu gebruikt in `captureSnapshot()`, `writeCompletedGamesSection()`'s readback én `BackupPanel`'s exportpad. `captureSnapshot()` vangt bovendien rejects van `settingsRepo.read()`/`rosterRepo.read()` af (nooit meer in `running` blijven hangen). Punt 4 (deels): de preview toont nu per sectie de lokale/cloudbestemming (`backupDestinationLocal`/`backupDestinationCloud`, `BackupPanelProps.settingsRosterMode` gevoed door `repositories.mode`) — settings/roster volgen de actieve modus, wedstrijdhistorie/actieve wedstrijd blijven altijd lokaal (fase-6-scope). De volledige owner/admin/coach/scorer/viewer-e2e-matrix, een echte cloud-serverreject/rollback-e2e en export-/herstelbestandsinhoud (i.p.v. alleen bestandsnaam) blijven open — e2e-emulator-afhankelijk, zoals steeds gemeld. Alle punten zijn gedekt door permanente regressietests: `BackupCoordinator.spec.ts` uitgebreid met server-reject-/settle-timeout-tests (via `vi.useFakeTimers()`), `backupMigrateV1.spec.ts`/`backupValidate.spec.ts` uitgebreid met de letterlijke reviewerprobes (malformed settings/roster/taal/activeGame, segment-tijdconsistentie, actions-validatie), `gameRepository.spec.ts`/`completedGameRepository.spec.ts` uitgebreid met `safeRead()`/`safeListStrict()`-regressies, en `BackupPanel.spec.tsx` met de bestemmingslabel-weergave. `tsc -b`, `eslint`, `prettier -c`, de volledige v2-unit-suite (57 bestanden, 516 tests) en de productiebuild zijn groen geverifieerd; de e2e-specs blijven ongedraaid in deze sandbox (geen Firebase-emulator) — vóór merge tegen de emulator draaien. **Tweede herreview op PR #52** (head `a9a6dfd`, alle vier CI-jobs groen, 115/115 gerichte tests lokaal groen) vond drie resterende P1's plus bevestigde de nog open §G-acceptatiepoorten: (1) v1-migratie was ondanks de vorige ronde nog niet volledig fail-closed — `migrateV1CompletedGame()` gebruikte nog `str(..., '')`/`num(..., 0)`-fallbacks voor scoreFor/scoreAgainst/quarterCount/opponent/competition/periodLabel/useClassLimit en per-speler nr/naam/kl/vrouw/jeugd/participate/start, waardoor bv. een string-getypeerde `scoreFor: "6"` stil `0` werd vóórdat validatie de typefout kon zien; alle vijf helpers zijn vervangen door `reqStr`/`reqNum`/`reqBool` die bij een aanwezig-maar-verkeerd-getypeerd (of ontbrekend) veld de HELE wedstrijd laten falen. Roster-/settingsmigratie gebruikte nog de bewust permissieve `normalizeRoster()`/`normalizeSettings()` (die resp. een niet-object-entry stil filtert en ontbrekende settingsvelden aanvult met defaults) — vervangen door hergebruik van de nu-geëxporteerde `validateRosterSection()`/`validateSettingsSection()` uit `validate.ts` (zelfde velddiepe eisen als v1's eigen validator), die ook meteen de per-veld-typecontrole op rosterentries (`nr`/`naam`/`kl`/`vrouw`/`jeugd`) toevoegden die er eerder niet was. (2) dubbele/conflicterende wedstrijd-ID's binnen één payload werden niet gedetecteerd — twee v1-wedstrijden met hetzelfde legacy-`Game.id` kregen via de deterministische mapping exact hetzelfde gemigreerde `id`/`sourceGameId` en werden beide geaccepteerd, wat `replaceAll()` twee botsende entries had laten wegschrijven; nieuwe `findDuplicateGameIds()` in `validateCompletedGamesSection()` (nieuwe foutcode `gameDuplicateId`) wijst dit binnen dezelfde alles-of-niets-validatie af, dus vóórdat een preview ooit gebouwd wordt (bewuste, gedocumenteerde scopekeuze: conflicten worden voorkomen i.p.v. als aparte preview-waarschuwing getoond). (3) taal werd als onfeilbare write behandeld — `setLang()` is slechts de React-state-setter, terwijl de echte `Storage.setItem()`-write pas later, ongecontroleerd, in een `App.tsx`-`useEffect` gebeurde; nieuwe `application/i18n/LangRepository.ts` (`LangWritePort`)/`infrastructure/i18n/LocalStorageLangRepository.ts` geven taal dezelfde write+readback+rollback-garantie als settings/roster/historie/actieve wedstrijd (`BackupSnapshot.lang`, nieuwe `'lang'`-rollbacktak), en `setLang()` wordt pas ná een bevestigde storage-write aangeroepen. Als extra, direct bruikbare verbetering uit dezelfde ronde: de preview toont nu ook expliciet `organizationId`/`teamId` naast de weergavenaam (disambiguatie bij gelijknamige teams, plan §C.7). Alle punten zijn gedekt door permanente regressietests: nieuwe `tests/unit/backupParse.spec.ts` draait de reviewerprobes door de ECHTE publieke `parseBackupPayload()`-pijplijn (niet alleen de losse migreerfuncties) en bewijst `errors.length > 0`/nul writes; `backupMigrateV1.spec.ts`/`backupValidate.spec.ts` uitgebreid met de letterlijke string-score-/roster-null-item-/ontbrekend-settingsveld-/dubbele-ID-probes; `BackupCoordinator.spec.ts` uitgebreid met taal-write/readback/rollback-tests (inclusief een throwende `setItem`-regressie); `BackupPanel.spec.tsx` met de org/team-ID-weergave. Nog open (bevestigd zoals de PR zelf al meldde): de volledige owner/admin/coach/scorer/viewer-e2e-matrix (nu alleen admin/scorer/viewer), lokale modus zonder netwerkcall, een e2e-test tegen een echte cloud-serverafwijzing, en assertions op de daadwerkelijke export-/herstelbestandsinhoud i.p.v. alleen bestandsnaam/preview — dit blijft e2e-emulatorafhankelijk. `tsc -b`, `eslint`, `prettier -c`, de volledige v2-unit-suite (60 bestanden, 534 tests) en de productiebuild zijn groen geverifieerd; de e2e-specs blijven ongedraaid in deze sandbox (geen Firebase-emulator) — vóór merge tegen de emulator draaien. **v1-compatibiliteitsfix door de reviewer** (head `e78fb54`): de vorige ronde maakte `participate`/`start` verplicht op elke gemigreerde v1-completedgame-speler, maar v1's eigen `finishGame()` slaat afgeronde spelers uitsluitend met `id/nr/naam/kl/vrouw/jeugd` op (geen `participate`/`start`) — waardoor een ECHTE, normale v1-back-up met historie ten onrechte `migrationFailed` gaf. Gericht gecorrigeerd: afwezige `participate`/`start` worden alleen voor deze canonieke v1-completedgame-vorm compatibel geprojecteerd naar `true`/`false` (zelfde gedrag als vóór de aanscherping); zijn ze wél aanwezig maar verkeerd getypeerd, blijft de migratie fail-closed. Alle vier CI-jobs groen op exact deze head; reviewer bevestigt "codeherreview: akkoord" en "CI op exacte head: akkoord", maar houdt de PR terecht draft zolang de §G-acceptatiepoorten nog openstaan. **Laatste ronde — volledige §G-testdekking toegevoegd** (op verzoek van de eigenaar, om GitHub CI's echte Firebase-emulator de eindverificatie te laten doen): owner (alice)/coach (carol) toegevoegd aan `tests/e2e/backup.spec.ts`'s rolmatrix (naast de al aanwezige admin/scorer/viewer) zodat alle vijf rollen expliciet gedekt zijn; een nieuwe test bewijst dat een volledige lokale-modus-export+importcyclus geen enkele request naar `firestore`/`identitytoolkit`/`securetoken.googleapis.com` maakt; de export- en herstelback-updownloads worden nu ook op daadwerkelijke JSON-INHOUD gecontroleerd (envelope/type/version/secties, en dat de herstelback-up de OUDE teaminstellingen bevat, niet de net geïmporteerde) i.p.v. alleen de bestandsnaam. Nieuwe `tests/e2e-auth/backup-cloud-reject.spec.ts` (draait tegen de echte Firestore-emulator + Security Rules, niet tegen een fake) bewijst het écht-cloud-serverafwijzingsscenario end-to-end: een gebruiker verliest `canManageTeamData` (via de Admin SDK, ná de preview maar vóór bevestiging) terwijl `canWrite` in de UI dat nog niet weet (geen live-abonnement) — de daaropvolgende write wordt door de ECHTE Security Rules geweigerd, de coordinator moet dit via `settled` als `failed`/`rollbackFailed` melden (nooit succes), en Firestore zelf bewijst dat er niets is weggeschreven. Deze nieuwe e2e/e2e-auth-tests zijn (net als de rest van de suite) in deze sandbox geschreven maar niet uitgevoerd — verificatie loopt via de v2-e2e- en v2-e2e-auth-CI-jobs op de gepushte head |
| Fase 6 — overige v1-flows | Voltooid — PR 6.1 t/m 6.6 alle gemerged |  | Wedstrijdopzet (6.1), live (6.2), historie/export (6.3), stats (6.4), trends (6.5) en back-up/import/migratie (6.6, PR #52) klaar |
| Fase 7 — wedstrijdsync en migratie | Codebouw volledig afgerond: PR 7.1a–7.1c, 7.2a–7.2c, 7.3a–7.3c (#66/#68/#69) en 7.4a–7.4c (#70/#71/#72) allemaal gemerged/geïmplementeerd — zie de bijbehorende "Geïmplementeerd"-secties in `docs/pr-7.3-plan.md`/`docs/pr-7.4-plan.md`. Praktijkpoort 5.5c (15-16 aug. 2026) gepasseerd: Android-kant volledig uitgevoerd (2/2 schoon, echte billable Firestore-baseline gemeten, zie `docs/pr-5.5-onderzoeksrapport.md`); iOS-kant expliciet, apart openstaand (geen Apple-apparaat beschikbaar bij de eigenaar) — de eigenaar heeft op 16 aug. 2026 besloten dat dit de sluiting van 5.5's acceptatiefase (en daarmee deze poort) niet blokkeert, met iOS als losstaand bijgehouden punt. Fase-7-acceptatie (§12 punt 9) blijft echter nog OPEN: 7.3c/7.4c's echte-tweede-apparaat/iOS-Android-hardwarevalidatie en 7.4c's staging-pilot met fictieve data (billable reads/writes) konden niet in de ontwikkelsandbox worden uitgevoerd (geen live staging-/hostingtoegang) — expliciet doorgeschoven, niet gefingeerd, wachtend op wie staging-toegang heeft, vóór fase 8 start |  | Aanbevolen keten: voltooid fundament 5.3/5.4 → 7.1a-c → 5.5b-activatie/5.5c-praktijkpoort → 7.2a-c → 7.3a-c → 7.4a-c → fase-7-acceptatie (echte-apparaat-validatie + staging-pilot) → fase 8. Zie `docs/pr-7.1-plan.md` t/m `docs/pr-7.4-plan.md` |
| PR 7.1a — cloudcontracten, converters, checkpointvorm | Voltooid | #54 | `firebase/src/documents/game.ts`+`gameAction.ts`: typed `GameDocument`/`GameActionEnvelopeDocument`-contracten + Firestore-converters, spiegelen `v2/src/domain/game/types.ts` (`ActiveGame`/`GameAction`/`Segment`/`GamePlayer`) exact. Fail-closed: onbekende `phase`/actietype/`schemaVersion`/teamwaarde, malformed geneste spelers/segmenten/contextvelden, timestamps die niet strikt ISO zijn (`toISOString()`-round-trip, ook onmogelijke kalenderdata) en contextvelden die niet met het Firestore-pad overeenkomen worden geweigerd (`validation.ts` uitgebreid met `assertInteger`/`assertStringArray`/`assertNullableStringArray`/`assertNullableString`/`assertIsoTimestampString`/`assertNullableIsoTimestampString`/`assertPathContextField`). `GameActionPayloadDocument` bevat bewust geen `id`/`at` (die zijn al `actionId`/`occurredAt` op de envelope — geen dubbele bron van waarheid). `v2/src/domain/game/syncCheckpoint.ts` (nieuw, puur): `GameSyncCheckpoint` voor het lokale checkpoint (bevestigde action-ID's, serverrevisie, `'idle'|'actie-nodig'`-status) — geen generieke IndexedDB-outbox, per ADR-002 §"Verduidelijkingen voor fase 7" punt 2. `v2/src/application/game/`: `GameSyncCheckpointRepository.ts` (lokale poort) en `GameCloudGateway.ts` (cloudpoort: `ensureGame()`/`uploadActions()`/`patchSnapshot()` met create-only-idempotentie en revisiecontrole) — beide poorten alleen, implementatie volgt in PR 7.1c; bestaande synchrone `GameRepository` is niet aangeraakt. `projectGameForCloud.ts`: pure, deterministische projectie van `ActiveGame` naar parent-snapshot (afgeleide `scoreFor`/`scoreAgainst`/`segmentCount` via de bestaande `deriveGameHistory()`, geen tweede berekeningspad) en action-envelopes (`actionId` == `GameAction.id`, `sequence` == arrayindex — bewijsbaar deterministische document-ID's en volgorde). 57 converter-tests (roundtrip + malformed-weigering, incl. padcontextmismatches en ISO-timestampprobes) in `firebase/tests/unit/documentConverters.spec.ts`, 14 tests in `v2/tests/unit/projectGameForCloud.spec.ts` (determinisme, contextvelden, een handmatig narekenbare 4-kwarten-fixture met scoreFor 24/scoreAgainst 16, en een documentgrootte-/read-write-budgettest ruim onder de Firestore 1 MiB-limiet). `firebase-base`-typecheck/unit en volledige v2-typecheck/lint/format/unit (548 tests)/build groen. Geen Security Rules, geen Firestore-adapter, geen deployment — dat is 7.1b/7.1c. Lokale v1-/v2-opslagkeys, CSV en berekeningen ongewijzigd. Twee externe reviewrondes vonden en corrigeerden vóór merge: (1) malformed timestamps/contextmismatches werden aanvankelijk geaccepteerd — nu fail-closed; (2) de documentgroottetest mat per ongeluk een kleine `score-delta` i.p.v. `segment-saved` |
| PR 7.1b — Security Rules, queries, create-only actions | Voltooid | #55 | `firebase/firestore.rules` punt 8–13: `canWriteGameData(orgId,teamId)` (owner/admin/coach/scorer, spiegelt exact `v2/src/domain/organizations/teamAccess.ts` `deriveTeamAccess().canWriteGameData`); geneste `games/{gameId}`- en `actions/{actionId}`-Rules onder `teams/{teamId}`. Game-create: `isValidGamePayload()` (punt 13) plus pad-/payloadcontext (`organizationId`/`teamId`), toegestane initiële fase/`revision==0`/`writerEpoch==0`, en "maker"-borging (een initiële `writerUid` mag alleen de eigen `request.auth.uid` zijn — geen apart `createdBy`-veld op `GameDocument`). Game-update is gesplitst in twee paden (externe review, aug. 2026, P1: de oorspronkelijke enkele update-regel liet ELKE bevoegde gebruiker — niet alleen de huidige writer — de writer-/epochvelden herschrijven, met een willekeurig vooruitspringende epoch): (a) **normale patch**, uitsluitend door de ACTUELE writer (`request.auth.uid == resource.data.writerUid`), met `writerUid`/`deviceId`/`writerEpoch` EXACT ongewijzigd; (b) **initiële claim**, alleen op een nog ongeclaimd document (`resource.data.writerUid == null`), uitsluitend op de eigen uid, epoch ongewijzigd. Een latere overname van een AL geclaimd document heeft bewust geen pad (PR 7.3-scope, transactioneel met epoch-increment) en blijft tot dan geweigerd. Beide paden: kernvelden (`organizationId`/`teamId`/`players`/`opponent`/`competition`/`clockDown`/`limitStr`/`createdAt`) niet in de allowlist dus impliciet onveranderlijk; `phase` alleen gelijk of `setup`→`tracking`; `revision` moet exact met 1 omhoog (= optimistische-concurrencycontrole voor PR 7.1c's snapshotpatches, geen aparte transactie nodig); `isValidGamePayload()` op de resulterende staat. Action-create: `isValidActionEnvelope()` (punt 13) plus create-only (update/delete altijd `false`), eigen auteur, en `writerEpoch`/`deviceId` die moeten overeenkomen met de ACTUELE claim op het parentdocument — een actie met een oude/overgenomen epoch wordt hierdoor al geweigerd, vooruitlopend op PR 7.3. **Punt 13 (externe review, P1):** Rules valideerden aanvankelijk slechts enkele context-/writervelden, niet de volledige documentvorm — een document zonder verplicht veld (de reviewerprobe: `sampleGame()` zonder `updatedAt` werd geaccepteerd, de PR 7.1a-converter kon het daarna niet meer lezen) of met een onbekend extra veld ging erdoorheen. `isValidGamePayload()`/`isValidActionEnvelope()`/`isValidActionPayload()` eisen nu de exacte sleutelset (`hasAll`+`hasOnly`) en het juiste Rules-type per veld, inclusief de discriminated union per actietype en `schemaVersion==1`; `createdAt`/`startedAt`/`occurredAt` tegen een ISO-8601-vormregel (`matches()` — kalenderlogica zoals 31 februari blijft converter-scope, Rules hebben geen lussen voor diepe `players`/`segment`-validatie). Bewust GEEN recursieve-wildcard match voor `games`/`actions`: er is nog geen cross-team-querybehoefte, dus elke `collectionGroup`-query blijft default-deny — vastgelegd in `firebase/docs/QUERY_CONTRACT.md` §"Wedstrijd-/actiepaden", geen nieuwe `firestore.indexes.json`-overrides nodig. `tests/rules/games-and-actions.spec.ts` (65 tests, was 39 vóór de reviewronde): volledige rolmatrix, cross-org/team-isolatie, self-promotion, vervalste auteur, stale-epoch-/deviceId-weigering, action-update/delete altijd geweigerd, queryscope, plus de reviewopvolging: schrijven-door-een-andere-bevoegde-gebruiker-dan-de-writer geweigerd, epoch-niet-mag-stijgen-via-normale-patch, initiële-claim-positief/negatief, overname-van-een-al-geclaimd-document-geweigerd, vier losse contextveld-probes (was één gecombineerde), en schema-/typevalidatieprobes (ontbrekend/extra/verkeerd-getypeerd veld, onbekende schemaVersion/actietype, niet-ISO-tijdstipvorm) voor zowel games als actions. `sampleGame()`/`sampleGameAction()` in `tests/rules/helpers/fixtures.ts` (nu met verplichte `updatedAt: Timestamp.now()`). **Tweede herreview (externe review, aug. 2026, P1):** de "volledige schema-/typevalidatie"-claim was nog niet fail-closed voor geneste contracten. Opgelost: `isValidSegment()` (nieuw) valideert `Segment`'s exacte sleutelset + veldtype per veld — anders dan `players`/`onCourt` (list van items, Rules kunnen niet itereren) is `Segment` een vast, klein aantal top-level velden en dus wél volledig te valideren zonder lus; `segment-saved`/`segment-edited` roepen dit nu aan i.p.v. alleen `is map`. `isValidActionEnvelope()`'s `authorUid`/`deviceId` en `isValidActionPayload()`'s `segmentId` zijn nu non-empty (spiegelt `assertNonEmptyString()` in de converter). Game-create/de initiële-claimregel eisen nu dat `writerUid`/`deviceId` SAMEN "beide null" of "beide gezet, deviceId non-empty" zijn — een writer zonder geldige deviceId kon voorheen ontstaan en kon daarna geen enkele action meer schrijven. De resterende, gedocumenteerde grens: `players` (list van objecten) en `onCourt`/`pendingSwapLineup`/`segment.lineup` (list van strings) blijven alleen op `list`-type gecontroleerd — Rules hebben geen `.all()`/lus-constructie voor element-voor-elementvalidatie; dit residuele gat wordt beperkt doordat schrijftoegang al tot `canWriteGameData`-rollen beperkt is en PR 7.1c's schrijfpad uitsluitend `projectGameForCloud()`-afgeleide payloads schrijft. 13 nieuwe tests (segment-diepte, deviceId/writerUid-consistentie, lege-string-deviceId): `tests/rules/games-and-actions.spec.ts` nu 78 tests (was 65). Volledige `firebase-base`-Rules-suite groen (9 bestanden, 145 tests, was 132); unit-suite ongewijzigd (57 tests). `firebase-spike/` (eigen, onafhankelijke `firestore.rules`) niet aangeraakt. Geen wijziging aan `v2/`. |
| PR 7.1c — GameSyncCoordinator en idempotente upload | Voltooid | #56 | `v2/src/infrastructure/game/FirestoreGameCloudGateway.ts` (nieuw): implementeert `GameCloudGateway` — `ensureGame()`/`uploadActions()`/`patchSnapshot()`, elke Firestore-aanroep timeout-begrensd (`withTimeout`, ADR-002/issue #27: offline writes/reads kunnen anders onbeperkt hangen) en nooit een full-document-overwrite van de parent. Action-upload is create-only en idempotent: een afgewezen retry op een reeds bestaand action-document wordt via readback + ordeloze structurele vergelijking onderscheiden als `alreadyConfirmed` (identieke payload) of een echt conflict. PR 7.1c-correctie op de PR 7.1a-poort: `ensureGame()` miste `gameId` als parameter (het document heeft geen eigen `id`-veld, `gameId` komt uit het pad) — toegevoegd, plus `writerUid`/`deviceId` op `GameSnapshotWriteResult` zodat de coordinator zonder een aparte leesoperatie kan bepalen of een claim nodig is. `v2/src/application/game/GameSyncCoordinator.ts` (nieuw): orkestreert per `sync()`-aanroep ensureGame → initiële writerclaim (alleen als het serverdocument nog geen schrijver heeft; overname van een BESTAANDE claim blijft PR 7.3-scope) → upload van alleen nog onbevestigde acties (lokaal checkpoint filtert) → snapshotpatch via `projectGameSnapshotPatch()` (nieuw in `projectGameForCloud.ts`: exact de draaivelden-/afgeleide-snapshotsubset, spiegelt de Rules-veldallowlist). Elke falende stap zet het lokale checkpoint naar `'actie-nodig'` en stopt de cyclus zonder lokale data te verliezen; een latere aanroep (nieuwe actie, reconnect) hervat vanaf de eerste onvoltooide stap. `v2/src/infrastructure/game/LocalStorageGameSyncCheckpointRepository.ts` (nieuw): synchrone, boolean-faalcontract-implementatie van de PR 7.1a-poort, sleutel per `gameId`. `v2/src/domain/game/gameSyncDiagnostics.ts` (nieuw): exporteerbare diagnosedescriptor (tellingen/status/revisie, nooit speler-/scoredata). `v2/src/infrastructure/device/deviceId.ts` (nieuw): stabiel per-browser apparaat-ID (losstaand van de bestaande `trustedDevice`-cachekeuze) voor het schrijver-/epoch-fencingcontract. Compositie: `selectRepositories()`/`resolveAppRepositories()` bouwen in cloud-modus nu ook `gameSync`/`gameWriterContext` (`null` in lokale modus — nul Firestore/Auth-aanroepen); `App.tsx` triggert `GameSyncCoordinator.sync()` fire-and-forget bij elke wijziging van een `'tracking'`-wedstrijd en bij een browser-`online`-event, met een in-flight/queued-guard (nooit overlappende syncs, een queued retry leest altijd de laatste bekende `ActiveGame`) en een hergebruikte `SyncStatusIndicator` (nieuwe `testId`-prop) voor `wacht-op-synchronisatie`/`gesynchroniseerd`/`actie-nodig`. 24 nieuwe unit-tests in vier nieuwe bestanden (`GameSyncCoordinator.spec.ts`, `gameSyncCheckpointRepository.spec.ts`, `gameSyncDiagnostics.spec.ts`, `deviceId.spec.ts`) plus enkele uitbreidingen in `projectGameForCloud.spec.ts`/`resolveAppRepositories.spec.ts`/`selectRepositories.spec.ts` (volledige v2-unit-suite nu 575 tests) en 3 nieuwe emulator-e2e-specs tegen de echte Firestore-/Auth-emulator en de PR 7.1b-Rules (`game-sync-online-upload.spec.ts`: claim+upload+patch+reload op hetzelfde apparaat; `game-sync-offline-reconnect.spec.ts`: offline actie blijft lokaal/nooit verwijderd, komt pas na reconnect door, idempotente retry; `game-sync-claim-conflict.spec.ts`: een onverwachte serverzijdige `writerUid` levert zichtbaar `actie-nodig` op zonder lokaal dataverlies) — alle drie groen geverifieerd in deze sessie. Nog niet e2e-gedekt (wel dooronderbouwde unit-tests): een gedeeltelijk mislukte action-batch en een live tweede-apparaat-UI-lezer (App heeft nog geen Firestore-leespad voor games — alleen schrijven, zie 7.1c-scope; een leescoordinator voor een tweede kijker is nog niet gepland). Volledige `firebase-base`-verify (type-check + 57 unit- + 145 rules-tests) en volledige v2-suite (typecheck/lint/format/build, unit- en beide e2e-suites) groen geverifieerd in deze sessie tegen de echte emulator. |
| PR 7.2a — idempotent afronden en uploadstatus | Gemerged | #61 | Voorbereidingsplan: `docs/pr-7.2-plan.md` §C 7.2a. **Firebase-contracten:** `firebase/src/documents/game.ts` krijgt `completedGameId: string \| null` (bewust GEEN `phase: 'completed'` — `phase` spiegelt exact `ActiveGame.phase`, die kent alleen `'setup'\|'tracking'`); nieuwe `firebase/src/documents/completedGame.ts` (`CompletedGameDocument`+`completedGameConverter` voor `organizations/{orgId}/teams/{teamId}/completedGames/{completedGameId}`, hergebruikt `assertGamePlayers()`/`assertSegment()` uit `game.ts`/`gameAction.ts` i.p.v. een tweede validatiekopie). **firestore.rules:** `completedGameId` toegevoegd aan `isValidGamePayload()`; het bestaande normale-patchpad (10a) weigert nu zodra `completedGameId != null` (bevroren na afronding); nieuw update-pad (10c) — de eenmalige finalize-patch, uitsluitend de actuele writer, `completedGameId` alleen null→niet-lege-string, raakt verder niets dan `completedGameId`/`revision`/`updatedAt`. Nieuwe `completedGames/{completedGameId}`-match: create-only (`isValidCompletedGamePayload`, pad-/payloadcontext, aanroeper moet de ACTUELE writer van `sourceGameId` zijn — spiegelt hoe actions aan de claim gebonden zijn), `update`/`delete` altijd geweigerd (tombstone is PR 7.2c-scope). Tijdens implementatie bleek de Rules-emulator op "maximum of 1000 expressions to evaluate" te stuiten toen de drie `games`-update-paden (10a/10b/finalize) als DRIE losse `allow update`-regels stonden — elke regel evalueert `isValidGamePayload()` (~25 veldchecks) opnieuw; opgelost door alle drie samen te voegen tot één `allow update` met gedeelde `isValidGamePayload()`-aanroep en een OR van de drie padvoorwaarden (zelfde autorisatiecontract, ~1/3 van de evaluatiekosten). **v2 domain/application:** `GameSyncCheckpoint` (`domain/game/syncCheckpoint.ts`) krijgt een optioneel `completedGameId`-veld (hergebruikt hetzelfde per-`gameId`-checkpoint, geen apart finalize-checkpoint nodig — een afgeronde `ActiveGame` wordt nooit meer als 'tracking' hervat). Nieuwe `application/game/projectCompletedGameForCloud.ts`: pure 1:1-projectie van `CompletedGame` (hergebruikt `projectGamePlayer()`/`projectSegment()` uit `projectGameForCloud.ts`, herberekent niets — `finishGame()`'s uitkomst blijft byte-/semantisch behouden). `GameCloudGateway` uitgebreid met `ensureCompletedGame()` (create-only + idempotent, zelfde alreadyConfirmed/readback-patroon als `uploadActions()`) en `completedGameId` op `GameSnapshotWriteResult` (nodig voor de server-kortsluitingscheck hieronder). `GameSyncCoordinator.finalize(game, completed, writer)` (nieuw): (1) lokale kortsluiting als dit checkpoint al `completedGameId === completed.id` draagt (idempotent, geen netwerk); (2) server-kortsluiting via `ensureGame()` — nodig omdat 10a/10c een reeds-`completedGameId`-parent categorisch weigeren, dus een retry na een crash tussen server-ack en lokale checkpointwrite moet dit HERKENNEN i.p.v. vast te lopen; (3) hergebruikt de volledige bestaande `sync()` (ensure/claim/upload/patch) zodat de actieset server-bevestigd is vóórdat een completed-snapshot ontstaat; (4) `ensureCompletedGame()`; (5) de finalize-patch met de verse revisie uit stap 3. Elke falende stap laat het checkpoint op `'actie-nodig'` zonder lokaal dataverlies, exact zoals `sync()`. Nieuwe `readFinalizeStatus()` voor een synchrone, netwerkloze statuslezing (Historie-lijst). **Infrastructure:** `FirestoreGameCloudGateway.ensureCompletedGame()` (create-only + readback/deepEqual, zelfde patroon als `uploadActions()`); `completedGameId` toegevoegd aan `ensureGame()`/`patchSnapshot()`'s readback-resultaten. **App.tsx:** `handleFinishGame()` roept `runFinalize(game, archived)` fire-and-forget aan vóórdat `gameRepo` naar een verse opzet wordt gereset (de laatste plek met de volledige actielog van de zojuist afgeronde wedstrijd); een `online`-reconnect-handler herprobeert alleen déze sessie's nog openstaande afrondingen (`pendingFinalizesRef`) — bekende, bewust gedocumenteerde grens: een browsercrash tussen archiveren en een voltooide finalize kan de raw acties van dat device niet meer hervatten ná een paginareload (v2 kent maar één actieve-wedstrijdslot); de lokale `CompletedGame`/CSV blijft in dat geval altijd beschikbaar, alleen de cloud-sync van dat device blijft op `'actie-nodig'` tot een online sessie. `HistoryPanel` toont per item een `SyncStatusIndicator` (`lokaal`/`wacht op synchronisatie`/`gesynchroniseerd`/`actie nodig`), uitsluitend in cloud-modus. **Tests:** firebase — 22 nieuwe/uitgebreide converter-tests (`documentConverters.spec.ts`, nu 68) en een nieuw `tests/rules/completed-games.spec.ts` (18 tests) plus 8 nieuwe finalize-patch-tests in `games-and-actions.spec.ts`; volledige `firebase-base`-verify (type-check + 73 unit- + 171 rules-tests) groen tegen de echte emulator. v2 — 20 nieuwe tests in `GameSyncCoordinator.spec.ts` (happy path, dezelfde finalize tweemaal, crash na elke stap, afwijkende bestaande payload, ingetrokken membership, server-al-afgerond-recovery, gecorrumpeerd lokaal checkpoint), 4 in `projectCompletedGameForCloud.spec.ts`, 2 in `gameSyncCheckpointRepository.spec.ts`, 3 in `HistoryPanel.spec.tsx`; volledige v2-suite (typecheck/lint/format/unit — 595 tests/build) groen. Emulator-e2e voor de finalize-flow is bewust NIET in deze PR (2-device-pilot/emulator-reads-writes-baseline is expliciet PR 7.2c-scope in het voorbereidingsplan). **Externe review PR #61** (aug. 2026) vond twee P1's, beide opgelost vóór verdere merge-overweging: (1) *finalize was niet hervatbaar na een paginareload* — het `(ActiveGame, CompletedGame)`-paar dat `finalize()` nodig heeft leefde alleen in een in-memory `useRef`, terwijl het actieve-wedstrijdslot meteen na archiveren naar een verse opzet werd gereset; opgelost met een nieuwe duurzame lokale outbox (`application/game/PendingFinalizeRepository.ts` + `infrastructure/game/LocalStoragePendingFinalizeRepository.ts`, eigen sleutel per organisatie/team) — `handleFinishGame()` schrijft hierheen VÓÓR de reset, een nieuw "hervat-op-load"-effect in `App.tsx` biedt bij elke (her)start alle nog openstaande outbox-items opnieuw aan `finalize()` aan, en een entry wordt pas verwijderd na `status:'idle'`. Bewezen met een echte reload-simulatie (`tests/unit/AppFinalizeResume.spec.tsx`: outbox-entry rechtstreeks in `localStorage` gezet, dan een VERSE `<App>`+`GameSyncCoordinator`-instantie gerenderd — toont dat de entry vanzelf hervat en na succes opgeruimd wordt) plus 10 nieuwe unit-tests (`tests/unit/pendingFinalizeRepository.spec.ts`, incl. "overleeft een nieuwe repository-instantie tegen dezelfde storage"). (2) *Rules dwongen de dubbele-snapshot-guard niet af* — de `completedGames`-createregel controleerde alleen de auteur, niet dat deze create en de parent-finalize-patch (10c) atomisch samen gebeuren; dezelfde writer kon zo twee completed-snapshots voor één `sourceGameId` laten ontstaan, of een crash tussen de twee (voorheen losse) writes een orphan-snapshot achterlaten. Opgelost: `GameCloudGateway.ensureCompletedGame()`+losse `patchSnapshot()` vervangen door één nieuwe atomische `finalizeCompletedGame()` (`FirestoreGameCloudGateway`: een Firestore-`WriteBatch` die de snapshot-create ÉN de parentpatch in dezelfde batch verstuurt); `firestore.rules`' `completedGames`-createregel (punt 16) eist nu `getAfter(gameRef(...)).data.completedGameId == completedGameId` — een standalone create (geen bijbehorende parentpatch in dezelfde batch) of een tweede batch voor een AL afgeronde wedstrijd faalt daardoor altijd atomisch in zijn geheel, nooit een orphan. Bewezen met 3 nieuwe Rules-tests in `tests/rules/completed-games.spec.ts` (standalone create geweigerd, een tweede finalize-batch voor dezelfde wedstrijd atomisch geweigerd mét bewijs van geen orphan-document, een create/parentpatch-ID-mismatch geweigerd) — volledige `firebase-base`-verify nu 174 tests (was 171), volledige v2-suite nu 607 tests (was 595), beide + productiebuild groen geverifieerd tegen de echte emulator na deze reviewronde. **Externe review PR #61 [tweede ronde]:** reviewer sloot de atomiciteits-thread (b) volledig af, maar hield de resumability-thread (a) open met een resterende hiaat: een mislukte `pendingFinalizeRepo.add()` (bijv. quota-overschrijding, of de niet-strikte `browserStorage` die een onbeschikbare storage-getter stilzwijgend als no-op behandelt) weerhield `handleFinishGame()` er niet van om alsnog het actieve-wedstrijdslot te resetten — de enige duurzame retrybron voor die afronding kon zo alsnog verloren gaan. Reviewer expliciet: "Maak outbox-persistency daarom een echte preconditie vóór archiveren/resetten (met strikte storage en fail-closed read/write; geen bestaande outbox overschrijven na read/corruptiefout) en voeg een App-regressietest toe waarin outbox add() faalt en wordt bewezen dat de bronwedstrijd niet verloren/reset raakt." Opgelost: (1) `LocalStoragePendingFinalizeRepository` herschreven naar fail-closed — `readAll()` geeft nu `{entries, ok}` terug en onderscheidt een genuine lege outbox (`ok:true`) van een mislukte/onbeschikbare read (`ok:false`, storage-getter gooit, corrupte JSON, of geen array); `add()`/`remove()` weigeren (`false`) zodra `ok:false` in plaats van op basis van een foutieve lege lijst te schrijven — exact hetzelfde fail-closed-patroon als `LocalStorageCompletedGameRepository`'s eerdere externe-reviewronde. (2) `App.tsx` instantieert de outbox nu met `strictReadBrowserStorage` (niet `browserStorage`), zodat een onbeschikbare storage-getter altijd doorwerkt als een echte fout in plaats van een stil no-op. (3) `handleFinishGame()` herstructureerd: een mislukte `pendingFinalizeRepo.add()` is nu een echte precondition die de functie direct laat stoppen (`setGameSaveError(true); return;`, géén reset van het actieve slot, géén `runFinalize()`-aanroep) — spiegelt exact het bestaande patroon voor een mislukte `completedGameRepo.add()` erboven. Bewezen met: twee nieuwe `FlakyStorage`-tests in `pendingFinalizeRepository.spec.ts` (`getItem()` faalt na een geslaagde eerdere `add()`; bewijst dat noch `add()` noch `remove()` de bestaande entry op basis van de mislukte read overschrijft/wist), en een volledige DOM-gedreven App-regressietest in `AppFinalizeResume.spec.tsx` die `window.localStorage` volledig vervangt door een custom `SelectiveFailStorage`-klasse (nodig omdat `vi.spyOn(window.localStorage, 'setItem')` in jsdom niet werkt — `Storage` is daar een Proxy waarbij een method-assignment zelf als `setItem('setItem', ...)` wordt geïnterpreteerd) die alléén de outbox-sleutel laat falen: bewijst dat de bronwedstrijd in `localStorage` ongewijzigd (`phase:'tracking'`, actielog intact) blijft staan, dat `gateway.finalizeCompletedGame()` nooit wordt aangeroepen, en dat `game-save-error` zichtbaar wordt. Volledige v2-suite nu 610 tests (was 607); `firebase-base` ongewijzigd op 174 (deze ronde was v2-only); typecheck, eslint, prettier en productiebuild groen geverifieerd na deze reviewronde. **Externe review PR #61 [derde ronde]:** reviewer sloot de resumability-thread (a) definitief af op exacte head `f135c3d`, maar vond in de bredere eindreview twee nieuwe, aangrenzende P1-paden in `App.tsx`. (1) *Verwijderen kon de enige retrybron van een nog pending finalize wissen*: `handleDeleteCompletedGame()` verwijderde onvoorwaardelijk zowel de lokale `CompletedGame` als de in-memory/duurzame outbox-entry, ook als de cloudfinalize nog nooit server-bevestigd was — in strijd met 7.2a's acceptatiecriterium "geen bronverwijdering", en kon bovendien een orphan cloudsnapshot achterlaten als de fire-and-forget finalize ondertussen alsnog slaagde. Opgelost: verwijderen is nu geblokkeerd in cloud-modus zolang `finalizeStatuses[id] !== 'gesynchroniseerd'` (fail-closed: ook een nog onbekende status blokkeert) — met een eigen `deleteBlockedPendingSync`-banner in `HistoryPanel` (los van de bestaande `saveError`-banner, want dit is een bewust geblokkeerde actie, geen mislukte opslag), tot 7.2c een echte tombstone-flow levert. (2) *`pendingFinalizesRef` was geen in-flight guard*: `runFinalize()` kon vanuit afronden/hervat-op-load/online-reconnect gelijktijdig voor hetzelfde `completed.id` aangeroepen worden, zodat twee cycli op dezelfde revisie konden racen — een geslaagde cyclus verwijderde de outbox al, waarna een laat mislukkende tweede cyclus de status alsnog naar `actie-nodig` terugzette zonder dat er nog een retrybron over was. Opgelost: een nieuw per-`completed.id` in-flight/queued-patroon (`finalizeInFlightRef`/`finalizeQueuedRef`), dat exact het bestaande `runGameSync`-patroon hierboven spiegelt — een aanroep tijdens een lopende cyclus voor hetzelfde ID wordt gemarkeerd voor precies één hernieuwde poging ná settelen, in plaats van een tweede gelijktijdige gatewayaanroep te starten. Bewezen met: een nieuwe `HistoryPanel`-testsuite voor de `deleteBlocked`-banner (lijst- én detailweergave, met/zonder), en twee nieuwe `App`-regressietests in `AppFinalizeResume.spec.tsx` — één die een mislukkende/offline finalize simuleert, een verwijderpoging blokkeert bewijst (banner + bron ongewijzigd in `localStorage`), en vervolgens met een verse App/coordinator-instantie (reload/reconnect) aantoont dat de bron nog steeds hervat en succesvol afgerond kan worden; en één die met een handmatig stuurbare (`deferred`) gateway-belofte bewijst dat meerdere `online`-events tijdens een lopende finalize nooit een tweede gelijktijdige gatewayaanroep starten, dat de outbox pas na een definitief succes wordt opgeruimd, en dat er nooit een overbodige derde aanroep volgt. Volledige v2-suite nu 614 tests (was 610); `firebase-base` ongewijzigd op 174 (deze ronde was opnieuw v2-only); typecheck, eslint, prettier en productiebuild groen geverifieerd na deze reviewronde |
| PR 7.2b — cloudhistorie en tweede apparaat | Geïmplementeerd | | Voorbereidingsplan: `docs/pr-7.2-plan.md` §C 7.2b. Nieuwe `infrastructure/game/FirestoreCompletedGameRepository.ts` (read-only cloudbron: `organizations/{orgId}/teams/{teamId}/completedGames`-query, `orderBy('date','desc')`, vaste bovengrens `COMPLETED_GAMES_QUERY_LIMIT`, geen nieuwe index nodig) en `infrastructure/game/CompositeCompletedGameRepository.ts` (voegt lokaal ∪ cloud samen achter de bestaande `CompletedGameRepository`-poort, gededupliceerd op `CompletedGame.id` — hetzelfde ID als het Firestore-documentnaam-ID uit `GameSyncCoordinator.finalize()` — lokale versie wint bij een botsing, hersorteerd op datum aflopend; `add`/`remove`/`replaceAll` delegeren naar lokaal, cloudschrijven blijft uitsluitend via `GameSyncCoordinator`). `CompletedGameRepository`-poort kreeg een optionele `subscribe(onNext, onError)` zodat `StatsPanel`/`TrendsPanel`/`HistoryPanel` ongewijzigd blijven terwijl `App.tsx` op cloud-pushes kan reageren. `selectRepositories.ts`/`resolveAppRepositories.ts` bouwen de composite in cloud-modus (`null` in lokale modus, zelfde patroon als `gameSync`). **Aangescherpt in dezelfde PR:** nu een cloud-only/gesynchroniseerde wedstrijd via de composite zichtbaar wordt op elk apparaat, zou een "geslaagde" lokale `remove()` zichzelf ongedaan maken zodra de eerstvolgende cloud-snapshot binnenkomt (firestore.rules staat nog geen `update`/`delete` toe op `completedGames` — dat is PR 7.2c). `handleDeleteCompletedGame()` blokkeert verwijderen in cloud-modus daarom nu altijd (was: toegestaan zodra `gesynchroniseerd`); `deleteBlockedPendingSync`-tekst aangepast zodat 'm niet langer belooft dat verwijderen na sync alsnog lukt. `finalizeStatuses`-effect behandelt een cloud-only item (nooit lokaal op dit apparaat opgeslagen) direct als `gesynchroniseerd` — `readFinalizeStatus()` leest uitsluitend het lokale checkpoint en zou anders ten onrechte `lokaal-beschikbaar` teruggeven. `HistoryPanel` kreeg een `cloudReadError`-banner (nooit gelijk aan "geen wedstrijden") en een lijstbrede `cloudSync`-indicator (cache-/serveractualiteit). **Tests:** 2 nieuwe unit-specs (`FirestoreCompletedGameRepository.spec.ts`, `CompositeCompletedGameRepository.spec.ts`, 19 tests) plus 3 bestaande App-tests aangepast voor het nieuwe `ResolvedAppRepositories.completedGames`-veld; volledige v2-suite (642 tests), typecheck, lint en format groen. Nieuwe emulator-e2e `tests/e2e-auth/game-sync-second-client-completed-history.spec.ts` (echte Rules via `openSecondDevice()`): bewijst dat een op apparaat A afgeronde wedstrijd zonder reload op apparaat B verschijnt via de echte Historie-UI — volledige `test:e2e:auth`-suite (53 tests) groen tegen de echte Firestore-/Auth-emulator. **Zijvondst tijdens het schrijven van die e2e-test** (geen 7.2b-regressie, bestaande PR 7.1c/7.2a-scope): `GameSyncCoordinator.finalize()` roept intern `sync()` aan, volledig los van `app/App.tsx`'s eigen `gameSyncInFlightRef`-serialisatie voor de live trackingsync — een 'Afronden'-klik vlak na een score-/segmentactie (vóórdat die actie's eigen sync-cyclus server-bevestigd is) laat zo twee gelijktijdige `patchSnapshot()`-aanroepen op dezelfde verwachte `revision` racen; de verliezer wordt terecht door firestore.rules' optimistische-concurrencycheck afgewezen en het checkpoint valt op `actie-nodig`. Nooit eerder zichtbaar omdat geen bestaande e2e-test ooit een live actie direct liet volgen door 'Afronden' zonder eerst op `gesynchroniseerd` te wachten. De nieuwe test ontwijkt 'm door dezelfde wacht-tussen-acties-conventie als de rest van de suite te volgen (zie de docstring bij `finishGameWithOneSegment()`); een coordinator-brede mutex voor `finalize()`/live-sync is nog niet opgelost en verdient een eigen, gerichte PR — zie `docs/pr-7.2-plan.md` §C 7.2b voor het volledige verslag. |
| PR 7.2c — tombstones en pilotbewijs | Geïmplementeerd | | Voorbereidingsplan: `docs/pr-7.2-plan.md` §C 7.2c (volledig implementatieverslag daar, inclusief exacte rules-voorwaarden, resurrectie-preventiemechanisme en test/e2e-overzicht — hier alleen de samenvatting). `firestore.rules`: nieuwe `allow update` op `completedGames/{completedGameId}` — uitsluitend `canManageTeamData` (owner/admin/coach), alleen als nog niet eerder getombstoned, uitsluitend `deletedAt`/`deletedBy`/`revision` geraakt (`diff(...).affectedKeys().hasOnly([...])` — bevroren inhoud blijft byte-identiek), `deletedBy == request.auth.uid`, optimistische concurrency via `revision`; `allow delete` blijft `false` (tombstone, geen hard delete). `CompletedGame`/`CompletedGameDocument` uitgebreid met `revision`/`deletedAt`/`deletedBy` (backward-compatibele defaults bij backup-import/v1-migratie). `GameCloudGateway.tombstoneCompletedGame()` + `FirestoreGameCloudGateway`-implementatie (niet-transactionele `updateDoc()`, net als `patchSnapshot()`). `CompositeCompletedGameRepository`: nieuwe async `tombstone(id, deletedBy)`; `mergeGames()` filtert elk cloud-item met `deletedAt != null` altijd uit de zichtbare lijst (resurrectie-preventie, ongeacht een niet-getombstoned lokale kopie), en het cloud-`subscribe()`-abonnement ruimt zo'n lokale kopie proactief op zodra de tombstone binnenkomt. `App.tsx` `handleDeleteCompletedGame()`: niet meer onvoorwaardelijk geblokkeerd in cloud-modus — nog niet server-bevestigd blijft geblokkeerd (tekst aangepast), wél server-bevestigd roept `tombstone()` aan; een nieuwe, aparte `deleteError`-banner dekt een afgewezen/gefaalde patch. Bewaarbesluit: geen automatische purge vóór PR 8.3, een getombstoned document blijft server-side auditeerbaar/exporteerbaar (geen nieuwe app-UI hiervoor in deze PR). **Tests:** firebase — 12 nieuwe rules-tests in `completed-games.spec.ts` (33 totaal), 1 nieuwe converter-test (70 totaal), nieuw `pilot-reads-writes-completed-games.spec.ts` (3 tests, meet tegen de echte emulator: afronden = 2 writes, cloudhistoriequery op twee apparaten = 2 reads, tombstone-delete = 1 write — vergelijking met de 5.5c-staging-baseline blijft een handmatige staging-stap); volledige `firebase-base`-rules-suite 189 tests groen. v2 — uitgebreide `CompositeCompletedGameRepository.spec.ts` (tombstone()-gedrag + resurrectie-preventie), `HistoryPanel.spec.tsx` (deleteError-banner), nieuw `AppTombstoneDelete.spec.tsx` (3 DOM-gedreven App-tests), fixture-updates in alle bestaande `CompletedGame`/`CompletedGameDocument`-literals; volledige v2-suite (662 tests), typecheck, eslint, prettier en productiebuild groen. Nieuwe emulator-e2e `tests/e2e-auth/game-sync-second-client-tombstone.spec.ts` (echte Rules via `openSecondDevice()`): apparaat A rondt af en verwijdert via de echte 'Verwijderen'-knop, een Admin-SDK-lezing bevestigt server-kant `deletedAt`/`deletedBy` en ongewijzigde score/segmenten, apparaat B (geopend NA de tombstone) ziet het item nooit — volledige `test:e2e:auth`-suite (58 specs) groen tegen de echte Firebase Auth-/Firestore-emulator. |
| PR 7.3a — claim, epoch en pre-game gate | Geïmplementeerd | | Voorbereidingsplan: `docs/pr-7.3-plan.md` §C 7.3a (volledig implementatieverslag daar — hier alleen de samenvatting). Nieuw `domain/game/writerClaim.ts` (pure claim-/epochtypes + `gameStartBlockReason()`, combineert roster- en cloudclaim-redenen). `firestore.rules`/`firebase/src/documents/game.ts`: nieuwe velden `claimedAt`/`lastWriterActivityAt`; nieuw pad 10d (**overname**) — elke bevoegde rol mag een AL geclaimd document overnemen mits `writerEpoch` met exact 1 omhoog gaat, geen `runTransaction()` nodig (Firestore serialiseert per document, Rules herevalueren tegen de laatste staat — zelfde garantie). `GameCloudGateway.claimWriter()`/`takeoverWriter()` (nieuw, met foutclassificatie naar `WriterClaimErrorCode`); `GameSyncCoordinator` gebruikt voortaan het ECHTE serverepoch voor action-uploads (was vóór 7.3a statisch op 0) en krijgt `ensureWriterClaim()` (het expliciete, blokkerende claimpad vóór tip-off) en `takeoverWriter()` (bouwsteen, nog geen UI-knop — dat is 7.3c-scope). `GameSetupPanel`/`App.tsx`: de startknop blijft in cloud-modus geblokkeerd tot een serverbevestigde claim (`cloudClaim` state, automatisch aangevraagd zodra de wedstrijd startbaar is), met een NL/EN-herstelmelding per foutcode en een "Opnieuw proberen"-knop; alleen-lokale modus blijft ongewijzigd zonder claim/netwerk. `App.tsx`/`AuthGate.tsx`: nieuwe `onGameLockChange`-prop — een bevestigde claim OF `phase === 'tracking'` blokkeert `handleBackToSwitcher()` met een dismissible banner (geen "expliciet loslaten"-actie nog, dat is 7.3c-scope). **Tests:** firebase — 209 rules-tests (was 189: het volledige 10d-overnamepad — geldig, self-promotion, viewer, epoch-sprong, epoch-ongewijzigd, lege deviceId, claimedAt/lastWriterActivityAt-niet-samen, draaivelden-in-dezelfde-patch, stale revision, afgeronde wedstrijd, en het fencingbewijs dat een oude actie na overname geweigerd wordt), 75 unit-tests; volledige rules-/unit-suite groen tegen de emulator. v2 — nieuw `writerClaim.spec.ts`, uitgebreid `GameSyncCoordinator.spec.ts` (`ensureWriterClaim()`/`takeoverWriter()`-scenario's), nieuw `GameSetupPanel.spec.tsx` (alle claimstatussen/foutcodes), nieuw `AppWriterClaim.spec.tsx` (end-to-end door `App` heen: automatische claim, lock-timing, alleen-lokale modus blijft claimloos); volledige v2-suite nu 713 tests, typecheck, eslint groen. **Nog niet gedaan (bij verschijnen van deze PR):** overname-bevestigings-UI en echte-apparaat-/emulator-e2e-tests voor claimrace/contextwissel waren bewust doorgeschoven naar 7.3c (§C 7.3c werk 1/4/5); 7.3b was toen nog niet gestart — beide sindsdien geïmplementeerd, zie de rijen hieronder. |
| PR 7.3b — live writer-sync en read-only viewer | Geïmplementeerd; gemerged via PR #68 (squash, commit `81af77b`) | #68 | Voorbereidingsplan: `docs/pr-7.3-plan.md` §C 7.3b (volledig implementatieverslag daar). Epoch/sequence-ordening en idempotente action-upload (werk 1) en offline-bruikbare lokale writeracties zonder server-await (werk 4) bleken al volledig gedekt door 7.3a — geverifieerd, niet herbouwd. Nieuwe pure `deriveGameStateFromCloud.ts` reconstrueert score/segmenthistorie uit cloud-actionenvelopes met dezelfde `applyAction()`-reducer als de writer (geen tweede berekening); nieuwe `GameCloudGateway.subscribeToGame()` + Firestore-`onSnapshot()`-implementatie (parent + actions, geen Rules-wijziging nodig — `canReadTeam` dekte viewer-reads al); `useGameCloudViewer`-hook + `GameCloudViewerState` combineren writerClaim/historie/freshness (`server`/`cache`/`error`)/loading. `App.tsx` schakelt schrijfbediening alleen uit bij een bevestigde ANDERE writer (nooit tijdens initiële load/offline), met een cloud-viewer-banner. **Regressiefix na eerste CI-run:** de live listener blokkeerde aanvankelijk lokaal scoren al bij elke server-writerUid-mismatch (ook een niet-legitieme, zelfde-epoch-conflict) — brak een bewust 7.1c/7.3a-principe; nieuwe pure `isEpochPromotedTakeover()` blokkeert alleen bij een écht epoch-verhoogde overname. Volledige v2-suite 753 tests, firebase Rules-suite 216 tests, CI groen op alle jobs; externe review (minimax) verwerkt (self-deps-fix in de hook, freshness-coherentie-fix, extra testdekking). Nog niet gedaan: overname-UI (7.3c) en crashherstel-machinerie (7.3c, later bleek al door constructie afgedekt). |
| PR 7.3c — overname, recovery en echte-apparaatvalidatie | Geïmplementeerd; gemerged via PR #69 (squash, commit `0b2a9ed`) | #69 | Voorbereidingsplan: `docs/pr-7.3-plan.md` §C 7.3c (volledig implementatieverslag daar). Nieuwe `TakeoverConfirmDialog.tsx` + "Overnemen…"-knop in de `cloud-viewer-banner`, gekoppeld aan `GameSyncCoordinator.takeoverWriter()` (bestond al sinds 7.3a, kreeg hier z'n eerste UI-aanroeppunt) — toont huidige writer-identiteit, laatste serveractiviteit en een waarschuwing over nog niet gesynchroniseerde lokale acties. Epoch/sequence bleek al schoon bij overname (geverifieerd, geen codewijziging); nieuwe export van niet-bevestigde acties (`unconfirmedGameActions()`/`exportPendingGameActions.ts`). Crashherstel geverifieerd zonder nieuwe machinerie nodig: het lokale schrijfpad is al synchroon en gaat altijd vóór de cloudsync, met 3 nieuwe coordinator-tests die dit bewijzen. Nieuwe emulator-e2e-spec `game-sync-takeover.spec.ts` (twee onafhankelijke Firestore-clients, echte Rules) — na een testracefix (apparaat A bewust offline tijdens B's overname i.p.v. racen tegen de live listener) groen in CI. Echte iOS/Android-hardwarevalidatie kon niet in de sandbox worden uitgevoerd en is **niet gefingeerd** — expliciet doorgeschoven naar fase-7-acceptatie/fase 8. Nieuwe `pilot-reads-writes-takeover.spec.ts` meet emulator-reads/writes; vergelijking tegen een live 5.5c-stagingbaseline blijft een handmatige vervolgstap. Volledige v2-suite 769 tests, firebase Rules-suite 227 tests, CI groen; externe review (minimax) verwerkt (`.catch` rond onverwachte throw in de bevestigingsflow, extra testdekking voor de exportknop bij `actie-nodig`). Met deze PR is PR 7.3 (writerprotocol) codebouw-compleet. |
| PR 7.4a — inventarisatie, mapping en preview | Geïmplementeerd; gemerged via PR #70 (squash, commit `db28387`) | #70 | Voorbereidingsplan: `docs/pr-7.4-plan.md` §C 7.4a (volledig implementatieverslag daar). Bewust preview-only, nul writes. Nieuwe pure `domain/migration/`-laag: `fingerprint.ts` (stabiele hashing/ID-determinisme), `capability.ts` (`canBulkMigrate()` — eigen allowlist organizationOwner/organizationAdmin/coach, géén hergebruik van bredere canWrite-predicates), `payload.ts` (canonieke per-sectie hashbuilders), `inventory.ts` (hergebruikt PR 6.6's fail-closed sectievalidatoren ongewijzigd), `preview.ts` (`buildCloudMigrationPreview()` — rolcheck → corrupte-broncheck → item-opbouw; trackingfase-wedstrijden altijd uitgesloten van bulk, setupfase gemarkeerd `needsSeparateDecision`). Read-only `CloudMigrationInventoryGateway` + Firestore-implementatie, geen Rules-wijziging nodig. 36 nieuwe tests (determinisme, rolweigering, corrupte/lege/partiële bron, gelijknamige teams in meerdere organisaties). Volledige v2-suite 805 tests, firebase-suite ongewijzigd groen; externe review (minimax) leverde geen blokkerende punten op. |
| PR 7.4b — hervatbare migratiecoordinator | Geïmplementeerd; gemerged via PR #71 (squash, commit `e9fc8b6`) | #71 | Voorbereidingsplan: `docs/pr-7.4-plan.md` §C 7.4b (volledig implementatieverslag daar). Nieuwe pure `MigrationRun`-statemachine (`run.ts`: `running`/`paused`/`actionNeeded`/`completed`/`compensationFailed`) en `recoveryBackup.ts` (hergebruikt PR 6.6's back-upformaat). `MigrationRunRepository` (lokaal, hervatbaar, spiegelt `GameSyncCheckpointRepository`) + `CloudMigrationRunGateway` (Firestore-manifest voor audit/cross-device, best-effort geschreven) + `MigrationWriteGateway`/`MigrationCoordinator` (stapsgewijze uitvoering settings → roster → actieve wedstrijd → completed games, elke stap met serverreadback + checkpoint). Alle writes lopen via bestaande 5.3/7.2/7.3-gateways, geen tweede Firestorepad. Rollback/compensatie: alleen `completedGame`-items worden getombstoned (hergebruikt PR 7.2c's mechanisme); settings/roster blijven ongemoeid; een rollback-run wordt nooit als `completed` gerapporteerd. Nieuw Firestore-pad `migrationRuns/{runId}` met eigen Rules-testsuite. Volledige v2-suite 832 tests, firebase Rules-suite 227 tests (12 bestanden); externe review (minimax) verwerkt (runtime-validatie van cloud-manifest-enums, testdekking voor `blockedByExistingRunId` en ontbrekende-lokale-bron-pad). |
| PR 7.4c — migratie-UI en volledige e2e | Geïmplementeerd; gemerged via PR #72 (squash, commit `4176b29`) | #72 | Voorbereidingsplan: `docs/pr-7.4-plan.md` §C 7.4c (volledig implementatieverslag daar). Afsluitende sub-PR van PR 7.4. Nieuwe `MigrationPanel.tsx` — statemachine idle→loading→preview→backup→confirm→running→result (plus denied/error/blocked), spiegelt `BackupPanel.tsx` (PR 6.6) en `TakeoverConfirmDialog.tsx` (PR 7.3c); roept uitsluitend 7.4a/7.4b's bestaande functies aan, geen nieuwe domeinlogica. Per-sectie preview, verplichte herstelback-updownload-gate vóór bevestiging, sterke bevestiging, live voortgangsregio, resultaatweergave met retry/export. Gepoort op `canBulkMigrate(organizationRole)` — scorer/viewer krijgen het paneel nooit te zien. Nieuwe Playwright-matrix `migration-flow.spec.ts` (rolgating, lokale-modus-afwezigheid, volledige flow met reload-hervatting, conflict/dubbele-retry-idempotentie tegen echte Firestore). **CI-fixronde (drie iteraties):** twee echte, root-cause-gefixte bugs die lokaal (geen Chromium in de sandbox) niet te vangen waren — (1) `app/App.tsx`'s onvoorwaardelijke "verse opzet"-effect schreef een spelerloze placeholder die de hele preview als corrupt blokkeerde, opgelost met nieuwe `isUntouchedAutoSetupGame()`; (2) `manifestHash` hing af van de vluchtige clouddoelstand, waardoor hervatten na gedeeltelijke voortgang ten onrechte als botsende tweede migratie werd geblokkeerd, nu alleen nog gebaseerd op stabiele bron-/contextidentiteit — beide bewezen met een nieuwe permanente component-test `migrationE2eRepro.spec.tsx`. Staging-pilot met fictieve data (werk 5) **niet gefingeerd** — blijft een handmatige vervolgstap. Volledige v2-suite 842 tests, CI groen op alle 4 jobs; externe review (minimax) verwerkt. Met deze PR is PR 7.4 (bestaande gebruiker naar cloud) codebouw-compleet — daarmee is heel fase 7's PR-keten (7.1–7.4) codebouw-compleet; alleen de expliciete fase-7-acceptatiepoort (echte-apparaat-validatie + staging-pilot, zie §12 punt 9) blijft open. |
| PR 8.1a — update-detectie, gecontroleerde refresh en asset-consistentie | Gemerged | #75 | Voorbereidingsplan: `docs/pr-8.1-plan.md` §C 8.1a (volledig implementatieverslag daar). Vervangt `sw.ts`'s ongeconditioneerde `self.skipWaiting()` door een bericht-gestuurd contract (`{type:'SKIP_WAITING'}`); nieuwe `infrastructure/pwa/PwaUpdateAdapter.ts` (constructor raakt `navigator.serviceWorker` nooit aan, alleen `init()` doet dat — voorkomt een ongemerkte regressie op bestaande jsdom-Apptests), `application/pwa/usePwaUpdate.ts`, eigen `ui/pwa/PwaUpdateBanner.tsx` (bewust niet via `ActionNeededPanel`) + `ui/sync/PwaActionNeededPanel.tsx` voor het herstelbare-foutpad. Twee echte CI-regressies gevonden en gefixed vóór merge: (1) de eerste e2e-poging om een "tweede build" te simuleren via `page.route()`/`browserContext.route()` intercepteerde de browser-interne SW-update-checkfetch niet betrouwbaar — opgelost door `dist/sw.js` daadwerkelijk op disk te wijzigen in het testproces; (2) `usePwaUpdate()` mount pas binnen `App` (ná login+teamselectie), waardoor SW-registratie niet meer bij paginaload begon zoals vóór 8.1a — opgelost met een gedeelde `pwaUpdateAdapter`-singleton die `main.tsx` zelf op `window load` initialiseert |
| PR 8.1b — pre-game offline-readinesscheck | Gemerged | #76 | Voorbereidingsplan: `docs/pr-8.1-plan.md` §C 8.1b (volledig implementatieverslag daar). Nieuwe, pure `domain/pwa/pwaReadiness.ts` (`PwaReadinessStatus`: `unsupported\|registering\|ready\|update-pending\|broken`), bewust een eigen module naast (niet in) `writerClaim.ts`. `gameStartBlockReason()`/`canStartGame()` kregen een optioneel derde `pwaReadiness`-argument met een `'ready'`-default — bestaande tweeargumentaanroepen (7.3a-tests) blijven exact hetzelfde resultaat geven; alleen `broken` blokkeert ooit een wedstrijdstart. `GameSetupPanel.tsx` toont een concrete, vertaalde melding per deelstatus |
| PR 8.1c — Safari/iPadOS-validatie en fallbackregistratie | Gemerged | #77 | Voorbereidingsplan: `docs/pr-8.1-plan.md` §C 8.1c (volledig implementatieverslag daar). Classic (niet-module) SW-fallbackbundel (`src/sw-classic.ts`, tweede `vite build`-aanroep via `SW_BUILD_TARGET=classic`), gekozen via een echte runtime-capability-check (`detectModuleServiceWorkerSupport()`, geen user-agent-sniffing) — één keuze vóór de registratiepoging, geen "probeer module, val terug bij falen"-keten. Nieuwe `scripts/verify-sw-classic-bundle.mjs` faalt `npm run build` als de classic-bundel ooit een top-level ES-module-`import` bevat. Falen zowel module- als classic-registratie, dan rapporteert `pwaReadiness` de al bestaande `broken`-status (bewust geen zesde, aparte deelstatus). **Werkitem 3 (echte Safari/iPadOS-hardwarevalidatie) blijft expliciet open** — geen fysieke iOS/iPadOS-hardware beschikbaar in de ontwikkelsandbox; zie de bestaande iOS-restpuntvermelding hieronder (rij "Fase 7") — geen tweede, losse trackingregel |
| Fase 8 — hardening en cutover | PR 8.1 (PWA-updates en herstel) volledig gemerged (8.1a/8.1b/8.1c, #75/#76/#77); PR 8.2 (toegankelijkheid en courtside QA): 8.2a gemerged (#81), 8.2b gemerged (#83), 8.2c geïmplementeerd (open PR); PR 8.3 nog niet gestart |  | PWA, a11y, security, parallelle acceptatie en expliciete productiecutover. Safari/iPadOS-echte-apparaatvalidatie voor de 8.1c-classic-SW-fallback blijft hetzelfde open restpunt als de bestaande iOS-regel bij Fase 7 |
| PR 8.2a — focus-infrastructuur, keyboard-navigatie en axe-core-baseline | Gemerged | #81 | Voorbereidingsplan: `docs/pr-8.2-plan.md` §C 8.2a. Nieuwe `@axe-core/playwright`-scan (`a11y-axe.spec.ts`) tegen de kernschermen, `infrastructure/a11y/focusTrap.ts` + `application/a11y/useFocusTrap.ts` (Tab-cyclus, focus-restore) gekoppeld aan `ModalDialog.tsx`, `GamesFilterModal.tsx` en `TakeoverConfirmDialog.tsx`, en `a11y-keyboard.spec.ts` voor het browserbewijs |
| PR 8.2b — score-/wissel-/contextbediening, clubkleurcontrast en reduced-motion | Gemerged | #83 | Voorbereidingsplan: `docs/pr-8.2-plan.md` §C 8.2b. Keyboard-bediening (score/wissel/kwart/contextwissel) bleek al volledig aanwezig — alleen e2e-bewijs toegevoegd (`a11y-keyboard.spec.ts`). Bug 10 (`docs/pr-5.5c-bugfixes.md` #10) opgelost via `--team-primary`/`--team-accent` CSS custom properties. **Eerste P1-review-opvolging (28 aug. 2026):** een eerste versie van de contrastfix toetste alleen tegen lichte-modus-vaste kleuren, waardoor `DEFAULT_SETTINGS`'s teamkleuren in donkere modus zelf onder de AA-drempel renderden (axe-core `color-contrast`) — `domain/settings/colorContrast.ts` herzien naar een afgeleide, wiskundig gegarandeerd leesbare knoptekst (`deriveButtonForeground`) en (destijds) een schema-bewuste headertitel-tekstkleur; de niet-blokkerende waarschuwing uit de eerste versie is daardoor vervallen. **Tweede P1-review-opvolging (29 aug. 2026):** de headertitel-tekstoplossing bleek zelf een regressie — geen van de tien kleurpresets haalt 4,5:1 tegen de lichte headerachtergrond, dus alle tien vielen terug op hetzelfde zwart (onzichtbare accentkeuze). `accentColor` wordt daarom niet meer als `.app-title`-tekstkleur gebruikt maar als puur decoratief accent (`border-left`, geen WCAG-tekstcontrasteis); `deriveAccentForeground` is verwijderd. **Derde review-opvolging (P2, 29 aug. 2026):** `docs/pr-8.2-plan.md` §B punt 4/werk 4 spraken de nieuwe acceptatiecriteria nog tegen (eisten nog de vervallen contrastwaarschuwing) — tekst bijgewerkt; `DEFAULT_SETTINGS.accentColor`'s wijziging naar `#c2410c` had geen bestaansreden meer (accentColor is nu puur decoratief, geen WCAG-tekstcontrasteis) — teruggedraaid naar `#f97316`. Reduced-motion bevestigd met een nieuwe modal-intredeanimatie + regressietest (v2 had voordien geen enkele CSS-animation/transition). Lokaal tegen de Firebase-emulator: unit- en e2e-suites groen |
| PR 8.2c — gedeeld apparaat, mobiele viewports en zwakke verbinding | Geïmplementeerd (open PR) |  | Voorbereidingsplan: `docs/pr-8.2-plan.md` §C 8.2c. `AuthGate.tsx`'s `handleSignOut()`/`handleChangeTrustedDevice()` breiden op het onvertrouwd-apparaatpad uit met `infrastructure/device/clearLocalDeviceData.ts` — enumereert `listBrowserStorageKeys()` (`i18n/browserStorage.ts`) en wist elke daadwerkelijk aanwezige sleutel die matcht met een expliciete `PREFIX`-constante (actieve wedstrijd/voltooide wedstrijden/pending-finalize/migratierun/game-sync-checkpoint) of de vaste witte-lijstsleutels — voor ELKE org/team/gameId op dit apparaat, niet alleen de huidige context (herzien na een P1-reviewbevinding op #84: een eerste versie wiste alleen de huidige context); nooit `localStorage.clear()`/een blinde storage-scan, taalvoorkeur/vertrouwd-apparaatvlag/cloud-import-vlaggen blijven bewust staan. Herroepbare vertrouwd-apparaat-instelling in `SessionBar.tsx` (checkbox + toegankelijke bevestigingsdialoog met `useFocusTrap`, Escape-afhandeling en focusherstel — herzien na een P1-reviewbevinding over axe `aria-dialog-name`) — wisselt live via `writeTrustedDevice()` + dezelfde wislogica, gevolgd door een paginareload. Tweede, kleiner/ouder mobiel viewportprofiel (375×667, iPhone SE 2016/8-formaat) in `tests/e2e/mobile-legacy.spec.ts` — **open besluitpunt (§B punt 6): deze viewportkeuze is een voorstel, vraagt expliciete bevestiging van de repo-eigenaar vóór merge.** CDP-netwerkemulatie (`tests/e2e-auth/game-sync-weak-network.spec.ts`, `latency: 500` zonder bandbreedteplafond — het oorspronkelijke ~1500ms/3G-voorstel bleek in CI structureel te blijven hangen zolang op de synchronisatie-uitkomst gewacht werd terwijl de emulatie actief bleef, zie `docs/pr-8.2-plan.md` §C 8.2c werk 4) bewijst dat score-knoppen klikbaar blijven, en dat een tweede score-actie — geobserveerd via `waitForGameSyncStatus(page, 'wacht-op-synchronisatie')` vóórdat de eerste upload klaar is — met de juiste `sequence`/delta aankomt; de emulatie gaat uit vóórdat op de uiteindelijke `'gesynchroniseerd'`-uitkomst gewacht wordt. Lokaal: unit-, type-, lint- en buildcontroles groen (942 unit tests); e2e/e2e-auth niet lokaal uitvoerbaar (Playwright/Chromium-browserdownload is in deze sandbox netwerkgeblokkeerd, zelfde restpunt als 8.1c/7.3c/7.4c) — CI (exact head, herhaalde externe review) bevestigt 4/4 groen |
| Fase 9 — groei na multi-organisatiebasis | Niet gestart |  | Multi-organisatie zit in fase 5; self-service schaalfuncties volgen na stabiele productie |

## 18. Bewuste uitsluitingen

Dit plan geeft nog geen toestemming voor:

- database-implementatie voordat fase 4 expliciet is goedgekeurd;
- Firebase service-accountkeys, Admin SDK-credentials,
  databasebeheersleutels, service-role-sleutels of Airtable-tokens in
  frontendcode;
- wijziging van historische statistiekdefinities;
- deployment, hostingwijziging of productie-cutover zonder afzonderlijke expliciete goedkeuring;
- een frontendstack die afwijkt van het goedgekeurde architectuurbesluit;
- automatische publicatie buiten de bestaande pipeline;
- verwerking van echte spelersdata in tests, fixtures, prompts of screenshots.

Deze onderwerpen vereisen eerst een afzonderlijk besluit.
