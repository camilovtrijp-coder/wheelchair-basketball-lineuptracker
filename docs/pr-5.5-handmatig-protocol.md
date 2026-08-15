# Handmatig protocol — PR 5.5c (iOS/Android-validatie + stagingverbruik)

Status: voorbereid in PR 5.5b-activatievoorbereiding (aug. 2026), **nog niet
uitgevoerd**. Dit document beschrijft exact wat een mens met een mobiel
apparaat moet doen zodra de v2-staging-Netlify-site en het staging-Firebase-
project (PR 5.5b-activatie) daadwerkelijk live staan. Er is bewust geen code
of test in deze PR die dit protocol al uitvoert — dat kan pas ná activatie,
en niet vanuit deze (sandbox)omgeving, die geen fysiek mobiel apparaat heeft.

Zie `docs/pr-5.5-plan.md` §C 5.5c voor de plek van dit protocol in de PR-
volgorde, en `docs/pr-5.4-onderzoeksrapport.md` §C voor de drie open punten
die dit protocol afsluit.

## A. Voorwaarden vóór je begint

1. PR 5.5b-activatie is voltooid: een echt staging-Firebase-project bestaat,
   de Firestore Rules zijn ernaartoe gedeployed, en de v2-Netlify-site is
   gekoppeld en heeft minstens één succesvolle deploy (Deploy Preview of de
   production-branch-deploy — beide gebruiken staging-Firebase, zie
   `v2/netlify.toml`).
2. Je hebt de deploy-URL bij de hand (Netlify geeft die na elke build).
3. Je hebt een mobiel apparaat (telefoon/tablet, iOS én Android indien
   mogelijk) met een browser en, voor het PWA-gedeelte, de mogelijkheid om
   de site "toe te voegen aan beginscherm".
4. Je hebt **geen** Firebase-service-accountkey nodig voor dit protocol — zie
   §B hieronder voor hoe testaccounts/data zonder zo'n sleutel ontstaan.

## B. Testaccounts en fictieve stagingdata aanmaken — zonder service-accountkey

`firebase/scripts/seed.ts` (de bestaande emulator-seeder) mag **niet** tegen
het staging-project draaien — het script weigert dit nu ook expliciet (zie
de guard bovenaan het bestand): het genereert bij elke run een wegwerp-
zelfondertekend sleutelpaar dat alleen de Emulator Suite accepteert (die
verifieert geen handtekeningen); een echte Google-backend zou dat sowieso
afwijzen. Een variant die wél tegen staging zou werken, vereist een
gedownloade Firebase-service-accountkey (JSON) — een gevoelig credential dat
we bewust niet in deze sessie/repo willen aanmaken, opslaan of hanteren (zie
AGENTS.md over geheimen).

In plaats daarvan: gebruik de app zelf, precies zoals een echte gebruiker
dat zou doen. Dat is toch al de meest realistische manier om dit protocol
uit te voeren (het bewijst tegelijk dat de signup-/onboardingflow op een
echte backend werkt, niet alleen tegen de emulator):

1. Open de staging-deploy-URL in een gewone browser (desktop mag voor deze
   stap, hoeft niet het mobiele apparaat te zijn).
2. Registreer een testaccount via het gewone inschrijfformulier. Gebruik een
   duidelijk fictief e-mailadres (bijv. `pilot-5.5c+<jouwnaam>@example.test`
   — het `.test`-domein is gereserveerd voor documentatie/testdoeleinden en
   levert dus nooit echte mail af); een wachtwoord naar keuze.
   - E-mailverificatie: als de staging-Firebase-Auth-configuratie
     verificatiemails verstuurt, gebruik dan een e-mailadres dat je
     daadwerkelijk kunt lezen (of schakel verificatie tijdelijk uit in de
     Firebase Console → Authentication-instellingen voor het testaccount).
3. Doorloop de onboardingflow: eerste organisatie + team aanmaken via de
   UI (`onboarding-org-name`/`onboarding-team-name`-formulier, hetzelfde pad
   als `bootstrap-first-org.spec.ts` in de e2e-suite).
4. Vul via de Roster-tab een paar fictieve spelers in (naam, rugnummer,
   klasse) — expliciet gemarkeerd als fictief in de naam, bijv. "Fictief
   Speler Eén", zodat niemand deze data ooit voor echt aanziet.
