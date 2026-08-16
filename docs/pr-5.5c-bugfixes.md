# Bugfixes — gevonden tijdens 5.5c-handmatige staging-validatie

Status: **fixes in uitvoering (PR 60).** Bugs 3, 4, 6 en 9 zijn gefixt (zie
hun statusregels hieronder); bugs 1, 2, 5, 7, 8 volgen in dezelfde PR. Bug 10
blijft bewust uitgesteld naar de toekomstige Fase 8-thema/personal-settings-
implementatie. Dit document verzamelt
applicatiebugs die tijdens het handmatige protocol
(`docs/pr-5.5-handmatig-protocol.md`) tegen de échte staging-Firebase-
omgeving (`wheelchair-basketball-tracker`, niet de emulator) aan het licht
komen. Losstaand van `docs/pr-5.5-onderzoeksrapport.md` — dat rapporteert
de resultaten van het protocol zélf; dit document houdt bij welke
onderliggende bugs het protocol blootlegt, zodat ze gebundeld gefixt kunnen
worden zonder het protocol zelf te onderbreken. Nieuwe bevindingen worden
hieronder toegevoegd naarmate het protocol verder wordt uitgevoerd; de
daadwerkelijke fixes (met regressietests) volgen in dezelfde PR zodra er
genoeg verzameld is of het protocol een geschikt pauzepunt bereikt.

## Gevonden bugs

### 1. Wedstrijd-tab (`GameSetupPanel`) toont geen recente roster-wijzigingen

**Symptoom**: na het opslaan van spelers op de Team-tab toont de
Wedstrijd-tab nog steeds "Nog geen spelers. Voeg ze toe via Team." totdat
de pagina wordt herladen.

**Oorzaak**: `v2/src/app/App.tsx`'s `useEffect` die `game` afleidt van
`roster` via `createGameFromRoster()` draait alleen wanneer `game === null`
— dus eenmalig, bij het eerst laden van een team (vaak met een lege
roster). Een latere roster-wijziging binnen dezelfde sessie leidt niet tot
een nieuwe afleiding; `game.players` blijft vastzitten op de
oorspronkelijke (vaak lege) snapshot.

**Waarom dit niet eerder opviel**: een browser-herlaad discardt een
`setup`-fase-`game` en leidt 'm vers af van de actuele roster — dat
verbergt de bug toevallig bij elke test die tussen roster-wijziging en
wedstrijd-check herlaadt (kennelijk het patroon van de bestaande
e2e-suite).

**Impact**: reëel voor elke gebruiker die een team voor het eerst instelt
en zonder tussentijds herladen naar Wedstrijd navigeert — precies het pad
dat een nieuwe gebruiker/coach als eerste bewandelt.

**Gevonden via**: `docs/pr-5.5-handmatig-protocol.md` §B.1, staging (niet
emulator) — account A, `basketball-tracker-staging`-Deploy Preview,
15 aug. 2026.

**Status**: open, nog niet gefixt.

### 2. Geen zichtbare bevestiging bij opslaan — systemisch, niet Roster-only

**Symptoom**: na het klikken op "Opslaan" (of een score-/wedstrijdactie)
verschijnt nergens in de app een duidelijke succesmelding. Op verzoek van
de eigenaar breder uitgezocht (16 aug. 2026): dit is **geen Roster-
specifiek probleem, maar een systemisch patroon** dat vrijwel de hele app
raakt.

**Oorzaak, per gebied**:
- **Roster (`RosterPanel.handleSave()`) en Settings
  (`SettingsPanel.handleSave()`)**: beide gebruiken exact hetzelfde
  `useSyncStatus`-contract (`v2/src/application/sync/useSyncStatus.ts`,
  `saveRoster`/`saveSettings`) — een optimistische lokale write die
  meteen `ok: true` teruggeeft, terwijl de Firestore-serverbevestiging
  (`settled`) los, fire-and-forget, op de achtergrond afloopt. Geen
  enkele positieve bevestiging; een écht mislukte serverwrite wordt pas
  zichtbaar via de aparte, globale "actie-nodig"-indicator
  (`ActionNeededPanel`), niet inline bij de knop zelf.
