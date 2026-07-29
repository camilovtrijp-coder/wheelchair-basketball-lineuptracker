# Implementatieplan — Wheelchair Basketball Lineup Tracker

Status: voorstel voor afzonderlijke v2-/herbouwrepository  
Repository: `camilovtrijp-coder/wheelchair-basketball-lineuptracker`  
Gecontroleerde basis: `main` op commit `e2684047985d13740b913938887ea692a6c44dc7`  
Datum: 29 juli 2026

## 1. Doel

In deze afzonderlijke repository een robuuste v2 van de Lineup Tracker bouwen, zonder de werkende productie-app of de productie-repository te benaderen of aan te passen. De in deze v2-repository aanwezige kopie van de app, plus uitsluitend door de eigenaar aangeleverde screenshots, exports en beschrijvingen, vormen de gedrags- en productreferentie. De nieuwe app moet bestaand wedstrijdgedrag, lokale gegevens, offline werking en CSV-compatibiliteit aantoonbaar behouden voordat een eventuele overstap plaatsvindt.

De volgorde is bewust:

1. huidig gedrag aantoonbaar vastleggen;
2. gegevensopslag en import beveiligen;
3. de monolithische app gecontroleerd opdelen;
4. een veilige cloudarchitectuur en databasemodel kiezen;
5. accounts, teamtoegang en offline-first synchronisatie bouwen;
6. toegankelijkheid en offline gedrag verbeteren;
7. pas daarna aanvullende productfuncties kiezen en bouwen.

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
- Playwright maakt screenshots, maar dekt de kernlogica nog niet betrouwbaar met assertions.

## 3. Niet-onderhandelbare randvoorwaarden

Iedere implementatietaak moet aan deze regels voldoen:

- Behoud bestaande `localStorage`-keys en opgeslagen gebruikersdata, tenzij een expliciete en geteste migratie is toegevoegd.
- Behoud de bestaande Nederlandse CSV-kolommen en hun betekenis.
- Verander geen berekeningen zonder vooraf vastgelegde voorbeelden en tests.
- Voeg in fase 0 tot en met 3 geen backend, analytics, tracking of externe gegevensoverdracht toe.
- Voeg pas een backend toe nadat het architectuurbesluit uit fase 4 expliciet is goedgekeurd.
- Spelersgegevens, classificaties en wedstrijddata blijven lokaal op het toestel.
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
- Voeg geen nieuwe Netlify-specifieke code of controles toe; deployment wordt elders beheerd.
- Plaats nooit een databasebeheersleutel, `service_role`-sleutel of ander geheim in browsercode.
- Beveilig iedere aan de browser blootgestelde databasetabel met geteste rijtoegangsregels.
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
productcode-bug is, wordt die testcase als `test.fail()` gemarkeerd totdat de
importvalidatie is opgelost vóór Fase 2.

### Modeladvies

`opencode-go/kimi-k2.7-code` voor implementatie. Laat de berekeningsassertions zo mogelijk reviewen met `opencode-go/glm-5.2`.

## 7. Fase 2 — Data-integriteit en migraties

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

## 8. Fase 3 — Nieuwe modulaire v2-architectuur

### Doel

In deze afzonderlijke repository een nieuwe modulaire appstructuur opbouwen. De bestaande `index.html` dient tijdelijk als werkende referentie en wordt niet stukje voor stukje de definitieve architectuur in getrokken.

### Belangrijk besluit vooraf

Leg eerst in `docs/architecture/adr-000-frontend-architecture.md` vast welke frontendstack wordt gebruikt. Vergelijk minimaal:

- React + TypeScript + Vite;
- Preact + TypeScript + Vite;
- vanilla TypeScript met ES-modules.

Voor deze stateful app is React of Preact met TypeScript en Vite de voorkeursrichting, mits domeinberekeningen en opslag onafhankelijk van het UI-framework blijven. Hosting blijft platformneutraal en valt pas bij een latere cutoverbeslissing in scope.

### Voorgestelde doelstructuur

