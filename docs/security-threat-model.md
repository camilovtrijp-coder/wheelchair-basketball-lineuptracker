# Securitydreigingsmodel — Lineup Tracker v2

Status: PR 8.3a-baseline, 31 augustus 2026. Geldt uitsluitend voor deze
v2-/herbouwrepository en fictieve dev/stagingdata; geen productiecutover.

## 1. Assets en privacygrens

Te beschermen assets:

- Firebase Auth-identiteit, verified-emailstatus en sessie;
- organisaties, teams, memberships, rollen en uitnodigingen;
- spelersnaam, rugnummer, classificatie en bestaande categorievlaggen;
- instellingen, actieve wedstrijden, actielogs, historie en tombstones;
- migratieruns, lokale synccheckpoints en back-ups/exports;
- beschikbaarheid tijdens een volledige offline wedstrijd;
- Firebase-/App Check-debugtokens en operationele beheerrechten.

Firebase-webconfig en een reCAPTCHA Enterprise-sitekey zijn publieke
projectidentificatie en geen autorisatiegeheim. Ze verlenen nooit toegang:
Authentication, App Check en Firestore Rules hebben ieder een afzonderlijke
rol. Service-accountkeys, Admin SDK-credentials en App Check-debugtokens zijn
wel geheim en horen nooit in browsercode, Git, buildoutput of logs.

## 2. Trust boundaries

```text
Browser/PWA
  ├─ lokale app-code en in-memory diagnose
  ├─ localStorage / IndexedDB / service-worker-cache
  ├─ Firebase Authentication
  ├─ App Check-attestation (alleen expliciet geconfigureerde staging/prod)
  └─ Cloud Firestore → Security Rules → organisatie-/teamdata

Test-/beheergrens
  ├─ Firebase Auth-/Firestore-emulators met fictieve fixtures
  ├─ stagingconsole en gebruiksmetingen
  └─ eventuele toekomstige server-/deletebeheerflow (niet in 8.3a)
```

De browser is nooit vertrouwd voor autorisatie. Verborgen/disabled UI is alleen
gebruikerservaring; Rules blijven de afdwingende grens. Firestore Rules zijn
geen queryfilters: iedere query moet dezelfde scope dragen die de Rules
toestaan.

## 3. Aanvallers en fouten

1. Niet-ingelogde internetgebruiker met publieke webconfig.
2. Geldig ingelogde gebruiker zonder membership.
3. Lid dat een hogere rol, andere organisatie of ander team probeert te lezen
   of wijzigen.
4. Uitgenodigde gebruiker die invitation replay, e-mailverwisseling of
   self-grant probeert.
5. Ex-lid met een offline cache of lang openstaand tabblad.
6. Oud writerapparaat dat na overname stale acties probeert te uploaden.
7. Script/bot dat publieke Firebase-endpoints gebruikt om quota uit te putten.
8. Operatorfout: verkeerde deploycontext, debugtoken in build, brede delete,
   incomplete export of restore over de bron.
9. Programmeerfout die persoonsgegevens of payloads aan diagnose toevoegt.

## 4. Dreigingen en bestaande/nieuwe mitigaties