- **Wedstrijdopzet (`GameSetupPanel`) en live-scoren
  (`LiveTrackingPanel`: score, blokjes opslaan/bewerken, wedstrijd
  afronden)**: geen expliciete "Opslaan"-knop per actie, maar elke
  wijziging schrijft direct lokaal (`gameRepo.write()`, synchroon). Hier
  wél een inline foutmelding bij een mislukte lokale write
  (`data-testid="game-save-error"`), maar **nooit een positieve
  bevestiging** — de gebruiker ziet alleen "geen foutmelding", niet
  "opgeslagen". De achtergrond-cloudsync van een lopende wedstrijd
  (`GameSyncCoordinator`) is alleen zichtbaar via de algemene
  `SyncStatusIndicator`-badge, niet inline per actie.
- **Historie (`HistoryPanel`)**: alleen een foutmelding bij mislukt
  verwijderen, nooit een succesbevestiging.
- **Uitzondering die het wél goed doet**: `BackupPanel.handleConfirmImport()`
  heeft een echte, afgewachte `idle → running → done`-statusmachine met
  een zichtbaar `role="status"`-succesblok (`data-testid="backup-success"`,
  vertaalstring `backupImportSuccess`) én een apart faalblok. Dit is het
  enige positieve-bevestigingspatroon dat al in de app bestaat.