```text
index.html
src/
  app/
    App.tsx
    routes.ts
  domain/
    entities/
    calculations/
    validation/
  application/
    commands/
    queries/
    services/
  infrastructure/
    local/
    sync/
    repositories/
  ui/
    components/
    screens/
    hooks/
  i18n/
  styles/
tests/
  unit/
  integration/
  e2e/
  fixtures/
public/
  manifest.json
  icons/
```

Dit is een richting, geen verplicht eindontwerp. Gebruik geen lege lagen of abstracties zonder concrete verantwoordelijkheid.

### Migratiestrategie binnen deze repository

1. Houd de huidige app bruikbaar als lokale referentie totdat de compatibiliteitsmatrix is afgedekt.
2. Scaffold de nieuwe v2-app en testomgeving zonder oude code te verwijderen.
3. Bouw eerst pure domeinmodellen, berekeningen en validatie.
4. Definieer repository-interfaces voor lokale en latere cloudopslag.
5. Migreer verticale gebruikersflows: instellingen/team, wedstrijdopzet, live wedstrijd, historie, stats en trends.
6. Vergelijk iedere flow met vaste fixtures en de compatibiliteitsmatrix.
7. Verwijder of archiveer de oude monoliet pas in een afzonderlijke PR na expliciete goedkeuring.

### Acceptatiecriteria

- De nieuwe app start via één gedocumenteerd ontwikkelcommando.
- TypeScript strict mode is ingeschakeld.
- Domeinberekeningen importeren geen DOM-, framework- of databasecode.
- UI gebruikt opslag via expliciete interfaces in plaats van directe verspreide browseraanroepen.
- De volledige regressiesuite blijft groen.
- CSV-output van dezelfde fixture is exact gelijk.
- JSON-back-up van dezelfde fixture is semantisch gelijk.
- De platformneutrale productiebuild bevat alle benodigde scripts, styles, fonts, iconen, manifest en service worker.
- De oude referentie-app blijft beschikbaar totdat de vervanging expliciet is geaccepteerd.

### Modeladvies

Laat `opencode-go/glm-5.2` het frontend-ADR en de grens tussen domain/application/infrastructure beoordelen. Gebruik daarna `opencode-go/kimi-k2.7-code` per verticale flow. Gebruik niet één autonome opdracht voor de volledige herbouw.

## 9. Fase 4 — Architectuurbesluit voor database en accounts

### Doel

Van uitsluitend lokale opslag doorgroeien naar duurzame, gedeelde opslag zonder de belangrijkste eigenschap van de app te verliezen: tijdens een wedstrijd moet hij ook zonder internet betrouwbaar blijven werken.

### Aanbevolen richting

Gebruik een **offline-first architectuur**:

1. de app schrijft een actie tijdens de wedstrijd eerst lokaal weg;
2. een lokale wachtrij houdt nog niet gesynchroniseerde wijzigingen bij;
3. wanneer verbinding beschikbaar is, worden wijzigingen idempotent naar de database gestuurd;
4. de interface toont duidelijk of alles lokaal opgeslagen, aan het synchroniseren of gesynchroniseerd is;
5. de database is de duurzame gedeelde kopie, maar niet vereist voor live scorebediening.

Onderzoek **Supabase** als voorkeurskandidaat omdat het Postgres, authenticatie en rijtoegangsregels combineert. Vergelijk het vóór definitieve keuze minimaal met Firebase en een eenvoudige eigen API. Leg de keuze vast in:

- `docs/architecture/adr-001-cloud-data-platform.md`
- `docs/architecture/adr-002-offline-sync-strategy.md`

### Besliscriteria

- betrouwbare offline werking;
- ondersteuning voor meerdere teams en gebruikers;
- rollen en teamlidmaatschap;
- export en verwijdering van persoonsgegevens;
- EU-regio, verwerkersafspraken en kosten;
- onderhoudslast;
- databaseback-ups en herstel;
- lokale ontwikkeling en reproduceerbare migraties;
- voorkomen van vendor lock-in;
- veilige browsertoegang zonder beheersleutels.

