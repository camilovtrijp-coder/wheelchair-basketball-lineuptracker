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
- Back-up/PITR, retentie, budgetalerts en actuele kosten zijn 8.3d-scope.
- Echte iOS/iPadOS-/oud-toestel-/screenreadervalidatie blijft open; geen
  securityclaim mag die praktijkpoort als automatisch afgedekt voorstellen.
- `organizationMembers`, `invitations`, `teamMembers`, `settings` en `roster`
  valideren geen volledige veldshape of `role`-enum op create/update (zie §4,
  "Ontbrekende role-shapevalidatie op membership-/teamdata-writes"). Nooit een
  escalatiepad omdat elke consumerende Rules-functie een exact-literal
  allowlist is; wel een open punt voor een toekomstige shapehardening-PR.

Voor iedere nieuwe Firestore-familie of query zijn vóór merge verplicht:

1. matrixrij en querycontract;
2. converter-/shapevalidatie;
3. positieve en negatieve Rules-tests per relevante rol;
4. cross-org/team-probe;
5. export-, retentie- en deleteclassificatie;
6. privacy-/kostenbeoordeling.