**Ontbrekende infrastructuur**: er bestaat nergens in `v2/src` een gedeeld
Toast-/Snackbar-/StatusBanner-component — elk paneel implementeert zijn
eigen lokale `error`/`state`-afhandeling los van de rest. Een structurele
fix vereist dus waarschijnlijk een nieuw, herbruikbaar component (naar het
voorbeeld van `BackupPanel`'s bestaande succes-/faalblok), in plaats van
een simpele aanpassing van bestaande code.

**Impact**: UX-gebrek over vrijwel de hele app, geen functioneel
dataverlies — saves lukken in de praktijk meestal wel, de gebruiker weet
het alleen nooit zeker.

**Gevonden via**: bug 1 (Roster, 15 aug. 2026); breder uitgezocht op
expliciet verzoek van de eigenaar (16 aug. 2026).

**Status**: open, nog niet gefixt. Scope nu vastgesteld — fix vereist een
nieuw gedeeld bevestigingscomponent, geen losse per-scherm patches.

### 3. Geen feedback bij "Verificatiemail opnieuw versturen" op het uitnodigingsscherm

**Symptoom**: op `AcceptInvitationScreen` (het "Bevestig je e-mailadres"-
scherm dat verschijnt zodra een uitnodiging pending is en het account nog
niet geverifieerd is) geeft de knop "Verificatiemail opnieuw versturen"
geen enkele terugkoppeling — geen laadstatus, geen bevestiging, geen
foutmelding.

**Oorzaak**: `AcceptInvitationScreen.tsx` regel 158:
`onClick={() => void onResendVerification()}` — de `void` gooit het
`Promise<boolean>`-resultaat van `sendVerificationEmail()`
(`FirebaseAuthGateway.ts`) volledig weg. Dezelfde bugklasse als bug 2, maar
zonder zelfs een `disabled`-status tijdens versturen (de accept-/claim-
knoppen op ditzelfde scherm hebben wél `disabled={submitting}`) — deze
knop is dus ook meerdere keren snel achter elkaar klikbaar, wat Firebase's
eigen rate-limit (`auth/too-many-requests`) kan raken zonder dat de
gebruiker dat ooit te zien krijgt.

**Impact**: UX-gebrek zoals bug 2, met een extra risico: herhaald klikken
kan de daadwerkelijke verzending laten mislukken (rate-limit) zonder enig
signaal, wat de gebruiker juist aanzet tot nóg meer klikken.

**Gevonden via**: `docs/pr-5.5-handmatig-protocol.md` §B.2 stap 7, staging
— account B, `basketball-tracker-staging`-Deploy Preview, 15 aug. 2026.

**Status**: gefixt (PR 60). `handleResendVerification()` in
`AcceptInvitationScreen.tsx` verwerkt nu het `Promise<boolean>`-resultaat: de
knop krijgt `disabled` tijdens het versturen, en toont daarna een zichtbare
succes- (`invitation-resend-success`) of foutmelding
(`invitation-resend-error`, nieuwe i18n-strings `authResendVerificationSuccess`/
`-Error`). Regressietest: `tests/e2e-auth/invitation-accept-and-claim.spec.ts`
(jack-scenario, uitgebreid) — geverifieerd tegen de echte Firebase Auth-
emulator.

### 4. "Uitnodiging accepteren" mislukt direct na e-mailverificatie (verouderd ID-token)

**Symptoom**: account B doorloopt e-mailverificatie succesvol en bereikt
het "Uitnodiging accepteren"-scherm (rol correct getoond:
`organizationAdmin`), maar het klikken op **"Uitnodiging accepteren"**
faalt met de generieke melding "Er ging iets mis. Probeer het opnieuw."

**Oorzaak**: twee samenhangende problemen.
- **Hoofdoorzaak**: `firebase/firestore.rules`' accept-regel controleert
  `request.auth.token.email_verified == true` — dat is een claim in het
  **ID-token (JWT)**, niet hetzelfde als `user.emailVerified` (het lokale,
  direct bijgewerkte SDK-veld waar `AcceptInvitationScreen` zelf op
  gate't om dit scherm te tonen). Nergens in `v2/src` wordt na de
  verificatielink een expliciete ID-token-refresh (`getIdToken(true)` /
  opnieuw inloggen) afgedwongen — de Firebase SDK ververst het token pas
  automatisch na ca. een uur. Het accept-verzoek gebruikt dus
  hoogstwaarschijnlijk nog een verouderd token waarin `email_verified`
  nog `false` staat, en Firestore Rules wijzen de write af
  (`permission-denied`).
- **Secundair, gerelateerd probleem**: `FirestoreOrganizationGateway.acceptInvitation()`
  geeft de echte Firestore-foutcode wél door in `OperationResult.errorCode`,
  maar `AcceptInvitationScreen.handleAccept()` gebruikt alleen `result.ok`
  en negeert `errorCode` volledig — dus deze faalmodus was zonder
  codeonderzoek niet te diagnosticeren vanuit de UI of de browserconsole.

**Waarom dit niet eerder opviel**: de bestaande Rules-tests
(`firebase/tests/rules/bootstrap-and-invitation-flow.spec.ts`) bakken
`email_verified` altijd statisch in bij het aanmaken van de testcontext
(`authCtx(env, uid, { email_verified: true })`) — het scenario "eerst
`false`, dan geverifieerd, dan schrijven met het oude token" is in die
testopzet structureel onmogelijk om te reproduceren.

**Workaround**: uitloggen en opnieuw inloggen forceert een vers ID-token
en zou de accept-actie alsnog moeten laten slagen.

**Gevonden via**: `docs/pr-5.5-handmatig-protocol.md` §B.2 stap 8, staging
— account B, `basketball-tracker-staging`-Deploy Preview, 15 aug. 2026.

**Status**: gefixt (PR 60). Nieuwe `AuthGateway.refreshIdToken()` (roept
`user.getIdToken(true)` aan) wordt nu altijd aangeroepen in
`AcceptInvitationScreen.handleAccept()`/`handleClaim()`, vlak vóór de
accept-/claim-write — dwingt een vers ID-token af zodat de
`email_verified`-claim in de Rules altijd overeenkomt met de actuele
`authUser.emailVerified`. Als secundaire verbetering wordt `result.errorCode`
nu ook zichtbaar meegegeven aan de foutmelding
(`data-error-code` op `invitation-error`), zodat een eventuele resterende
afwijzing voortaan wél diagnosticeerbaar is vanuit de UI/DOM. Geverifieerd via
de volledige `tests/e2e-auth/invitation-accept-and-claim.spec.ts`-suite tegen
de echte Firebase Auth-/Firestore-emulator (alle vier de uitnodigings-
randgevallen, inclusief grace's accept+claim-flow).

### 5. Alleen-lezen-status voor viewers onvoldoende zichtbaar/verklaard

**Symptoom**: account C (expliciete team-`viewer`, §B.3) opent de Team-tab
en klikt op knoppen ("+ Speler toevoegen", invoervelden) zonder dat er
iets gebeurt — voelt aan als een kapotte app, niet als een bewust
beperkte rol.

**Oorzaak**: geen bug in de autorisatie zelf — `RosterPanel.tsx` past
`canWrite` wel degelijk correct toe (`readOnly` op alle invoervelden,
`disabled` op alle knoppen inclusief "Opslaan" en "+ Speler toevoegen",
regels 106-211) en toont een `role="status"`-tekst `rosterReadOnly`
("Alleen-lezen"). Het probleem is **plaatsing en duidelijkheid**: die
tekst staat helemaal onderaan het paneel, vlak boven de "Opslaan"-knop
(regel 200-204) — een gebruiker die als eerste bovenaan op
"+ Speler toevoegen" klikt, heeft de verklaring dus nog niet gezien. Er
staat bovendien nergens uitgelegd wát de rol "viewer" concreet betekent
of waarom deze gebruiker geen wijzigingen mag maken.

**Impact**: UX-gebrek, geen functionele/autorisatiefout — de Rules/UI
blokkeren schrijven terecht, maar de gebruiker begrijpt niet waarom en
denkt dat de app niet werkt.

**Gevonden via**: `docs/pr-5.5-handmatig-protocol.md` §B.3/§C.2
(negatieve role-matrix-test), staging — account C, 16 aug. 2026.

**Status**: open, nog niet gefixt. Waarschijnlijk hetzelfde patroon op
Settings-tab (zelfde `canWrite`-aanpak, niet apart geverifieerd).

### 6. Herladen terwijl offline toont altijd "geen lokale kopie", ook als het team wél gecachet is

**Symptoom**: tijdens een proefronde van het §C.1-protocol op **desktop
Chrome** (nog geen formele mobiele ronde — zie toelichting onderaan), zowel
bij vliegtuigmodus als bij wifi-uit: direct na het wijzigen van de
teamnaam offline toont de app kort
"Lokaal beschikbaar - uit cache" met de aangepaste naam zichtbaar en
bruikbaar. Herlaad je de pagina terwijl nog steeds offline, dan verschijnt
in plaats daarvan **"Geen verbinding" / "Er is nog geen lokale kopie van je
organisaties op dit apparaat. Ga online om verder te gaan."** — ook al was
het team een moment eerder aantoonbaar uit cache beschikbaar.

**Oorzaak**: `FirestoreOrganizationGateway.listMyMemberships()` en
`listMyTeamOnlyContexts()` (`v2/src/infrastructure/organizations/FirestoreOrganizationGateway.ts`,
regel 70-92 resp. 105+) gebruiken een **eenmalige `getDocs()`**-aanroep op
een `collectionGroup`-query, geen `onSnapshot()` met persistente cache
zoals de team-roster/settings-data dat wel heeft
(`initializeFirestore(..., { localCache: resolveLocalCacheMode(trusted) })`
in `firebaseClient.ts`). `deriveAppState()`
(`v2/src/domain/organizations/deriveAppState.ts` regel 49-50) toont
`uncached-offline` zodra `memberships === null` én offline — en die
membershiplijst kan door het `getDocs()`-eenmalige-fetch-patroon
structureel niet uit cache komen bij een volledige paginaherlaad, ook al
staat het onderliggende teamdocument zelf wél degelijk in de persistente
Firestore-cache. Dit is dus geen incidentele flake maar **elke keer
reproduceerbaar** bij offline herladen, ongeacht vliegtuigmodus of
wifi-uit (beide bevestigd identiek gedrag).

**Impact**: functioneel — geen dataverlies (de wijziging staat nog steeds
lokaal/wacht op sync zodra online), maar het weerhoudt de gebruiker ervan
om na een offline herlaad zijn/haar reeds-gecachete team te blijven zien
en bewerken, precies het scenario dat §C.1 test. Geen "onverwacht
vastgelopen laadscherm" (er verschijnt direct een duidelijke, niet-hangende
melding), dus dit hoeft een "schone run" volgens de letterlijke
protocoldefinitie niet te blokkeren — maar het is een structurele
beperking die het rapport (§B.4) expliciet moet vermelden, niet als
toevallige afwijking.

**Gevonden via**: `docs/pr-5.5-handmatig-protocol.md` §C.1-stappen
doorlopen op desktop Chrome, staging — 16 aug. 2026. **Telt niet mee als
één van de vereiste mobiele §C.1-rondes** (die vereisen een fysiek
Android-/iOS-apparaat, zie §A punt 3) — de bug is een codebevinding die
onafhankelijk van het platform geldt (`getDocs()` vs. `onSnapshot()` is
platformonafhankelijk), maar de formele "2/2 schone runs"-telling begint
pas bij de eerste échte mobiele ronde.

**Status**: gefixt (PR 60). `listMyMemberships()`/`listMyTeamOnlyContexts()`
zijn vervangen door `subscribeMyMemberships()`/`subscribeMyTeamOnlyContexts()`
(`onSnapshot()` i.p.v. een eenmalige `getDocs()`) — deze bedienen zich net als
team-roster/settings-data uit Firestores persistente lokale cache, dus een
offline paginaherlaad toont de gecachete membershiplijst direct i.p.v.
"Geen verbinding". `AuthGate.tsx`'s membership-effect is herschreven naar dit
live abonnement (zie ook bug 9 hieronder, dezelfde wijziging). Bijwerking
ontdekt tijdens het testen tegen de echte emulator: een live abonnement zou
een intrekking (of rolwijziging) ook DIRECT tijdens een al-actieve sessie
laten doorwerken — in strijd met het bestaande, bewust zo ontworpen gedrag
("intrekking wordt pas zichtbaar via een afgewezen write of een expliciete
reload", zie `action-needed-panel.spec.ts`, `backup-cloud-reject.spec.ts`,
`game-sync-real-rules-rejection.spec.ts`). Opgelost door het abonnement
additief te laten samenvoegen en te bevriezen zodra een context al actief
gekozen is (zie `AuthGate.tsx`'s `selectedContextRef`/`hasPublishedOnce`) —
alleen de allereerste publicatie en updates vóór contextselectie komen live
door; intrekking/rolwijziging tijdens een actieve sessie blijft zoals
voorheen pas zichtbaar via reload of een afgewezen write. Geverifieerd via de
volledige `tests/e2e-auth`-suite (52 tests) tegen de echte Firebase
Auth-/Firestore-emulator, inclusief alle offline/reload- en
intrekkingsscenario's.

### 7. Geen zichtbare aanduiding van het ingelogde account

**Symptoom**: nergens in de app is te zien met welk e-mailadres/account je
bent ingelogd — alleen de knoppen "Wissel van organisatie/team" en
"Uitloggen" zijn zichtbaar.

**Oorzaak**: `SessionBar` (`v2/src/ui/context/SessionBar.tsx`) accepteert
geen `email`/`authUser`-prop en rendert dus nooit het ingelogde account;
`SessionBarProps` bevat alleen `onSignOut`/`onSwitchContext`/`syncStatus`.

**Impact**: UX-gebrek — met name lastig tijdens multi-account-testen
(A/B/C in verschillende browserprofielen) en voor eindgebruikers die
tussen meerdere teams/organisaties wisselen en willen bevestigen op welk
account ze zitten vóór het uitvoeren van een actie.

**Gevonden via**: eigenaarfeedback tijdens §C.1, staging, 16 aug. 2026.

**Status**: open, nog niet gefixt.

### 8. Syncstatus-badge afgesneden/overlapt door knoppen op mobiele breedte

**Symptoom**: op een echt Android-toestel (portret, smalle viewport) wordt
de syncstatus-badge in de sessiebalk ("Lokaal beschikbaar - uit cache",
"Gesynchroniseerd") links afgesneden en overlapt door de knoppen "Wissel
van organisatie/team" en "Uitloggen" — alleen het staartje van de tekst
(bijv. "...okaal beschikbaar uit cache") is nog leesbaar.

**Oorzaak**: `.session-bar` (`v2/src/index.css` regel 409-416) is
`display: flex; justify-content: flex-end;` **zonder `flex-wrap: wrap`**.
`.sync-status-indicator` (regel 418-426) krijgt `margin-right: auto` om
naar links te duwen, maar met twee vaste-breedte-knoppen ernaast en geen
wrap-regel is er op smalle schermen te weinig ruimte — de badge klapt niet
naar een eigen regel, maar wordt simpelweg buiten beeld/onder de knoppen
geduwd.

**Impact**: op mobiel (waar dit paneel het vaakst gebruikt wordt) is de
syncstatus — juist de indicator die bug 2's ontbrekende opslaan-
bevestiging enigszins zou moeten compenseren — in de praktijk onleesbaar.

**Gevonden via**: `docs/pr-5.5-handmatig-protocol.md` §C.1, Android-ronde 1
(vliegtuigmodus + wifi-uit, beide sub-runs), echt toestel, staging,
16 aug. 2026.

**Status**: open, nog niet gefixt.

### 9. "Geen toegang meer/ingetrokken" direct na het aanmaken van een gloednieuwe organisatie

**Symptoom**: direct na het succesvol aanmaken van een eerste organisatie +
team (`NoOrganizationsScreen`) toont de app kort **"Geen toegang meer" /
"Je toegang tot deze organisatie of dit team is ingetrokken."** — een
alarmerende melding voor een organisatie die letterlijk nog geen minuut
oud is en waarvan de gebruiker zelf net owner is geworden. Op
"Terug naar organisatie-overzicht" klikken lost het meteen op: de nieuwe
organisatie/team verschijnt daarna gewoon en werkt normaal.

**Vermoedelijke oorzaak** (nog niet 100% herleid tot de exacte
race-volgorde, wel goed onderbouwd): `NoOrganizationsScreen.handleSubmit()`
roept `onCreated()` pas aan ná een geslaagde org- én team-write
(`AuthGate.tsx` regel 357: `onCreated={() => setMembershipsRefreshKey(...)}`),
wat een herfetch van `memberships` triggert via dezelfde eenmalige
`listMyMemberships()`-`getDocs()`-aanroep als bug 6. `deriveAppState()`
evalueert `selectedContext`/`memberships`/`selectedContextTeamValid`
(regel 181-209, apart async-effect) — in het korte venster tussen het
zetten/selecteren van de nieuwe context en het daadwerkelijk binnenkomen
van de ververste membershiplijst kan de validatie momenteel geen geldig
lidmaatschap vinden en concludeert het (onterecht) "ingetrokken" in plaats
van "nog aan het laden". Zodra de membershiplijst alsnog binnenkomt,
herstelt de status vanzelf.

**Impact**: geen dataverlies, volledig herstelbaar — maar zeer verwarrend/
beangstigend voor een net-geregistreerde gebruiker die exact op dit moment
voor het eerst een organisatie aanmaakt (elke nieuwe klant/coach dus).

**Gevonden via**: aanmaken van account D / "Verbruikmeting Org B" voor
§D-verbruiksmeting, staging, 16 aug. 2026.

**Status**: gefixt (PR 60), zelfde onderliggende oorzaak als bug 6 bevestigd.
Met `subscribeMyMemberships()` (zie bug 6) komt een net aangemaakt membership
via Firestores lokale-schrijf-echo vrijwel direct door, i.p.v. via het oude
`membershipsRefreshKey`-refreshrondje — het venster waarin "ingetrokken" ten
onrechte kon verschijnen is daarmee weg. `NoOrganizationsScreen`'s
`onCreated`-callback (de refresh-trigger) is overbodig geworden en verwijderd.
Tijdens het testen bleek de org+team-aanmaakflow zelf ook een tweede, nauw
verwante race te hebben — behandeld als onderdeel van dezelfde fix:
1. Doordat de membership-write nu live doorkomt vóórdat `createTeam()` (de
   daaropvolgende, afhankelijke write) is voltooid, kon de contextwisselaar
   heel even een organisatie zonder enig team tonen. Opgelost met een
   `bootstrapInFlight`-signaal (`NoOrganizationsScreen` → `AuthGate`) dat het
   onboardingscherm zichtbaar houdt totdat zowel de organisatie- als de
   team-write voltooid zijn.
2. Empirisch (tegen de echte Firestore-emulator) bleek `createTeam()`'s Rule-
   evaluatie (`isOrgOwnerOrAdmin`) de zojuist bevestigde owner-membership-write
   soms nog niet te zien — een kort, `permission-denied`-gevend venster. Een
   kleine automatische retry (`createTeamWithRetry`, tot 3 pogingen met
   oplopende backoff) lost dit op i.p.v. de gebruiker een generieke foutmelding
   te tonen voor iets dat een fractie van een seconde later gewoon lukt.

Regressietest: `tests/e2e-auth/bootstrap-first-org.spec.ts` (uitgebreid met een
expliciete MutationObserver-check dat het "ingetrokken"-scherm nooit
verschijnt tijdens de bootstrap-flow), geverifieerd tegen de echte
Firebase Auth-/Firestore-emulator.

### 10. Team-kleuren (primaire/accentkleur) worden nergens visueel toegepast — v1-regressie

**Symptoom**: op de Instellingen-tab kies je onder "Club" een primaire
kleur en een accentkleur ("Aangepast" of een van de preset-cirkels),
slaat op, maar nergens in de rest van de app (Wedstrijd-scherm, knoppen,
headers) verandert er iets — "alles blijft blauw", inclusief de
"Opslaan"-knop zelf. In v1 had deze instelling wel een zichtbaar effect.

**Oorzaak**: `primaryColor`/`accentColor` (`domain/settings/types.ts`)
worden in de hele `v2/src`-codebase **uitsluitend gelezen en geschreven
binnen het Instellingen-formulier zelf** (`SettingsPanel.tsx`) en
gevalideerd/genormaliseerd (`domain/settings/normalize.ts`). Nergens
anders — geen CSS custom property-injectie, geen inline `style`-gebruik,
geen thema-logica — wordt deze waarde daadwerkelijk toegepast op UI-
elementen. Alle knoppen (incl. "Opslaan") gebruiken een vaste, hardcoded
`.btn-primary`-stijl in `index.css`, losstaand van de teaminstelling.

**Impact**: functionele regressie t.o.v. v1, geen dataverlies — de kleur
wordt wel degelijk correct opgeslagen in Firestore (het is dus geen writes-
bug), maar de hele branding-functie heeft in v2 op dit moment geen enkel
zichtbaar effect. Dit is dus geen losse "polish"-bug maar een ontbrekend
stuk functionaliteit.

**Gevonden via**: eigenaarfeedback tijdens §D-vervolgtesten, staging,
16 aug. 2026.

**Status**: open, nog niet gefixt. Vereist een aparte implementatiestap
(bijv. CSS custom properties op basis van `settings.primaryColor`/
`accentColor` toepassen op de relevante UI-laag), geen kleine patch zoals
de meeste andere bugs hierboven.

## Nog te doen

- Meer bugs toevoegen naarmate het 5.5c-protocol verder wordt uitgevoerd
  (§C.1 resterende 3 rondes, §D verbruiksmeting).
- Zodra er genoeg verzameld is of het protocol een pauzepunt bereikt: de
  bugs hierboven daadwerkelijk fixen in deze PR, met regressietests (unit
  en/of e2e tegen de emulator, zodat toekomstige reloads-tussen-stappen
  deze klasse van bug niet opnieuw kunnen maskeren).

## Cross-references

- `docs/pr-5.5-handmatig-protocol.md` — het protocol waarmee deze bugs
  worden gevonden.
- `docs/pr-5.5-onderzoeksrapport.md` — de resultaten van het protocol
  zélf (los van deze onderliggende applicatiebugs).
- `docs/IMPLEMENTATION_PLAN.md` §17 — voortgangsregel voor deze PR.
