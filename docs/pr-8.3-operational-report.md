# Operationeel rapport PR 8.3d-i (verbruik, back-up, DPA)

Datum: 11 oktober 2026. Status: **deel 1 van 8.3d, alleen documentatie en bronverificatie.** Er is geen
code, geen Rules-wijziging, geen deploy, geen Blaze en geen billingkoppeling aangeraakt. Er zijn geen
echte spelersdata, tokens of e-mailadressen gebruikt of opgenomen.

Wat dit rapport **wel** levert: herverificatie van quota, regio, DPA en back-upopties met datumstempel,
een afgeleide (niet gemeten) verbruiksprojectie, een Spark-runbook, een beslisvoorstel voor het
back-upmodel, een dependency-controle en een go/no-go-advies voor PR 8.4.

Wat het **niet** levert, en als open gate staat in §6: metingen op een echt stagingproject, een echte
restore, de uitputtingstest en de herverificatie van Blaze-prijzen en Cloud Billing-pagina's.

## 1. Bronnen en datumstempels

Opgehaald op 11 oktober 2026 met `curl` vanuit de omgeving. Alleen officiële Google-pagina's.

| Bron | Gelezen | Datum op de pagina |
|---|---|---|
| <https://firebase.google.com/docs/firestore/pricing> | gratis quotum, reads, listeners, Rules-reads | Last updated 2026-10-08 UTC |
| <https://firebase.google.com/docs/firestore/quotas> | limieten en gratis quotum | Last updated 2026-10-08 UTC |
| <https://firebase.google.com/docs/firestore/disaster-recovery> | herstelopties | Last updated 2026-10-08 UTC |
| <https://firebase.google.com/docs/firestore/backups> | geplande back-ups | geen datum gelezen |
| <https://firebase.google.com/docs/firestore/locations> | regio's, `eur3` | Last updated 2026-10-08 UTC |
| <https://firebase.google.com/terms/data-processing-terms/> | DPA | Terms last modified August 21, 2024 |
| <https://firebase.google.com/terms/subprocessors> | subprocessors | Last modified September 23, 2021 |
| <https://firebase.google.com/support/privacy> | gegevensverwerking per dienst | Last modified September 15, 2026 |

**Niet herverifieerd:** Blaze-prijzen per locatie (de pricingpagina verwijst naar Google Cloud-prijzen) en
de Cloud Billing-pagina's over budgetten en spend caps (`docs.cloud.google.com` werd door de
netwerkpolicy van de omgeving geweigerd). Alles wat daarvan afhangt staat hieronder als "niet
herverifieerd".

## 2. Verbruiksprojectie (afgeleid, geen meting)

### 2.1 Wat een bewerking kost

Afgeleid uit de code (`FirestoreGameCloudGateway`, `firestore.rules`) en de factureringsregels van §1.
Het zijn **schattingen met een bandbreedte**, geen metingen.

| Bewerking | Writes | Reads | Toelichting |
|---|---|---|---|
| Actie uploaden (geslaagd) | 1 | 2–3 | `setDoc` op `actions/{id}`; de Rules lezen het organisatielid, bij coach/scorer ook het teamlid, en het `games`-document (`canWriteGameData`, `gameData`). Een readback gebeurt alleen bij een mislukte create. |
| Synccyclus (patch van de wedstrijd) | 1 | 3–5 | `updateDoc` plus readback (1 read) plus Rules-reads voor update en readback. |
| Wedstrijd aanmaken, claimen, afronden | 4 | ongeveer 10 | create, claim, en de `WriteBatch` met `completedGames`-create en `games`-update; Rules-reads gebundeld geschat. |
| Kijker, per nieuwe actie | 0 | 2–3 | listener: 1 read per toegevoegd document, plus Rules-evaluatie bij elke update. |
| Kijker, per update van het wedstrijddocument | 0 | 2–3 | idem. |
| Herverbinding van een kijker na meer dan 30 minuten offline | 0 | A (alle acties opnieuw) | officiële regel voor listeners met persistente cache. |

