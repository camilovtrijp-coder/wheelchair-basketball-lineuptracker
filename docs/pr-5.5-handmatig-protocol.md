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
   owner/editor) en kunt op je eigen machine vanuit `firebase/` interactief
   `npx firebase-tools login` uitvoeren. Dat is alleen nodig voor de begrensde
   delete-meting en vereist geen service-accountkey.
6. Je hebt **drie echt bereikbare e-mailadressen** die jij zelf kunt lezen
   (bijv. drie `+`-aliassen van hetzelfde testaccount). Account A wordt owner,
   account B organizationAdmin voor de tweede-client-readback, en account C
   expliciet team-viewer voor de negatieve role-matrix-test. Zie §B voor
   waarom `@example.test` hier niet volstaat.

## B. Testaccounts en fictieve stagingdata aanmaken — zonder service-accountkey

`firebase/scripts/seed.ts` (de bestaande emulator-seeder) mag **niet** tegen
het staging-project draaien — het script weigert dit nu ook expliciet (zie
`assertEmulatorEnv()` bovenaan het bestand, met een eigen unit-test in
`firebase/tests/unit/assertEmulatorEnv.spec.ts`): het genereert bij elke run
een wegwerp-zelfondertekend sleutelpaar dat alleen de Emulator Suite
accepteert (die verifieert geen handtekeningen); een echte Google-backend
zou dat sowieso afwijzen. Een Admin-seeder voor staging zou verhoogde
beheerrechten en bijbehorende credentials vereisen. Die route gebruiken we
bewust niet: er wordt geen service-accountkey aangemaakt, opgeslagen of
gehanteerd (zie AGENTS.md over geheimen).

In plaats daarvan: gebruik de app zelf waar daarvoor een productpad bestaat,
en leg de ontbrekende staging-fixtures expliciet via de Firebase Console aan.
Er zijn drie accounts nodig: owner A, organizationAdmin B en team-viewer C.
Dat onderscheid is verplicht: alleen organizationOwner/organizationAdmin
hebben impliciet toegang tot ieder team; coach/scorer/viewer hebben volgens
`firebase/firestore.rules` en `v2/src/domain/organizations/teamAccess.ts`
een expliciet `teamMembers/{uid}`-document nodig.

### B.1 — Account A (owner) aanmaken

1. Open de staging-deploy-URL in een gewone browser (desktop mag voor deze
   stap, hoeft niet het mobiele apparaat te zijn).
2. Registreer een testaccount met een **echt door jou leesbaar** e-mailadres
   (zie §A punt 6). Gebruik geen `@example.test` en geen echte spelers- of
   klantdata. De huidige `signUp()`-implementatie verstuurt niet automatisch
   een verificatiemail; voor owner A is verificatie niet nodig om de eerste
   organisatie en het eerste team aan te maken. Account B wordt hieronder
   via het uitnodigingsscherm wél aantoonbaar geverifieerd.
3. Doorloop de onboardingflow: eerste organisatie + team aanmaken via de UI
   (`onboarding-org-name`/`onboarding-team-name`-formulier, hetzelfde pad
   als `bootstrap-first-org.spec.ts` in de e2e-suite). Dit account is
   automatisch `organizationOwner`.
4. Vul via de Roster-tab een paar fictieve spelers in (naam, rugnummer,
   klasse) — expliciet gemarkeerd als fictief in de naam, bijv. "Fictief
   Speler Eén", zodat niemand deze data ooit voor echt aanziet.
5. Vul via de Settings-tab een teamnaam en de overige instellingen in.

### B.2 — Account B als organizationAdmin uitnodigen en laten claimen

De app heeft géén scherm of knop om een uitnodiging te *versturen* — alleen
`AcceptInvitationScreen` (accepteren/claimen) bestaat client-side; het
aanmaken van een `organizations/{orgId}/invitations/{invitationId}`-document
gebeurt in de bestaande code-/testbasis uitsluitend via `firebase/scripts/seed.ts`
(Admin SDK, alleen emulator) of via directe Rules-tests. Voor staging is er
dus geen kant-en-klaar UI-pad — dat moet je hier expliciet via de Firebase
Console doen, als bewuste, gedocumenteerde uitzondering:

