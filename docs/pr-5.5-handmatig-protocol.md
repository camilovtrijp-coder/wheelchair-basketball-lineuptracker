# Handmatig protocol — PR 5.5c (iOS/Android-validatie + stagingverbruik)

Status: voorbereid in PR 5.5b-activatievoorbereiding (aug. 2026), **nog niet
uitgevoerd**. Dit document beschrijft exact wat een mens met een mobiel
apparaat moet doen zodra de v2-staging-Netlify-site en het staging-Firebase-
project (PR 5.5b-activatie) daadwerkelijk live staan. Er is bewust geen code
of test in deze PR die dit protocol al uitvoert — dat kan pas ná activatie,
en niet vanuit deze (sandbox)omgeving, die geen fysiek mobiel apparaat heeft.

Zie `docs/pr-5.5-plan.md` §C 5.5c voor de plek van dit protocol in de PR-
volgorde, en `docs/pr-5.4-onderzoeksrapport.md` §C voor de drie open punten
die dit protocol afsluit. `docs/pr-5.5-plan.md` §D legt vast wat het formele
acceptatiecriterium voor 5.5c is: **2/2 schone runs** op zowel iOS als
Android, role-matrix-UI-dekking, en een werkelijke verbruiksmeting inclusief
deletes. Dit protocol is geschreven om precies dát te leveren — geen enkele
stap hieronder is optioneel.

## A. Voorwaarden vóór je begint

1. PR 5.5b-activatie is voltooid: een echt staging-Firebase-project bestaat,
   de Firestore Rules zijn ernaartoe gedeployed, en de v2-Netlify-site is
   gekoppeld en heeft minstens één succesvolle deploy (Deploy Preview of de
   production-branch-deploy — beide gebruiken staging-Firebase, zie
   `v2/netlify.toml`).
2. Je hebt de deploy-URL bij de hand (Netlify geeft die na elke build).
3. Je hebt **beide** mobiele platforms beschikbaar: minstens één iOS- en
   minstens één Android-apparaat (telefoon/tablet), elk met een browser en,
   voor het PWA-gedeelte, de mogelijkheid om de site "toe te voegen aan
   beginscherm". Zonder één van beide is 5.5c's acceptatiecriterium
   (`docs/pr-5.5-plan.md` §D: "iOS/Android: 2/2 schone runs") niet haalbaar
   — dit is geen "indien mogelijk"-stap.
4. Je hebt **geen** Firebase-service-accountkey nodig voor dit protocol — zie
   §B hieronder voor hoe testaccounts/data zonder zo'n sleutel ontstaan.
5. Je hebt toegang tot de Firebase Console voor het staging-project (als
   owner/editor) en tot `firebase login` op je eigen machine (voor de
   opruimstap in §B, punt 8) — dat vereist geen service-accountkey, alleen
   een interactieve browser-login.
6. Je hebt **twee echt bereikbare e-mailadressen** die jij zelf kunt lezen
   (bijv. twee adres-aliassen van hetzelfde account, zoals
   `jouwnaam+5.5c-a@gmail.com` en `jouwnaam+5.5c-b@gmail.com`). Zie §B voor
   waarom `@example.test` hier niet volstaat.

## B. Testaccounts en fictieve stagingdata aanmaken — zonder service-accountkey

`firebase/scripts/seed.ts` (de bestaande emulator-seeder) mag **niet** tegen
het staging-project draaien — het script weigert dit nu ook expliciet (zie
`assertEmulatorEnv()` bovenaan het bestand, met een eigen unit-test in
`firebase/tests/unit/assertEmulatorEnv.spec.ts`): het genereert bij elke run
een wegwerp-zelfondertekend sleutelpaar dat alleen de Emulator Suite
accepteert (die verifieert geen handtekeningen); een echte Google-backend
zou dat sowieso afwijzen. Een variant die wél tegen staging zou werken,
vereist een gedownloade Firebase-service-accountkey (JSON) — een gevoelig
credential dat we bewust niet in deze sessie/repo willen aanmaken, opslaan
of hanteren (zie AGENTS.md over geheimen).

In plaats daarvan: gebruik de app zelf, precies zoals een echte gebruiker
dat zou doen — met twee accounts, want role-matrix- en tweede-client-
validatie (§C) hebben een owner/coach-account (A) én een tweede account met
een andere rol (B) nodig.

### B.1 — Account A (owner) aanmaken

1. Open de staging-deploy-URL in een gewone browser (desktop mag voor deze
   stap, hoeft niet het mobiele apparaat te zijn).