### Supabase-veiligheidsvoorwaarden bij keuze voor Supabase

- Gebruik alleen een voor de browser bedoelde publishable key.
- Plaats nooit een secret key of `service_role`-sleutel in de app.
- Schakel Row Level Security in op iedere tabel in een blootgesteld schema.
- Controleer naast authenticatie altijd teamlidmaatschap en rol; alleen `authenticated` is geen autorisatie.
- Gebruik voor updates zowel een bestaand-rijcriterium als controle op de nieuwe rij.
- Baseer autorisatie niet op door gebruikers aanpasbare metadata.
- Maak views alleen browsertoegankelijk wanneer ze de onderliggende toegangsregels respecteren.
- Bewaar schemawijzigingen als migrations in Git.
- Test dat gebruiker A geen data van team B kan lezen, wijzigen of verwijderen.

### Acceptatiecriteria

- De gekozen architectuur is vastgelegd met alternatieven en trade-offs.
- Er is nog geen productiedatabase gekoppeld.
- Het datamodel en dreigingsmodel zijn beoordeeld voordat credentials of dependencies worden toegevoegd.
- Er is een kosten- en exit-inschatting.
- Expliciet is besloten of classificatiegegevens noodzakelijk zijn en welke bewaartermijn geldt.

### Modeladvies

Gebruik `opencode-go/glm-5.2` voor het architectuurbesluit en laat het reviewen door `opencode-go/qwen3.7-plus` of een andere modelfamilie.

## 10. Fase 5 — Domeinmodel, authenticatie en autorisatie

### Doel

Een databasefundament bouwen dat meerdere teams en seizoenen ondersteunt, historische wedstrijden correct bewaart en teamdata strikt van elkaar scheidt.

### Voorgesteld domeinmodel

Werk het definitieve schema tijdens fase 4 uit. Start conceptueel met:

- `profiles` — minimaal openbaar profiel naast de auth-gebruiker;
- `teams` — club- of teaminstellingen;
- `team_memberships` — gebruiker, team en rol;
- `seasons` — seizoen of competitieperiode;
- `players` — speleridentiteit binnen een team;
- `games` — wedstrijdmetadata en status;
- `game_players` — snapshot van naam, rugnummer en classificatie voor die wedstrijd;
- `stints` — segment met begin/einde en punten voor/tegen;
- `stint_players` — de vijf spelers die in een stint op het veld stonden;
- `sync_operations` of een equivalente idempotencyregistratie — alleen indien nodig voor veilige synchronisatie;
- `audit_events` — beperkte, privacyveilige registratie van belangrijke mutaties.

Bewaar historische spelergegevens als wedstrijdsnapshot. Als een naam, rugnummer of classificatie later in het team verandert, mogen eerder gespeelde wedstrijden niet mee veranderen.

### Rollen voor de eerste versie

Houd het klein:

- **owner** — team beheren, leden uitnodigen en data exporteren/verwijderen;
- **coach** — team en wedstrijden bewerken en scoren;
- **viewer** — alleen lezen.

Voeg pas later extra rollen toe als echte gebruikssituaties dat vereisen.

### Databaseregels

- Gebruik clientgegenereerde UUID’s zodat offline aangemaakte records stabiele IDs hebben.
- Gebruik foreign keys, `NOT NULL`, unieke constraints en bereikcontroles waar passend.
- Gebruik UTC-timestamps plus afzonderlijke wedstrijdtijdzone indien nodig.
- Gebruik `created_at`, `updated_at`, een revisienummer en waar nodig `deleted_at`.
- Maak lineupcodes afgeleid uit de vijf wedstrijdspelers; gebruik ze niet als enige relationele identiteit.
- Laat totalen als score, plus/min en speeltijd reproduceerbaar uit bronrecords.
- Voorkom hard verwijderen van gegevens die nog door historische wedstrijden worden gebruikt.
- Maak een afgeronde wedstrijd standaard onveranderlijk of vereis een expliciete heropenactie met auditrecord.

### Authenticatie