1. Noteer het `uid` van account A: Firebase Console → Authentication →
   Users-tabblad → kopieer het "User UID" van account A.
2. Noteer `orgId` en `teamId` via Firebase Console → Firestore Database:
   het document-ID onder `organizations` is `orgId`; het document-ID onder
   `organizations/<orgId>/teams` is `teamId`. De gewone contextwisselaar zet
   deze IDs niet in de URL; neem ze dus niet over uit een veronderstelde URL.
3. Firebase Console → Firestore Database → navigeer naar
   `organizations/<orgId>/invitations` → **Document toevoegen** met een
   zelfgekozen document-ID (bijv. `inv-pilot-b`) en exact deze velden (zie
   `firebase/src/documents/invitation.ts` `InvitationDocument` voor het
   schema):
   - `email` (string) = het echte e-mailadres van account B (zie §A punt 6);
   - `role` (string) = `"organizationAdmin"`; deze rol heeft impliciet
     toegang tot het team en kan daardoor in iedere §C.1-run als onafhankelijke
     tweede client de gewijzigde teamnaam teruglezen;
   - `status` (string) = `"pending"`;
   - `invitedBy` (string) = het uid van account A uit stap 1;
   - `invitedAt` (timestamp) = nu;
   - `acceptedAt` (null).
4. **Belangrijk voorbehoud**: deze Console-write omzeilt de Firestore Rules
   volledig (zoals elke Console-write) — dit bewijst dus NIET dat
   `invitations`-`create` via de Rules werkt voor een owner/admin. Dat is al
   afzonderlijk gedekt door geautomatiseerde Rules-tests
   (`firebase/tests/rules/bootstrap-and-invitation-flow.spec.ts`, tegen de
   emulator). Deze stap is uitsluitend testfixture-voorbereiding — het punt
   dat dit protocol wél test, is of *accepteren en claimen* via de echte
   staging-Rules werkt, wat vanaf hier via de gewone app-UI gebeurt.
5. Bouw de accept-link handmatig op:
   `<staging-deploy-URL>/?orgId=<orgId>&invitationId=<document-ID uit stap 3>`
   (zie `v2/src/infrastructure/invitations/invitationLink.ts` voor het
   parameterformaat).
6. Open de accept-link uit stap 5 in een ander browserprofiel terwijl je niet
   als A bent ingelogd. Registreer account B daar met exact het e-mailadres
   uit het invitation-document.
7. `AcceptInvitationScreen` ziet dat B nog niet geverifieerd is. Druk daar
   expliciet op **Verificatiemail opnieuw versturen**; alleen die knop roept
   in de huidige app `sendVerificationEmail()` aan. Open de ontvangen link,
   keer terug naar staging en herlaad de app of log opnieuw in zodat het
   vernieuwde `email_verified`-token wordt gelezen.
8. Open zo nodig de accept-link opnieuw en accepteer/claim de uitnodiging.
   Controleer daarna dat B dezelfde organisatie en hetzelfde team kan kiezen.
   Deze normale app-flow bewijst accept+claim tegen de echte staging-Rules.

### B.3 — Account C als expliciete team-viewer aanmaken

Een organization-brede rol `viewer` is niet genoeg om het team in de
contextwisselaar te activeren. Maak daarom een echte team-only fixture:

1. Registreer account C in een derde browserprofiel met het derde adres uit
   §A. Maak in het onboarding-scherm geen nieuwe organisatie aan.
2. Noteer C's UID via Firebase Console → Authentication → Users.
3. Voeg via Firebase Console exact dit document toe:
   `organizations/<orgId>/teams/<teamId>/teamMembers/<uid-van-C>`.
4. Gebruik exact deze velden, conform
   `firebase/src/documents/teamMember.ts` `TeamMemberDocument`:
   - `role` (string) = `"viewer"`;
   - `email` (string) = het e-mailadres van C;
   - `uid` (string) = exact C's UID en exact gelijk aan het document-ID;
   - `addedAt` (timestamp) = nu.