**Correctie op een eerdere aanname.** `docs/pr-7.3-plan.md` telde vervolgupdates op een open listener
als gratis ("geen nieuwe document read per gewijzigd veld"). De huidige officiële pagina zegt dat een
listener **een read per toegevoegd of gewijzigd document in de resultaatset** kost en dat Rules-reads
opnieuw tellen bij elke update. De 7.3-cijfers zijn dus een ondergrens voor kijkers. De oude documenten
zijn niet aangepast; deze correctie geldt vanaf hier.

### 2.2 Scenario's

Aannames (niet gemeten): **A** = acties per wedstrijd, **C** = synccycli per wedstrijd, **V** = aantal
kijkers met de wedstrijd open. Het meest onzeker zijn A en C. Rekenmodel, met middelpunten
r_a = 2,5, r_c = 4, r_kijker = 3 en 10 vaste reads:

- writes = A + C + 4
- schrijver-reads = 2,5 × A + 4 × C + 10
- kijker-reads (per kijker) = 3 × A + 3 × (C + 2)

| Scenario | A | C | V | Writes/wedstrijd | Reads/wedstrijd |
|---|---|---|---|---|---|
| Laag | 150 | 20 | 0 | 150 + 20 + 4 = **174** | 2,5·150 + 4·20 + 10 = **465** |
| Verwacht | 400 | 60 | 1 | 400 + 60 + 4 = **464** | 1250 + 1386 = **2636** |
| Piek | 800 | 120 | 3 | 800 + 120 + 4 = **924** | 2490 + 3·2766 = **10788** |

Rekenwerk voor "Verwacht": schrijver 2,5·400 + 4·60 + 10 = 1250; kijker 3·400 + 3·(60+2) = 1386.
Rekenwerk voor "Piek": schrijver 2,5·800 + 4·120 + 10 = 2490; per kijker 3·800 + 3·122 = 2766.

### 2.3 Hoeveel wedstrijden per dag past er in Spark (hele project)

Quota: 50.000 reads en 20.000 writes per dag (§1 van het runbook).

| Scenario | Max. door writes (20.000 / writes) | Max. door reads (50.000 / reads) | Bindend |
|---|---|---|---|
| Laag | 20.000 / 174 = 114 | 50.000 / 465 = 107 | reads, 107 |
| Verwacht | 20.000 / 464 = 43 | 50.000 / 2636 = 18 | reads, 18 |
| Piek | 20.000 / 924 = 21 | 50.000 / 10788 = 4 | reads, 4 |

**Lezing.** Eén team dat één wedstrijd per dag speelt, gebruikt in het verwachte scenario circa 5% van
de dagelijkse reads (2636 van 50.000) en circa 2% van de writes. Het gratis quotum is dan ruim voldoende.
De grens ligt bij ongeveer 18 wedstrijden per dag over het hele project met één kijker per wedstrijd, en
bij 4 in het pessimistische geval met drie kijkers. **De bindende grens is dus reads, en de grootste
kostendrijver zijn kijkers, niet de scorer.**

Achtergrondverbruik (login, settings, roster, organisatielisteners) komt daarbovenop. De enige meting
die daarvoor bestaat is `docs/pr-5.5-onderzoeksrapport.md` §B.2: een bovengrens van +235 reads en +16
writes over een groep van vijf synthetische flows op de stagingomgeving, ruim binnen het quotum.

### 2.4 Onzekerheid en wat het zou veranderen

- A en C zijn aannames. Een verdubbeling van A halveert ongeveer het aantal wedstrijden per dag.
- De Rules-reads zijn het minst zeker: ze hangen af van de rol (owner/admin: 2 reads, coach/scorer: 3) en
  van of een niet-bestaand document ook als read telt. De projectie rekent met het midden.
- Het aantal kijkers (V) verandert de uitkomst het meest. Beperk live meekijken als de reads stijgen.
- **Geen schijnprecisie:** gebruik deze tabel voor de orde van grootte en voor de keuze welke meting als
  eerste in staging moet (§6, G1), niet als voorspelling.

