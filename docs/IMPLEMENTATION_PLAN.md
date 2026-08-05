# Implementatieplan — Wheelchair Basketball Lineup Tracker

Status: actief implementatieplan voor afzonderlijke v2-/herbouwrepository
Repository: `camilovtrijp-coder/wheelchair-basketball-lineuptracker`
Oorspronkelijke basis: `main` op commit `e2684047985d13740b913938887ea692a6c44dc7`
Laatst gevalideerd: `main` op commit `a0eab1bfe668568e2ec72ed367b075f52fa6c2e4`
Bijgewerkt: 1 augustus 2026

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

Alleen na afzonderlijke expliciete hostingopdracht:

- leg base directory, `npm run build` en `v2/dist` vast;
- maak GitHub-gekoppelde Deploy Previews voor pull requests;
- controleer of het bestaande Netlify-account een legacy- of credit-based plan
  gebruikt en leg quota/kosten vast; geen betaalde upgrade of auto-recharge;
- wijs Deploy Previews uitsluitend naar development/staging Firebase, nooit
  productie;
- beheer Firebase-webconfig per deploycontext buiten de broncode;
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
- startvalidatie en hervatten van een voorbereide wedstrijd;
- actieve organisatie/teamcontext verplicht opslaan en na start vergrendelen;
- v1-key blijft tijdens compatibiliteitsperiode leesbaar.

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

- lineupcombinaties, on/off, plus/min, speeltijd en per-10-minuten;
- handmatig narekenbare fixtures;
- totalen blijven afleidbaar uit bronacties/segmenten en niet alleen caches;
- meet Firestore-querykosten, maar bouw nog geen cloudbrede rapportagelaag.

### PR 6.5 — trends

- chronologische spelertrends, gemiddelde speeltijd en plus/min;
- lopende wedstrijd als voorlopig datapunt volgens v1-gedrag;
- mobiele weergave en lege/partiële/cachedata duidelijk onderscheiden.

### PR 6.6 — back-up, import en lokale migratie

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

### PR 7.1 — Firestore-wedstrijdmodel

- `games/{gameId}` voor identiteit/status/snapshot en
  `games/{gameId}/actions/{actionId}` voor append-only bronacties;
- actions dragen auteur, client-ID, volgnummer, tijd en organisatie/teamcontext;
- historische spelergegevens blijven onveranderlijk;
- score, plus/min en speeltijd blijven reproduceerbaar;
- documentgrootte, indexes, reads/writes en exportbaarheid worden getest.

### PR 7.2 — afgeronde wedstrijden synchroniseren

- clientgegenereerde IDs maken retries idempotent;
- voortgang en herstelbare foutstatus;
- verwijdering met tombstone en bewaarbeleid;
- historie op een tweede apparaat beschikbaar;
- afgeronde wedstrijd standaard onveranderlijk.

### PR 7.3 — actieve wedstrijd single-writer

- expliciet scorer-eigenaarschap/lease met auditvelden;
- andere apparaten read-only met zichtbare cache-/serveractualiteit;
- expliciete overname met revisiecontrole en sterke bevestiging;
- verlies van netwerk blokkeert de actieve scorer niet;
- dubbele of late actions veranderen score/segmenten niet;
- organisatie/teamcontext blijft gedurende de wedstrijd vergrendeld.

### PR 7.4 — bestaande gebruiker naar cloud

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

- eerste installatie, offline reload en app-shellupdate;
- geen mix van oude HTML en nieuwe gehashte assets;
- zichtbare updatebeschikbaarheid en gecontroleerde refresh;
- pre-game offline-readinesscheck;
- herstelbare technische/syncfouten zonder wedstrijdverlies;
- **Safari + iPadOS-ondersteuning verifiëren** voor de in PR 3.2a gekozen `type: 'module'` service-worker-registratie (Workbox-precache + NavigationRoute); module-SW heeft historisch beperkte ondersteuning in WebKit en vereist een echte Safari-test voordat dit als "PWA werkt" kan worden afgevinkt;
- **fallback-strategie** bepalen wanneer Safari geen module-SW accepteert (klassieke SW, alleen precache, of detectie + gebruikersmelding), en die keuze vastleggen voordat productie-cutover plaatsvindt.

### PR 8.2 — toegankelijkheid en courtside QA

- focusvolgorde, modal focus trap/restore en zichtbare focus;
- score-, wissel- en contextbediening met touch en toetsenbord;
- contrast van clubkleuren en `prefers-reduced-motion`;
- gangbare telefoonviewports, oudere doeltelefoon en zwakke/offline verbinding;
- gedeeld apparaat: vertrouwd-apparaatkeuze, uitloggen en cache wissen.

### PR 8.3 — beveiliging, privacy, kosten en beheer

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
| Fase 4 — cloud/sync/tenancy-ADR's | In uitvoering | #23 | ADR-001 geaccepteerd; PR 4.2 (ADR-002, offline sync) en PR 4.3 (ADR-003, tenancy) volgen |
| Fase 5 — platformpilot settings/team | Niet gestart |  | Firebase Emulator/Rules, Auth, multi-organisatiecontext, offline cache, twee apparaten en optionele Netlify-staging |
| Fase 6 — overige v1-flows | Niet gestart |  | Wedstrijdopzet, live, historie/export, stats, trends en back-up |
| Fase 7 — wedstrijdsync en migratie | Niet gestart |  | Afgeronde games, single-writer live sync en opt-in cloudmigratie |
| Fase 8 — hardening en cutover | Niet gestart |  | PWA, a11y, security, parallelle acceptatie en expliciete productiecutover |
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
