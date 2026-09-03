# Voorbereidingsplan PR 8.3 — beveiliging, privacy, kosten en beheer

Status: 8.3a staat open als PR #85 (`codex/pr-8.3a`); 8.3b–8.3d blijven
voorbereidingsplan. PR 8.2 is volledig gemerged
(8.2a #81, 8.2b #83 en 8.2c #84). Dit plan splitst roadmap-PR 8.3 in vier
afzonderlijk reviewbare sub-PR's. Geen van deze stappen geeft op
zichzelf toestemming voor een productiecutover, betaalde Firebase-functie,
billingkoppeling, deployment of verwerking van echte spelersdata.

## A. Doel en actuele basis

PR 8.3 maakt de bestaande Firebase-/offline-architectuur beheerbaar vóór de
parallelle acceptatie van PR 8.4. De app heeft al een sterke technische basis:

- organisatie-, team-, membership- en rolgebonden Firestore Rules;
- positieve en negatieve Emulator-tests, inclusief cross-org-isolatie,
  self-promotion, uitnodigingen, queries, games/actions, tombstones en
  migratieruns;
- Firebase achter application-ports; de UI importeert Firebase niet direct;
- lokale JSON-back-up/import, fail-closed validatie en herstelback-ups;
- lokale-first wedstrijdbediening met expliciete sync- en herstelstatussen;
- een gemeten stagingpilot op fictieve data en een Spark-baseline;
- geen analytics, tracking, externe logger of Firebase service-accountkey in
  browsercode of repository.

De roadmapgaten zijn nog concreet:

1. Er is geen actuele, complete dreigings-/Rules-matrix die ieder werkelijk
   Firestore-pad, iedere query en iedere rol tegen de implementatie afvinkt.
2. App Check is niet geïnitialiseerd of gemonitord; er is nog geen besluit over
   enforcement en de gevolgen voor offline gebruik, CI en oudere apparaten.
3. Foutdiagnose bestaat verspreid in UI-statussen en foutcodes. Er is geen
   vast privacycontract dat voorkomt dat toekomstige logging spelersnamen,
   e-mailadressen, IDs, payloads of tokens vastlegt.
4. De huidige back-up is team-/apparaatgericht. Er is geen volledige,
   versieerbare organisatie-export met alle teams en cloudobjecten.
5. Account-/organisatieverwijdering, tombstonebewaring en auditbewaring zijn
   niet uitgevoerd of in bewaartermijnen vastgelegd.
6. De pilot mat verbruik, maar er is nog geen herhaalbaar kostenrapport,
   waarschuwingsrunbook of actueel Spark/Blaze-/back-upbesluit.

### Huidige gegevensfamilies die 8.3 moet meenemen

De inventarisatie en tests gebruiken minimaal deze werkelijke paden; een nieuw
pad mag niet buiten de matrix of export vallen:

```text
organizations/{orgId}
organizations/{orgId}/organizationMembers/{uid}
organizations/{orgId}/invitations/{invitationId}
organizations/{orgId}/teams/{teamId}
organizations/{orgId}/teams/{teamId}/teamMembers/{uid}
organizations/{orgId}/teams/{teamId}/settings/current
organizations/{orgId}/teams/{teamId}/roster/current
organizations/{orgId}/teams/{teamId}/games/{gameId}
organizations/{orgId}/teams/{teamId}/games/{gameId}/actions/{actionId}
organizations/{orgId}/teams/{teamId}/completedGames/{completedGameId}
organizations/{orgId}/teams/{teamId}/migrationRuns/{runId}
```

Ook verwijderde/tombstoned wedstrijden, ingetrokken/geclaimde uitnodigingen en
afgebroken migratieruns horen bij de privacy-, export- en bewaarinventaris; ze
mogen niet verdwijnen uit de beoordeling omdat de normale UI ze niet toont.

## B. Vastgelegde bouwkeuzes

### 1. Vier sub-PR's, geen beveiligingsmegapr

- **8.3a**: Rules-/dreigingsmatrix, misbruikscenario's, App Check in
  monitor-first-vorm en privacyveilige diagnostiek.
- **8.3b**: volledige organisatie-export plus een herstelbare, geverifieerde
  export-/restoreproef met fictieve data.
- **8.3c**: bewaartermijnen en account-/organisatieverwijdering, pas na de
  expliciete keuzes in §E.
- **8.3d**: actuele verbruiksmeting, kosten-/quotapoorten, back-upstrategie,
  regio/DPA/afhankelijkheden en het operationele overdrachtsrapport.

Elke sub-PR heeft een eigen diff, gerichte tests en onafhankelijke review. Een
groene CI-run zonder inhoudelijke securityreview is niet voldoende.

### 2. App Check krijgt eerst een expliciet besluit; bij akkoord: meten vóór handhaven

Aanbevolen optie voor de webapp is de officiële reCAPTCHA Enterprise-provider.
Dat introduceert een nieuw extern attestationpad en is dus ook een privacy-/
platformkeuze; 8.3a legt eerst het besluit, de datastroom en de gevolgen vast.
Zonder expliciete bevestiging wordt geen App Check-library of provider aan de
runtime toegevoegd. Bij akkoord is de publieke sitekey projectidentificatie,
geen autorisatiegeheim; een App Check-debugtoken is wél gevoelig en mag
uitsluitend in een lokale/CI-secretstore staan.

Vaste volgorde:

1. besluitrecord en gegevensstroom-/DPA-beoordeling;
2. initialisatie achter expliciete omgevingsconfiguratie;
3. app-eigen productiecode/config activeert nooit debugmodus en bevat nooit
   een debugtoken; de Firebase-vendorbundle bevat zelf slapende debugsupport;
4. lokale Emulator-tests blijven zonder extern reCAPTCHA-verkeer werken;
5. een eventuele staging-debugtoken staat alleen als encrypted CI-secret;
6. App Check-metrics eerst observeren op staging;
7. enforcement pas na echte-browser-/offline-/oud-toestelvalidatie en een
   afzonderlijke expliciete eigenaarsbevestiging;
8. productie-enforcement hoort bij de PR 8.5-cutoverpoort, niet bij het mergen
   van 8.3a.

Officiële Firebase-richtlijnen eisen monitoring vóór enforcement en waarschuwen
dat een debugtoken toegang vanaf niet-geattesteerde apparaten mogelijk maakt:

- <https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider>
- <https://firebase.google.com/docs/app-check/web/debug-provider>

App Check is defense-in-depth en vervangt nooit Authentication of Firestore
Rules. Een geldige App Check-token verleent geen organisatie-, team- of rolrecht.

### 3. Geen remote logger of analytics in PR 8.3

Privacyveilige diagnostiek wordt lokaal en dataminimaal:

- een allowlist van stabiele fout-/statuscodes, componentnaam, appversie en
  tijdstip;
- nooit spelersnamen, rugnummers, classificaties, e-mailadressen, uid/orgId/
  teamId/gameId, Firebase-config, tokens, back-uppayloads of ruwe exception-
  objecten;
- geen automatische netwerkverzending;
- standaard een begrensde in-memory buffer, geen nieuwe blijvende
  `localStorage`-key;
- downloaden/kopiëren alleen na een expliciete gebruikersactie, met een
  zichtbare NL/EN-uitleg van de inhoud;
- onbekende velden falen closed in de sanitizer in plaats van stil te worden
  meegestuurd.

Wanneer 8.3 geen extra PWA-diagnose aan de gedeelde `PwaUpdateAdapter` toevoegt,
wordt ook geen `forTesting()`-/reset-API aan die singleton toegevoegd. De
post-PR-8.1-follow-up wordt alleen uitgevoerd als echte nieuwe diagnose-state
dat noodzakelijk maakt. De classic-SW-importregex wordt alleen aangepast bij
een daadwerkelijke Workbox-upgrade.

### 4. Organisatie-export is niet hetzelfde als operationele back-up

8.3b maakt een eigenaarsexport voor dataportabiliteit en controle. Het contract:

- alleen `organizationOwner`; geen admin/coach/scorer/viewer;
- expliciete doelorganisatie met naam én ID vóór de download;
- versieerbare envelope met `type`, `version`, `exportedAt`, broncontext,
  volledigheidsstatus en aantallen per gegevensfamilie;
- alle teams en alle in §A genoemde cloudfamilies, inclusief membership-
  e-mails, acties, tombstones en migratieruns;
- deterministische sortering en converter-/schemavalidatie;
- fail closed: bij één geweigerde, corrupte of onvolledige read wordt geen
  bestand als 'volledige export' aangeboden;
- geen wijzigingen, deletes of cloudwrites tijdens export;
- bestand pas als downloadbaar markeren nadat aantallen en canonieke hash zijn
  berekend en een lokale roundtripparse slaagt.

Omdat een organisatie-export persoonsgegevens en teamdata bevat, gebruikt de
test uitsluitend fictieve data en wordt de inhoud nooit in console-/CI-logs
geprint. De bestaande Nederlandse CSV-contracten blijven volledig buiten deze
JSON-export en veranderen niet.

De herstelproef bewijst twee verschillende vangnetten afzonderlijk:

1. **portabiliteitsherstel**: de export wordt in een lege, geïsoleerde
   Emulator-doelcontext gevalideerd en als gelijkwaardige inventaris
   teruggelezen; nooit over de bronorganisatie heen;
2. **operationeel databaseherstel**: alleen als Blaze/back-ups in §E worden
   goedgekeurd, een afzonderlijk staging-runbook voor scheduled backup/PITR en
   restore naar een nieuwe database. Zonder die goedkeuring mag een JSON-export
   niet misleidend als Firestore-PITR worden beschreven.

### 5. Verwijderen gebeurt nooit als onbegrensde browsercascade

Firestore verwijdert subcollecties niet automatisch wanneer een bovenliggend
document wordt verwijderd. Een volledige organisatie vanuit de browser
recursief wissen is bovendien niet atomair, moeilijk hervatbaar en geeft de
client te brede deletebevoegdheden. Officiële achtergrond:

- <https://firebase.google.com/docs/firestore/data-model#subcollections>
- <https://firebase.google.com/docs/firestore/solutions/delete-collections>

Daarom bouwt 8.3c alleen één van de in §E expliciet gekozen modellen:

- een begrensde, server-side verwijdercoordinator met eigen autorisatie,
  idempotent checkpoint, readback en auditresultaat; of
- een tijdelijk, eigenaar-geïnitieerd verwijderverzoek plus een getest
  handmatig beheer-/CLI-runbook zonder self-service-claim.

De servervariant vereist afzonderlijke Blaze-/deploymentgoedkeuring en mag geen
vrij pad uit clientinput accepteren. De functie ontvangt alleen een vaste
organisatie-ID uit geauthenticeerde context, hercontroleert ownerstatus,
inventariseert exacte toegestane families en verwijdert in hervatbare batches.
Geen enkele implementatie gebruikt een service-accountkey in Git/browser/logs.

Auth-accountverwijdering blijft een eigen stap: Firebase vereist recente
authenticatie voor `deleteUser()`. Eerst moeten memberships/verwijderverzoeken
consistent zijn afgehandeld; het verwijderen van alleen de Auth-user mag geen
Firestore-documenten met uid/e-mail achterlaten en mag evenmin een organisatie
zonder beheerbare owner creëren.

Bron: <https://firebase.google.com/docs/auth/web/manage-users#delete_a_user>.

### 6. Spark blijft de standaard totdat de eigenaar anders beslist

De actuele officiële gratis Firestore-baseline is één gratis database per
project, 1 GiB opslag, 50.000 reads/dag, 20.000 writes/dag, 20.000 deletes/dag
en 10 GiB uitgaand verkeer/maand. TTL, PITR, scheduled backupdata, restore en
clone vereisen billing:

- <https://firebase.google.com/docs/firestore/pricing>
- <https://firebase.google.com/docs/firestore/disaster-recovery>

8.3d verifieert deze cijfers opnieuw op de uitvoeringsdatum. Er komt geen
automatische Spark→Blaze-upgrade, billingkoppeling of auto-recharge.

Als Blaze wordt goedgekeurd, zijn Cloud Billing-budgetalerts waarschuwings-
mechanismen en geen algemene harde Firestore-uitgavenlimiet. De nieuwe
spend-cap-preview geldt momenteel slechts voor een beperkte lijst diensten en
niet voor Firestore. Het beheerplan mag dus nooit 'budget = harde cap' claimen:

- <https://cloud.google.com/billing/docs/how-to/budgets>
- <https://cloud.google.com/billing/docs/how-to/budgets-spend-caps>

## C. Sub-PR's

### 8.3a — securitybaseline, App Check-monitoring en lokale diagnostiek

Werk:

1. Maak `docs/security-threat-model.md` met assets, trust boundaries,
   aanvallers, misbruikscenario's en mitigaties. Minimaal: cross-org/team,
   self-grant/-promotion, invitation replay/enumeratie, gestolen clientconfig,
   ongeverifieerde e-mail, revoked membership met offline cache, stale writer,
   action replay/sequence, bulkexport, verwijdering en quota-uitputting.
2. Maak één machineleesbare pad-/rolmatrix die ieder pad uit §A koppelt aan
   toegestane reads/queries/create/update/delete en de bijbehorende Rules-test.
   Voeg een test toe die faalt wanneer converter-/gatewaypaden of Rulesmatches
   niet in de matrix voorkomen.
3. Vul ontbrekende positieve én negatieve Emulator-tests aan. Test per rol,
   niet alleen 'lid versus geen lid'; test malformed payloads, affectedKeys,
   brede queries, cross-org IDs, ingetrokken membership en deletes expliciet.
4. Leg het App Check-besluit uit §B.2 vast. Alleen bij expliciet akkoord: voeg
   initialisatie achter env-config toe, zonder enforcement of
   productieconsolewijziging. Bewijs dat lokale modus en Emulator-e2e geen
   reCAPTCHA-/App Check-netwerkcall doen. Bij afwijzing: geen runtimecode, maar
   documenteer de geaccepteerde restdreiging en alternatieve misbruikremmen.
5. Voeg de lokale diagnosepoort/sanitizer uit §B.3 toe. Migreer alleen ruwe
   foutplaatsen die aantoonbaar gevoelige objecten zouden kunnen lekken; geen
   brede refactor van alle UI-statussen.
6. Leg een staging monitorprotocol vast: geldige/ongeldige/niet-geverifieerde
   App Check-requests, offline start/reconnect, oude viewport, incognito,
   update van een lang openstaande tab en rollback van configuratie.

Acceptatie:

- ieder Firestore-pad/query heeft een eigenaar in de matrix en minimaal één
  positieve plus relevante negatieve test;
- volledige Firebase typecheck/unit-/Rules-suite is groen;
- App Check monitor-only verandert geen bestaande offline-, Auth- of
  Firestorefunctionaliteit en verzendt lokaal/emulator niets externs;
- app-eigen productiebron en deployconfig bevatten of activeren nooit een
  debugtoken; de vendor-SDK-support wordt niet als eigen debugconfig beschouwd;
- diagnostiek accepteert alleen allowlistvelden en bevat in regressieprobes
  geen namen, e-mails, IDs, payloads of tokens;
- NL/EN-uitleg en keyboard/a11y voor de expliciete diagnose-export zijn groen;
- geen deployment, enforcement of billingwijziging in deze PR.

Implementatieresultaat 31 augustus 2026:

- de 13 Rules-scopes zijn gekoppeld aan hun clientgateways en testbewijs in
  `firebase/src/security/firestoreAccessMatrix.ts`;
- organisatie- en teamcreate hebben een exacte shape; identiteit/auditvelden
  zijn bij update onveranderlijk en client-hard-delete is geweigerd totdat
  8.3c een begrensde verwijderflow levert;
- App Check gebruikt uitsluitend de reCAPTCHA Enterprise-provider, is in
  development altijd uit en in staging/productie opt-in via env-config;
- lokale diagnostiek bewaart maximaal 50 allowlisted technische events in
  geheugen en verzendt niets automatisch;
- verificatie: v2 955/955 unit-tests, lint en productie/classic-SW-build groen;
  Firebase 83/83 unit-/convertertests en 232/232 Emulator Rules-tests groen;
  gerichte Chromium-emulatorprobe 1/1 groen zonder App Check-/reCAPTCHA-call
  en instellingen-axe-probe 1/1 groen; alle gewijzigde codebestanden slagen
  voor de gerichte Prettier-check; `npm audit --omit=dev` meldt 0
  productiekwetsbaarheden.

Nog geen operationele claim: App Check is niet op een echt stagingproject
geactiveerd of gemonitord. Sitekey/configuratie, metrics en echte-apparaatcheck
blijven de afzonderlijke monitorpoort vóór enige enforcement.

**Herreview-opvolging (P1, 3 september 2026):** de matrix-completeness-test
vergeleek `FIRESTORE_ACCESS_MATRIX`/`FIRESTORE_CLIENT_GATEWAY_FILES` alleen
tegen zichzelf, niet tegen de werkelijke bestandsboom of `firestore.rules`. Nu
opgelost:

1. `firestoreAccessMatrix.spec.ts` ontdekt Rules-datamatches, direct-
   Firestore-padbouwende bronbestanden onder `v2/src/infrastructure` en
   converter-exports uit `firebase/src/documents` automatisch vanaf de schijf
   en vergelijkt ze in beide richtingen met de matrix — een vergeten of
   overbodige matrixrij faalt nu de test.
2. De twee ontbrekende migratiegateways (`FirestoreCloudMigrationInventory
   Gateway.ts`, `FirestoreMigrationWriteGateway.ts`) zijn toegevoegd aan
   `FIRESTORE_CLIENT_GATEWAY_FILES` en gekoppeld aan de `settings`/`roster`/
   `games`/`completed-games`-matrixrijen die ze daadwerkelijk raken.
3. Elke matrixrij heeft nu een `converterSources`-veld dat de daadwerkelijk
   gebruikte `firebase/src/documents`-converter(s) benoemt (`migration-runs`
   blijft bewust leeg — geen dedicated converter, zie die entry's
   `conditions`); een nieuwe/vergeten converter faalt de bidirectionele test.
4. De onjuiste `team-members`-claim ("role values are allowlisted") is
   verwijderd; de conditie beschrijft nu eerlijk dat create/update alleen de
   `uid`-invariant afdwingen. De ontbrekende role-/shapevalidatie op
   `organizationMembers`/`invitations`/`teamMembers`/`settings`/`roster` is
   toegevoegd als expliciete, niet-blokkerende restdreiging in
   `docs/security-threat-model.md` §4/§7 (geen escalatiepad: elke
   consumerende Rules-functie is een exact-literal allowlist).

Verificatie na deze opvolging: Firebase 86/86 unit-/convertertests (was
83/83) en 232/232 Emulator Rules-tests groen, `type-check` groen.

### 8.3b — volledige organisatie-export en herstelbewijs

Werk:

1. Definieer een versieerbaar `OrganizationExportV1`-contract in de pure
   domeinlaag met secties voor de volledige §A-inventaris.
2. Voeg een read-only `OrganizationExportGateway` toe achter de application-
   poort. Hergebruik bestaande converters en expliciet gescopete queries; geen
   Admin SDK en geen UI→Firebase-import.
3. Bouw een coordinator: capability-/contextcheck → inventarisatie → reads →
   validatie → aantallen/hash → lokale roundtrip → download. Elke fout levert
   nul writes en geen bestand met een vals volledigheidslabel.
4. Voeg een owner-only NL/EN-preview toe met doelorganisatie, teams,
   gegevensfamilies, aantallen, gevoelige-inhoudwaarschuwing en expliciete
   downloadactie. Voor andere rollen wordt de actie niet gerenderd.
5. Maak pure parser-/validator-/roundtriptests plus Emulator-e2e voor twee
   organisaties, gelijknamige teams, tombstones, actieve game/actions,
   migratierun en invitationstatussen.
6. Maak een herstelproef in een nieuwe fictieve Emulator-doelcontext met een
   test-only Admin-/Emulatorharness die nooit in de productiebuild komt, en
   vergelijk canonieke inventaris + hashes; bron blijft byte-voor-byte intact.
   8.3b voegt geen algemene organisatie-importknop of productie-restoreendpoint
   toe.

Acceptatie:

- export is volledig, deterministisch, versieerbaar en fail closed;
- owner slaagt; admin/coach/scorer/viewer en cross-org-aanvallers krijgen geen
  exportactie en geen leesresultaat;
- membership-e-mails komen alleen in het expliciet gedownloade bestand, nooit
  in DOM buiten de previewnoodzaak, console, traces of CI-output;
- corrupte of deels onleesbare clouddata kan niet als geslaagde export eindigen;
- herstelproef bewijst inhoudsgelijkheid in een nieuw doel en wijzigt/verwijdert
  de bron niet;
- bestaande team-back-up/import, lokale modus, offline wedstrijd en het
  Nederlandse CSV-contract blijven ongewijzigd groen.

### 8.3c — bewaarbeleid en veilige account-/organisatieverwijdering

**Startblokkade:** voer deze sub-PR niet uit voordat de keuzes in §E.1–E.3
expliciet zijn bevestigd.

Werk:

1. Leg bewaartermijnen vast voor actieve/completed games, tombstones,
   invitations, migrationRuns, diagnosebuffer, exportbestanden en eventuele
   operationele back-ups. Documenteer juridische/productreden en purgepad.
2. Bouw het gekozen verwijdermodel uit §B.5 met vaste padallowlist,
   idempotente run-ID, inventaris-/previewfase, sterke bevestiging,
   voortgang/checkpoint, readback en een eerlijk partial-failureresultaat.
3. Blokkeer organisatieverwijdering zolang er een actieve trackinggame,
   onbevestigde acties/migratie of onvolledige eigenaarsexport is, tenzij het
   gekozen beleid daar expliciet een herstelbaar alternatief voor vastlegt.
4. Behandel laatste-owner en meerdere organisaties expliciet. Accountdelete
   mag organisaties van andere owners niet raken; een sole owner krijgt eerst
   overdracht of organisatieverwijdering als verplichte stap.
5. Scheid Auth-userverwijdering van Firestore-dataverwijdering met recente
   reauthenticatie, hervatbare status en readback. Nooit 'account verwijderd'
   tonen als één kant nog persoonsgegevens bevat.
6. Test crash/retry, dubbele aanvraag, ingetrokken ownerrol tijdens uitvoering,
   cross-org ID, onverwachte subcollectie, meer dan één batch, serverreject en
   een mislukte Auth-delete na geslaagde Firestore-opruiming.

Acceptatie:

- geen orphan-subcollecties, membership-e-mails of onbeheerbare sole-ownerorg;
- geen client kan een willekeurig Firestore-pad laten verwijderen;
- herhalen is idempotent en een crash is zichtbaar hervatbaar;
- actieve/offline wedstrijddata wordt nooit stil verloren;
- export vóór delete is aantoonbaar compleet of de delete blijft geblokkeerd;
- rolverlies of contextwissel faalt closed;
- Emulator-/serverintegratietests dekken alle rollen en negatieve paden;
- geen Blaze/deployment zonder de afzonderlijke goedkeuring uit §E.

### 8.3d — verbruik, back-up, DPA en operationele acceptatie

Werk:

1. Herhaal met fictieve stagingdata het PR-5.5-meetprotocol voor minimaal:
   login/context, settings/roster, live game met sync, afronden/historie,
   tweede apparaat, tombstone, migratie, organisatie-export en het gekozen
   verwijderpad. Noteer reads/writes/deletes/opslag per scenario en meetvenster.
2. Projecteer laag/verwacht/piekgebruik naar organisaties, teams, wedstrijden
   en gelijktijdige apparaten. Vergelijk met actuele quota/prijzen en benoem
   grootste kostendrijvers; geen schijnprecisie zonder echte meting.
3. Leg Spark-runbook vast: quota-dashboard, verantwoordelijke, controletempo,
   waarschuwingsdrempels en gedrag bij quotumuitputting zonder dat offline
   wedstrijdbediening stopt.
4. Alleen bij goedgekeurd Blaze: configureer budgetalerts via gecontroleerde
   console-/IaC-stap, documenteer ontvangers en testmelding. Benoem expliciet
   dat alerts Firestore-uitgaven niet automatisch hard stoppen.
5. Beslis en test het back-upmodel: JSON-organisatie-export, scheduled backup,
   PITR of combinatie. Een echte restore gaat naar een nieuwe stagingdatabase,
   nooit over de bron; documenteer RPO/RTO, retentie en kosten.
6. Herverifieer regio (`eur3`), Firebase Authentication-metadata-afweging,
   Firebase Data Processing and Security Terms/DPA, subprocessors,
   authproviders, dependencies/licenties en exitstrategie. Verwerk alleen
   actuele officiële bronnen en datumstempel ieder driftgevoelig besluit.
   Officiële privacy-/verwerkersbasis:
   <https://firebase.google.com/support/privacy> en
   <https://firebase.google.com/terms/data-processing-terms/>.
7. Lever `docs/pr-8.3-operational-report.md` met bewijs, open risico's en een
   expliciet go/no-go-advies voor PR 8.4 — geen productiecutoveradvies.

Acceptatie:

- gemeten scenario's zijn herhaalbaar en gescheiden van achtergrondverbruik;
- quota-/kostenprojectie vermeldt aannames en onzekerheid;
- budgetalerts hebben een eigenaar en testbewijs, of zijn eerlijk als
  niet-toepasbaar op Spark vastgelegd;
- back-up en restore zijn aantoonbaar verschillende controles; een restore is
  echt uitgevoerd op fictieve stagingdata of blijft als open blokkerende gate;
- DPA/regio/voorwaarden/prijzen zijn op uitvoeringsdatum herverifieerd;
- geen echte spelersdata, tokens of e-mails in rapport, Git of logs;
- PR 8.4 start pas als het rapport geen open P0/P1-security-/privacybevindingen
  en geen onbeheerst herstel- of kostenrisico meldt.

## D. Algemene verificatie per sub-PR

Voer naar rato van de diff minimaal uit:

```text
v2: typecheck, lint, format-check, volledige unit-suite, productiebuild,
    relevante Playwright e2e/e2e-auth en v1-regressies
firebase: typecheck, unit-tests en volledige Emulator Rules-suite
documentatie: links, genoemde paden/scripts en git diff --check
```

Voor security-, export- en delete-e2e geldt:

- echte Auth-/Firestore-emulators en echte Rules, geen alleen-gemockte happy
  path;
- fixtures zijn fictief en uniek per test;
- test minstens owner/admin/coach/scorer/viewer plus unauthenticated en
  cross-org;
- assert serverreadback en aantallen, niet alleen een succesmelding in de UI;
- geen brede waits/timeouts als vervanging van een waarneembare statuspoort;
- iedere nieuw geopende bevestigingsdialoog krijgt axe-, focus-, Escape-,
  Tab/Shift+Tab- en focusrestoredekking.

## E. Eigenaarsbesluiten vóór implementatie

1. **Verwijdermodel** — aanbevolen voor de eerste release: een getest,
   eigenaar-geïnitieerd verwijderverzoek plus handmatig beheer-/CLI-runbook.
   Dit voorkomt nu een nieuwe serverruntime/Blaze-afhankelijkheid. Alternatief:
   een callable Cloud Function met expliciete Blaze- en deploymentgoedkeuring.
2. **Bewaartermijnen** — aanbevolen startpunt: tombstoned wedstrijden 90 dagen;
   claimed/revoked invitations 30 dagen; afgeronde migrationRuns 90 dagen;
   unresolved/failed runs bewaren tot herstel of expliciete afhandeling;
   diagnose alleen in-memory tot tabsluiting. Gedownloade exports vallen onder
   beheer van de gebruiker. Voor eventuele cloudback-ups wordt retentie pas bij
   een Blaze-besluit gekozen. Zonder expliciete bevestiging geen purge.
3. **Sole-owner/accountdelete** — bevestig: eerst eigendom overdragen of de
   eigen organisatie volledig exporteren en verwijderen; nooit automatisch
   eigendom aan een willekeurige admin geven.
4. **App Check** — aanbevolen: 8.3a bouwt monitor-only; staging-enforcement pas
   na gemeten geldige-requestratio en echte-apparaatcheck; productie pas in 8.5.
5. **Back-up/billing** — aanbevolen zolang de app preproductie is: Spark plus
   volledige organisatie-export. Scheduled backups/PITR of Cloud Functions
   vereisen een afzonderlijk Blaze-/budgetbesluit.
6. **Diagnostiek** — aanbevolen: lokaal, bounded, allowlisted en alleen
   expliciet exporteerbaar; geen remote logging-/analyticsleverancier in 8.3.

## F. Stopregels en faseoverdracht

- Geen implementatie van 8.3c zolang §E.1–E.3 niet bevestigd zijn.
- Geen App Check-enforcement op staging/productie vanuit een code-PR alleen;
  monitorbewijs, rollbackpad en expliciete toestemming zijn vereist.
- Geen debugtoken, service-accountkey, Admin SDK-credential, back-uppayload,
  spelerdata of klantdata in code, fixtures, screenshots, prompts of logs.
- Geen blinde recursive delete, `localStorage.clear()`, clientaangeleverd
  Firestore-pad of delete zonder volledige inventaris/readback.
- Geen wijziging van Nederlandse CSV-kolommen, statistiekberekeningen of
  bestaande `localStorage`-keys zonder apart contract/migratiebesluit.
- Geen remote analytics/tracking of nieuwe loggerdienst.
- Geen automatische betaalde upgrade, billingkoppeling, auto-recharge,
  deployment of productiecutover.
- Een fysiek iOS/iPadOS-/ouder-toestelrestpunt uit fase 7/8.1/8.2 blijft open
  totdat het echt is uitgevoerd; App Check-enforcement mag dit niet omzeilen.
- Na 8.3 volgt eerst PR 8.4 parallelle v1/v2-acceptatie. PR 8.5 blijft de enige
  productiecutoverpoort en vereist afzonderlijke expliciete goedkeuring.