5. Vul via de Settings-tab een teamnaam en de overige instellingen in.
6. Wil je een tweede rol (bijv. scorer/viewer) testen: nodig een tweede
   fictief e-mailadres uit via de bestaande uitnodigingsflow — geen tweede
   handmatige signup nodig.
7. **Opruimen na afloop**: verwijder het testaccount/de testorganisatie via
   de Firebase Console (Authentication → gebruiker verwijderen; Firestore →
   de betreffende documenten verwijderen) zodra het protocol is afgerond, of
   laat ze staan als herbruikbare vaste staging-testdata — leg de keuze vast
   in `docs/pr-5.5-onderzoeksrapport.md` §B.1.

Dit levert dezelfde soort fictieve, duidelijk gelabelde data op als
`firebase/scripts/seed.ts` doet voor de emulator — alleen via de UI in
plaats van via een script, en zonder dat er ooit een service-accountkey
nodig is geweest.

## C. Handmatig reproductieprotocol — echt mobiel apparaat, tegen staging

Aangepast van `docs/pr-5.3d-onderzoeksrapport.md` §F: dat protocol liep tegen
een lokale/emulator-buildomgeving; dit hier loopt tegen de echte staging-
Netlify-deploy + echte staging-Firestore, wat destijds bewust als open vraag
is blijven staan ("of dit ook op een echt apparaat/tegen productie-Firestore
optreedt").

1. Open de staging-deploy-URL op het mobiele apparaat.
2. Log in met het testaccount uit §B (of registreer er ter plekke een via
   het mobiele apparaat zelf — ook een geldige test van de signup-flow op
   mobiel). Beantwoord "vertrouwd apparaat" met **ja**, zodat settings/
   roster persistent gecachet worden. Open het team zodat settings/roster
   daadwerkelijk gecachet raken.
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
8. Log op een tweede apparaat/browser in als een ander teamlid met dezelfde
   context en controleer of de nieuwe teamnaam daar verschijnt (tweede-
   client-readback, nu tegen echte staging-Firestore in plaats van de
   emulator — zie ook PR 7.1c's `game-sync-second-client-readback.spec.ts`
   voor het emulator-equivalent).
9. Herhaal stap 3–7 minstens twee keer, met verschillende manieren van
   "offline gaan" (wifi-uit vs. vliegtuigmodus vs. daadwerkelijk buiten
   bereik) — dat is exact de as die `pr-5.3d-onderzoeksrapport.md` binnen de
   emulator al verkende (CDP `setOffline` vs. `route.abort`) en die op een
   echt apparaat/echte backend niet automatisch hetzelfde hoeft te zijn.

Herhaal dit protocol op zowel iOS als Android indien beide apparaten
beschikbaar zijn — Safari/iPadOS-specifiek gedrag (service-worker-caching)
is bewust een apart, nog open aandachtspunt voor PR 8.1, maar een eerste
signaal hier is nuttig.

## D. Werkelijke Firestore-verbruiksmeting

Herhaal, tegen de echte staging-backend, dezelfde synthetische flows als
`firebase/tests/rules/pilot-reads-writes-accounting.spec.ts` (emulator-
proxy, zie `docs/pr-5.4-onderzoeksrapport.md` §B: 15 reads/7 writes per
volledige run):

1. live-deliver binnen hetzelfde team;
2. twee verschillende organisaties parallel;
3. bewust conflict op hetzelfde veld;
4. niet-conflicterende veldpatches.

Lees na afloop de daadwerkelijke reads/writes/opslag af via de Firebase
Console (Firestore → Gebruik-tab, of Google Cloud Console → Firestore-
metrics) en vergelijk met de emulator-extrapolatie. Leg de uitkomst vast in
`docs/pr-5.5-onderzoeksrapport.md` §B.2.

## E. Rapportage

Verwerk de resultaten van §C en §D in `docs/pr-5.5-onderzoeksrapport.md`:
per stap verwacht vs. waargenomen (met schermafbeeldingen/video indien
mogelijk), en de verbruiksmeting inclusief vergelijking met de emulator-
extrapolatie. Rapporteer vóórdat een besluit wordt genomen over het
voorwaardelijke IndexedDB-outbox-traject uit
`docs/pr-5.3d-onderzoeksrapport.md` §G (dat traject wordt alleen gestart als
hetzelfde faalpatroon dat op de emulator werd opgelost, hier op een echt
apparaat/echte backend terugkeert).