| Dreiging                                      | Impact                             | Mitigatie en bewijs                                                                                                                                                                    |
| --------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-org/team read of write                  | P0 datalek/-wijziging              | Padcontext in documenten/converters, `canReadTeam`/rolchecks en positieve/negatieve Emulator-tests. Zie `firebase/src/security/firestoreAccessMatrix.ts`.                              |
| Self-grant/-promotion                         | P0 privilege escalation            | UID als membershipdocument-ID, verified invitation, atomaire claim met `getAfter()`, owner/admin-beperkingen en `self-promotion.spec.ts`.                                              |
| Invitation replay/enumeratie                  | P1 ongeautoriseerd lid/lekkage     | Statusmachine pending→accepted→claimed/revoked, verified e-mail, atomische claim; onleesbaar en niet-bestaand zijn in UI niet te onderscheiden.                                        |
| Te brede query                                | P1 datalek of uitval               | Alleen twee uid-gefilterde collection-groupqueries; overige queries onder expliciet org/team-pad. Querycontract + Rules-tests.                                                         |
| Revoked lid gebruikt cache                    | P1 stale inzage/schrijfpoging      | Cache kan laatst bekende data tonen; server weigert nieuwe reads/writes. UI wordt read-only bij onzekere rol en toont actie-nodig bij reject. Gedeeld apparaat kan lokale data wissen. |
| Stale writer/action replay                    | P1 corrupte wedstrijd              | Writer claim/epoch, monotone sequence, create-only action-ID-idempotentie, revisionchecks en takeover-/reconnecttests.                                                                 |
| Malformed/oversized document                  | P1 kosten of converteruitval       | Rules shape-/type-/sizegrenzen, converters fail closed, importvalidatie en negatieve probes. Nieuwe families moeten matrix + tests toevoegen. Geldt volledig voor `organizations`/`teams`/`games`/`actions`/`completedGames`/`migrationRuns` (`hasAll`/`hasOnly` en/of `isValidXPayload()`); `organizationMembers`, `invitations`, `teamMembers`, `settings` en `roster` valideren alleen specifieke velden/de document-ID, geen volledige shape of `role`-enum — zie de restdreiging hieronder. |
| Ontbrekende role-shapevalidatie op membership-/teamdata-writes | P2 (geen escalatie; data-integriteit) | `organizationMembers`/`invitations`/`teamMembers`.create/update valideren geen `role`-enum (geen `hasOnly`/waardenlijst) en `settings`/`roster`.write valideren geen enkele veldshape buiten de document-ID. Escaleert nooit: elke consumerende functie (`isOrgOwnerOrAdmin`, `canManageTeamData`, `orgRole`/`teamRole`-vergelijkingen) is een exact-literal allowlist die een onbekende rolwaarde standaard weigert. Alleen al bevoegde owner/admin/coach-actoren kunnen dit lokaal veroorzaken — geen aanvalspad voor een lager-bevoegde rol. Geaccepteerd als niet-blokkerende restdreiging; zie `firebase/src/security/firestoreAccessMatrix.ts`'s `team-members`-conditie. Volledige shape-/enumvalidatie (naar het niveau van `organizations`/`teams`/`games`) is toekomstig werk, niet in 8.3a-scope. |
| Hard delete/resurrectie                       | P1 dataverlies                     | Games/actions/migrationRuns hard-delete denied; completed games tombstone-only en lokale resurrectiepreventie. Bewaar/purge is 8.3c.                                                   |
| Quota-uitputting via echte client             | P1 beschikbaarheid/kosten          | Rules beperken bevoegdheden; App Check wordt monitor-first beoordeeld als defense-in-depth. Gebruik/alerts/back-up volgen in 8.3d. Offline wedstrijd blijft lokaal bruikbaar.          |
| Gestolen App Check-debugtoken                 | P1 bypass attestation              | Alleen encrypted secretstore, nooit productiebuild/Git/log; direct intrekken bij lek. App Check vervangt Rules niet.                                                                   |
| App Check false positive/offline regressie    | P1 legitieme gebruiker geblokkeerd | Development/emulator provider-vrij; staging eerst metrics; enforcement alleen na echte-browser/offline/oud-toestelgate en expliciete toestemming.                                      |
| Diagnose lekt persoonsgegevens                | P1 privacyincident                 | Exacte allowlist `area`+`code`, extra veld faalt closed, maximaal 50 events in-memory, geen auto-upload of blijvende key; unitprobes met e-mail/IDs/raw error.                         |
| Onvolledige export als volledig gepresenteerd | P1 vals herstelvertrouwen          | 8.3b moet fail closed, alle paden inventariseren, convertervalideren, aantallen/hash/roundtrip en serverreadback bewijzen.                                                             |
| Browser-recursive organisatie-delete          | P0 orphan/dataloss                 | Niet toegestaan. 8.3c kiest expliciet servercoordinator of eigenaarverzoek + beheer-runbook, met inventaris/checkpoint/readback.                                                       |

