# Uitvoeringsontwerp PR 8.3c-2b — organisatie verlaten, accountverwijdering en overdracht (domein, applicatie, gateways)

Status (4 oktober 2026): **ontwerp; besluiten B1 t/m B9 genomen door de eigenaar (hij
volgt de aanbevelingen in §I, zie het besluitblok daar).** Dit document bevat geen
productiecode, geen tests en geen Rules-wijziging. Het werkt §4 en §5 (8.3c-2) van
`docs/pr-8.3c-besluitvoorstel.md` uit tot een uitvoerbaar plan voor 8.3c-2b. Het geeft
geen toestemming voor UI-werk (2c), e2e-werk (2d), een deployment, een
productiecutover of een Blaze-/billingkoppeling.

**Rules-basis.** PR #98 (8.3c-2a, Rules voor "organisatie verlaten") is **gemerged**.
Dit ontwerp neemt de Rules en tests daarvan (`firebase/firestore.rules`,
`firebase/tests/rules/leave-organization.spec.ts`, besluitrecord §8.6) als basis; de
regelnummers hieronder verwijzen naar de stand van #98 en kunnen na de Rules-PR met de
termijnen van besluitrecord §8.7 (#103) iets verschoven zijn. **8.3c-2b-i start pas na die
Rules-PR** (besluit eigenaar 6 oktober 2026).

Leesvolgorde gevolgd: `AGENTS.md`, `README.md`, `docs/IMPLEMENTATION_PLAN.md`
(fase 8, 8.3c-rijen), `docs/pr-8.3-plan.md` (§B.5, §C 8.3c, §D, §E, §F),
`docs/pr-8.3c-besluitvoorstel.md` (§1.2, §2.5, §3.4, §4, §5, §8.2–§8.6),
`docs/security-threat-model.md` §7, `firebase/docs/QUERY_CONTRACT.md`, en de code
onder `v2/src/{domain,application,infrastructure,ui}/deletion`,
`v2/src/application/{migration,export}`, `v2/src/infrastructure/organizations`,
`v2/src/infrastructure/auth`, `v2/src/app/{App,AuthGate}.tsx`,
`v2/src/infrastructure/repositories/*`, `v2/src/i18n/strings.ts`,
`firebase/src/security/firestoreAccessMatrix.ts` en `firebase/src/documents/*`.

---

## A. Huidige werking (geverifieerd in de code)

### A.1 Wat de Rules (na #98) toestaan

| Handeling | Regel (branch #98) | Voorwaarde |
| --- | --- | --- |
| Eigen `organizationMembers/{uid}` verwijderen | `firestore.rules:631` | `request.auth.uid == uid` **en** `resource.data.role != 'organizationOwner'` **en** `get(organizations/{orgId}).data.createdBy != request.auth.uid` |
| Eigen `teamMembers/{uid}` verwijderen | `:878` | alleen `request.auth.uid == uid` — geen lidmaatschap, geen rol, geen `resource`-verwijzing |
| Andermans `organizationMembers` verwijderen | `:614` (owner, elke rol), `:647` (admin, nooit een owner) | nooit het eigen document |
| Andermans membership wijzigen (promoveren) | `:642` (owner, ook naar owner), `:653` (admin, nooit naar/van owner) | `uid`-veld onveranderd, nooit het eigen document |
| Eigen uitnodiging verwijderen | `:752` | `email_verified == true` en token-e-mail == `resource.data.email`; **geen ouderdomsgrens** |
| Uitnodiging intrekken | `:693` | owner/admin, alleen vanuit `pending`/`accepted`, `revokedAt == request.time` |
| Eigen membership/teamMembers/uitnodigingen **vinden** | `:1282`, `:1294`, `:1310` | de drie collectionGroup-queries uit `QUERY_CONTRACT.md`; **geen** `exists()` op lidmaatschap, dus ook bruikbaar nádat alle lidmaatschappen weg zijn |

Gevolgen die het ontwerp sturen:

1. **Een owner kan zichzelf nooit verwijderen, ook niet als er meer owners zijn.**
   Hij kan zichzelf ook niet demoveren (`:642` eist `request.auth.uid != uid`). Elke
   owner die wil vertrekken heeft dus altijd een **andere owner** nodig die zijn
   membership verwijdert (§4.2). Er is geen "alleen de laatste owner"-uitzondering
   nodig in de client: de Rules dwingen het al af.
2. **De maker (`createdBy`) kan nooit zelf vertrekken,** ook niet gedemoveerd
   (besluitrecord §8.6 punt 1). Een gedemoveerde maker heeft een owner nodig.
3. **Een organisatie zonder (leesbaar) `createdBy`** — buiten de app ontstaan — laat de
   `get(...).data.createdBy`-evaluatie falen: de self-delete op `organizationMembers`
   wordt dan **voor iedereen** geweigerd (§8.6 punt 4, slot). Hetzelfde geldt als het
   organisatiedocument zelf ontbreekt (bijv. een half uitgevoerde runbookwissing).
   `organizationConverter` (`firebase/src/documents/organization.ts`) gooit bovendien
   bij een ontbrekend `createdBy`, dus een gewone converter-read faalt al vóór de
   write.
4. **Een delete op een niet-bestaand document is niet overal idempotent.** De
   `organizationMembers`-self-delete (`resource.data.role`) en de
   uitnodigings-self-delete (`resource.data.email`) verwijzen naar `resource`; op een
   al verwijderd document is `resource == null` en volgt een weigering. De
   `teamMembers`-self-delete verwijst niet naar `resource` en slaagt dus ook op een
   ontbrekend document. *(Aanname A1, wordt in 2b-i met een emulatortest vastgepind.)*
   Hervatten mag dus nooit "blind opnieuw verwijderen" zijn; het moet uit een verse
   inventaris komen (§B.4).
5. **Een owner kan zonder toestemming een `teamMembers`-document voor elke uid
   aanmaken** (`:860`, `isOrgOwnerOrAdmin && uid == docId`), en een owner/admin kan
   op elk moment een uitnodiging op elk e-mailadres aanmaken. Een eindcontrole is dus
   een momentopname; zie restrisico R3.

### A.2 Wat de v2-code vandaag doet

- **Er bestaat geen enkele code die een lid verwijdert, demoveert of promoveert, en
  geen code die een `teamMembers`-document of uitnodiging aanmaakt.**
  `FirestoreOrganizationGateway` (`v2/src/infrastructure/organizations/`) kent alleen
  de twee eigen-uid-collectionGroup-abonnementen, organisatie-/teamaanmaak, teamlijst,
  toegangscontrole en `getInvitationByLink`/`acceptInvitation`/`claimInvitation`.
  Geverifieerd met `grep` op `organizationMembers`/`teamMembers`/`deleteDoc` in
  `v2/src`. Demotie en verwijdering gebeuren vandaag uitsluitend **buiten de app**
  (Console/Admin), en omzeilen daarmee Rules. Dit is relevant voor de mitigatie van
  §8.6 punt 3 (§B.7).
- **De collectionGroup-query op `invitations.email` heeft nog geen client.** De
  accessmatrix markeert `invitations-collection-group` met
  `clientPending: "8.3c-2: …"`, en `firestoreAccessMatrix.spec.ts` vergrendelt die lijst.
- **Er is geen reauthenticatie en geen `deleteUser()`** in `v2/src`.
  `AuthGateway`/`FirebaseAuthGateway` kennen `signUp`, `signIn`, `signOut`,
  `sendVerificationEmail` en `refreshIdToken`; de enige provider is e-mail/wachtwoord.
- **Uitloggen op een onvertrouwd apparaat** wist via `wipeLocalFirebaseData()`
  (`infrastructure/firebase/firebaseClient.ts`) de IndexedDB-cache en via
  `clearLocalDeviceData()` (`infrastructure/device/clearLocalDeviceData.ts`) een
  expliciete allowlist van `localStorage`-sleutels — **inclusief lokale-modussleutels**
  zoals `SETTINGS_STORAGE_KEY`, `ROSTER_STORAGE_KEY` en `V1_GAMES_STORAGE_KEY`.
- **Patroon dat 2b volgt:** `DeletionRequestCoordinator` +
  `DeletionRequestGateway` + `FirestoreDeletionRequestGateway` (8.3c-1b): een
  application-poort zonder identiteits- of padparameters, uitkomsten als
  discriminated union, gezaghebbende aanroeper via `readAuthoritativeCaller()`, een
  timeout van 8 s met eigen uitkomst `timeout`, readback na elke write, en een aparte
  pure payloadmodule die de Rules-emulatortest rechtstreeks importeert
  (`firebase/tests/rules/deletion-request-gateway-payloads.spec.ts`).
- **Wiring:** `selectRepositories()` bouwt alle cloudcoördinatoren alleen bij
  `authUser && selectedContext && trustedDevice`. Accountverwijdering moet ook werken
  **zonder** gekozen context (iemand die nergens meer lid is) en op een onvertrouwd
  apparaat. 2b levert daarom een losse fabriek; de wiring op `AuthGate`-niveau is 2c
  (§C.4).
- **Er bestaat nergens `getDocsFromServer`** in `v2/src`. Alle bestaande reads mogen
  uit de persistente cache komen. Voor een eindcontrole is dat onacceptabel (§B.5).

### A.3 Omvang van vergelijkbare PR's (voor de knip in §C)

| PR | Inhoud | Diff |
| --- | --- | --- |
| #93 (8.3c-1 deel 1) | Rules + index + matrix + Rules-tests | 15 bestanden, +1829 |
| #94 (8.3c-1b) | domein + coordinator + gateway + converter + tests | 19 bestanden, +2173 |
| #95 (8.3c-1c-i) | wiring + UI + NL/EN + DOM-tests | 26 bestanden, +2114 |
| #96 (8.3c-1c-ii) | e2e-auth + reviewfixes | 9 bestanden, +895 |

---

## B. Ontwerpkeuzes

### B.1 Scope van 2b

**In 2b:** domein (puur, zonder `firebase/*`), application-poorten en coördinatoren,
Firestore-/Auth-gateways in `infrastructure`, accessmatrix en querycontract,
vitest-unit-tests en Emulator-tests die de exacte queries en writes van de gateways
tegen de echte Rules bewijzen. **Niet in 2b:** UI, NL/EN-teksten, App-/AuthGate-
wiring, e2e-auth, Rules-wijzigingen, wijzigingen aan `localStorage`-sleutels, CSV,
export of statistieken.

### B.2 Knip: 2b in drie stukken

Een volledige 2b (twee coördinatoren, overdracht, een nieuwe Auth-gateway, drie
gateways, de queryklant en de bijbehorende tests) schat ik op ruim 4000 regels — bijna
het dubbele van #94, dat al als bovengrens van reviewbaarheid gold. Voorstel, in
uitvoeringsvolgorde:

| Stuk | Inhoud | Waarom apart |
| --- | --- | --- |
| **2b-i — inventaris en organisatie verlaten** | `AccountGateway` + `FirestoreAccountGateway` (de drie collectionGroup-queries, per-organisatiefeiten, de drie self-deletes), `LeaveOrganizationCoordinator`, pure classificatie, lokale onbevestigde-werk-probe, `clientPending` opheffen | Levert het fundament dat 2b-ii en 2b-iii hergebruiken; het eerste en enige stuk dat een client op de nieuwe Rules van #98 zet |
| **2b-ii — accountverwijdering** | `AccountAuthGateway` + `FirebaseAccountAuthGateway` (reauth, `deleteUser`), `AccountDeletionCoordinator` met harde eindpoort en het statusmodel uit §4.4 | Enige stuk dat Firebase Auth raakt en een onomkeerbare actie bevat; verdient een eigen review |
| **2b-iii — overdracht en intrekken** | `OwnershipTransferGateway` + Firestore-implementatie (promoveren, andermans teamMembers/membership verwijderen, openstaande uitnodigingen intrekken), `OwnershipTransferCoordinator` | Enige stuk dat op **andermans** documenten schrijft (andere autorisatievorm: owner-check i.p.v. self-paden) en de mitigatie voor §8.6 punt 3 bevat |

2b-ii hangt alleen af van de *classificatie* "overdracht nodig" uit 2b-i, niet van
2b-iii; 2b-ii en 2b-iii kunnen dus in beide volgordes. Aanbeveling: i → ii → iii,
omdat 2b-ii de eerder bevestigde kern (§E.3) afrondt. Dit is **open besluit B1**.

### B.3 Identiteit en scope: geen identiteit als parameter

Zelfde harde les als de 8.3b-herreview (`callerUid`): geen enkele methode op
`AccountGateway` neemt een uid of e-mail aan. De gateway leest uid en e-mail uit
`getAuth(db.app).currentUser` en `email_verified` uit
`currentUser.getIdTokenResult()` (de **token**-claim waar Rules op steunen, niet
`user.emailVerified`; zie de toelichting bij `AuthGateway.refreshIdToken()`).

Pad-onderdelen (`organizationId`, `teamId`, `invitationId`) die van de UI komen, worden
**nooit rechtstreeks** gebruikt: `leave(organizationId)` zoekt de organisatie eerst op
in een verse inventaris; staat ze daar niet in, dan is de uitkomst `not-a-member` en
volgt er geen enkele write. De self-delete-paden worden in de gateway opgebouwd uit
een inventarisregel plus de eigen uid.

AGENTS.md: "Firestore Rules zijn geen filters". Iedere query in 2b gebruikt
expliciet dezelfde scope als de toegangsregel:

| Query | Scope in de query | Scope in de regel |
| --- | --- | --- |
| `collectionGroup('organizationMembers').where('uid','==',eigenUid)` | eigen uid | `resource.data.uid == request.auth.uid` (`:1282`) |
| `collectionGroup('teamMembers').where('uid','==',eigenUid)` | eigen uid | `:1294` |
| `collectionGroup('invitations').where('email','==',eigenTokenEmail)` | eigen geverifieerde e-mail | `:1310` (vereist `email_verified`) |
| `collection('organizations/{orgId}/organizationMembers')` (ongefilterd, alleen 2b-i facts en 2b-iii) | één organisatie | `isOrgMember(orgId)` — zelfde vorm als de 8.3b-export, bewezen in `organization-export-listing.spec.ts` |
| `collection('organizations/{orgId}/invitations')` (ongefilterd, alleen 2b-iii, owner) | één organisatie | `isOrgOwnerOrAdmin(orgId)` — zelfde vorm als de 8.3b-export |
| `collection('organizations/{orgId}/teams')` (alleen 2b-iii, owner) | één organisatie | `canReadTeam` via `isOrgMember` — zelfde vorm als de 8.3b-export |

Per-organisatie-filtering van een collectionGroup-resultaat gebeurt in de client op
het documentpad (`ref.parent.parent.id`, voor teamMembers twee niveaus hoger). Er komt
**geen nieuwe queryvorm** bij: de drie collectionGroup-queries staan in het contract,
en de ongefilterde org-listings zijn de bewezen 8.3b-vorm. (Een gefilterde
`where('email','==',x)`-query op één organisatie zou goedkoper zijn, maar is een nieuwe
vorm met eigen contract en Rules-test; niet nodig bij de huidige omvang.)

### B.4 Hervatbaarheid zonder persistente staat

**Besluit (binnen mijn mandaat, met onderbouwing): 2b bewaart niets.** Geen nieuwe
`localStorage`-sleutel, geen Firestore-document, geen wijziging aan bestaande
sleutels. Elke stap wordt afgeleid uit een **verse server-inventaris**:

- Elke organisatie-/accountflow begint met dezelfde drie collectionGroup-queries
  (plus per organisatie de feiten uit §B.6). Wat er nog staat, is precies wat er nog
  moet gebeuren. Er is dus geen checkpoint dat kan afwijken van de werkelijkheid.
- Elke stap is daardoor idempotent **op niveau van de flow**, ook waar een losse
  delete dat niet is (§A.1 punt 4): een document dat in de inventaris niet meer
  voorkomt, wordt niet opnieuw verwijderd. Een weigering op een delete leidt tot een
  readback via dezelfde query; is het document weg, dan is de uitkomst
  `already-gone` en geen fout.
- De vaste volgorde (teamMembers → per-organisatie-controle → organizationMembers als
  laatste write) garandeert dat elke tussenstand een **geldige, bruikbare** toestand
  is: zolang het eigen `organizationMembers`-document bestaat, heeft de gebruiker nog
  toegang en kan hij opnieuw starten; is het weg, dan is er voor die organisatie niets
  meer over (dat is bewezen vóór de laatste write).

**Wat er gebeurt als de sessie of het apparaat wegvalt:**

| Moment | Toestand daarna | Hervatten |
| --- | --- | --- |
| Tijdens teamMembers-deletes | sommige teamMembers weg, membership staat | gebruiker is nog lid; opnieuw "verlaten" pakt de rest |
| Na per-org-controle, vóór membership-delete | alleen membership staat | idem |
| Membership-delete in de wachtrij (offline/timeout) | Firestore past de gequeuede delete later toe, in volgorde | volgende inventaris toont de werkelijke toestand |
| Na Firestore-opruiming, vóór `deleteUser()` | ingelogd, inventaris leeg | **afleidbaar**: ingelogd + drie lege queries = "Firestore-data verwijderd, Auth-account nog aanwezig". De gebruiker landt via `deriveAppState` op het geen-organisaties-scherm; 2c biedt daar "account verwijderen" aan |
| `deleteUser()` geslaagd, antwoord kwijt | lokaal mogelijk nog ingelogd | volgende tokenverversing faalt (`auth/user-token-expired`/`auth/user-not-found`); uitkomst `auth-state-unknown`, nooit `deleted` |

**Hervatten na een geslaagde laatste delete (reviewnit #98, toe te passen in 2b-i):** een
tweede "verlaten" nadat het eigen `organizationMembers`-document al weg is, geeft op dat
document `permission-denied` (de Rules lezen het eigen document om de rol te toetsen). De
coördinator moet daarom **eerst teruglezen** (de verse inventaris) en bij een afwezig
membership `already-gone` melden, in plaats van de delete te proberen en een
permission-denied als fout te classificeren.

**Wat je verliest zonder persistentie:** alleen de *intentie* ("ik was mijn account
aan het verwijderen") op een ander apparaat of na een crash. Dat is een UX-gemak, geen
data-integriteitsprobleem: niets wordt ooit als klaar getoond zonder verse
serverbevestiging. Een optionele, per-apparaat intentiesleutel voor een
hervatbanner is **open besluit B5** (aanbeveling: niet bouwen).

### B.5 Eindcontroles alleen van de server

Met `persistentLocalCache` (vertrouwd apparaat) geeft `getDocs()` offline een
gecachet resultaat, en latency compensation laat een nog niet bevestigde delete lokaal
al als verdwenen zien. Een "leeg" resultaat uit de cache bewijst dus niets. Daarom:

- **Alle** inventaris- en controlereads in `FirestoreAccountGateway` gebruiken
  `getDocsFromServer()` / `getDocFromServer()`. Offline faalt die read (`unavailable`)
  en de uitkomst is `offline` — nooit "leeg".
- Een write telt pas als geslaagd na serverbevestiging binnen de timeout én een
  server-readback.

### B.6 Per-organisatiefeiten

Voor elke organisatie waarin de gebruiker een `organizationMembers`-document heeft,
leest de gateway (alle reads van de server):

| Feit | Bron | Waarom |
| --- | --- | --- |
| `exists` | `getDocFromServer(organizations/{orgId})` | ontbrekend document = halve runbookwissing (wees-membership) |
| `createdBy` (`string \| null`) | ruw uit hetzelfde document, **zonder converter** (`typeof === 'string' && length > 0`) | de converter gooit bij ontbreken; de coördinator moet "geen maker" kunnen onderscheiden van "leesfout" |
| `ownerUids` | ongefilterde listing `organizationMembers` van die organisatie | lone owner vs. andere owner aanwezig |
| `deletionRequestStatus` | hergebruik `DeletionRequestGateway.read()` (8.3c-1b) | lopend verwijderverzoek |

Een team-only lid (alleen `teamMembers`) kan het organisatiedocument niet lezen
(`isOrgMember`); voor hem zijn geen feiten nodig, want `teamMembers`-self-delete kent
geen maker- of rolgrens.

Classificatie per organisatie (pure functie `classifyOrganizationForLeave()` in
`v2/src/domain/account/classify.ts`), in deze volgorde:

| Klasse | Voorwaarde | Zelf op te lossen? |
| --- | --- | --- |
| `local-unsynced-work` | onbevestigd lokaal wedstrijdwerk voor deze organisatie op dit apparaat (§B.10) | nee — eerst synchroniseren |
| `organization-missing` | membership bestaat, organisatiedocument niet | nee — runbook |
| `organization-unsupported` | membership bestaat, `createdBy` ontbreekt of is ongeldig | nee — runbook of een owner verwijdert het membership |
| `organization-deletion-failed` | caller is owner, verzoek `failed` | nee — runbook |
| `awaiting-organization-deletion` | caller is owner, verzoek `requested`/`executing` | nee — wachten op uitvoering (§4.4 stap 3) |
| `owner-sole` | caller is owner, geen andere owner | nee — overdragen (§4.2) of verwijderverzoek (§2.5) |
| `owner-awaiting-removal` | caller is owner, er is ≥ 1 andere owner | nee — een andere owner moet het membership verwijderen ("wacht op bevestiging door de nieuwe eigenaar") |
| `creator-needs-owner` | caller is niet-owner maar wel `createdBy` | nee — een owner moet het membership verwijderen (§8.6 punt 1) |
| `leave` | niet-owner, niet de maker | **ja** |
| `leave-team-only` | alleen `teamMembers`-documenten | **ja** |
| `invitations-only` | geen membership, wel eigen uitnodigingen | **ja** (alleen in accountverwijdering) |

Een niet-owner in een organisatie met een lopend verwijderverzoek mag gewoon
vertrekken; de uitkomst draagt dan een informatieve vlag
`organizationDeletionPending: true` (2c kan daarover iets zeggen), geen blokkade.

### B.7 Openstaande uitnodigingen intrekken (mitigatie §8.6 punt 3)

**Feit:** er is vandaag geen app-code die demoveert of verwijdert (§A.2). Wie een
demotie of verwijdering uitvoert, doet dat buiten de app en buiten Rules. Een
client-mitigatie dekt dus alleen de paden die de app zélf bouwt. Ontwerp:

1. **`LeaveOrganizationCoordinator` (2b-i):** de vertrekker verwijdert vóór de laatste
   membership-write zijn **eigen openstaande** (`pending`/`accepted`) uitnodigingen in
   díe organisatie, via de self-deletetak (`:752`). Dat is geen beveiliging tegen een
   kwaadwillende vertrekker (die omzeilt de coördinator), maar sluit het eerlijke pad
   en een onbedoelde herclaim. `claimed`/`revoked` uitnodigingen in die organisatie
   blijven staan bij verlaten (auditwaarde voor de organisatie; owner/admin kunnen ze na
   30 dagen opruimen); bij accountverwijdering gaan ze wél weg. Dit onderscheid is
   **open besluit B3**.
2. **`OwnershipTransferCoordinator.completeTransfer()` (2b-iii):** de enige plek waar
   de app **andermans** membership verwijdert. Vóór de verwijdering trekt de nieuwe
   owner alle `pending`/`accepted` uitnodigingen op het e-mailadres van de vertrekker in
   die organisatie in (`:693`, `revokedAt == request.time`). Het e-mailadres komt uit
   het `organizationMembers`-document van de vertrekker (server-read), niet uit
   invoer.
3. **Herbruikbare gatewaymethode** `revokeOpenInvitationsForEmail(organizationId,
   email)` op `OwnershipTransferGateway`, zodat een toekomstige ledenbeheer-UI
   (demotie/verwijderen, buiten de huidige roadmapscope) hem verplicht kan aanroepen.
4. **Wat 2b niet kan sluiten:** demotie/verwijdering via Console. Daarvoor zijn er twee
   routes, besloten op 6 oktober 2026 (besluitrecord §8.7): een runbookregel ("trek bij
   demotie of verwijdering de openstaande uitnodigingen op dat adres in") én de Rules-
   claimtermijn van 30 dagen na `invitedAt` (Rules-PR #103). De termijn dicht het gat voor
   alle paden behalve het restvenster van uitnodigingen jonger dan 30 dagen.

### B.8 Overdracht als tweestapsflow (§4.2)

Overdracht = **A promoveert B** (`:642`) → **B verwijdert A** (`:614`). Stap 2 is een
handeling van B en bewijst dat B bestaat en kan inloggen.

- **2b-iii levert:** `listTransferCandidates(orgId)` (owner-only, niet-owner-leden van
  die organisatie), `promote(orgId, targetUid)` en `completeTransfer(orgId,
  previousOwnerUid)`. `completeTransfer` voert in vaste volgorde uit: (a) openstaande
  uitnodigingen op het adres van A intrekken (§B.7), (b) A's `teamMembers`-documenten in
  alle teams van de organisatie verwijderen (owner/admin-tak `:868`; teams via de
  bewezen listing, per team een directe `getDocFromServer` op `teamMembers/{A}`), (c)
  A's `organizationMembers`-document als laatste, (d) server-readback. Zonder (b) blijven
  er weesdocumenten met A's uid en e-mail achter (teamMembers dragen ook `email`).
- **"Wacht op bevestiging door de nieuwe eigenaar" is afleidbaar, niet opgeslagen:**
  A is owner én er is ≥ 1 andere owner → klasse `owner-awaiting-removal`. Voor B is
  afleidbaar dat er een andere owner is; de *bedoeling* van A ("ik wil weg") is dat
  niet. 2c moet B dus een expliciete actie geven ("overdracht afronden: verwijder
  {e-mail} als eigenaar"), met bevestigingsdialoog. Owners konden elkaar via Rules al
  verwijderen; de app maakt die bestaande bevoegdheid alleen zichtbaar.
- **Restgat 2 blijft staan bij een overdracht zonder accountverwijdering:** verwijdert B
  een gedemoveerde of nog-owner maker A, dan kan A zich via de bootstrap-create weer
  owner maken (§8.6 punt 4). In de accountverwijderflow is dat moot (A heeft daarna geen
  account), bij een losse overdracht niet. 2b-iii verandert daar niets aan; de Rules-fix
  (bootstrap alleen de eerste 7 dagen na `createdAt`, besluit B6/§8.7, Rules-PR #103)
  laat alleen dat venster van 7 dagen open.
- **2c levert:** de UI voor A (kandidaat kiezen, promoveren, wachtstatus) en voor B
  (afrondactie), NL/EN, dialogen met axe/focus/Escape.

### B.9 Volgorde en eindpoort van accountverwijdering (§4.4)

Volgorde in het ontwerp, met één aanvulling (stap 5'):

1. Voorwaarden: ingelogd; `email_verified`-claim `true` in het token (anders kan de
   derde query niet draaien en is "leeg" onbewijsbaar → uitkomst `email-not-verified`;
   2c kan `sendVerificationEmail` + `refreshIdToken` aanbieden).
2. Inventaris: de drie collectionGroup-queries, van de server.
3. Classificatie per organisatie (§B.6). **Poort vóór de eerste write:** zolang één
   organisatie niet zelf op te lossen is, volgt **geen enkele write** en is de uitkomst
   `needs-action` met het per-organisatieplan. Reden: anders verliest de gebruiker
   toegang tot de oplosbare organisaties terwijl zijn account wekenlang blijft bestaan
   (bijv. wachtend op een verwijderverzoek). Binnen mijn mandaat beslist; zie ook B2.
4. Per organisatie: verlaten via dezelfde stappen als `LeaveOrganizationCoordinator`
   (hergebruik, geen kopie).
5. Alle eigen uitnodigingen verwijderen, elke status, elke ouderdom (`:752`).
6. **Harde eindpoort:** de drie queries opnieuw van de server; alle drie moeten nul
   rijen geven. Anders `incomplete` (hervatbaar) en **geen** reauth/`deleteUser()`.
7. Reauthenticatie (`reauthenticateWithCredential` met `EmailAuthProvider`).
8. **5' — dezelfde eindpoort nogmaals, direct vóór `deleteUser()`.** Verkleint het
   race-venster van R3 tot milliseconden (er kan tussen stap 6 en 7 een minuut zitten
   waarin iemand de gebruiker toevoegt of uitnodigt).
9. `deleteUser(currentUser)` — alleen na drie bewezen lege resultaten uit stap 8.

Statusmodel (exhaustief; de UI in 2c toont **nooit** "account verwijderd" behalve bij
`deleted`):

```text
            ┌───────────────┐   offline / timeout / read-failed   ┌───────────┐
 start ───► │ preconditions │ ──────────────────────────────────► │  stopped  │ (geen write)
            └──────┬────────┘                                     └───────────┘
                   │ ok                     niet zelf op te lossen
                   ▼                       ┌──────────────────────► needs-action (geen write)
            ┌───────────────┐              │
            │   inventory   │ ─────────────┘
            └──────┬────────┘
                   │ alles zelf op te lossen
                   ▼
            ┌───────────────┐  write/readback faalt, timeout
            │ clear-firestore│ ───────────────────────────────────► incomplete (hervatbaar)
            └──────┬────────┘
                   │ eindpoort: 3 × leeg (server)
                   ▼
            ready-for-auth-deletion ── reauth faalt ──► reauth-failed (hervatbaar)
                   │ reauth ok + eindpoort 5' 3 × leeg
                   ▼
            ┌───────────────┐  faalt (requires-recent-login / network / other)
            │  deleteUser   │ ───────────────► firestore-cleared-auth-present (hervatbaar)
            └──────┬────────┘  antwoord onbekend ─► auth-state-unknown
                   ▼
                deleted
```

Uitkomsttype (2b-ii, `application/account/AccountDeletionCoordinator.ts`):

```ts
export type AccountDeletionOutcome =
  | { status: 'not-signed-in' }
  | { status: 'email-not-verified' }
  | { status: 'offline' }
  | { status: 'in-progress' } // tweede gelijktijdige aanroep op deze instantie
  | { status: 'failed'; reason: 'read-failed' }
  | { status: 'needs-action'; plan: AccountDeletionPlan } // er is NIETS geschreven
  | {
      status: 'incomplete'; // er is WEL geschreven; opnieuw starten hervat
      stage: 'team-members' | 'organization-member' | 'invitations' | 'final-gate';
      organizationId: string | null;
      remaining: { organizationMembers: number; teamMembers: number; invitations: number };
    }
  | { status: 'ready-for-auth-deletion' } // eindpoort groen, Auth nog aanwezig
  | {
      status: 'reauth-failed';
      reason: 'wrong-password' | 'too-many-requests' | 'network' | 'other';
    }
  | {
      status: 'firestore-cleared-auth-present'; // "Firestore-data verwijderd, Auth-account nog aanwezig — hervatbaar"
      reason: 'requires-recent-login' | 'network' | 'other';
    }
  | { status: 'auth-state-unknown' } // deleteUser-antwoord kwijt; opnieuw inloggen beslist
  | { status: 'deleted' };
```

Reauthenticatie *ná* de Firestore-opruiming is de letterlijke volgorde van §4.4. Een
nadeel: een gekaapte, open sessie kan iemands lidmaatschappen weghalen zonder ooit het
wachtwoord te kennen, en een gebruiker die zijn wachtwoord vergeten is staat na de
opruiming zonder organisaties. **Open besluit B2:** reauth (ook) vóór de eerste write.

### B.10 Offline en lokaal wedstrijdwerk

AGENTS.md eist dat een volledige wedstrijd zonder netwerk gespeeld en afgerond kan
worden. 2b raakt geen enkel wedstrijdpad, geen sync-logica en geen lock. Verlaten en
accountverwijderen zijn per definitie **online-acties**: ze vereisen
serverbevestigde reads en writes (§B.5). Veilig falen:

- **Offline bij de start:** de eerste `getDocsFromServer()` faalt → `offline`, vóór
  elke write. Geen halve toestand.
- **Verbinding valt weg halverwege:** de lopende write haalt de timeout van 8 s niet →
  `incomplete`/`timeout`; de coördinator stopt en issue't geen volgende write. Een
  gequeuede delete kan later alsnog landen; dat is een delete die we wilden, in de
  juiste volgorde (de membership-delete wordt pas gegeven nádat de per-organisatie-
  controle van de server groen was).
- **Nooit "klaar" zonder serverbewijs:** `ok`/`deleted` zijn alleen bereikbaar na een
  server-eindcontrole.
- **Onbevestigd lokaal werk blokkeert:** een read-only `LocalUnsyncedWorkProbe` telt
  voor een organisatie de bestaande sleutels met prefix
  `PENDING_FINALIZE_STORAGE_KEY_PREFIX + orgId + ':'` (onbevestigde afronding) en
  `ACTIVE_GAME_STORAGE_KEY_PREFIX + orgId + ':'` met een gestarte wedstrijd. Verlaten
  zou die data onsynchroniseerbaar maken (Rules weigeren daarna elke write), dus:
  `local-unsynced-work`, geen write. De probe **leest** alleen via
  `listBrowserStorageKeys()`; hij wijzigt of verwijdert geen sleutel. *(Aanname A2: of
  een actieve-wedstrijdsleutel ook bestaat voor een opgezette maar niet gestarte
  wedstrijd, en hoe "gestart" betrouwbaar af te lezen is, verifieer ik in 2b-i in
  `LocalStorageGameRepository`; zo niet, dan alleen de pending-finalize-sleutel als harde
  blokkade.)* Een onvertrouwd apparaat zonder cloudmodus heeft deze sleutels niet in
  cloudvorm; de probe geeft dan 0.

### B.11 Foutclassificatie

Eén interne mapping in de gateways (zelfde vorm als `FirestoreDeletionRequestGateway`),
nieuwe gedeelde helper `v2/src/infrastructure/firebase/withTimeout.ts` (de bestaande
kopie in de deletiongateway blijft ongemoeid; deduplicatie is een losse opruimtaak):

| Bron | Code | Interne uitkomst |
| --- | --- | --- |
| Firestore | `permission-denied` op een delete | readback: weg → `already-gone`; staat er nog → `rejected` |
| Firestore | `permission-denied` op een read | `read-failed` (en bij de invitations-query zonder geverifieerde claim: `email-not-verified`, vooraf gecontroleerd) |
| Firestore | `unavailable`, `failed-precondition` (offline `FromServer`) | `offline` |
| eigen timeout | — | `timeout` |
| converter | `DocumentValidationError` | `read-failed` — fail closed, geen write, geen `deleteUser` |
| Auth | `auth/requires-recent-login` | `firestore-cleared-auth-present` (reason `requires-recent-login`) |
| Auth | `auth/wrong-password`, `auth/invalid-credential` | `reauth-failed` / `wrong-password` |
| Auth | `auth/too-many-requests` | `reauth-failed` / `too-many-requests` |
| Auth | `auth/network-request-failed` | `reauth-failed`/`network` of `firestore-cleared-auth-present`/`network` |
| Auth | `auth/user-token-expired`, `auth/user-not-found` na een `deleteUser`-poging | `auth-state-unknown` |

Geen uid, e-mail of documentinhoud in een uitkomst-`detail` dat naar de diagnostiek
kan lekken; `detail` blijft `unknown` en wordt nergens gelogd (zelfde discipline als
8.3a).

### B.12 Vertalingen

**2b voegt geen NL/EN-sleutels toe** — zelfde lijn als 8.3c-1b. Coördinatoren geven
alleen getypeerde uitkomsten. 2c krijgt in dit document een vaste mapping-tabel
(uitkomst → sleutel) zodat elke uitkomst een NL- én EN-tekst krijgt; de
sleutelpariteitstest in 2c vangt een vergeten taal. Voorgestelde sleutelgroepen voor
2c (namen indicatief): `leaveOrg*` (titel, bevestiging, per klasse uit §B.6, offline,
timeout, incomplete), `accountDelete*` (plan per organisatie, eindpoort, reauth,
`firestore-cleared-auth-present` met expliciet "je account bestaat nog", `deleted`),
`transfer*` (kandidaat, promoveren, "wacht op bevestiging door de nieuwe eigenaar",
afronden voor B).

---

## C. Uitvoeringsplan per sub-PR

### C.1 2b-i — inventaris en organisatie verlaten

**Domein** (`v2/src/domain/account/`, geen `firebase/*`):

```ts
// types.ts
export interface OwnOrganizationMembershipRef { organizationId: string; role: OrganizationRole }
export interface OwnTeamMembershipRef { organizationId: string; teamId: string; role: OrganizationRole }
export interface OwnInvitationRef {
  organizationId: string; invitationId: string; status: InvitationStatus; role: OrganizationRole;
}
export interface AccountInventory {
  organizationMemberships: OwnOrganizationMembershipRef[];
  teamMemberships: OwnTeamMembershipRef[];
  invitations: OwnInvitationRef[]; // leeg wanneer niet opgevraagd
}
export interface OrganizationFacts {
  organizationId: string;
  exists: boolean;
  createdBy: string | null;
  ownerUids: string[];
  deletionRequestStatus: DeletionRequestStatus | null;
}
export type OrganizationLeaveClass =
  | 'leave' | 'leave-team-only' | 'invitations-only'
  | 'owner-sole' | 'owner-awaiting-removal' | 'creator-needs-owner'
  | 'awaiting-organization-deletion' | 'organization-deletion-failed'
  | 'organization-unsupported' | 'organization-missing' | 'local-unsynced-work';

// classify.ts — puur, volledig unit-testbaar
export function groupInventoryByOrganization(inv: AccountInventory): Map<string, OrganizationSlice>;
export function classifyOrganizationForLeave(input: {
  callerUid: string; slice: OrganizationSlice; facts: OrganizationFacts | null; localUnsyncedWork: number;
}): OrganizationLeaveClass;
export function isSelfResolvable(c: OrganizationLeaveClass): boolean;
export function isInventoryEmpty(inv: AccountInventory, scope?: { organizationId: string }): boolean;
```

**Poort** (`v2/src/application/account/AccountGateway.ts`):

```ts
export type AccountReadError =
  | { code: 'not-signed-in' } | { code: 'email-not-verified' }
  | { code: 'offline' } | { code: 'timeout' } | { code: 'read-failed'; detail: unknown };

export type SelfDeleteResult =
  | { ok: true; outcome: 'deleted' | 'already-gone' }
  | { ok: false; error: { code: 'rejected' } | { code: 'timeout' } | { code: 'offline' }
      | { code: 'not-signed-in' } | { code: 'failed'; detail: unknown } };

export interface AccountGateway {
  /** uid/e-mail uit de Auth-sessie, `email_verified` uit de TOKEN-claim. Geen invoer. */
  readIdentity(): Promise<AccountIdentity | null>;
  /** De drie collectionGroup-queries, ALTIJD van de server. */
  readInventoryFromServer(options: { includeInvitations: boolean }):
    Promise<{ ok: true; inventory: AccountInventory } | { ok: false; error: AccountReadError }>;
  readOrganizationFacts(organizationId: string):
    Promise<{ ok: true; facts: OrganizationFacts } | { ok: false; error: AccountReadError }>;
  deleteOwnTeamMembership(ref: { organizationId: string; teamId: string }): Promise<SelfDeleteResult>;
  deleteOwnInvitation(ref: { organizationId: string; invitationId: string }): Promise<SelfDeleteResult>;
  deleteOwnOrganizationMembership(organizationId: string): Promise<SelfDeleteResult>;
}

// application/account/LocalUnsyncedWorkProbe.ts
export interface LocalUnsyncedWorkProbe { countForOrganization(organizationId: string): number }
```

**`LeaveOrganizationCoordinator`** (`v2/src/application/account/LeaveOrganizationCoordinator.ts`),
afhankelijkheden `AccountGateway`, `DeletionRequestGateway` (alleen via de facts) en
`LocalUnsyncedWorkProbe`:

```text
leave(orgId):
  0  identity == null                                   → not-signed-in
     al een leave voor deze orgId in deze instantie      → in-progress
  1  inventory (server, incl. invitations als verified)  → offline | timeout | failed
     orgId niet in inventory                             → not-a-member   (geen write)
  2  facts (alleen bij org-membership) + probe + classify
     klasse ∉ {leave, leave-team-only}                   → denied(klasse) | blocked(local-unsynced-work)
  3  voor elk eigen teamMembers-doc in orgId: delete     → bij fout: incomplete(team-members)
  4  voor elke eigen pending/accepted uitnodiging in orgId: delete (B3)
                                                         → bij fout: incomplete(invitations)
  5  per-organisatie-controle (server): in orgId geen eigen teamMembers
     en geen open eigen uitnodiging meer                 → anders incomplete(per-org-check)
  6  eigen organizationMembers-doc (indien aanwezig) als LAATSTE write
                                                         → bij fout: incomplete(organization-member)
  7  eindcontrole (server): beide uid-queries, gefilterd op orgId, leeg
                                                         → ok | incomplete(final-check)
```

```ts
export type LeaveOrganizationOutcome =
  | { status: 'not-signed-in' } | { status: 'in-progress' } | { status: 'offline' }
  | { status: 'failed'; reason: 'read-failed' | 'timeout' }
  | { status: 'not-a-member' } // ook: al vertrokken — idempotent
  | { status: 'denied'; reason: 'owner-sole' | 'owner-awaiting-removal' | 'creator-needs-owner'
      | 'organization-unsupported' | 'organization-missing'
      | 'awaiting-organization-deletion' | 'organization-deletion-failed'; otherOwnerCount?: number }
  | { status: 'blocked'; reason: 'local-unsynced-work'; count: number }
  | { status: 'incomplete'; stage: 'team-members' | 'invitations' | 'per-org-check'
      | 'organization-member' | 'final-check'; error?: SelfDeleteResult }
  | { status: 'ok'; removed: { teamMembers: number; invitations: number; organizationMember: boolean };
      organizationDeletionPending: boolean };
```

De kern (stap 3–7) staat in een interne functie die `AccountDeletionCoordinator`
in 2b-ii per organisatie hergebruikt.

**Infrastructuur:**

- `v2/src/infrastructure/account/accountQueries.ts` — pure bouwers zonder Auth:
  `ownOrganizationMembershipsQuery(db, uid)`, `ownTeamMembershipsQuery(db, uid)`,
  `ownInvitationsQuery(db, email)`, `ownTeamMemberRef(db, orgId, teamId, uid)`,
  `ownOrganizationMemberRef(db, orgId, uid)`, `ownInvitationRef(db, orgId, invId)`,
  plus `organizationIdOf(snapshot)`/`teamIdOf(snapshot)`. De Emulator-test importeert
  precies deze bouwers (zelfde patroon als `deletionRequestPayloads.ts`), zodat de
  echte Rules de echte queryvorm beoordelen.
- `v2/src/infrastructure/account/FirestoreAccountGateway.ts` — implementeert de poort;
  `getDocsFromServer`/`getDocFromServer`; converters `organizationMemberConverter`,
  `teamMemberConverter`, `invitationConverter` (en voor `organizations` een ruwe read
  van `createdBy`, zie §B.6); timeout 8 s per call; readback na elke delete.
- `v2/src/infrastructure/account/LocalStorageUnsyncedWorkProbe.ts` — read-only.
- `v2/src/infrastructure/firebase/withTimeout.ts` — gedeelde helper.
- `v2/src/infrastructure/account/createAccountServices.ts` — fabriek
  `(db) => { accountGateway, leaveCoordinator }` voor de wiring in 2c (geen
  `selectedContext` nodig).

**Firebase-pakket:**

- `firebase/src/security/firestoreAccessMatrix.ts`: de twee nieuwe infrastructuurbestanden
  met een padbouwer (`FirestoreAccountGateway.ts`, `accountQueries.ts`) in
  `FIRESTORE_CLIENT_GATEWAY_FILES`; `clientSources` aanvullen op `organization`
  (read), `organization-members` (read, delete), `team-members` (delete), `invitations`
  (delete), `organization-members-collection-group`, `team-members-collection-group` en
  `invitations-collection-group`; **`clientPending` van `invitations-collection-group`
  verwijderen** — daarmee is de lijst `clientPending`-rijen leeg.
- `firebase/tests/unit/firestoreAccessMatrix.spec.ts`: de vergrendelde lijst naar leeg.
- `firebase/docs/QUERY_CONTRACT.md`: de derde query heeft nu een client; eis
  `getDocsFromServer` voor eindcontroles vastleggen.
- `docs/security-threat-model.md` §7: status van §8.6 punten 3 en 4 en R1–R4 (§F).

### C.2 2b-ii — accountverwijdering

- `v2/src/application/account/AccountAuthGateway.ts`:

  ```ts
  export interface AccountAuthGateway {
    /** Ververst het token en leest de `email_verified`-claim; null als niet ingelogd. */
    readVerifiedEmailClaim(): Promise<{ email: string; verified: boolean } | null>;
    reauthenticateWithPassword(password: string):
      Promise<{ ok: true } | { ok: false; code: 'wrong-password' | 'too-many-requests' | 'network' | 'not-signed-in' | 'other' }>;
    deleteCurrentUser():
      Promise<{ ok: true } | { ok: false; code: 'requires-recent-login' | 'network' | 'not-signed-in' | 'unknown-state' | 'other' }>;
  }
  ```

  Bewust een **aparte** poort naast `AuthGateway`, zodat de bestaande poort en zijn
  mocks in alle App-tests ongewijzigd blijven. Het wachtwoord leeft alleen in de
  aanroep, wordt nooit opgeslagen of gelogd.
- `v2/src/infrastructure/auth/FirebaseAccountAuthGateway.ts` —
  `reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password))`,
  `deleteUser(user)`, foutmapping uit §B.11.
- `v2/src/domain/account/plan.ts` — `buildAccountDeletionPlan(inventory, factsPerOrg,
  probe)` (puur) → `AccountDeletionPlan { organizations: { organizationId; class;
  otherOwnerCount? }[]; invitationCount: number; canProceed: boolean }`.
- `v2/src/application/account/AccountDeletionCoordinator.ts` met drie methoden:
  `assess()` (read-only plan), `clearFirestoreData()` (stap 1–6 uit §B.9) en
  `deleteAuthAccount(password)` (stap 7–9, met eindpoort 5'). Geen `deleteUser` zonder
  dat **deze aanroep zelf** de eindpoort groen zag.
- Fabriek uitbreiden: `createAccountServices(db, auth)`.

### C.3 2b-iii — overdracht en intrekken

- `v2/src/application/account/OwnershipTransferGateway.ts` en
  `v2/src/infrastructure/account/FirestoreOwnershipTransferGateway.ts`:
  `listOrganizationMembers(orgId)`, `promoteToOwner(orgId, targetUid, expectedRole)`,
  `revokeOpenInvitationsForEmail(orgId, email)`, `removeTeamMembershipsOf(orgId,
  targetUid)`, `removeOrganizationMember(orgId, targetUid)`. Hier is `targetUid`
  noodzakelijk een parameter (het gaat om een ánder); de autorisatie is de
  gezaghebbende owner-check plus Rules.
- `v2/src/application/account/OwnershipTransferCoordinator.ts`: hergebruikt
  `OrganizationExportGateway.readAuthoritativeCaller()` (zoals
  `DeletionRequestCoordinator`) — owner-check vóór elke read; weigert `targetUid ==
  eigen uid`; `promote` alleen naar een bestaand niet-owner-lid; `completeTransfer`
  alleen op een andere owner, in de volgorde van §B.8; readback.
- Uitkomsten: `denied`, `not-found`, `rejected` (bijv. rol verloren tijdens
  uitvoering), `timeout`, `incomplete(stage)`, `ok`.
- Accessmatrix: nieuw gatewaybestand, `clientSources` op `organization-members`
  (update, delete), `team-members` (delete), `invitations` (update/revoke, read),
  `teams` (read).

### C.4 Wat expliciet naar 2c en 2d gaat

- **2c (UI/wiring):** `createAccountServices` op `AuthGate`-niveau (werkt zonder
  `selectedContext` en op een onvertrouwd apparaat); "organisatie verlaten" voor
  niet-owners; "account verwijderen" (ook vanaf het geen-organisaties-scherm, voor de
  hervatting); overdracht voor A en B; NL/EN; dialogen met focustrap, Escape,
  focusherstel. **Let op:** het membership-abonnement in `AuthGate` vuurt zodra een
  membership verdwijnt en kan de context ongeldig maken terwijl de flow loopt; de
  coördinatoraanroep mag daarom niet in een component leven die bij contextverlies
  unmount. Na `deleted`: lokale opruiming volgens **open besluit B7**.
- **2d (e2e-auth):** de browserstromen uit §D.3 tegen echte Auth-/Firestore-emulator,
  alle rollen, cross-org, serverreadback, axe.

---

## D. Tests

### D.1 Toewijzing van de negatieve matrix (plan §C 8.3c werk 6)

| # | Geval | 2b (laag) | 2c/2d |
| --- | --- | --- | --- |
| 1 | crash/retry | **unit 2b-i/ii:** fout op elke stap (3–7 en accountstappen) gesimuleerd, daarna opnieuw `leave()`/`clearFirestoreData()` → hervat uit verse inventaris, geen dubbele delete, eindigt `ok`; **emulator 2b-i:** delete van een al verwijderd membership/uitnodiging wordt geweigerd (A1) en de gateway maakt er `already-gone` van | **2d:** herladen midden in de flow, opnieuw starten |
| 2 | dubbele aanvraag | **unit 2b-i/ii:** twee gelijktijdige aanroepen → één `in-progress`; tweede aanroep na afloop → `not-a-member` resp. lege eindpoort | **2d:** dubbelklik op bevestigen |
| 3 | ingetrokken ownerrol tijdens uitvoering | **emulator 2b-iii:** A gedemoveerd tussen preflight en `promote` → `rejected`, niets geschreven; B verliest ownerrol vóór `completeTransfer` → `rejected`, A blijft intact; **emulator 2b-i:** rol van vertrekker wordt tijdens de flow `organizationOwner` → membership-delete geweigerd → `incomplete`, membership staat | **2d:** rolverlies tijdens de flow faalt gesloten in de UI |
| 4 | cross-org-ID | **unit 2b-i:** `leave(orgB)` zonder lidmaatschap → `not-a-member`, nul writes; **emulator 2b-i:** de drie queries met andermans uid/e-mail geven niets, self-delete in een vreemde organisatie geweigerd | **2d:** twee organisaties, vertrek uit A raakt B niet |
| 5 | onverwachte subcollectie | Voor personen is er geen subcollectie onder een membership. Uitgewerkt als **onverwacht/misvormd document in de inventaris**: **unit 2b-i:** converterfout (onbekende rol, ontbrekend `uid`) → `read-failed`, nul writes, nooit `deleteUser`; organisatie zonder `createdBy` → `organization-unsupported` | — |
| 6 | meer dan één batch | 2b gebruikt geen `WriteBatch` (elke self-delete is een eigen Rules-evaluatie). Uitgewerkt als **veel documenten**: **emulator 2b-i:** fictieve gebruiker met 3 organisaties, 25 teams en 12 uitnodigingen → alles weg, eindpoort leeg; **unit:** volgorde blijft teamMembers → uitnodigingen → membership | — |
| 7 | serverreject | **emulator 2b-i:** owner, maker, gedemoveerde maker, organisatie zonder `createdBy`, ontbrekend organisatiedocument → geweigerd, en de coördinator probeert die write niet eens (preflight) | **2d:** foutmelding zichtbaar, niets weg |
| 8 | mislukte Auth-delete na geslaagde Firestore-opruiming | **unit 2b-ii:** `deleteCurrentUser` faalt met `requires-recent-login`/`network`/`other` → `firestore-cleared-auth-present`, nooit `deleted`; antwoord kwijt → `auth-state-unknown` | **2d:** Auth-emulator, `accounts:delete`-request afgebroken via Playwright-routering (*aanname A5*) → UI toont "account bestaat nog", nieuwe poging slaagt |

### D.2 Toewijzing van de zes extra tests (besluitrecord §5)

| # | Test | Status |
| --- | --- | --- |
| 1 | terugdatering geweigerd | geleverd in 8.3c-0 (`server-bound-timestamps.spec.ts`); 2b geen werk |
| 2 | annuleren + herstart `attempt + 1` | geleverd in 8.3c-1 (`deletion-requests.spec.ts`); 2b geen werk |
| 3 | coach/scorer/viewer vindt eigen verlopen uitnodiging via de query en verwijdert; andermans e-mail geweigerd | Rules geleverd in `invitation-retention.spec.ts`; **2b-i emulator:** opnieuw met de bouwers uit `accountQueries.ts`; **2d** |
| 4 | verlopen `pending` en vastgelopen `accepted` verwijderbaar en in opruimoverzicht | geleverd in 8.3c-1; 2b geen werk |
| 5 | account met **jonge** uitnodiging volledig verwijderbaar; `deleteUser()` pas na drie lege resultaten | **2b-i emulator** (query + self-delete van een uitnodiging van vandaag, daarna leeg); **2b-ii unit** (volgorde: geen `deleteCurrentUser`-aanroep zolang één query niet leeg is — spy-assert); **2d** e2e |
| 6 | eindcontrole ná de laatste membership-delete: beide uid-queries nul rijen | Rules geleverd in `leave-organization.spec.ts` (#98); **2b-i emulator:** met de gatewaybouwers; **2b-i unit:** coördinator leest de eindcontrole ná stap 6; **2d** |

### D.3 Nieuwe tests voor de #98-restgaten en dit ontwerp

| Test | Laag | Stuk |
| --- | --- | --- |
| Gedemoveerde maker: `leave()` → `denied/creator-needs-owner` **zonder** enige write (ook geen teamMembers-delete) | unit + emulator | 2b-i |
| Owner met andere owner: `denied/owner-awaiting-removal`, `otherOwnerCount` klopt; lone owner: `owner-sole` | unit + emulator | 2b-i |
| Organisatie zonder `createdBy` (Admin-seed): self-delete geweigerd (Rules-evaluatiefout, pint het huidige gedrag zonder Rules-wijziging) en gateway classificeert `organization-unsupported` | emulator | 2b-i |
| Wees-membership (organisatiedocument ontbreekt): `organization-missing`, nul writes | emulator | 2b-i |
| Vertrekker verwijdert eigen open uitnodigingen in die organisatie; daarna kan hij geen hogere-rol-uitnodiging meer claimen (eerlijk pad van RESTGAT 1) | emulator | 2b-i |
| `completeTransfer` trekt `pending`/`accepted` uitnodigingen op A's adres in vóór verwijdering; A's claim daarna geweigerd; `claimed`/`revoked` ongemoeid | emulator | 2b-iii |
| `completeTransfer` laat geen teamMembers van A achter (≥ 2 teams) | emulator | 2b-iii |
| Offline: `getDocsFromServer` faalt → `offline`, nooit "leeg"; nul writes | unit (gemockte SDK) | 2b-i |
| Niet-geverifieerde e-mail: invitations-query geweigerd door Rules; coördinator → `email-not-verified` vóór elke write | emulator + unit | 2b-i / 2b-ii |
| Lokale onbevestigde afronding voor org A blokkeert `leave(A)`, niet `leave(B)` | unit | 2b-i |
| Race: nieuwe uitnodiging tussen eindpoort 6 en 5' → `incomplete`, geen `deleteUser` | unit | 2b-ii |
| Gateway: elke self-delete gebruikt exact het eigen-uid-pad; er bestaat geen methode die een uid accepteert (typetest + padassert) | unit | 2b-i |
| Matrix: `clientPending`-lijst leeg; nieuwe gatewaybestanden ontdekt | firebase unit | 2b-i |

### D.4 Verificatie per stuk (plan §D)

v2: `tsc -b`, eslint, prettier, volledige vitest-suite, productiebuild (incl.
classic-SW-verificatie). firebase: type-check, unit-tests, volledige Emulator
Rules-suite (inclusief de nieuwe gateway-querytests). Documentatie: paden, links,
`git diff --check`. Mutatiebewijs zoals bij #93/#94: met de eindpoort, de
preflightpoort en de `FromServer`-eis weggemuteerd moeten de bijbehorende tests falen.

---

## E. Risico's per AGENTS.md-categorie

| Categorie | Risico | Maatregel |
| --- | --- | --- |
| **Opslag** | Een nieuwe sleutel of een wis-actie raakt bestaande gebruikersdata | 2b voegt **geen** sleutel toe en wist niets; de probe leest alleen. Lokale opruiming na `deleted` is 2c en open besluit B7. |
| **Opslag** | Gecachet "leeg" resultaat leidt tot een vals "klaar" | `getDocsFromServer` voor alle controles (§B.5) |
| **CSV** | — | Geen raakvlak; geen wijziging aan het Nederlandse CSV-contract, export of statistiek |
| **Offline** | Halve toestand die als klaar wordt getoond; verlies van onbevestigde wedstrijddata | Serverbevestiging verplicht, timeout stopt de flow, vaste volgorde, blokkade bij onbevestigd lokaal werk (§B.10). Wedstrijdpaden ongewijzigd. |
| **Vertalingen** | Een uitkomst zonder tekst in één taal | Geen teksten in 2b; mapping-tabel en pariteitstest in 2c (§B.12) |

---

## F. Bekende restrisico's (vast te leggen in `security-threat-model.md` §7 in 2b-i)

- **R1 — RESTGAT 1 (§8.6 punt 3):** een vertrokken lid kan een openstaande uitnodiging met
  een hogere rol claimen. 2b sluit het eerlijke vertrekpad en het overdrachtspad (§B.7); de
  Rules-claimtermijn van 30 dagen na `invitedAt` (B4, #103) sluit oude uitnodigingen. **Restvenster
  na #103:** een uitnodiging jonger dan 30 dagen blijft na vertrek claimbaar tot ze is
  ingetrokken of verlopen.
- **R2 — RESTGAT 2 (§8.6 punt 4):** een gedemoveerde maker die is verwijderd kan zich via de
  bootstrap-create weer owner maken. De Rules-binding aan de eerste 7 dagen na `createdAt`
  (B6, #103) vraagt geen datacontractwijziging. **Restvenster na #103:** die eerste 7 dagen
  na het aanmaken van de organisatie, ook bij een overdracht zonder accountverwijdering
  (§B.8) en eenzijdig met een tweede account als de maker admin is.
- **R5 — half aangemaakte organisatie na 7 dagen (reviewbevinding #103).** Slaagt de
  org-write maar de membership-write niet (bijvoorbeeld uit een offline-wachtrij die pas na
  meer dan 7 dagen wordt verstuurd, of een gebruiker die later terugkomt), dan weigert de
  bootstrap-binding het hervatten. `bootstrapOrgId` blijft in `localStorage` staan en wordt
  alleen bij succes gewist (`NoOrganizationsScreen.tsx`, `FirestoreOrganizationGateway.ts`),
  dus elke volgende poging hervat dezelfde dode organisatie met een generieke fout en de
  gebruiker kan via dat scherm geen nieuwe aanmaken. Zeldzaam; niets is gedeployed.
  **Fix in 2b/2c, vóór de cutover:** bij `permission-denied` op het hervatpad met een
  `createdAt` ouder dan 7 dagen de sleutel wissen en een nieuwe organisatie toestaan. Het
  runbook (§8) dekt alleen de organisatie zonder owner.
- **R3 — race na de eindpoort.** Een owner/admin kan direct na de eindpoort een
  `teamMembers`-document of uitnodiging voor de vertrekkende gebruiker aanmaken. Eindpoort
  5' verkleint het venster tot milliseconden; wat dan nog ontstaat, kan een owner/admin
  opruimen (teamMembers direct, uitnodigingen na 30 dagen) of het runbook.
- **R4 — pseudonieme audit-uid's blijven staan.** `organizations.createdBy`,
  `teams.createdBy`, `invitations.invitedBy`, `games.writerUid`, `actions.authorUid`,
  `completedGames.deletedBy` (tot redactie), `deletionRequests.requestedBy` en
  `migrationRuns.createdBy` dragen de uid. Ze zijn onveranderlijk of append-only onder Rules
  en bevatten geen e-mail. Na `deleteUser()` verwijst de uid nergens meer naar. §4.3 stap 2
  ("geen document meer dat de eigen uid draagt") is in dit ontwerp beperkt tot
  **lidmaatschaps- en uitnodigingsdocumenten**; zie open besluit B8.
- **R5 — hoofdlettergebruik in e-mailadressen.** Een uitnodiging die buiten de app met
  een afwijkend gespeld adres is aangemaakt, matcht de token-e-mail niet: ze is niet te
  accepteren, maar ook niet via de query te vinden en blijft na accountverwijdering staan.
  *(Aanname A3: Firebase Auth levert het token-adres in kleine letters.)* Achtervang:
  runbook, en het pre-8.5-besluit over het uitnodigingsaanmaakpad (threat model §7).

---

## G. Bestandenlijst en omvang

| Stuk | Nieuw | Gewijzigd | Schatting |
| --- | --- | --- | --- |
| **2b-i** | `v2/src/domain/account/{types,classify}.ts`; `v2/src/application/account/{AccountGateway,LeaveOrganizationCoordinator,LocalUnsyncedWorkProbe}.ts`; `v2/src/infrastructure/account/{FirestoreAccountGateway,accountQueries,LocalStorageUnsyncedWorkProbe,createAccountServices}.ts`; `v2/src/infrastructure/firebase/withTimeout.ts`; `v2/tests/unit/{accountClassify,LeaveOrganizationCoordinator,FirestoreAccountGateway,LocalStorageUnsyncedWorkProbe}.spec.ts`; `firebase/tests/rules/account-gateway-queries.spec.ts` | `firebase/src/security/firestoreAccessMatrix.ts`; `firebase/tests/unit/firestoreAccessMatrix.spec.ts`; `firebase/docs/QUERY_CONTRACT.md`; `docs/security-threat-model.md`; `docs/IMPLEMENTATION_PLAN.md`; `docs/pr-8.3-plan.md` | ~2000–2400 regels (≈ #94) |
| **2b-ii** | `v2/src/domain/account/plan.ts`; `v2/src/application/account/{AccountAuthGateway,AccountDeletionCoordinator}.ts`; `v2/src/infrastructure/auth/FirebaseAccountAuthGateway.ts`; `v2/tests/unit/{accountDeletionPlan,AccountDeletionCoordinator,FirebaseAccountAuthGateway}.spec.ts`; uitbreiding van `account-gateway-queries.spec.ts` (test 5) | `createAccountServices.ts`; statusdocs | ~1400–1800 regels |
| **2b-iii** | `v2/src/application/account/{OwnershipTransferGateway,OwnershipTransferCoordinator}.ts`; `v2/src/infrastructure/account/FirestoreOwnershipTransferGateway.ts`; `v2/tests/unit/{OwnershipTransferCoordinator,FirestoreOwnershipTransferGateway}.spec.ts`; `firebase/tests/rules/ownership-transfer-gateway.spec.ts` | accessmatrix + spec; `createAccountServices.ts`; threat model §7; statusdocs | ~1300–1700 regels |

Ongewijzigd in alle drie: `firebase/firestore.rules`, `firestore.indexes.json`,
documentconverters, `localStorage`-sleutels, CSV, export, statistiek,
`FirestoreDeletionRequestGateway`, `AuthGateway`, alle UI.

---

## H. Acceptatie voor 2b (alle drie stukken samen)

- Geen client kan via 2b een pad verwijderen dat niet uit een eigen server-inventaris
  komt (self) of dat niet door een gezaghebbende owner-check is gegaan (overdracht).
- Volgorde teamMembers → per-organisatie-controle → organizationMembers als laatste write
  is in unit-tests (spy-volgorde) én emulatortests bewezen.
- `deleteUser()` wordt in geen enkel testscenario aangeroepen zonder drie lege
  server-resultaten in dezelfde aanroep (5').
- Geen uitkomst `ok`/`deleted` op basis van een cachelezing.
- Geen `localStorage`-sleutel toegevoegd, gewijzigd of gewist; geen CSV-/export-/
  statistiekwijziging; geen NL/EN-tekst.
- `clientPending`-lijst in de accessmatrix leeg; elke nieuwe gateway in
  `FIRESTORE_CLIENT_GATEWAY_FILES`.
- Alle tests met fictieve gebruikers en organisaties (`USERS`/`ORG_A`/`ORG_B`-fixtures).
- Volledige v2- en firebase-suites groen; Emulator-tests lokaal en in CI.

---

## I. Besluiten voor de eigenaar (B1 t/m B9: besloten)

**Besloten op 4 oktober 2026 (eigenaar): alle aanbevelingen in de tabel hieronder zijn
overgenomen, B1 t/m B9 ongewijzigd.** Wat dat concreet betekent:

- **B1:** 2b gaat in drie stukken: 2b-i, 2b-ii, 2b-iii, in die volgorde.
- **B2:** reauthenticatie vooraf én, bij `auth/requires-recent-login`, opnieuw vlak vóór
  `deleteUser`; de harde eindpoort blijft direct vóór `deleteUser`.
- **B3:** bij "organisatie verlaten" gaan de eigen openstaande (pending/accepted)
  uitnodigingen in die organisatie mee weg; claimed/revoked blijven.
- **B4:** RESTGAT 1 voor paden buiten de app sluit een kleine, aparte Rules-PR met een
  claimtermijn van **30 dagen na `invitedAt`** (besloten op 6 oktober 2026, besluitrecord
  §8.7; dit vervangt het anker `acceptedAt` uit de aanbeveling), plus een runbookregel.
  Die PR komt vóór 2b-i.
- **B5:** geen intentiesleutel in `localStorage` voor een hervatbanner.
- **B6:** bootstrapbinding (RESTGAT 2) is een apart besluit vóór de cutover, niet in 2b;
  tot dan geldt restrisico R2. NB: het beslismemo wijst erop dat het org-document al een
  servergebonden `createdAt` heeft, waardoor dit geen datacontractwijziging vraagt maar één
  Rules-regel. **Besloten op 6 oktober 2026 (besluitrecord §8.7): bootstrap alleen de eerste
  7 dagen na `createdAt`**, samen met B4 in één kleine Rules-PR vóór 2b-i (dit vervangt
  "apart besluit vóór de cutover, niet in 2b").
- **B7:** na `deleted` altijd `wipeLocalFirebaseData()`, nooit `clearLocalDeviceData()`.
- **B8:** pseudonieme audit-uid's accepteren en vastleggen in het threat model (§7).
- **B9:** 2c toont de B-zijde van de overdracht als "andere eigenaar verwijderen", alleen
  voor owners, alleen op andere owners, met getypte bevestiging.

De tabel hieronder blijft ter onderbouwing staan. De aannames in §J blijven aannames tot ze
in 2b-i met de emulator zijn bewezen.

Wat ik binnen het mandaat zelf heb vastgelegd (en dus géén besluit vraagt): geen
persistente staat (§B.4), `getDocsFromServer` voor controles (§B.5), poort vóór de
eerste write bij accountverwijdering (§B.9 stap 3), eindpoort 5' vóór `deleteUser`,
geen nieuwe queryvorm (§B.3), aparte `AccountAuthGateway`, geen teksten in 2b.

| # | Besluit | Aanbeveling |
| --- | --- | --- |
| **B1** | 2b knippen in 2b-i / 2b-ii / 2b-iii (en volgorde) | **Ja, in de volgorde i → ii → iii.** Elk stuk ≈ de omvang van #94; 2b-ii is het enige Auth-stuk met een onomkeerbare actie, 2b-iii het enige dat op andermans documenten schrijft. |
| **B2** | Reauthenticatie ook vóór de eerste Firestore-write (afwijking van de letterlijke §4.4-volgorde) | **Ja: reauth vooraf én, bij `auth/requires-recent-login`, opnieuw vlak vóór `deleteUser`.** Beschermt tegen een gekaapte open sessie en tegen een vergeten wachtwoord ná de opruiming. De harde eindpoort blijft direct vóór `deleteUser`. |
| **B3** | Bij "organisatie verlaten" de eigen **openstaande** uitnodigingen in die organisatie meeverwijderen; `claimed`/`revoked` laten staan (die gaan pas weg bij accountverwijdering of na 30 dagen via owner/admin) | **Ja.** Sluit het eerlijke pad van RESTGAT 1 en voorkomt een onbedoelde herclaim; laat de auditwaarde voor de organisatie intact. Alternatief: álle eigen uitnodigingen in die organisatie meeverwijderen (meer privacy, minder audit). |
| **B4** | Hoe RESTGAT 1 voor demotie/verwijdering buiten de app wordt gesloten | **Rules-claimtermijn als kleine, aparte Rules-PR (zelfde vorm als 2a), plus een runbookregel.** Besloten: 30 dagen na `invitedAt` (niet de oorspronkelijke aanbeveling `acceptedAt`). 2b alleen dekt uitsluitend de app-paden. |
| **B5** | Een per-apparaat intentiesleutel in `localStorage` voor een hervatbanner ("je accountverwijdering is nog niet afgerond") | **Niet bouwen.** De toestand "Firestore leeg, Auth aanwezig" is afleidbaar; elke nieuwe sleutel moet bovendien op de wislijst-discussie van 8.2c. |
| **B6** | Bootstrap-create binden aan "organisatie net aangemaakt" (RESTGAT 2) | Oorspronkelijk: apart besluit vóór 8.5. **Besloten:** alleen de eerste 7 dagen na `createdAt`, in dezelfde Rules-PR als B4 (#103); geen datacontractwijziging omdat `createdAt` al servergebonden is. |
| **B7** | Lokale opruiming na `deleted` (2c) | **Altijd `wipeLocalFirebaseData()` (IndexedDB-cache met org-data en e-mails), maar níet de bestaande `clearLocalDeviceData()`-allowlist**, want die wist ook lokale-modusdata (`SETTINGS_STORAGE_KEY`, `ROSTER_STORAGE_KEY`, `V1_GAMES_STORAGE_KEY`) die niets met het cloudaccount te maken heeft. Hoogstens de org-gescoopte cloudsleutels van de verlaten organisaties, als expliciet getest besluit in 2c. |
| **B8** | Pseudonieme audit-uid's (R4) accepteren | **Accepteren en vastleggen in threat model §7**; geen redactie van onveranderlijke auditvelden. Herzien bij de juridische toets vóór 8.5 (besluitrecord §7 punt 1). |
| **B9** | Mag 2c de B-zijde van de overdracht tonen als "andere eigenaar verwijderen" (een bestaande Rules-bevoegdheid die de app voor het eerst zichtbaar maakt) | **Ja, alleen voor owners, alleen op andere owners, met getypte bevestiging.** Zonder deze actie is §4.2 niet in de app af te ronden. |

---

## J. Aannames die ik niet kon verifiëren

- **A1** — Een delete op een al verwijderd `organizationMembers`- of uitnodigingsdocument
  wordt door de Rules geweigerd (`resource == null`), terwijl een `teamMembers`-delete op
  een ontbrekend document slaagt. Afgeleid uit de regeltekst, niet in de emulator gedraaid.
- **A2** — Hoe "een gestarte actieve wedstrijd" uit de bestaande
  actieve-wedstrijdsleutel af te lezen is (§B.10).
- **A3** — Firebase Auth levert het token-adres genormaliseerd in kleine letters (R5).
- **A4** — `getDocsFromServer` op een collectionGroup-query gedraagt zich met
  `persistentLocalCache` en de Auth-emulator zoals gedocumenteerd (faalt offline met
  `unavailable`). Er is nog geen gebruik in `v2/src` om naar te verwijzen.
- **A5** — Een mislukte `deleteUser()` is in de e2e-auth-suite te forceren door het
  `accounts:delete`-verzoek naar de Auth-emulator via Playwright-routering af te breken.
- **A6** — De omvangschattingen in §G zijn extrapolaties uit #93–#96, geen metingen.
- **A7** — PR #98 is ongewijzigd gemerged. Wijzigen de termijnen uit #103 iets aan de
  voorwaarden die §A.1 en §B.6 beschrijven, dan moeten die opnieuw worden nagelopen.

---

## K. Stopregels

Onverkort uit plan §F en besluitrecord §6: geen Cloud Function, geen Blaze, geen
deployment, geen Netlify-wijziging, geen recursieve clientdelete, geen door de client
aangeleverd vrij pad, geen wijziging aan `localStorage`-sleutels, CSV of statistiek
zonder apart besluit, geen tokens/sleutels/spelersdata in code, tests of logs.
Aanvullend voor 2b: **niet starten vóór de Rules-PR met de termijnen (#103) gemerged is**, en stoppen en een besluit
vragen zodra een stuk een Rules-wijziging, een nieuwe queryvorm, een nieuw
documentveld of een nieuwe opslagsleutel blijkt te vereisen.