2. Registreer een testaccount met een **echt door jou leesbaar**
   e-mailadres (zie §A punt 6) — géén `@example.test`: dat domein kan geen
   echte mail ontvangen, en de Firestore Rules eisen voor zowel het
   accepteren als het claimen van een uitnodiging expliciet
   `request.auth.token.email_verified == true` (zie
   `firebase/firestore.rules`, `invitations/{invitationId}`-sectie). Een
   niet-geverifieerd of onverifieerbaar account kan dus geen tweede rol
   claimen — "verificatie tijdelijk uitschakelen" is geen geldige omweg,
   want dat test een ander codepad dan wat écht gebruikt wordt.
3. Open de link die de verificatiemail bevat (Firebase Authentication
   verstuurt deze automatisch bij signup met e-mail/wachtwoord via de
   standaard e-mailtemplate — geen aparte configuratie nodig) en bevestig
   het e-mailadres.
4. Doorloop de onboardingflow: eerste organisatie + team aanmaken via de UI
   (`onboarding-org-name`/`onboarding-team-name`-formulier, hetzelfde pad
   als `bootstrap-first-org.spec.ts` in de e2e-suite). Dit account is
   automatisch `organizationOwner`.
5. Vul via de Roster-tab een paar fictieve spelers in (naam, rugnummer,
   klasse) — expliciet gemarkeerd als fictief in de naam, bijv. "Fictief
   Speler Eén", zodat niemand deze data ooit voor echt aanziet.
6. Vul via de Settings-tab een teamnaam en de overige instellingen in.

### B.2 — Uitnodiging aanmaken (er bestaat geen UI hiervoor) en account B laten claimen

De app heeft géén scherm of knop om een uitnodiging te *versturen* — alleen
`AcceptInvitationScreen` (accepteren/claimen) bestaat client-side; het
aanmaken van een `organizations/{orgId}/invitations/{invitationId}`-document
gebeurt in de bestaande code-/testbasis uitsluitend via `firebase/scripts/seed.ts`
(Admin SDK, alleen emulator) of via directe Rules-tests. Voor staging is er
dus geen kant-en-klaar UI-pad — dat moet je hier expliciet via de Firebase
Console doen, als bewuste, gedocumenteerde uitzondering:

1. Noteer het `uid` van account A: Firebase Console → Authentication →
   Users-tabblad → kopieer het "User UID" van account A.
2. Noteer het `orgId`: zichtbaar in de URL van de contextwisselaar
   (`?orgId=...`) of via Firebase Console → Firestore Database →
   `organizations`-collectie → het documentnaam is het `orgId`.
3. Firebase Console → Firestore Database → navigeer naar
   `organizations/<orgId>/invitations` → **Document toevoegen** met een
   zelfgekozen document-ID (bijv. `inv-pilot-b`) en exact deze velden (zie
   `firebase/src/documents/invitation.ts` `InvitationDocument` voor het
   schema):
   - `email` (string) = het echte e-mailadres van account B (zie §A punt 6);
   - `role` (string) = bijv. `"coach"` of `"viewer"`, afhankelijk van welke
     rolgrens je wilt testen (zie §C.2);
   - `status` (string) = `"pending"`;
   - `invitedBy` (string) = het uid van account A uit stap 1;
   - `invitedAt` (timestamp) = nu;
   - `acceptedAt` (null).
4. **Belangrijk voorbehoud**: deze Console-write omzeilt de Firestore Rules
   volledig (zoals elke Console-write) — dit bewijst dus NIET dat
   `invitations`-`create` via de Rules werkt voor een owner/admin. Dat is al
   afzonderlijk gedekt door geautomatiseerde Rules-tests
   (`firebase/tests/rules/membership-and-roles.spec.ts`, tegen de
   emulator). Deze stap is uitsluitend testfixture-voorbereiding — het punt
   dat dit protocol wél test, is of *accepteren en claimen* via de echte
   staging-Rules werkt, wat vanaf hier via de gewone app-UI gebeurt.
5. Bouw de accept-link handmatig op:
   `<staging-deploy-URL>/?orgId=<orgId>&invitationId=<document-ID uit stap 3>`
   (zie `v2/src/infrastructure/invitations/invitationLink.ts` voor het
   parameterformaat).
6. Registreer account B (op een ANDER apparaat/browserprofiel, of een
   incognitovenster) met het e-mailadres uit stap 3, en verifieer dat adres
   net als bij account A (stap B.1.3).