Begin bij voorkeur met e-mail magic link of OTP om wachtwoordbeheer te beperken. Beslis expliciet:

- wie nieuwe teams mag maken;
- of uitnodigingen verlopen;
- hoe een eigenaar een lid verwijdert;
- wat er gebeurt wanneer de laatste eigenaar vertrekt;
- sessieduur en uitloggen op gedeelde apparaten;
- account- en teamverwijdering.

### Oplevering

- database migrations;
- schema-overzicht;
- geteste toegangsregels;
- fictieve seeddata;
- lokale ontwikkelinstructies;
- geen echte spelers- of klantdata in Git.

### Acceptatiecriteria

- Een gebruiker zonder teamlidmaatschap ziet geen teamdata.
- Een viewer kan niets wijzigen.
- Een coach kan alleen toegestane data binnen eigen teams wijzigen.
- Historische wedstrijden veranderen niet wanneer een teamspeler wordt aangepast.
- Databaseconstraints blokkeren ongeldige stints en referenties.
- Schema en policies zijn vanaf een lege database reproduceerbaar.

### Modeladvies

Gebruik `opencode-go/glm-5.2` voor schema en autorisatiemodel; `opencode-go/kimi-k2.7-code` voor migrations en tests. Gebruik voor Supabase-implementatie altijd de actuele officiële documentatie.

## 11. Fase 6 — Offline-first lokale database, synchronisatie en migratie

### Doel

Bestaande lokale gebruikers veilig naar databaseopslag brengen en live wedstrijdregistratie netwerk-onafhankelijk houden.

### Lokale opslag

Gebruik op termijn IndexedDB voor gestructureerde lokale data en een synchronisatiewachtrij. Behoud `localStorage` tijdelijk als compatibiliteitsbron tijdens migratie. Verwijder oude data pas nadat:

1. deze succesvol is gelezen;
2. lokaal naar het nieuwe schema is gemigreerd;
3. de gebruiker de nieuwe data kan controleren;
4. eventueel cloudsynchronisatie aantoonbaar is voltooid;
5. een herstelbare back-up beschikbaar is.

### Eerste synchronisatieversie

Beperk de complexiteit:

- Eén apparaat is de actieve scorer van een lopende wedstrijd.
- Andere apparaten mogen de lopende wedstrijd aanvankelijk alleen lezen.
- Een lease of expliciete overname voorkomt twee gelijktijdige scorers.
- Lokale mutaties krijgen een client-ID, idempotency key en basisrevisie.
- Herhaalde verzending mag geen dubbele segmenten of punten maken.
- Een serverconflict wordt niet stil overschreven.
- Afgeronde wedstrijden synchroniseren met expliciete status.

Bouw pas echte multi-writer realtime samenwerking wanneer de single-writer-versie betrouwbaar is.

### Synchronisatiestatus in de interface

Toon minimaal:

- **Lokaal opgeslagen** — veilig op dit apparaat, nog niet in de cloud;
- **Synchroniseren**;
- **Gesynchroniseerd**;
- **Actie nodig** — conflict of blijvende fout.

Een netwerkfout mag live bediening niet blokkeren.

### Migratie van bestaande gebruikers

- Detecteer bestaande lokale data.
- Toon vooraf welke teams, wedstrijden en spelers worden geïmporteerd.
- Maak vóór migratie automatisch een downloadbare JSON-back-up.
- Laat de gebruiker doelteam en account bevestigen.
- Gebruik deterministische of bewaarde IDs om duplicaten bij opnieuw proberen te voorkomen.
- Bied een alleen-lokale modus zolang cloudmigratie nog niet is gekozen.
- Test lege opslag, oude opslag, gedeeltelijke migratie, dubbele poging en rollback.

### Conflicten

Definieer per object een strategie:

- teaminstellingen: laatste wijziging met zichtbare waarschuwing of handmatige keuze;
- spelerslijst: revisiecontrole en handmatige keuze;
- actieve wedstrijd: single-writer;
- afgeronde wedstrijd: standaard onveranderlijk;
- verwijderingen: soft delete en tombstone tot alle apparaten zijn bijgewerkt.