## 3. Back-upmodel: beslisvoorstel

Back-up en restore zijn aantoonbaar verschillende controles. Een back-up bestaat of niet; een restore
bewijst pas dat de back-up bruikbaar is.

| Optie | Plan | Retentie | Herstel | Opmerking |
|---|---|---|---|---|
| **JSON-organisatie-export** (8.3b) | Spark | door de eigenaar zelf bewaard | importeren in een lege organisatie | beschikbaar, RPO = tijd sinds de laatste export |
| Geplande Firestore-back-up | **vereist Blaze** | tot 14 weken, dagelijks of wekelijks | naar een **nieuwe** database in hetzelfde project | tijdstip niet instelbaar |
| PITR | **vereist billing** | tot 7 dagen, granulariteit 1 minuut | lezen en terugschrijven; RPO 1 minuut, RTO 0 volgens Google | PITR-data heeft geen gratis quotum |
| Clone | **vereist billing** | tot 7 dagen met PITR, anders tot 1 uur | nieuwe database | geen gratis quotum |
| PITR-export naar Cloud Storage | billing | onbeperkt in Cloud Storage | herstel duurder dan uit back-up | voor archivering langer dan 14 weken |

Bronnen: §1 (disaster-recovery, backups, pricing). De backups-pagina stelt letterlijk: "This feature
requires the Blaze pricing plan." Er bestaat volgens de navigatie ook een "in-place restore"; die is hier
**niet beoordeeld**, en onze regel blijft dat een restore nooit over de bron gaat.

**Voorstel (besluit eigenaar):**
1. **Nu, op Spark:** de JSON-organisatie-export als enige back-up, met een vast ritme en een bewaarplek
   die de eigenaar beheert. RPO is dan het exportinterval (bijvoorbeeld wekelijks plus vóór en na een
   toernooi). RTO is ongemeten: de import in een lege organisatie moet in staging worden uitgevoerd (G2).
2. **Geen Blaze alleen voor back-ups.** Scheduled backups en PITR vereisen Blaze; dat is een
   kostbeslissing en een eigen goedkeuring (plan §E.6), met budgetalerts, ontvangers en een testmelding.
3. **Als de eigenaar later Blaze kiest:** begin met geplande back-ups voor een korte retentie en test één
   echte restore naar een nieuwe stagingdatabase vóór een gebruiker erop vertrouwt.

Wat dit **niet** bewijst: dat de JSON-export compleet terugkomt. Het bewijs is de restoreproef (G2).

## 4. DPA, regio en voorwaarden

### 4.1 Wat de bronnen zeggen