5. Herlaad als C. Controleer dat uitsluitend het bedoelde team verschijnt en
   voer daarmee de negatieve test uit §C.2 uit. Deze Console-write is opnieuw
   alleen fixturevoorbereiding en geen bewijs van een client-side create.

### B.4 — Fixtures bewaren en veilig opruimen

1. Bewaar A/B/C en de hoofdorganisatie bij voorkeur als vaste, fictieve
   staging-fixtures. Noteer org-ID, team-ID, UID's en rollen in het rapport,
   maar nooit wachtwoorden of verificatielinks.
2. Meet deletes met een **apart, herkenbaar wegwerppad** en niet door de
   herbruikbare hoofdorganisatie te verwijderen; zie §D punt 5.
3. Als later toch recursief wordt opgeruimd: de alias `staging` in
   `firebase/.firebaserc` wijst inmiddels naar het echte staging-project
   (`wheelchair-basketball-tracker`, sinds de 5.5b-activatie). Bevestig dat
   vóór uitvoering ter controle alsnog met `npx firebase-tools projects:list`
   en vergelijk met de project-ID in de Firebase Console — een verkeerd
   ingerichte alias mag nooit stilzwijgend worden vertrouwd bij een
   destructieve operatie.
4. Controleer vóór uitvoering letterlijk zowel de project-ID als het
   volledige documentpad. Voer daarna vanuit `firebase/` uit:
   `npx firebase-tools firestore:delete organizations/<orgId> --recursive --project staging`
   (of expliciet `--project wheelchair-basketball-tracker` als extra
   controle op de alias).
5. De gebruikte Firebase CLI heeft geen opdracht `firestore:get`. Verifieer
   daarom handmatig in de Firebase Console dat het parentdocument én de
   verwachte subcollections niet meer bestaan. Verwijder testaccounts apart
   via Authentication → Users; een Firestore-delete verwijdert Auth-users
   niet automatisch.

Dit levert dezelfde soort fictieve, duidelijk gelabelde data op als
`firebase/scripts/seed.ts` doet voor de emulator — via normale appflows waar
die bestaan en via expliciet gemarkeerde Console-fixtures waar de app nog
geen beheer-UI heeft, zonder dat er ooit een service-accountkey nodig is.

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
2. Log in met het bestaande account A uit §B.1. Maak voor deze rondes geen
   nieuw owneraccount of nieuwe organisatie aan. Beantwoord
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
criterium — dit is niet optioneel naast §C.1. Dit hergebruikt de rolindeling van
`v2/tests/e2e-auth/role-matrix-ui.spec.ts` (emulator), nu tegen staging:

1. **Positieve test**: log in als owner A (of organizationAdmin B) en
   bevestig dat Settings/Roster/
   Game-opzet-velden daadwerkelijk opslaan (niet alleen "geen foutmelding"
   — herlaad en controleer dat de wijziging beklijft).
2. **Negatieve test**: log in als de expliciete team-viewer C uit §B.3 en
   bevestig dat
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
5. **deletes** — expliciet niet in de emulator-proxy meegenomen:
   - maak via de Firebase Console een apart, uniek wegwerppad aan, bijvoorbeeld
     `organizations/delete-measurement-<datum-tijd>`, met minstens één
     fictief childdocument eronder; gebruik nooit de A/B/C-hoofdorganisatie;
   - noteer vóór uitvoering de letterlijke staging-project-ID en het
     volledige wegwerppad en bevestig de project-ID met
     `npx firebase-tools projects:list` — de alias `staging` in
     `firebase/.firebaserc` wijst naar `wheelchair-basketball-tracker`;
   - voer vanuit `firebase/` uit:
     `npx firebase-tools firestore:delete organizations/delete-measurement-<datum-tijd> --recursive --project staging`;
   - noteer het aantal verwijderde documenten uit de CLI-uitvoer en verifieer
     daarna in de Firebase Console dat het wegwerppad en zijn subcollections
     verdwenen zijn. Gebruik niet de niet-bestaande opdracht
     `firebase firestore:get`.

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