### Acceptatiecriteria

- Een volledige wedstrijd kan in vliegtuigmodus worden gespeeld en afgerond.
- Na opnieuw verbinden verschijnt de wedstrijd exact één keer in de database.
- Opnieuw laden of app-crash verliest geen bevestigde lokale actie.
- Dubbele verzending verandert score of speeltijd niet.
- Een conflict wordt zichtbaar en leidt niet tot stil dataverlies.
- Bestaande lokale gebruikers kunnen migreren én een back-up behouden.

### Modeladvies

Gebruik `opencode-go/glm-5.2` voor sync-protocol en conflictmodel; `opencode-go/kimi-k2.7-code` voor incrementele implementatie en Playwright-tests.

## 12. Fase 7 — Offline betrouwbaarheid en toegankelijkheid

### PR 7.1 — PWA-updategedrag

- Test eerste installatie, offline herladen en een nieuwe app-shellversie.
- Controleer dat nieuwe assets in de platformneutrale productiebuild en offline app-shell worden opgenomen.
- Voorkom een mix van oude HTML en nieuwe scripts.
- Maak updatefouten zichtbaar in ontwikkeling; slik ze niet volledig stil in.

### PR 7.2 — Toegankelijkheid

- Voeg toegankelijke namen toe aan icon-only knoppen.
- Controleer focusvolgorde en zichtbare focus.
- Zorg dat modals focus vasthouden en na sluiten teruggeven.
- Controleer score- en wisselbediening met toetsenbord.
- Controleer contrast voor clubkleur-presets en aangepaste kleuren.
- Respecteer `prefers-reduced-motion` bij alle animaties.

### PR 7.3 — Fout- en herstelgedrag

- Toon herstelbare fouten zonder wedstrijddata kwijt te raken.
- Voeg waar passend undo toe voor lokale destructieve acties.
- Maak onderscheid tussen een lege wedstrijd, ongeldige data en een technische fout.

### Modeladvies

`opencode-go/kimi-k2.7-code` voor implementatie en `opencode-go/qwen3.7-plus` voor een toegankelijkheids- en tekstcontrole.

## 13. Fase 8 — Aanvullende productverbeteringen

Na fase 0 tot en met 7 volgt eerst een productkeuze. Bouw niet alle opties tegelijk.

Mogelijke richtingen:

1. **Analyse verdiepen** — filters, lineupvergelijking, exporteerbare rapporten.
2. **Meerdere teams/seizoenen** — vereist een expliciet nieuw datamodel en migratie.
3. **Veilige toesteloverdracht** — verbeterde lokale back-up zonder cloudaccount.
4. **Coachdashboard** — wedstrijdselectie, trends en rapportages buiten de live scoringsinterface.
5. **Veilige Airtable-export** — als aparte server-side export of importworkflow, nooit met geheime tokens in de browserapp.
6. **Wedstrijdherstel** — undo voor laatste acties, expliciet heropenen en privacyveilige auditgeschiedenis.
7. **Datakwaliteit** — automatische controles op ontbrekende minuten, ongeldige lineups en afwijkende totalen.
8. **Deelbare rapporten** — alleen na expliciete keuze welke gegevens buiten het team zichtbaar mogen zijn.
9. **Installatie en updates** — zichtbare PWA-updatebeschikbaarheid en een gecontroleerde verversactie.
10. **Beheer en levenscyclus** — seizoensarchivering, teamoverdracht, export en verwijdering.

Voor synchronisatie of directe Airtable-integratie is een afzonderlijk beslisdocument nodig met minimaal:

- gebruikersdoel;
- gegevensclassificatie en AVG-impact;
- authenticatie en autorisatie;
- eigenaarschap en verwijdering van data;
- offline conflicten;
- kosten en beheer;
- exporteerbaarheid en exit-strategie.

## 14. Werkwijze voor OpenCode

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
Lees README.md, package.json, playwright.config.js, tests/ui.spec.js en index.html.
Lees daarna docs/IMPLEMENTATION_PLAN.md, met nadruk op fase 0 en fase 1.