## 5. App Check monitor-first besluit

Aanbevolen en in 8.3a gebouwd: uitsluitend opt-in initialisatie voor staging en
productie via deploycontext-env. Development en Emulator Suite initialiseren
geen provider en doen geen extern attestationverzoek. Ingeschakeld betekent
alleen dat geldige clients tokens/metrics leveren; enforcement wordt niet door
code geactiveerd en blijft uit tot een afzonderlijke eigenaarsbeslissing.

De reCAPTCHA Enterprise-datastroom, Firebase privacyvoorwaarden en prestaties
op echte doelapparaten worden vóór staging-enforcement beoordeeld. CI gebruikt
geen debugtoken voor de Emulatorsuite. Als later een echte staging-e2e tegen
een enforced backend draait, komt het debugtoken uitsluitend uit een encrypted
CI-secret en wordt gecontroleerd dat geen productieartifact de debugprovider
of een tokenwaarde activeert. De Firebase App Check-vendorbundle bevat zelf
slapende debug-exchangecode; de repository activeert die niet en zet nergens
`FIREBASE_APPCHECK_DEBUG_TOKEN`.

Officiële basis:

- <https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider>
- <https://firebase.google.com/docs/app-check/web/debug-provider>
- <https://firebase.google.com/support/privacy>

### Staging-monitorprotocol (geen enforcement)

1. Zet uitsluitend op staging de Enterprise-sitekey en de expliciete
   `VITE_FIREBASE_APP_CHECK_ENABLED_STAGING=true`; laat enforcement uit.
2. Controleer in de App Check-metrics afzonderlijk: normale geverifieerde
   sessie, onjuiste/niet-geverifieerde login, incognito en een herladen lang
   openstaande tab. Registreer alleen geaggregeerde geldige/ongeldige/
   onbekende requestratio's, geen identifiers of payloads.
3. Speel met fictieve data een offline start, volledige wedstrijd en reconnect;
   herhaal op de 375×667-viewport en op het beschikbare oudste doelapparaat.
4. Accepteer monitoring pas wanneer Auth-/Firestoregedrag, offline bediening,
   reconnect en PWA-updatepad ongewijzigd werken en de ongeldige/unknown-ratio
   verklaard is. Dit is nog geen toestemming voor enforcement.
5. Rollback is configuratief: zet de staging-enableflag terug op `false` en
   publiceer pas na dezelfde build-/emulatorchecks opnieuw. Een gelekt
   debugtoken wordt ingetrokken; productiecode bevat zelf geen debugprovider.

## 6. Privacyveilige diagnostiek

De nieuwe diagnose is geen analytics- of loggingdienst. Zij bewaart maximaal
50 events in geheugen tot tabsluiting. Een event bevat uitsluitend:

```text
area + vaste code + occurredAt
```

Uitgesloten en runtime geweigerd: naam, rugnummer, classificatie, e-mail, uid,
orgId, teamId, gameId, Firebase-config, token, back-up-/wedstrijdpayload, stack
trace en raw exception. Download is een expliciete gebruikersactie met NL/EN-
privacyuitleg; niets wordt automatisch verzonden.

## 7. Restdreigingen en overdracht

- App Check staat nog niet enforced en voorkomt geen misbruik vóór de aparte
  staging-/productiegate.
- Laatste-ownerbescherming is nog application-level en niet atomair in Rules;
  account-/organisatieverwijdering blijft daarom 8.3c-scope.
- Firestore parent-delete verwijdert subcollecties niet; geen organisatie-hard-
  delete tot het gekozen 8.3c-model getest is.
