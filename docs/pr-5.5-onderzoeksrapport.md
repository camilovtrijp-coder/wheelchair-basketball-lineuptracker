# Onderzoeksrapport — PR 5.5 (staging-activatie en handmatige validatie)

Status: **afgerond — 5.5's acceptatiefase is door de eigenaar gesloten
verklaard (16 aug. 2026).** Eén bewust, expliciet open punt: de iOS-poot
van het 2/2-protocol (§B.4) is niet uitgevoerd — de eigenaar heeft geen
Apple-apparaat beschikbaar. Dit blokkeert de sluiting van 5.5 niet; het
blijft apart bijgehouden totdat er alsnog een iOS-apparaat beschikbaar is
(zie §C). Uitgevoerd 15–16 augustus 2026, door de eigenaar
(camilovtrijp-coder) met begeleiding van Claude, op de échte staging-
Firebase-backend (`wheelchair-basketball-tracker`) en de échte v2-Netlify-
staging-site — geen emulator.

Zie `docs/pr-5.5-plan.md` §C (5.5b/5.5c-scope) en
`docs/pr-5.5-handmatig-protocol.md` (het uitgevoerde protocol) voor de
volledige context.

## A. Scope

Dit rapport dekt:
- **5.5b-activatie** (volledig): het echte staging-Firebase-project
  aanmaken, Firestore + Authentication inschakelen, Rules/indexes
  deployen, de v2-Netlify-site aanmaken/koppelen, twee build-bugs fixen
  (`#59`), toegangsbeperking instellen.
- **5.5c** (grotendeels): §B (testaccounts A/B/C/D), §C.1
  (offline/reload-protocol — **Android 2/2, iOS niet uitgevoerd**), §C.2
  (role-matrix-UI, positief + negatief), §D (werkelijke
  Firestore-verbruiksmeting inclusief deletes).

Datum: 15–16 augustus 2026. Uitgevoerd door: de eigenaar, op eigen
Android-toestel + desktop Chrome, begeleid stap voor stap door Claude
(inclusief live codeonderzoek bij onverwacht gedrag — zie §C en
`docs/pr-5.5c-bugfixes.md`).

## B. Bevindingen

### B.1 — Staging-activatie (Firebase-project, Netlify-site, eerste Deploy Preview)

