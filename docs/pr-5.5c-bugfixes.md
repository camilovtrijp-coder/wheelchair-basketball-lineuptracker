# Bugfixes — gevonden tijdens 5.5c-handmatige staging-validatie

Status: **verzamelfase, nog geen fixes toegepast.** Dit document verzamelt
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

### 2. Geen zichtbare bevestiging bij "Opslaan" op Roster/Settings

**Symptoom**: na het klikken op "Opslaan" op de Team-tab (en vermoedelijk
Instellingen) verschijnt geen duidelijke succes- of foutmelding.

**Oorzaak**: `RosterPanel.handleSave()` (`v2/src/ui/roster/RosterPanel.tsx`)
roept `onSave()` aan, die optimistisch `{ ok: true }` teruggeeft vóórdat de
Firestore-serverbevestiging binnen is (`FirestoreRosterRepository.write()`).
Een écht mislukte schrijfactie wordt pas zichtbaar via een aparte, globale
"actie-nodig"-indicator — niet inline op de Roster-tab zelf. De inline
foutmelding (`rosterSaveError`) triggert in de praktijk vrijwel nooit voor
Firestore-writes.

**Impact**: UX-gebrek, geen functioneel dataverlies — de save lukt in de
praktijk wel, de gebruiker weet het alleen niet zeker.

**Gevonden via**: zelfde sessie als bug 1.

**Status**: open, nog niet gefixt.

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

**Status**: open, nog niet gefixt.

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

**Status**: open, nog niet gefixt. Root cause bevestigd via codeonderzoek
én empirisch: uitloggen en met een verse login opnieuw inloggen (nieuw
ID-token) liet "Uitnodiging accepteren" alsnog slagen — account B kwam
daarna via "Lidmaatschap voltooien" succesvol tot bij de context-
wisselaar ("ROBA test"). Structurele fix (bijv. een expliciete
`getIdToken(true)`-refresh na e-mailverificatie, vóór de accept-write)
nog niet toegepast.

## Nog te doen

- Meer bugs toevoegen naarmate het 5.5c-protocol verder wordt uitgevoerd
  (§B.2/§B.3 account B/C, §C.1 offline/reload, §C.2 role-matrix-UI, §D
  verbruiksmeting).
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