- Bewaartermijnen zijn Rules-**ondergrenzen**, geen automatische purge: Spark
  kent geen TTL en er is geen serverruntime. PR 8.3c-1 (deel 1) legt de
  30-dagengrens op uitnodigingen, de 90-dagengrens op tombstoneredactie en het
  `deletionRequests/current`-pad vast in Rules; het daadwerkelijke opruimen is
  een handmatige, nog te documenteren runbookactie. Rules kunnen de
  blokkerende voorwaarden van een verwijderverzoek (recente niet-afgeronde
  wedstrijd, niet-terminale migratierun) niet afdwingen — die vragen een query
  — en `exportProof` is een vaste vorm, geen narekenbare hash. Beide zijn
  applicatielogica (8.3c-1 deel 2) en worden door het runbook opnieuw gecontroleerd.
- Team-only leden (alleen een `teamMembers`-rij, geen `organizationMembers`-rij)
  kunnen `deletionRequests/current` niet lezen en zien dus geen banner terwijl
  een organisatie wordt verwijderd. **Bewust geaccepteerd restrisico** (eigenaar,
  29 september 2026): Rules kunnen "lid van enig team" niet uitdrukken zonder een
  `teamId` in het pad, en een melding per team is een gewijzigd datacontract
  (nieuw teamveld, niet-atomaire batch). Mitigatie in 8.3c-1 deel 2 en het
  runbook: de owner-bevestiging toont het aantal team-only leden met de melding
  dat zij geen banner zien en handmatig geïnformeerd moeten worden, het runbook
  eist die controle vóór uitvoering, en de blokkade op recente niet-afgeronde
  wedstrijden blijft gelden. Herzien zodra er meer dan één organisatie met een
  eigenaar buiten de eigen kring is (besluitrecord §2.4, trigger 2); dan hoort een
  melding per team samen met de servervariant opnieuw op de agenda.
- Back-up/PITR, retentie, budgetalerts en actuele kosten zijn 8.3d-scope.
- Echte iOS/iPadOS-/oud-toestel-/screenreadervalidatie blijft open; geen
  securityclaim mag die praktijkpoort als automatisch afgedekt voorstellen.
- `organizationMembers`, `invitations`, `teamMembers`, `settings` en `roster`
  valideren geen volledige veldshape of `role`-enum op create/update (zie §4,
  "Ontbrekende role-shapevalidatie op membership-/teamdata-writes"). Nooit een
  escalatiepad omdat elke consumerende Rules-functie een exact-literal
  allowlist is; wel een open punt voor een toekomstige shapehardening-PR.

### Organisatie verlaten en accountverwijdering (8.3c-2, restrisico's R1–R6)

Stand na PR 8.3c-2b-ii (`LeaveOrganizationCoordinator`, `AccountDeletionCoordinator`,
`FirestoreAccountGateway`, `FirebaseAccountAuthGateway`;
ontwerp `docs/pr-8.3c-2b-plan.md` §F, besluitrecord `docs/pr-8.3c-besluitvoorstel.md`
§8.6/§8.7). De client verwijdert alleen eigen documenten die uit een verse
server-inventaris komen, in de vaste volgorde teamMembers → eigen openstaande
uitnodigingen → per-organisatiecontrole → eigen membership als laatste →
eindcontrole van de server. Rules blijven de grens; onderstaande restrisico's
blijven bewust staan.