7. Open de accept-link uit stap 5 als account B. De normale
   `AcceptInvitationScreen`-flow accepteert en claimt de uitnodiging nu via
   de echte Rules (`email == token.email`, `email_verified == true`) — dit
   is het daadwerkelijke, geautomatiseerd-onbewezen pad dat dit protocol
   verifieert.
8. **Opruimen na afloop — kies één van beide, expliciet, geen impliciete
   "verwijder het document maar"**:
   - **Voorkeur: laat de fixtures staan** als vaste, herbruikbare
     staging-testdata voor een volgende 5.5c-of-latere-ronde. Documenteer
     die keuze in `docs/pr-5.5-onderzoeksrapport.md` §B.1 (org-ID,
     account-uid's, welke rollen).
   - **Als opruimen toch gewenst is**: een los Firestore-parentdocument
     verwijderen via de Console cascadeert NIET naar subcollecties (teams,
     invitations, teamMembers, settings, roster blijven dan als wees-
     documenten achter). Gebruik in plaats daarvan de Firebase CLI (`firebase
     login` volstaat, geen service-accountkey nodig):
     `firebase firestore:delete organizations/<orgId> --recursive --project staging`.
     Verifieer daarna met een **readback** dat het document en al zijn
     subcollecties echt weg zijn: `firebase firestore:get organizations/<orgId> --project staging`
     hoort een "not found" te geven, of controleer handmatig in de Console
     dat `organizations/<orgId>` niet meer bestaat. Verwijder de
     testaccounts zelf apart via Authentication → Users → verwijderen (dat
     cascadeert niet automatisch mee met de Firestore-delete).

Dit levert dezelfde soort fictieve, duidelijk gelabelde data op als
`firebase/scripts/seed.ts` doet voor de emulator — alleen via de UI (en één
bewust gedocumenteerde Console-uitzondering voor de uitnodiging zelf) in
plaats van via een script, en zonder dat er ooit een service-accountkey
nodig is geweest.

## C. Handmatig reproductieprotocol — echt mobiel apparaat, tegen staging

Aangepast van `docs/pr-5.3d-onderzoeksrapport.md` §F: dat protocol liep tegen
een lokale/emulator-buildomgeving; dit hier loopt tegen de echte staging-
Netlify-deploy + echte staging-Firestore, wat destijds bewust als open vraag
is blijven staan ("of dit ook op een echt apparaat/tegen productie-Firestore
optreedt").

### C.1 — Offline/reload/sync-protocol (per platform, 2/2 schone runs)

Eén **"schone run"** betekent: alle stappen 1-8 hieronder voltooien zonder
een onverwacht vastgelopen laadscherm, zonder een blijvende `actie-nodig`-
status na reconnect, én met een geslaagde tweede-client-readback in stap 8.
**Voer deze volledige reeks twee keer uit op een iOS-apparaat én twee keer
op een Android-apparaat (4 volledige runs in totaal)** — dat is exact wat
`docs/pr-5.5-plan.md` §D bedoelt met "iOS/Android: 2/2 schone runs"; één
run per platform is onvoldoende om consistentie aan te tonen.

1. Open de staging-deploy-URL op het mobiele apparaat.
2. Log in met account A uit §B.1 (of registreer/verifieer opnieuw op dít
   apparaat als je een vers account per platform wilt). Beantwoord
   "vertrouwd apparaat" met **ja**, zodat settings/roster persistent
   gecachet worden. Open het team zodat settings/roster daadwerkelijk
   gecachet raken.
3. Zet het apparaat in **vliegtuigmodus** (niet alleen wifi uit — dat ligt
   dichter bij een reële "verbinding weg"-situatie).
4. Wijzig de teamnaam in de instellingen en sla op.
5. Observeer de syncstatus-indicator: verwacht `Wacht op synchronisatie`
   (NL) / `Pending sync` (EN). **Noteer of dit al dan niet gebeurt, en zo
   ja: na hoeveel seconden.**
6. Herlaad de pagina (pull-to-refresh of browser-herlaad) terwijl nog in
   vliegtuigmodus. **Noteer of de app blijft hangen op het laadscherm, en of
   na verloop van tijd een diagnostische melding verschijnt over welke stap
   vaststeekt** (`LoadingScreen`'s stalled-steps-indicator).
7. Zet vliegtuigmodus weer uit. Noteer of/wanneer de indicator naar
   `Gesynchroniseerd` (NL) / `Synced` (EN) springt.
8. **Tweede-client-readback (verplicht in élke run, niet slechts één keer
   voor het hele protocol)**: log op een tweede apparaat/browser in als
   account B met dezelfde context en controleer dat de nieuwe teamnaam daar
   verschijnt — tegen echte staging-Firestore, niet de emulator (zie ook PR
   7.1c's `game-sync-second-client-readback.spec.ts` voor het
   emulator-equivalent van dit principe).

Herhaal stap 3–8 nogmaals binnen dezelfde run met een andere manier van
"offline gaan" (wifi-uit i.p.v. vliegtuigmodus, of daadwerkelijk buiten
bereik) om de as te dekken die `pr-5.3d-onderzoeksrapport.md` binnen de
emulator al verkende (CDP `setOffline` vs. `route.abort`) en die op een
echt apparaat/echte backend niet automatisch hetzelfde hoeft te zijn.

### C.2 — Role-matrix-UI op staging (verplicht onderdeel van 5.5c)

`docs/pr-5.5-plan.md` §D noemt role-matrix-UI expliciet als acceptatie-
criterium — dit is niet optioneel naast §C.1. Hergebruikt de rolindeling van
`v2/tests/e2e-auth/role-matrix-ui.spec.ts` (emulator), nu tegen staging:

1. **Positieve test**: log in met een account dat `organizationOwner`,
   `organizationAdmin` of `coach` is (account A, of nodig via §B.2 een
   derde account uit met rol `coach`) en bevestig dat Settings/Roster/
   Game-opzet-velden daadwerkelijk opslaan (niet alleen "geen foutmelding"
   — herlaad en controleer dat de wijziging beklijft).
2. **Negatieve test**: nodig via §B.2 een account uit met rol `viewer` (of
   hergebruik account B als je die rol daar al koos) en bevestig dat
   Settings/Roster-opslaan **uitgeschakeld** is en de read-only-indicator
   zichtbaar is — een viewer mag géén schrijfactie kunnen voltooien, ook
   niet per ongeluk via een niet-uitgeschakelde knop.
3. Voer beide (positief + negatief) uit op minstens één van de twee
   platforms uit §C.1 — niet per se alle 4 runs, maar minstens één keer
   werkelijk waargenomen, niet aangenomen.

Herhaal dit protocol op zowel iOS als Android — zie §A punt 3: beide zijn
verplicht, niet "indien mogelijk". Safari/iPadOS-specifiek gedrag
(service-worker-caching) blijft daarnaast een apart, nog open aandachtspunt
voor PR 8.1; een eerste signaal hier is nuttig maar vervangt PR 8.1 niet.

## D. Werkelijke Firestore-verbruiksmeting (inclusief deletes)

Herhaal, tegen de echte staging-backend, dezelfde synthetische flows als
`firebase/tests/rules/pilot-reads-writes-accounting.spec.ts` (emulator-
proxy, zie `docs/pr-5.4-onderzoeksrapport.md` §B: 15 reads/7 writes per
volledige run):

1. live-deliver binnen hetzelfde team;
2. twee verschillende organisaties parallel;
3. bewust conflict op hetzelfde veld;
4. niet-conflicterende veldpatches;
5. **deletes** — expliciet niet in de emulator-proxy meegenomen: voer de
   opruimstap uit §B.2 punt 8 (`firebase firestore:delete --recursive`) uit
   en noteer het aantal verwijderde documenten (zichtbaar in de
   CLI-uitvoer) plus de daaropvolgende readback-bevestiging.

Meet **vóór** en **na** elke flow (niet alleen achteraf in totaal) via de
Firebase Console (Firestore → Gebruik-tab) of Google Cloud Console
(Firestore-metrics): reads, writes, deletes, en opslag in bytes. Vergelijk
de gemeten delta per flow met de emulator-extrapolatie. Leg de uitkomst
vast in `docs/pr-5.5-onderzoeksrapport.md` §B.2.

## E. Rapportage

Verwerk de resultaten van §C en §D in `docs/pr-5.5-onderzoeksrapport.md`:
per run (platform, rondenummer 1 of 2) en per stap verwacht vs. waargenomen
(met schermafbeeldingen/video indien mogelijk), de role-matrix-UI-uitkomst,
en de verbruiksmeting inclusief deletes en vergelijking met de emulator-
extrapolatie. Rapporteer vóórdat een besluit wordt genomen over het
voorwaardelijke IndexedDB-outbox-traject uit
`docs/pr-5.3d-onderzoeksrapport.md` §G (dat traject wordt alleen gestart als
hetzelfde faalpatroon dat op de emulator werd opgelost, hier op een echt
apparaat/echte backend terugkeert).