- **Rolverdeling** (privacypagina): de klant is doorgaans verwerkingsverantwoordelijke ("data
  controller"), Google doorgaans verwerker ("data processor"). De klant blijft zelf verantwoordelijk voor
  rechten van betrokkenen.
- **Firebase Data Processing and Security Terms** (laatst gewijzigd **21 augustus 2024**): zijn onderdeel
  van de overeenkomst voor Firebase-diensten die ernaar verwijzen. De ingangsdatum is de datum waarop de
  klant ze accepteerde of waarop partijen anderszins overeenkwamen. Gegevens kunnen worden verwerkt in
  elk land waar Google of subverwerkers faciliteiten hebben, **onder voorbehoud van de
  datalocatieverbintenissen** (sectie 10.1). Voor Europese overdrachten gelden de SCC's (sectie 10.2).
- **Subverwerkers:** specifiek toegestaan wat op de lijst staat; nieuwe subverwerkers worden minimaal
  30 dagen vooraf aangekondigd, de klant kan binnen 90 dagen bezwaar maken door de overeenkomst te
  beëindigen (sectie 11.4). De lijst staat op <https://firebase.google.com/terms/subprocessors>
  (laatst gewijzigd **23 september 2021**).
- **Bepaalde Firebase-diensten onder de Google Cloud-voorwaarden** vallen onder de Cloud Data Processing
  Addendum (privacypagina). Welke diensten voor **dit** project onder welke voorwaarden vallen, is
  **niet uit de repository te verifiëren**: zie gate G3.
- **Firestore-regio:** `eur3` (Europa) bestaat als multiregio met lees-schrijfregio's `europe-west1`
  (België) en `europe-west4` (Nederland) en `europe-north1` (Finland) als witness. Multiregio's bieden
  99,999% beschikbaarheid (disaster-recoverypagina).
- **Firebase Authentication** draait volgens de privacypagina **uitsluitend vanuit datacenters in de
  Verenigde Staten** ("processes data exclusively in the United States").
  - Verwerkte gegevens: wachtwoorden, e-mailadressen, user agents en IP-adressen.
  - IP-adressen worden enkele weken bewaard; overige authenticatiegegevens tot de klant het account
    verwijdert, daarna verdwijnen ze uit live- en back-upsystemen binnen 180 dagen.

### 4.2 Bevindingen

| Nr | Bevinding | Ernst | Wat het betekent |
|---|---|---|---|
| D1 | Authentication verwerkt e-mailadressen en IP-adressen uitsluitend in de VS, ook als Firestore in `eur3` staat. | **P1, privacy** | De data van gebruikers staat niet volledig in de EU. Het is een eigenaarsbesluit of dat past bij de beoogde gebruikers. Het hoort expliciet in de privacyverklaring en in de gebruikersinformatie. De DPA regelt Europese overdrachten via SCC's, maar dat vervangt de transparantie niet. |
| D2 | Het is niet te verifiëren of de Data Processing and Security Terms voor dit specifieke Firebase-project zijn geaccepteerd en onder welke overeenkomst. | **P1, formeel** | Moet de eigenaar controleren in de Firebase/Google Cloud-console (G3). Dit is geen codekwestie. |
| D3 | De subprocessorlijst is al sinds 2021 niet gewijzigd. | informatief | Kan kloppen, maar de datum is niet bruikbaar als bewijs van recente controle. Laat de eigenaar zich abonneren op wijzigingsberichten volgens de DPA (sectie 11.4). |
| D4 | De DPA is van 2024, de privacypagina van september 2026. | informatief | De voorwaarden zelf lijken niet recent gewijzigd; de uitleg eromheen wel. Herverifieer bij elke grote stap (8.4, cutover). |

### 4.3 Wat de app zelf al doet
- Toegang tot cloudgegevens is per organisatie en team begrensd door Security Rules, die in de
  Emulator Suite positief en negatief worden getest (8.3c).
- Accountverwijdering wist alle eigen lidmaatschappen en uitnodigingen en, na `deleted`, de lokale
  gegevens van de eigen organisaties (8.3c, R7). Authentication-gegevens verdwijnen daarna volgens de
  bewaartermijn van §4.1 (180 dagen uit back-upsystemen).

## 5. Dependencies en licenties

Gecontroleerd op 11 oktober 2026 op `main` na #118.

**Licenties (productieboom van `v2`, inclusief de workspace `firebase-base`):** 91 pakketten, waarvan 88 van derden:
Apache-2.0 52, MIT 20, BSD-3-Clause 10, ISC 5, 0BSD 1 (`tslib`). De drie zonder licentieveld zijn de eigen
workspaces. Er is geen copyleft- of onbekende licentie gevonden.

**`npm audit --omit=dev`:** 4 meldingen, alle "high", één oorzaak:

| Pakket | Pad | Melding | Beoordeling |
|---|---|---|---|
| `@grpc/grpc-js@1.9.16` (bereik `<1.13.6`) | `firebase@12.17.1` → `@firebase/firestore@4.17.0` | GHSA-m9gg-hp2v-232j (`getAuthContext` kan niet-geautoriseerde certificaten als geautoriseerd tonen), plus een lage melding over foutberichten | zie hieronder |

- De `@grpc/grpc-js` van `firebase-admin` (via `google-gax`) is `1.14.4` en valt buiten het kwetsbare bereik.
- De kwetsbare `1.9.16` zit in de **Node**-build van de Firestore-SDK. De browserbundel van `v2` bevat
  geen `grpc-js` (geen treffer op `getAuthContext` in `v2/dist`); de browser gebruikt de web-SDK zonder
  deze server-kant-code.
- Beoordeling: **in de browser niet bereikbaar, praktisch laag risico**; relevant voor Node-scripts en
  tests in de `firebase`-workspace. De door `npm audit` voorgestelde "fix" (`firebase@9.14.0`, een
  neerwaartse major) is **niet toepasbaar**.
- Aanbeveling (eigen kleine PR, buiten dit rapport): een `overrides`-regel voor `@grpc/grpc-js` naar
  `>=1.13.6` in de `firebase`-workspace, gevolgd door de volledige Rules-, unit- en e2e-suites. Dit is een
  dependencywijziging en hoort niet in deze docs-only PR.

Dev-afhankelijkheden zijn in deze sessie niet beoordeeld.

**Exitstrategie.** Data zit niet opgesloten: de JSON-export (8.3b) en het Nederlandse CSV-contract blijven
leesbaar zonder Firebase. Opslag zit achter repository-ports; Supabase blijft de terugvaloptie met
geteste RLS (AGENTS.md). Een exit is nog niet geoefend; dat is geen blokkade voor 8.4.

## 6. Open gates

| Gate | Wat | Waarom open | Wie |
|---|---|---|---|
| **G1** | Meting op een stagingproject met fictieve data (scenario's runbook §6), inclusief de **uitputtingstest** | geen stagingtoegang in deze omgeving; de console toont alleen een rollend 24-uurs-totaal | eigenaar levert staging, daarna meting |
| **G2** | Echte restore: JSON-export van een fictieve organisatie importeren in een lege organisatie en vergelijken | nog nooit uitgevoerd; zonder dit bewijst de back-up niets | eigenaar of sessie met stagingtoegang |
| **G3** | Controle in de console of de Data Processing and Security Terms zijn geaccepteerd, en onder welke overeenkomst Firestore en Authentication vallen | niet vanuit de repo te zien | eigenaar |
| **G4** | Besluit over D1 (Authentication in de VS) en de tekst in de privacyverklaring | eigenaarsbesluit | eigenaar |
| **G5** | Herverificatie van Blaze-prijzen en Cloud Billing (budgets, spend caps) | `docs.cloud.google.com` was geblokkeerd | sessie na het toevoegen van dat domein, alleen nodig als Blaze serieus wordt |
| **G6** | Invulling van het Spark-runbook (verantwoordelijke, tempo, ontvanger) | eigenaarsbesluit, zie runbook §7 | eigenaar |
| **G7** | iOS-dekking van het handmatige protocol ontbreekt (5.5, eigenaarsbesluit) | eerder bewust open gelaten | eigenaar |

Budgetalerts zijn **niet van toepassing op Spark** (geen billing); dat staat hier eerlijk vastgelegd in
plaats van een alert zonder eigenaar of testbewijs.

## 7. Advies voor PR 8.4

**Voorwaardelijk NO-GO** tot G1, G2, G3 en G4 zijn gesloten.

Redenen, zoals het plan ze eist:
- Er is **geen open P0**.
- Er zijn **twee open P1-bevindingen** (D1 privacy, D2 formeel) die alleen de eigenaar kan afhandelen.
- Er is **een onbeheerst herstelrisico**: een back-up zonder bewezen restore. Het plan laat PR 8.4 pas
  starten als dat niet meer geldt.
- Het kostenrisico is **beheerst op papier** (§2: ruime marge bij gebruik door enkele teams), maar nog niet
  door een meting bevestigd.

Wat **wel** klaar is: de technische beveiliging van 8.3c (Rules, verwijderen, overdracht, sessiewissels),
de juiste licentie- en dependencybeoordeling met één gemelde, niet-bereikbare afhankelijkheid, en een
bruikbaar Spark-runbook zodra de eigenaar het invult.

**Geen productiecutoveradvies.** Dit rapport gaat niet over het uitrollen naar gebruikers.