- **R1 — herclaim van een openstaande uitnodiging (besluitrecord §8.6 punt 3).** Een
  vertrokken lid kan een nog openstaande uitnodiging met een hogere rol claimen.
  2b-i sluit het eerlijke vertrekpad: bij verlaten verwijdert de vertrekker zijn eigen
  `pending`/`accepted` uitnodigingen in die organisatie (besluit B3; `claimed`/`revoked`
  blijven voor de audit). Het overdrachtspad volgt in 2b-iii. De Rules-claimtermijn
  van 30 dagen na `invitedAt` (#103) sluit oude uitnodigingen. **Restvenster:** een
  uitnodiging jonger dan 30 dagen die buiten de app om blijft staan (demotie of
  verwijdering via de Console, of een vertrekker zonder geverifieerde e-mailclaim, die
  zijn uitnodigingen niet kan vinden), tot ze is ingetrokken of verlopen.
- **R2 — re-bootstrap van een verwijderde, gedemoveerde maker (§8.6 punt 4).** De
  Rules-binding aan de eerste 7 dagen na `createdAt` (#103) laat alleen dat venster
  open, ook bij een overdracht zonder accountverwijdering en eenzijdig met een tweede
  account als de maker admin is. De maker kan zelf nooit vertrekken (klasse
  `creator-needs-owner`, geen write).
- **R3 — race na de eindcontrole.** Een owner/admin kan direct na de eindcontrole een
  `teamMembers`-document of uitnodiging voor de vertrekker aanmaken; de eindcontrole is
  een momentopname. Sinds 2b-ii leest `deleteAuthAccount()` de eindpoort (drie queries
  van de server) zelf opnieuw, direct vóór `deleteUser()`, na een reauthenticatie in
  dezelfde aanroep; een groene eindpoort uit een eerdere aanroep telt niet. Wat daarna
  nog ontstaat (een venster van milliseconden), ruimt een owner/admin op (teamMembers
  direct, uitnodigingen na 30 dagen) of het runbook. **Omgekeerd:** een self-delete die de
  flow als `timeout`/`offline` opgaf, blijft in de schrijfwachtrij van Firestore en kan
  later alsnog landen zonder dat de flow het merkt; de uitkomst `incomplete` kan dan
  achterhaald zijn. Het is altijd een bedoelde delete in de juiste volgorde; de volgende
  verse inventaris toont de werkelijke toestand.
- **Misvormd ledendocument blokkeert vertrek (fail closed, runbook).** De
  per-organisatiefeiten lezen de ongefilterde ledenlijst met de converter. Eén ongeldig
  `organizationMembers`-document van een ánder lid (bijv. via de Console aangemaakt met
  een onbekende rol of zonder `uid`) laat vertrek en accountverwijdering voor iedereen in
  die organisatie stoppen met `read-failed`, zonder write. Runbook: het document in de
  Console herstellen of verwijderen.
- **R4 — pseudonieme audit-uid's blijven staan (besluit B8, geaccepteerd).**
  `organizations.createdBy`, `teams.createdBy`, `invitations.invitedBy`,
  `games.writerUid`, `actions.authorUid`, `completedGames.deletedBy` (tot redactie),
  `deletionRequests.requestedBy` en `migrationRuns.createdBy` dragen de uid. Ze zijn
  onveranderlijk of append-only onder Rules en bevatten geen e-mail. "Geen document
  meer dat de eigen uid draagt" is beperkt tot lidmaatschaps- en
  uitnodigingsdocumenten. Herzien bij de juridische toets vóór 8.5.
- **R5 — hoofdlettergebruik in e-mailadressen.** Een uitnodiging die buiten de app
  met een afwijkend gespeld adres is aangemaakt, matcht de token-e-mail niet: ze is
  niet te accepteren, maar ook niet via de query te vinden en blijft na vertrek of
  accountverwijdering staan (aanname A3: Firebase Auth levert het token-adres in
  kleine letters; niet in de emulator bewezen). Achtervang: runbook, en het
  pre-8.5-besluit over het uitnodigingsaanmaakpad hieronder.
- **R6 — half aangemaakte organisatie na 7 dagen (alleen vastgelegd, niet opgelost).**
  `createOrganizationWithOwner` schrijft sequentieel eerst het organisatiedocument en
  dan het owner-membership via de bootstrap-create. Landt die tweede write niet
  binnen 7 dagen na `createdAt` (bijv. een write die offline in de wachtrij bleef
  staan of een afgebroken sessie), dan weigeren de Rules sinds #103 de bootstrap (ook
  de hervatting via `resumeOrgId`) en blijft er een organisatie zonder owner en zonder
  lid achter. De maker ziet haar niet
  in zijn inventaris (er is geen eigen document), dus verlaten of accountverwijdering
  raakt haar niet; opruimen is een beheerdersactie via het runbook. Bovendien blijft
  `NoOrganizationsScreen` hangen: `bootstrapOrgId` staat in `localStorage` en wordt alleen
  bij succes gewist, dus elke volgende poging hervat dezelfde dode organisatie met een
  generieke fout en de gebruiker kan via dat scherm geen nieuwe organisatie aanmaken
  (ontwerp `docs/pr-8.3c-2b-plan.md` §F R6; fix vóór de cutover: bij `permission-denied`
  op het hervatpad met een `createdAt` ouder dan 7 dagen de sleutel wissen).

Accountverwijdering (2b-ii): geen enkele write vóór een groen plan (alles zelf op te
lossen) en een geslaagde reauthenticatie (besluit B2); `deleteUser()` alleen direct na
een lege eindpoort uit dezelfde aanroep; `deleted` alleen na een bevestigend antwoord,
een onbekende afloop is `auth-state-unknown`. Het wachtwoord bestaat alleen als argument
van één aanroep en komt in geen uitkomst of log. De preflight ververst het ID-token altijd
(een verouderde `email_verified=false` liet in 2b-i de uitnodigingsstap stil weg; een
geslaagd vertrek meldt nu `invitationsChecked`).

Verder geldt voor deze flows: elke inventaris-, controle- en readbacklezing komt van
de server (`getDocsFromServer`/`getDocFromServer`), dus een offline cache kan nooit
een vals "leeg" opleveren; er is geen nieuwe `localStorage`-sleutel en geen
persistente voortgang (hervatten gebeurt uit een verse server-inventaris); en
onbevestigd lokaal wedstrijdwerk voor een organisatie (openstaande afronding of een
gestarte wedstrijd op dit apparaat) blokkeert het verlaten van die organisatie, ook als
de sleutels niet op te sommen zijn (onbekend = blokkeren; alleen "geen storage" telt 0).

### Pre-8.5-poort: er bestaat geen uitnodigingsaanmaakpad in `v2/src`

PR 8.3c-0 bindt `invitedAt` aan `request.time`, zodat een uitnodiging niet
meer teruggedateerd kan worden. Die garantie geldt **uitsluitend voor writes
die door Security Rules gaan** — en dat is precies waar hier een gat zit dat
vóór de PR 8.5-cutover gesloten moet worden:

- `FirestoreOrganizationGateway` kent alleen `getInvitationByLink()`,
  `acceptInvitation()` en `claimInvitation()`. Nergens in `v2/src` wordt een
  uitnodigingsdocument aangemaakt; de app heeft geen uitnodig-UI.
- Uitnodigingen ontstaan vandaag dus buiten de app om. De handmatige
  Firebase Console-write uit het stagingprotocol loopt via Admin-privileges en
  **omzeilt Rules volledig** — inclusief de nieuwe `invitedAt`-eis.
- Gevolg: `invitedAt == request.time` bewijst alleen iets over
  Rules-gecontroleerde writes. Zolang de enige werkelijke aanmaakroute een
  Console-write is, is elke bewaartermijn die op `invitedAt` rekent (8.3c-1)
  in de praktijk ongefundeerd.

**Vóór echte spelersdata moet het gezaghebbende productie-aanmaakpad worden
vastgesteld.** Dat is een productbesluit, geen codefix: ofwel een uitnodig-UI
in de app (die dan automatisch onder Rules valt), ofwel een expliciet
vastgelegde, gecontroleerde beheerroute met een eigen afspraak over hoe
`invitedAt` daar gezet wordt. Tot dat besluit er is, blijft dit een open
poort en mag geen enkele acceptatieclaim de uitnodigingsbewaartermijn als
afgedwongen presenteren.

Voor iedere nieuwe Firestore-familie of query zijn vóór merge verplicht:

1. matrixrij en querycontract;
2. converter-/shapevalidatie;
3. positieve en negatieve Rules-tests per relevante rol;
4. cross-org/team-probe;
5. export-, retentie- en deleteclassificatie;
6. privacy-/kostenbeoordeling.