**Firebase**
- Project-ID: `wheelchair-basketball-tracker` (eigenaar-aangemaakt, niet de
  placeholder `demo-lineup-tracker-staging` — `firebase/.firebaserc`'s
  `staging`-alias hierop bijgewerkt in #58).
- Firestore Database aangemaakt (regio `eur3`, default-database).
- Authentication → e-mail/wachtwoord ingeschakeld.
- Rules + indexes gedeployed vanaf de repo (`firebase deploy --only
  firestore:rules,firestore:indexes --project wheelchair-basketball-tracker`),
  lokaal bevestigd geslaagd (compileerde zonder fouten, gepubliceerd).

**Netlify**
- Nieuwe, aparte site: `basketball-tracker-staging` (los van de bestaande
  v1-site `lineuptracker`), gekoppeld met Netlify's monorepo-wizard
  ("Project to deploy: v2").
- Eerste deploy-poging faalde tweemaal (zie #59): (1) `npm run build`
  vond geen build-script omdat Netlify's monorepo-detectie de working
  directory niet naar `v2/` verplaatst maar op de repo-root blijft
  draaien, terwijl de root npm-workspaces gebruikt — gefixt met
  `--workspace=v2`; (2) `publish = "dist"` bleek daardoor ook root-
  relatief opgelost te worden (niet packagePath-relatief zoals
  aangenomen) — gefixt naar `publish = "v2/dist"`. Beide fixes lokaal
  geverifieerd (`npm run build --workspace=v2` vanaf de repo-root
  produceert `v2/dist/`) en bevestigd via een geslaagde Deploy Preview.
- Geverifieerde, werkende URL: **Deploy Preview van PR #59**,
  `https://deploy-preview-59--basketball-tracker-staging.netlify.app/`
  — hierop is al het onderstaande §B/§C/§D-werk uitgevoerd. **Nog niet
  apart geverifieerd**: een daadwerkelijke `main`-productie-branch-deploy
  (bewust uitgesteld — zie hieronder, "Stop builds").
- Console toont bij een echte Auth-aanroep (`identitytoolkit.googleapis.com`)
  het staging-project-ID `wheelchair-basketball-tracker` — bevestigd
  tijdens het eerste inlogexperiment, niet de emulator.
- PWA-/offline-verificatie: niet als apart puntje getest, maar impliciet
  ruim gedekt door het volledige §C.1-offline/reload-protocol
  (app-shell laadt zonder netwerk, cache/sync-gedrag geobserveerd op een
  echt mobiel apparaat) — zie §B.4.
- Netlify-account/plan: bestaand Free-teamplan ("Camilo"-team), geen
  betaalde upgrade gedaan, consistent met het eerdere besluit in
  `docs/pr-5.5-plan.md` §E.7.
- **Bewuste kostenbeheersing, eigenaarsbesluit 16 aug. 2026**: "Stop
  builds" ingeschakeld voor de v2-site — geen enkele merge naar `main`
  triggert sindsdien automatisch een (credit-kostende) productie-deploy;
  een deploy wordt voortaan alleen nog bewust handmatig getriggerd
  ("Trigger deploy"). Gevolg: de daadwerkelijke `main`-productiedeploy met
  de #59-fixes is nog niet uitgevoerd — dat is een bewuste, nog openstaande
  handeling voor wanneer de eigenaar de "definitieve" (niet aan een PR
  gebonden) staging-URL wil activeren.
- **Toegangsbeperking, eigenaarsbesluit 16 aug. 2026**: Visitor access op
  "Private" gezet (`Production and previews`) — alleen leden van het
  Netlify-team kunnen de site bereiken, ook met de directe URL.

**Testfixtures (drie/vier accounts, geen service-accountkey gebruikt)**

| Account | E-mail | Rol | Context |
|---|---|---|---|
| A (owner) | `camilovtrijp@gmail.com` | `organizationOwner` | Org "ROBA test" (`BUBXgGJQdxB29FRlWb9Y`), team "Rotterdam basketball RSE 1 test" (`YjQsecI4WSWHb9o4r5yK`) |
| B | `camiloboombeach355@gmail.com` | `organizationAdmin` | Zelfde org als A — uitgenodigd via handmatig Firestore-document (`invitations/inv-pilot-b`), geaccepteerd/geclaimd via de echte app-UI |
| C | `camilo355@hotmail.com` | `viewer`, **team-only** | Zelfde team als A/B, via een direct `teamMembers/<uid>`-document — bewust **geen enkel** `organizationMembers`-document, om het pure team-only-codepad te testen |
| D (alleen §D flow 2) | `camilovtrijp+5.5d@gmail.com` | `organizationOwner` | Eigen, aparte org "Verbruikmeting Org B" (`Oq76Lc4sFotiT8LAbtI9`), team "Team B" |

Account B's uitnodiging en account C's teamMembers-document zijn bewust via
de Firebase Console aangemaakt (Rules-bypass, uitsluitend fixture-
voorbereiding) — het daadwerkelijke *accepteren/claimen* liep via de
echte app-UI tegen de echte staging-Rules.

**Keuze fixtures**: bewaard als herbruikbare stagingdata (org "ROBA test"
met A/B/C, org "Verbruikmeting Org B" met D) — niet opgeruimd, met
uitzondering van het losse wegwerppad voor de deletemeting (zie §B.2).

### B.2 — Werkelijke Firestore-verbruiksmeting (inclusief deletes)

Alle 5 synthetische flows uit het protocol zijn uitgevoerd tegen de echte
staging-backend:

1. **Live-deliver binnen hetzelfde team**: twee tabs (account A), wijziging
   in tab 1 verscheen zonder actie in tab 2. Geslaagd.
2. **Twee organisaties parallel**: gelijktijdige writes in "ROBA test"
   (account A) en "Verbruikmeting Org B" (account D) — beide onafhankelijk
   correct bijgewerkt, geen kruisbesmetting. Geslaagd.
3. **Bewust conflict op hetzelfde veld**: twee tabs wijzigden gelijktijdig
   dezelfde teamnaam ("Conflict Alpha"/"Conflict Beta") — consistent,
   deterministisch laatste-schrijver-wint-gedrag, twee keer getest
   (Alpha won één keer, Beta de andere keer), in beide gevallen kwamen
   beide tabs na herlaad op dezelfde waarde uit. Geslaagd, geen corruptie.
4. **Niet-conflicterende veldpatches**: tab 1 wijzigde de teamnaam, tab 2
   gelijktijdig een ander veld (kleur) — na herlaad stonden **beide**
   wijzigingen correct naast elkaar in beide tabs. Geslaagd.
5. **Deletes**: apart wegwerppad `organizations/delete-measurement-20260816-1`
   aangemaakt via de Firebase Console, met een childdocument in een
   `dummy`-subcollectie. Verwijderd vanuit `firebase/` met:
   `npx firebase-tools firestore:delete organizations/delete-measurement-20260816-1
   --recursive --project wheelchair-basketball-tracker` (de `staging`-
   alias werkte hier niet — de lokale clone was nooit ge-`pull`'d ná #58,
   dus de alias wees lokaal nog naar de oude placeholder; met de
   expliciete project-ID werkte het meteen). CLI meldde "Deleted 1 docs";
   Console-readback bevestigde dat het pad **volledig** verdwenen is
   (parent + subcollectie) — het CLI-aantal wijkt af van het werkelijke
   aantal documenten (2), vermoedelijk een tellingseigenaardigheid van de
   tool, maar de daadwerkelijke verwijdering is onafhankelijk bevestigd.

**Metingen (Firebase Console, Firestore → Usage-tab, rollend 24-uurs-totaal)**:

| Moment | Reads | Writes | Deletes |
|---|---|---|---|
| Nulmeting, 16 aug. 15:33 (vóór flow 1) | 393 | 11 | 64 |
| Eindmeting, zelfde dag (ná flow 5 + readback) | 628 | 27 | 64 |
| **Delta** | **+235** | **+16** | **+0 (zie kanttekening)** |

**Kanttekeningen (belangrijk, vooraf al voorzien)**:
- De Console-Usage-tab rapporteert met vertraging en toont een rollend
  24-uurs-totaal, geen per-flow-teller. De gemeten delta (+235/+16) is
  dus een **bovengrens**: het venster overlapt ook met het afronden van
  Android-§C.1-ronde 2 (wifi-uit-sub-run) en het aanmaken van account D/
  Org B, niet uitsluitend de 5 §D-flows.
- De **Deletes-teller bleef op 64 staan** ondanks de bevestigde,
  Console-readback-geverifieerde recursieve delete — vermoedelijk
  dezelfde rapportagevertraging, geen aanwijzing dat de delete niet
  werkte (die is apart, direct in de Console geverifieerd).
- Emulator-referentie (`docs/pr-5.4-onderzoeksrapport.md` §B): 15
  reads/7 writes voor flows 1-4 **samen** (zelf ook al een optelsom, geen
  per-flow-cijfer) — de gemeten bovengrens (235/16) ligt daar ruim boven,
  wat past bij de bredere overlap hierboven, niet bij een op-zichzelf
  verontrustende afwijking van flows 1-4 alleen.

**Conclusie**: zowel de bovengrens-meting als elke redelijke schatting van
het werkelijke 5-flows-aandeel blijft **ruim binnen het gratis
Spark-quotum** (50.000 reads/20.000 writes/20.000 deletes per dag) — geen
escalatie naar PR 8.3 nodig.

### B.3 — Multi-write-queue-trigger

Bevestigd: niet geraakt door 5.5b-activatie/5.5c. Geen enkele wijziging
aan queue-/mergesemantiek is in deze PR's doorgevoerd; de trigger blijft
zoals gepland volgen op multi-tabgebruik of Fase 6 PR 6.2 (zie
`docs/pr-5.4-onderzoeksrapport.md` §C punt 3). Geen actie nodig hier.

### B.4 — Handmatig iOS/Android-protocol (2/2 schone runs per platform)

**Android — 2/2 schoon, bevestigd.** Beide rondes op een echt
Android-toestel, elk met twee sub-runs (vliegtuigmodus én wifi-uit):

| Ronde | Sub-run | Stap 5 (sync-status na offline-write) | Stap 6 (herladen offline) | Stap 7 (reconnect) | Stap 8 (2e-client-readback) | Schoon? |
|---|---|---|---|---|---|---|
| 1 | vliegtuigmodus | "Lokaal beschikbaar - uit cache" na ~3s | "Geen verbinding"/"geen lokale kopie" (geen hang — zie bug 6) | direct "Gesynchroniseerd" | geslaagd (ander apparaat/account) | Ja |
| 1 | wifi-uit | identiek gedrag aan vliegtuigmodus | identiek | identiek | geslaagd | Ja |
| 2 | vliegtuigmodus | "Lokaal beschikbaar - uit cache" na ~3s | opnieuw "geen lokale kopie" (geen hang) | direct "Gesynchroniseerd" | geslaagd | Ja |
| 2 | wifi-uit | consistent met eerdere sub-runs | consistent | consistent | geslaagd | Ja |

Geen enkele run hing onverwacht vast op een laadscherm; elke keer
verscheen in plaats daarvan direct een duidelijke (niet-hangende)
melding. Dat gemelde-in-plaats-van-hangende gedrag is zelf wel een
structurele bevinding — zie bug 6 in `docs/pr-5.5c-bugfixes.md`: een
volledige paginaherlaad terwijl offline kan de lidmaatschapslijst niet
uit cache lezen (eenmalige `getDocs()`, geen persistente listener),
waardoor "geen lokale kopie" verschijnt óók als het onderliggende
teamdocument zelf al gecachet is. Reproduceerbaar bevestigd bij zowel
vliegtuigmodus als wifi-uit, en al eerder ook op desktop Chrome (niet
platformspecifiek). Het reload-hang-patroon uit
`docs/pr-5.3d-onderzoeksrapport.md` §A/§G (de destijds bewust
verkleinde #27-scope) **keerde niet terug** — dit is een ander,
nieuw-gevonden fenomeen, geen bevestiging van het oude risico.

**iOS — niet uitgevoerd.** De eigenaar heeft geen iOS-apparaat. Bewust
gekozen (16 aug. 2026, eigenaarsbesluit) om **niet** een apparaat te
lenen of een cloud-devicetestdienst (bv. BrowserStack) in te zetten, en
in plaats daarvan met alleen Android door te gaan — iOS-dekking blijft
een expliciet **open punt**, zie §C.

**Formele consequentie**: het acceptatiecriterium uit `docs/pr-5.5-plan.md`
§D ("iOS/Android: 2/2 schone runs") is dus **gedeeltelijk** gehaald —
Android-kant volledig bewezen, iOS-kant nog niet.

### B.5 — Role-matrix-UI op staging

**Positieve test**: account A (owner) en account B (organizationAdmin)
konden herhaaldelijk succesvol opslaan — bevestigd na herlaad, tijdens
zowel §C.1 als §D (flows 1, 3, 4). Platform: Android + desktop Chrome.

**Negatieve test**: account C (expliciete team-only viewer) kon **niet**
opslaan — invoervelden `readOnly`, knoppen `disabled`, met een
"Alleen-lezen"-indicator. De autorisatie zelf is correct; de
duidelijkheid van de indicator (staat pas onderaan het paneel, geen
uitleg wat "viewer" betekent) is een aparte, apart vastgelegde bevinding
(bug 5). Platform: desktop Chrome.

## C. Open punten

Van de drie punten die `docs/pr-5.4-onderzoeksrapport.md` §C aan 5.5
overdroeg:

1. **Handmatige iOS/Android-validatie** — **gedeeltelijk gesloten, en zo
   geaccepteerd (eigenaarsbesluit 16 aug. 2026).** Android: 2/2 schoon
   bewezen op een echt apparaat, geen reload-hang. iOS: **blijft
   expliciet, apart open** — geen Apple-apparaat beschikbaar bij de
   eigenaar; bewust niet opgelost via een geleend apparaat of
   cloud-devicetestdienst. De eigenaar heeft besloten dat dit de
   sluiting van 5.5's acceptatiefase niet blokkeert: 5.5 geldt als
   afgerond met dit ene, met naam genoemde openstaande punt. Vervolg:
   alsnog een iOS-ronde draaien zodra er een apparaat beschikbaar is
   (bijv. gecombineerd met PR 8.1's Safari/iPadOS-onderzoek) — geen
   vaste datum, geen blokkade voor verder werk.
2. **Werkelijke Firestore-verbruiksmeting** — **gesloten**, met de
   kanttekening dat de meting een bovengrens is (Console-rapportage-
   vertraging, geen per-flow-isolatie) — zie §B.2. Ruim binnen het gratis
   quotum, geen escalatie nodig.
3. **Multi-write-queue-trigger** — **terecht nog open**, zoals gepland
   niet in 5.5-scope; blijft volgen op multi-tabgebruik of Fase 6 PR 6.2.

**Nieuw in dit rapport**: tijdens de uitvoering van §B/§C/§D zijn **10
losse applicatiebugs** gevonden (missend opslaan-feedback op vrijwel elk
scherm, een structurele offline-herlaad-beperking, een v1-regressie
waarbij teamkleuren nergens meer visueel worden toegepast, en meer) —
volledig vastgelegd met reproductie en root cause in
`docs/pr-5.5c-bugfixes.md` (PR #60, nog niet gefixt, verzamelfase). Geen
van deze bugs blokkeert de kernconclusie van dit rapport (staging werkt,
Rules/rollen/sync functioneren correct), maar ze horen thuis op de
roadmap vóórdat 5.5c als UX-gereed geldt.

Safari/iPadOS-specifiek service-worker-gedrag blijft, zoals steeds al
voorzien, bewust voorbehouden aan PR 8.1 — nu extra relevant omdat het
ook de enige resterende iOS-testdekking bundelt.

## D. Cross-references

- `docs/pr-5.5-plan.md` §C (5.5b/5.5c-scope), §D (acceptatiecriteria),
  §E (eigenaarsbesluiten);
- `docs/pr-5.5-handmatig-protocol.md` (het uitgevoerde protocol);
- `docs/pr-5.5c-bugfixes.md` (PR #60 — de 10 gevonden applicatiebugs,
  root cause en status);
- `docs/pr-5.4-onderzoeksrapport.md` §C (de drie punten die dit rapport
  overneemt) en §B (de emulator-verbruiksextrapolatie waartegen §B.2
  vergelijkt);
- `docs/pr-5.3d-onderzoeksrapport.md` §F/§G (het oorspronkelijke, tegen de
  emulator uitgevoerde protocol en het voorwaardelijke IndexedDB-outbox-
  vervolgtraject — het daar beschreven reload-hang-patroon is in dit
  rapport niet teruggekeerd);
- `docs/IMPLEMENTATION_PLAN.md` §10 (Fase 5) en §12 (Fase 7's
  5.5b-activatie/5.5c-praktijkpoort-gate).