Voer alleen fase 0 uit. Wijzig geen productiecode.

Maak:
- docs/architecture/current-state.md
- docs/data-contracts.md

Documenteer alle localStorage-keys, objectvormen, statusovergangen,
berekeningen, CSV-kolommen en JSON-back-upstructuur. Voeg voor score,
speeltijd, plus/min en lineupcode minimaal één handmatig narekenbaar voorbeeld toe.
Benoem onzekerheden expliciet en presenteer voorstellen niet als bestaand gedrag.
```

### Tweede aanbevolen opdracht

```text
Voer alleen PR 1.1 uit docs/IMPLEMENTATION_PLAN.md uit.

Maak de Playwright-testbasis deterministisch met vaste, fictieve testdata.
Vervang conditioneel overslaan van kritieke flows door expliciete assertions.
Verander geen productiegedrag en voer nog niet de volledige wedstrijdflow in.
Voer de tests uit en rapporteer exact wat wel en niet is getest.
```

## 15. Modelstrategie

- Dagelijkse implementatie: `opencode-go/kimi-k2.7-code`.
- Goedkoop bulkwerk, testvarianten en mechanische documentatie: `opencode-go/deepseek-v4-flash`.
- Verkenning en documentanalyse: `opencode-go/qwen3.7-plus`.
- Moeilijke architectuur, migraties en onafhankelijke review: `opencode-go/glm-5.2`.
- Laat risicovolle code bij voorkeur controleren door een andere modelfamilie dan waarmee deze is geschreven.

## 16. Voortgang bijhouden

Gebruik GitHub Issues of een kleine tabel in dit bestand. Issues zijn beter zodra meerdere wijzigingen parallel of verspreid over langere tijd plaatsvinden.

| Onderdeel | Status | Issue/PR | Opmerking |
|---|---|---|---|
| Fase 0 — inventarisatie | Voltooid |  | current-state.md, data-contracts.md, product-compatibility-matrix.md |
| PR 1.1 — testbasis | Voltooid |  | fixtures.js, ui.spec.js deterministisch |
| PR 1.2 — wedstrijdflow | Voltooid |  | full-game.spec.js met scenario en totalen |
| PR 1.3 — hervatten en back-up | Voltooid |  | backup-resume.spec.js met resume, export, import, invalid |
| PR 1.4 — mobiel en taal | Voltooid |  | mobile-lang.spec.js met iPhone viewport, NL/EN flows |
| PR 1.5 — GitHub Actions CI | Voltooid | #6 | .github/workflows/ci.yml, Playwright tests in CI |
| PR 1.6 — fase-1-dekking | Voltooid | #7 | coverage-gaps.spec.js; P0-1 als test.fail |
| Fase 2 — data-integriteit | Niet gestart |  |  |
| Fase 3 — modulaire v2-architectuur | Niet gestart |  |  |
| Fase 4 — databasebesluit | Niet gestart |  |  |
| Fase 5 — database, auth en rollen | Niet gestart |  |  |
| Fase 6 — offline synchronisatie en migratie | Niet gestart |  |  |
| Fase 7 — offline en toegankelijkheid | Niet gestart |  |  |
| Fase 8 — productkeuze | Niet gestart |  |  |

## 17. Bewuste uitsluitingen

Dit plan geeft nog geen toestemming voor:

- database-implementatie voordat fase 4 expliciet is goedgekeurd;
- databasebeheersleutels, service-role-sleutels of Airtable-tokens in frontendcode;
- wijziging van historische statistiekdefinities;
- deployment, hostingwijziging of productie-cutover zonder afzonderlijke expliciete goedkeuring;
- een frontendstack die afwijkt van het goedgekeurde architectuurbesluit;
- automatische publicatie buiten de bestaande pipeline;
- verwerking van echte spelersdata in tests, fixtures, prompts of screenshots.

Deze onderwerpen vereisen eerst een afzonderlijk besluit.
