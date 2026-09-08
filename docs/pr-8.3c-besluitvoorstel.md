# Besluitvoorstel PR 8.3c — verwijdermodel, bewaartermijnen en sole-owner

Status: **bevestigd door de eigenaar op 8 september 2026** (zie §8). Dit
document beantwoordt de startblokkade van `docs/pr-8.3-plan.md` §C 8.3c
("voer deze sub-PR niet uit voordat de keuzes in §E.1–E.3 expliciet zijn
bevestigd"). Het bevat zelf geen code, geen Rules-wijziging, geen deployment
en geen billingkoppeling, en geeft geen toestemming voor een productiecutover
— het maakt uitsluitend de weg vrij voor 8.3c-1 en 8.3c-2 als afzonderlijke
implementatie-PR's.

De bevestigingsronde heeft vier verfijningen op het oorspronkelijke voorstel
opgeleverd; die zijn hieronder verwerkt en in §8 apart benoemd.

## 0. Samenvatting

| Besluit | Voorstel in één zin |
| --- | --- |
| **E.1 verwijdermodel** | Eigenaar-geïnitieerd *verwijderverzoek* in de app plus een getest handmatig beheerrunbook; géén Cloud Function, géén Blaze — met vier vooraf benoemde triggers die alsnog tot de serververiant leiden. |
| **E.2 bewaartermijnen** | Vaste termijnen per gegevensfamilie, in Rules afgedwongen als *ondergrens* (niets mag eerder weg), met een handmatig purgepad plus een owner-only opruimoverzicht; geen automatische purge, want Spark heeft geen TTL en geen serverruntime. |
| **E.3 sole-owner/accountdelete** | Eigendom eerst overdragen (promoveren + laten verwijderen) óf de organisatie volledig exporteren en verwijderen; nooit automatische promotie van een admin; Auth-delete altijd als laatste, apart bevestigde stap. |

De belangrijkste inhoudelijke keuze die afwijkt van een naïeve invulling:
**een verlopen tombstone wordt niet hard verwijderd maar geredigeerd** — de
persoonsgegevens in het document worden leeggemaakt, het documentidentiteits-
en tombstoneveld blijven staan. Zie §3.3 voor waarom een hard delete hier een
echt dataveiligheidsrisico introduceert.

## 1. Uitgangssituatie in de code (geverifieerd, 8 september 2026)

Deze feiten bepalen wat er überhaupt mogelijk is; ze zijn nagelopen in de
huidige `main`-code, niet uit het plan overgenomen.

### 1.1 Er bestaat vandaag geen enkel serverzijdig verwijderpad

- Er is geen `functions/`-workspace in de repository. `firebase.json` bevat
  uitsluitend `firestore` (rules + indexes) en emulatorpoorten — geen
  `functions`-blok.
- Er is dus geen Cloud Functions-runtime, geen deploypipeline daarvoor, geen
  CI-job die functies bouwt of test, en geen Admin SDK-credential in de repo
  (conform `AGENTS.md` en plan §F).
- Het project draait op Spark. Firestore TTL-policies, PITR, scheduled
  backups en restore vereisen billing (plan §B.6). Er is dus **geen enkel
  automatisch verlopen-mechanisme beschikbaar** zonder een Blaze-besluit.

### 1.2 Wat een client vandaag wél en niet mag verwijderen

Uit `firebase/firestore.rules`:

| Pad | Hard delete vandaag | Regel |
| --- | --- | --- |
| `organizations/{orgId}` | **nee** | `:513` `allow delete: if false;` |
| `organizationMembers/{uid}` | ja, maar **nooit het eigen document** | `:542` (owner), `:557` (admin, niet op een owner-rij) |
| `invitations/{invitationId}` | **nee** — er is helemaal geen `allow delete`, dus default-deny | `:571`–`:609` |
| `teams/{teamId}` | **nee** | `:629` |
| `teamMembers/{uid}` | ja, door owner/admin | `:646` |
| `settings/current`, `roster/current` | **ja** — `allow write` omvat delete | `:652`, `:658` |
| `games/{gameId}` | **nee** | `:825` |
| `games/.../actions/{actionId}` | **nee** (append-only) | `:846` |
| `completedGames/{id}` | **nee** — alleen een tombstone-fieldpatch | `:934` |
| `migrationRuns/{runId}` | **nee** (auditbewijs) | `:986` |

Drie consequenties die het voorstel sturen:

1. **Een organisatie verwijderen kan vandaag helemaal niet vanuit de app.**
   Niet gedeeltelijk, niet met een truc — de wortel en bijna alle families
   staan op `false`. Elk verwijdermodel begint dus sowieso bij nieuwe,
   expliciet ontworpen Rules of bij een beheerder buiten de app om.
2. **Een gebruiker kan zichzelf niet uit een organisatie verwijderen.** De
   owner- en adminregels eisen allebei `request.auth.uid != uid`, en
   coach/scorer/viewer hebben überhaupt geen deleterecht. "Organisatie
   verlaten" bestaat dus niet; een ander moet je eruit halen. Dit raakt
   §E.3 direct.
3. **Uitnodigingen zijn onverwijderbaar en dragen e-mailadressen.** Een
   `claimed`/`revoked` uitnodiging houdt het e-mailadres van de uitgenodigde
   permanent vast, ook nadat die persoon zijn account laat verwijderen. Dit
   is vandaag het meest concrete openstaande privacypunt in het datamodel.

### 1.3 Welke persoonsgegevens er werkelijk staan

- Spelers: naam, rugnummer, classificatie, `vrouw`/`jeugd`-vlaggen. Geen
  geboortedatum, geen medische gegevens (ADR-003 §"Verwijdering,
  bewaartermijnen en minimale persoonsgegevens", ADR-001 §5).
- Gebruikers: uid en e-mailadres in `organizationMembers` en `invitations`.
- Diagnostiek: allowlist van technische codes, maximaal 50 events, uitsluitend
  in geheugen, niets automatisch verzonden (8.3a-implementatie).

De gevoeligheid is dus beperkt maar niet nul: namen van (deels
minderjarige) spelers plus e-mailadressen van begeleiders.

### 1.4 Wat er al bewezen werkt en hergebruikt kan worden

- De volledige organisatie-export (8.3b) leest alle elf gegevensfamilies over
  alle teams, is owner-only op basis van de *echte* ingelogde Auth-sessie,
  faalt in zijn geheel bij één mislukte read en levert een `contentHash` over
  alles behalve `exportedAt`. Twee dezelfde exports van dezelfde brondata
  geven dus dezelfde hash — precies wat een "export vóór delete"-poort nodig
  heeft.
- De herstelproef bewijst dat zo'n export in een lege doelcontext een
  inhoudelijk gelijke inventaris teruggeeft.
- De tombstoneflow op `completedGames` (7.2c) is al fail-closed, revisie-
  bewaakt en heeft lokale resurrectiepreventie.

## 2. E.1 — Verwijdermodel

### 2.1 Besluit

**Optie A: eigenaar-geïnitieerd verwijderverzoek in de app + een getest,
handmatig beheerrunbook.** Geen Cloud Function, geen Blaze, geen nieuwe
serverruntime in 8.3c.

### 2.2 Waarom niet de servervariant, nu

- Een recursieve organisatiedelete met eigenaarsrechten is de code met de
  grootste blast radius in dit hele project. Die bouwen zonder dat er één
  echte gebruiker op wacht, is speculatief werk op het gevaarlijkste
  onderdeel.
- Ze vereist een compleet nieuwe leveringsketen: `functions/`-workspace,
  buildstap, testharnas, deployrechten, CI-job, en een Blaze-koppeling
  (plan §E.5 adviseert Spark zolang de app preproductie is).
- De app verwerkt vandaag uitsluitend fictieve data. Er is geen betrokkene
  met een wettelijke verwijderaanvraag en dus geen termijn die loopt.
- Alles wat aan een verwijdering *risicovol* is — de autorisatie, de
  blokkerende voorwaarden, de exportpoort, de inventaris, de readback en de
  eerlijke statusweergave — kan in optie A volledig gebouwd en in de Emulator
  bewezen worden. Alleen de daadwerkelijke wisstap is handmatig.

### 2.3 Waarom dit eerlijk moet worden gelabeld

Optie A is **geen self-service verwijdering**. De UI mag dus nooit
"organisatie verwijderd" tonen op het moment van aanvragen, en nooit een
verwachte doorlooptijd suggereren die niet gegarandeerd is. De teksten worden:

- NL: "Verwijderverzoek ingediend. De organisatie wordt handmatig door de
  beheerder verwijderd. Je krijgt hier de uitvoeringsstatus te zien."
- EN: idem.

En expliciet in het document: de beheerder die het runbook uitvoert heeft
eigenaarsniveau-toegang tot het Firebase-project. Die concentratie van
bevoegdheid is een geaccepteerd restrisico zolang de eigenaar en de beheerder
dezelfde persoon zijn; zodra dat niet meer zo is, geldt trigger 2 hieronder.

### 2.4 Vier triggers die alsnog tot optie B leiden

Zodra één hiervan waar wordt, is de servervariant (callable Cloud Function met
aparte Blaze- en deploymentgoedkeuring) opnieuw een verplicht agendapunt:

1. Er staat echte spelersdata in productie (dat is de PR 8.5-cutover). Vanaf
   dat moment loopt er een wettelijke reactietermijn op verwijderverzoeken en
   moet er een aanwijsbare verantwoordelijke plus een gemeten doorlooptijd
   zijn.
2. Er is meer dan één organisatie met een eigenaar buiten de eigen kring van
   de projecteigenaar.
3. Blaze wordt om een andere reden alsnog goedgekeurd (bijvoorbeeld scheduled
   backups/PITR in 8.3d) — dan vervalt het belangrijkste bezwaar.
4. Een gemeten runbookuitvoering duurt langer dan één werkdag of levert een
   fout op die niet uit het runbook zelf te herstellen is.

### 2.5 Wat optie A concreet betekent voor de 8.3c-implementatie

Nieuw pad, één per organisatie (singleton, dus inherent idempotent):

```text
organizations/{orgId}/deletionRequests/current
```

Voorgestelde toestandsmachine — create-only kernvelden plus revisie-bewaakte
statuspatches, exact hetzelfde schrijfpatroon als `migrationRuns` (plan §B):

```text
requested ──(owner annuleert)──> cancelled
    │
    └──(beheerder start)──> executing ──> completed
                                 │
                                 └──────> failed  (hervatbaar, nooit "klaar")
```

Invarianten die in Rules en tests hard moeten liggen:

- alleen `organizationOwner` mag `requested` aanmaken; `requestedBy` moet de
  ingelogde uid zijn;
- de aanvraag draagt `exportProof = { contentHash, exportedAt, counts }` uit
  een geslaagde 8.3b-export — zonder dat veld geen geldige aanvraag;
- alleen de owner mag annuleren, en alleen vanuit `requested`;
- `executing`/`completed`/`failed` worden door het runbook gezet, niet door de
  app-UI;
- de kernvelden zijn na create onveranderlijk, `revision` gaat per patch
  precies met 1 omhoog;
- geen enkel pad in de aanvraag komt uit clientinvoer: de organisatie-ID komt
  uit het documentpad, de identiteit uit `getAuth(db.app).currentUser` —
  dezelfde harde les als de 8.3b-herreview over `callerUid`.

**Blokkerende voorwaarden vóór een aanvraag geldig is** (plan §C 8.3c werk 3):

| Voorwaarde | Besluit | Waarom |
| --- | --- | --- |
| Niet-afgeronde `games/{gameId}` met **recente** `lastWriterActivityAt` (voorstel: binnen 24 uur) in enig team | **harde blokkade**, geen override in de UI | Een offline apparaat kan nog niet-gesynchroniseerde wedstrijddata vasthouden. Die staat per definitie ook niet in de export. Doorzetten zou stil dataverlies zijn — precies wat plan §C 8.3c acceptatie verbiedt. |
| Niet-afgeronde `games/{gameId}` **zonder** recente activiteit | **geen blokkade**, wel een expliciet te bevestigen waarschuwing | Verfijning uit de bevestigingsronde. Een ooit opgestarte, nooit afgeronde wedstrijd zou een organisatie anders permanent onverwijderbaar maken. `GameDocument.lastWriterActivityAt` bestaat al (`string \| null`, met backward-compat-defaulting voor pre-7.3a-documenten) en maakt dit onderscheid meetbaar. |
| `migrationRuns` in een niet-terminale status | **harde blokkade** | Een half uitgevoerde migratie verwijderen laat een onbeoordeelbare situatie achter. |
| Geen geldig `exportProof` | **harde blokkade** | Dit is de kern van "export vóór delete is aantoonbaar compleet of de delete blijft geblokkeerd". |

Een override bestaat uitsluitend in het runbook, met een expliciete,
schriftelijke vastlegging door de beheerder — nooit als knop in de app.

**De export die telt, is die van de beheerder.** Het `exportProof` van de
eigenaar is een UX-poort, geen bewijs: tussen aanvraag en uitvoering kan er
nog data bijkomen. Het runbook draait daarom vlak vóór het wissen zelf
opnieuw een volledige 8.3b-export, en vergelijkt aantallen per gegevensfamilie
met de readback ná het wissen (alles nul). Pas dan mag de status `completed`
worden.

**Wachttijd.** Minimaal **7 dagen** tussen `requested` en `executing`, waarin
de eigenaar kan annuleren. Dat beschermt tegen een vergissing en tegen een
gekaapte sessie.

Verfijning uit de bevestigingsronde: die termijn is **runbookdiscipline, geen
Rules-ondergrens.** De Rules bewaken de toestandsmachine (wie welke overgang
mag maken, en dat kernvelden onveranderlijk blijven); de wachttijd staat in
het runbook en in de UI-tekst. Reden: een harde 7-dagengrens in Rules maakt
de verwijderflow onmogelijk om in één sessie tegen de emulator of op staging
te testen — je zou een week moeten wachten op een fictieve organisatie. De
bescherming die je werkelijk wilt (bedenktijd bij een vergissing) blijft
overeind; alleen het afdwingpunt verschuift naar de uitvoerder.

Er komt in die periode bewust *geen* functionele lockdown van de organisatie
(dat zou over vrijwel elk pad nieuwe Rules vragen en de offline
wedstrijdbediening kunnen raken) — alleen een permanente, voor alle
organisatieleden zichtbare banner.

**Waar het bewijs van uitvoering blijft staan.** `deletionRequests/current`
staat ónder `organizations/{orgId}` en verdwijnt dus mee met het wissen. Het
uitvoeringsbewijs kan daarom niet in Firestore leven. Besluit: het runbook
legt buiten Firestore een minimaal record vast met **alleen**
organisatie-ID, aanvraagtijdstip, uitvoeringstijdstip, aantallen per
gegevensfamilie, de `contentHash` van de beheerdersexport, en de uid van de
aanvrager. **Geen e-mailadressen, geen spelersnamen, geen exportinhoud.** Zie
§3 voor de bewaartermijn van dat record.

## 3. E.2 — Bewaartermijnen

### 3.1 Het mechanisme, eerst

Zonder dit erbij is elke termijn hieronder een loze belofte:

- Spark heeft **geen TTL-policies** en er is **geen serverruntime**. Er kan
  dus niets automatisch verlopen.
- Besluit: de termijn wordt in Firestore Rules afgedwongen als **ondergrens**
  (`resource.data.<tijdstempel> < request.time - duration.value(N, 'd')`),
  niet als automatische purge. Betekenis: *niets mag eerder verdwijnen dan de
  termijn*, en het opruimen zelf is een expliciete, handmatige actie.
- Dat is een zwakkere garantie dan een TTL en moet ook zo gelabeld worden. Het
  is wél een echte, testbare garantie tegen te vroeg wissen, en het is de
  enige die op Spark bestaat.

**Verfijning uit de bevestigingsronde: een owner-only opruimoverzicht.** Een
ondergrens zonder zichtbaarheid blijft in de praktijk een belofte — het
opruimen hangt dan volledig af van wie eraan denkt. Daarom krijgt 8.3c-1 een
owner-only overzicht dat toont wat er op dit moment opruimbaar is: het aantal
tombstones ouder dan 90 dagen, het aantal terminale uitnodigingen ouder dan 30
dagen, het aantal verlaten wedstrijden ouder dan 180 dagen, en het aantal
afgeronde migratieruns ouder dan 90 dagen.

Dat is goedkoop om te bouwen: het leest exact dezelfde paden als de bestaande
`FirestoreOrganizationExportGateway` uit 8.3b, met dezelfde owner-only
autorisatie via `readAuthoritativeCaller()`. Het toont uitsluitend
**aantallen**, geen inhoud — geen spelersnamen, geen e-mailadressen — zodat
het overzicht zelf geen nieuwe blootstelling van persoonsgegevens in de DOM
oplevert.

### 3.2 De termijnen

| Gegevensfamilie | Voorstel | Reden | Purgepad |
| --- | --- | --- | --- |
| `organizations` + alle subcollecties | zolang de organisatie bestaat | dit is het product | verwijderverzoek (§2) |
| `organizationMembers` | direct bij einde lidmaatschap | bevat e-mailadres; dataminimalisatie | bestaat al (owner/admin delete) |
| `invitations` — `pending` | **30 dagen**, daarna als verlopen behandeld en niet meer accepteerbaar | een blijvend openstaande uitnodiging is een permanente claim op een e-mailadres | zie §3.4 — dit is vandaag een echt gat |
| `invitations` — `claimed`/`revoked` | **30 dagen** na de eindstatus (`claimedAt`/nieuw `revokedAt`, met terugval op `invitedAt`), dan verwijderbaar | de auditwaarde is kort, het e-mailadres blijft anders eeuwig staan | nieuwe, enge Rules-delete (§3.4) |
| `teams`, `teamMembers`, `settings`, `roster` | zolang het team bestaat | operationele data | teamverwijdering valt onder §2 |
| actieve `games` + `actions` | tot afronding; een niet-afgeronde game ouder dan **180 dagen** wordt als verlaten gemarkeerd en gerapporteerd | voorkomt dat een vergeten game de verwijderpoort eeuwig blokkeert | rapportage in 8.3c, opruiming via runbook |
| `completedGames` zonder tombstone | **geen purge** | dit is precies de waarde van het product: historie en statistiek over seizoenen heen | n.v.t. |
| `completedGames` mét tombstone | **90 dagen**, daarna **redactie** (§3.3), geen hard delete | na 90 dagen is de auditwaarde van een verwijdering weg, de persoonsgegevens niet | redactiepatch, Rules-ondergrens |
| `migrationRuns` — terminale status | **90 dagen** | auditbewijs van een afgeronde migratie | runbook |
| `migrationRuns` — failed/onopgelost | bewaren tot afhandeling, dán 90 dagen | mag nooit verdwijnen vóór iemand ernaar gekeken heeft | runbook |
| diagnosebuffer | tot tabsluiting, max. 50 events, in geheugen | al zo geïmplementeerd in 8.3a | n.v.t. |
| gedownloade exportbestanden | beheer van de gebruiker | staan buiten ons bereik; de UI waarschuwt al bij de download | n.v.t. |
| operationele cloudback-ups | **niet van toepassing** zolang Spark geldt | bestaat niet zonder Blaze | retentie pas kiezen bij een Blaze-besluit (8.3d) |
| uitvoeringsrecord van een verwijdering | **12 maanden**, minimale velden (§2.5) | bewijs dat een verwijdering rechtmatig en volledig is uitgevoerd | handmatig |
| Firebase Auth-user | tot accountverwijdering | zie §4 | `deleteUser()` na reauthenticatie |

### 3.3 Waarom een verlopen tombstone geredigeerd wordt en niet hard verwijderd

Dit is het belangrijkste inhoudelijke punt van dit voorstel.

De tombstone op `completedGames` doet vandaag twee dingen tegelijk: hij is
auditbewijs, én hij is het mechanisme voor resurrectiepreventie.
`CompositeCompletedGameRepository.mergeGames()` filtert elk clouditem met
`deletedAt != null` altijd uit de zichtbare lijst, óók als er nog een
niet-getombstonede lokale kopie op een apparaat staat.

Wordt zo'n tombstone na 90 dagen hard verwijderd, dan verdwijnt daarmee ook
het signaal waarop die filtering steunt. Een apparaat dat lang offline was en
nog een lokale kopie draagt — of een bulkmigratie van lokale historie naar de
cloud — kan die wedstrijd dan opnieuw introduceren. De verwijdering zou stil
ongedaan gemaakt worden: precies het scenario dat 7.2c heeft dichtgezet.

Besluit: na 90 dagen wordt de **inhoud leeggemaakt** in plaats van het
document verwijderd.

- Blijft staan: `organizationId`, `teamId`, `sourceGameId`, `date`,
  `deletedAt`, `revision`, plus een nieuw `redactedAt`.
- Wordt leeggemaakt: `opponent: ''`, `competition: ''`, `players: []`,
  `segments: []`, `scoreFor: 0`, `scoreAgainst: 0`, **`deletedBy: null`**.

`deletedBy` wordt dus óók gewist — verfijning uit de bevestigingsronde. Het is
de uid van degene die de wedstrijd verwijderde, dus zelf een persoonsgegeven,
en na 90 dagen is de auditwaarde ervan net zo verlopen als die van de rest van
het document. Het veldtype is al `string | null`
(`assertNullableString`), dus dit kost geen schema- of converterwijziging.

Twee gecontroleerde eigenschappen maken dit goedkoop:

1. **De bestaande converter accepteert deze vorm ongewijzigd.**
   `assertString` accepteert de lege string, `assertGamePlayers`/
   `assertSegments` accepteren een lege array, `assertInteger` accepteert `0`,
   en `fromFirestore()` negeert onbekende velden zoals `redactedAt`. Er is dus
   geen converterwijziging nodig — wel een expliciete regressietest die dat
   vastlegt.
2. **`deletedAt` blijft ongelijk aan `null`**, dus de resurrectiepreventie in
   `mergeGames()` blijft exact werken.

Wat er wél bij hoort: `firestore.rules` heeft hiervoor een tweede
update-tak nodig naast de bestaande tombstonepatch (die eist juist
`deletedAt == null`). Die tak eist samen: al getombstoned, `deletedAt` ouder
dan 90 dagen, `redactedAt is timestamp`, `revision + 1`, en een
`affectedKeys().hasOnly([...])`-allowlist over precies de leeg te maken velden
plus `redactedAt`/`revision`. Wie dat mag: `organizationOwner`, bewust enger
dan de `canManageTeamData` die de tombstone zelf mag zetten.

### 3.4 Uitnodigingen: het gat dat nu open staat

Twee losse problemen, allebei vandaag reëel:

1. **Een `pending` uitnodiging veroudert niet.** De Rules staan accepteren toe
   zolang `status == 'pending'`, ongeacht ouderdom. Een uitnodiging uit 2026
   is in 2028 nog steeds inwisselbaar door wie dat e-mailadres dan beheert.
   Besluit: `request.time < resource.data.invitedAt + duration.value(30, 'd')`
   toevoegen aan de accepteertak (`invitedAt` is het bestaande aanmaakveld op
   `InvitationDocument`, er is geen `createdAt`). Dat is een pure
   aanscherping, geen nieuw pad, en negatief testbaar in de Emulator.
2. **Een terminale uitnodiging is onverwijderbaar en houdt een e-mailadres
   vast.** Besluit: één nieuwe, enge `allow delete` — alleen
   `organizationOwner`/`organizationAdmin`, alleen bij `status in ['claimed',
   'revoked']`, en alleen als de bijbehorende eindtijdstempel ouder is dan 30
   dagen. Dat is een bewuste uitzondering op de "geen hard delete"-lijn van
   dit project, en de rechtvaardiging is expliciet: dit document bestaat
   vrijwel volledig uit een persoonsgegeven en heeft na afronding geen
   operationele functie meer.

   Twee schemadetails die hierbij horen en waar de implementatie niet
   overheen mag lezen:

   - **Er bestaat geen `revokedAt`.** De intrekpatch staat vandaag alleen
     `affectedKeys().hasOnly(['status'])` toe, dus een ingetrokken uitnodiging
     draagt geen eigen eindtijdstempel. Besluit: de intrekpatch uitbreiden
     naar `hasOnly(['status', 'revokedAt'])` met `revokedAt is timestamp`, en
     de nieuwe deleteregel op dat veld laten steunen. Bestaande, vóór 8.3c
     ingetrokken uitnodigingen missen het veld; die vallen dan terug op
     `invitedAt` als ondergrens — dezelfde backward-compat-defaulting als
     `completedGames` bij `revision`/`deletedAt`, met een
     `('revokedAt' in resource.data)`-check zodat een ontbrekend veld geen
     evaluatiefout geeft.
   - **`claimedAt` is optioneel** (`assertOptionalTimestamp`). Dezelfde
     aanwezigheidscheck geldt dus ook voor de `claimed`-tak.

Punt 1 is strikt genomen een securityaanscherping en zou ook los van 8.3c in
`docs/security-threat-model.md` als bevinding kunnen landen. Voorstel is om
het in 8.3c mee te nemen, omdat het inhoudelijk over bewaartermijnen gaat.

## 4. E.3 — Sole owner en accountverwijdering

### 4.1 Bevestiging van de plan-aanbeveling

Overgenomen zoals plan §E.3 voorstelt, met een uitwerking die op de echte
Rules past:

- Accountverwijdering raakt **nooit** een organisatie van een andere
  eigenaar. Per organisatie wordt afzonderlijk beoordeeld wat er moet
  gebeuren.
- Een `organizationOwner` die de enige owner is, kan zijn account niet
  verwijderen zonder eerst één van twee dingen te doen:
  1. **eigendom overdragen**, of
  2. **de organisatie exporteren en verwijderen** via §2.
- Er wordt **nooit** automatisch een willekeurige admin tot owner
  gepromoveerd. Eigendom krijgen is een bewuste handeling, geen bijwerking van
  andermans vertrek.

### 4.2 Hoe overdracht werkt met de bestaande Rules

Dit is geen theorie: het werkt vandaag al, in twee stappen, zonder
Rules-wijziging.

1. Owner A promoveert lid B naar `organizationOwner` (owner mag andermans
   membership onbeperkt wijzigen, `:557`).
2. B verwijdert het membership van A (owner mag andermans membership
   verwijderen, `:542`).

Stap 2 vereist dus een handeling van B. Dat is een feature, geen bug: het
bewijst dat de nieuwe eigenaar bestaat, kan inloggen en de organisatie
daadwerkelijk heeft overgenomen. De UI moet dit als expliciete tweestapsflow
tonen ("wacht op bevestiging door de nieuwe eigenaar"), niet als iets dat A
alleen kan afronden.

### 4.3 Eén Rules-toevoeging: organisatie verlaten

Vandaag kan **niemand** zichzelf uit een organisatie verwijderen (§1.2, punt
2). Voor een coach, scorer of viewer die van club wisselt betekent dat: je
e-mailadres blijft in `organizationMembers` staan tot iemand anders je
eruit haalt.

Besluit: een nieuwe, enge `allow delete` op `organizationMembers/{uid}` —
`request.auth.uid == uid` **en** `resource.data.role != 'organizationOwner'`.
Een owner kan zichzelf dus nog steeds niet verwijderen, waardoor de invariant
"een organisatie raakt nooit ongemerkt zonder owner" gewoon blijft staan; die
weg loopt via §4.2 of §2.

Verfijning uit de bevestigingsronde: **dezelfde regel is ook nodig op
`teamMembers/{uid}`.** Een coach of scorer heeft naast zijn
`organizationMembers`-rij ook één of meer `teamMembers`-documenten met
dezelfde uid. Dekt de self-delete alleen de eerste, dan blijven er na het
"verlaten" weesdocumenten met die uid achter — precies wat plan §C 8.3c
acceptatie verbiedt ("geen orphan-subcollecties"). De volgorde is daarbij
dwingend: eerst de `teamMembers`-documenten, dan als laatste de
`organizationMembers`-rij, want met het verdwijnen van die laatste vervalt de
toegang tot de rest van de organisatie.

Let op de volgorde-consequentie: zodra iemand zijn membership verwijdert,
verliest hij ook de leestoegang tot die organisatie. De readback "er staat
geen document meer met mijn uid of e-mailadres" moet dus **per organisatie
plaatsvinden vóór** het eigen membership wordt verwijderd, niet erna. Dat
hoort expliciet in het coordinatorontwerp en in de tests.

### 4.4 Auth-verwijdering als aparte, laatste stap

Firebase vereist recente authenticatie voor `deleteUser()`. Voorgestelde
volgorde, met een hervatbare status per stap:

1. Inventariseer alle organisaties waarin de gebruiker lid is.
2. Handel elke organisatie af: verlaten (§4.3), overdragen (§4.2) of een
   verwijderverzoek indienen (§2). Zolang één organisatie een lopend
   verwijderverzoek heeft, blijft de accountverwijdering in de status
   "wacht op uitvoering".
3. Verwijder per organisatie de uitnodigingen die op het e-mailadres van deze
   gebruiker staan en al terminaal zijn (§3.4, punt 2) — dit is de reden dat
   die Rules-uitzondering nodig is; zonder haar blijft het e-mailadres na een
   "voltooide" accountverwijdering gewoon in Firestore staan.
4. Doe de readback per organisatie, vóór het eigen membership verdwijnt.
5. Vraag om reauthenticatie.
6. Roep `deleteUser()` aan.

Harde eis, uit plan §C 8.3c werk 5: **nooit "account verwijderd" tonen zolang
één kant nog persoonsgegevens bevat.** Faalt stap 6 na een geslaagde
Firestore-opruiming, dan is de status "Firestore-data verwijderd,
Auth-account nog aanwezig — hervatbaar", niet "gelukt".

## 5. Wat dit betekent voor de omvang van 8.3c

Bevestigd in dezelfde ronde: **8.3c wordt in twee PR's geknipt**, zelfde reden
en zelfde patroon als de 8.3b-splitsing (plan §B.1, "vermijd één grote PR").
De knip is ook inhoudelijk schoon — 8.3c-1 gaat over data, 8.3c-2 over
personen:

### 8.3c-1 — bewaarbeleid en organisatieverwijdering

**Rules (drie gerichte wijzigingen, elk positief én negatief te testen):**

1. nieuw pad `deletionRequests/current` met create-only kernvelden en
   revisie-bewaakte statuspatches (géén 7-dagengrens in Rules — zie §2.5);
2. tweede update-tak op `completedGames` voor de redactiepatch, met de
   90-dagen-ondergrens, inclusief het wissen van `deletedBy`;
3. `allow delete` op terminale `invitations` ouder dan 30 dagen, een
   30-dagen-vervaltermijn op de accepteertak, en `revokedAt` toevoegen aan de
   allowlist van de intrekpatch.

**Domein/applicatie:** puur verwijderverzoekmodel (toestandsmachine,
blokkerende voorwaarden inclusief de `lastWriterActivityAt`-verfijning,
`exportProof`-koppeling aan de 8.3b-hash).

**UI:** owner-only "organisatie verwijderen"-flow met sterke bevestiging en
zichtbare blokkades, plus het owner-only **opruimoverzicht** uit §3.1: hoeveel
tombstones over de 90 dagen zijn, hoeveel terminale uitnodigingen over de 30
dagen, hoeveel verlaten wedstrijden. Dat overzicht is wat een bewaartermijn
van een belofte in een werkend beleid verandert, en het leest exact dezelfde
paden als de bestaande 8.3b-exportgateway.

**Documentatie:** `docs/pr-8.3c-runbook.md` met de handmatige uitvoering en de
7-dagendiscipline, inclusief de expliciete eis dat er geen service-accountkey
in Git, browser of logs komt (het runbook gebruikt de ingelogde Firebase
CLI-sessie van de beheerder, geen sleutelbestand), plus een gemeten
testuitvoering op een fictieve organisatie in de emulator/staging.

### 8.3c-2 — accountverwijdering en organisatie verlaten

**Rules (één wijziging, twee paden):** self-delete op
`organizationMembers/{uid}` **en** `teamMembers/{uid}` voor de eigen uid,
behalve voor `organizationOwner` (§4.3).

**Domein/applicatie:** accountverwijdercoördinator met per-organisatiestatus,
hervatbaarheid en de readbackvolgorde uit §4.3/§4.4.

**UI:** "organisatie verlaten" voor niet-owners; "account verwijderen" met de
stappenstatus uit §4.4; de tweestapsoverdracht uit §4.2 met een expliciete
"wacht op bevestiging door de nieuwe eigenaar"-status. Alles NL/EN, met axe-,
focus-, Escape- en focusrestoredekking op elke nieuwe dialoog (plan §D).

### Tests, over beide PR's verdeeld

De volledige negatieve matrix uit plan §C 8.3c werk 6 — crash/retry, dubbele
aanvraag, ingetrokken ownerrol tijdens uitvoering, cross-org-ID, onverwachte
subcollectie, meer dan één batch, serverreject, en een mislukte Auth-delete na
geslaagde Firestore-opruiming. Elke PR draagt de tests van zijn eigen scope;
8.3c-2 hergebruikt de emulatorharnas uit 8.3c-1.

## 6. Wat 8.3c bewust niet doet

- Geen Cloud Function, geen `functions/`-workspace, geen Blaze, geen
  billingkoppeling, geen deployment.
- Geen automatische purge en geen TTL-policy — die bestaan niet op Spark, en
  dit document claimt ze nergens.
- Geen hard delete op `games`, `actions`, `migrationRuns` of niet-getombstonede
  `completedGames`.
- Geen wijziging aan het Nederlandse CSV-contract, aan statistiekberekeningen
  of aan bestaande `localStorage`-keys.
- Geen "undelete" van een getombstonede wedstrijd.
- Geen recursieve clientdelete en geen door de client aangeleverd Firestore-pad
  (plan §F).

## 7. Openstaande punten, te verifiëren bij uitvoering

1. De 30/90/180-dagentermijnen zijn een productvoorstel, geen juridisch
   advies. Zolang er alleen fictieve data is, is dat prima; vóór de
   PR 8.5-cutover met echte spelersdata hoort hier een expliciete toets tegen
   de dan geldende verplichtingen, inclusief het punt dat spelersnamen deels
   minderjarigen betreffen.
2. De exacte Firebase CLI-commando's van het runbook moeten op de
   uitvoeringsdatum tegen de dan actuele CLI-versie geverifieerd worden, niet
   uit dit document overgenomen.
3. Prijzen, quota en de beschikbaarheid van TTL/PITR/backups worden in 8.3d
   opnieuw op datum geverifieerd (plan §B.6).
4. Als §E.5 later alsnog Blaze goedkeurt, moet §2.4 trigger 3 opnieuw
   beoordeeld worden vóórdat 8.3c gemerged is — dan is optie B mogelijk
   goedkoper dan het runbook.

## 8. Bevestiging

**Bevestigd door de eigenaar op 8 september 2026.** Alle zeven punten zijn
aangenomen zoals voorgesteld, met vier verfijningen die uit de
bevestigingsronde zelf voortkwamen en hierboven al verwerkt zijn.

- [x] **E.1** — Verwijdermodel: eigenaar-geïnitieerd verwijderverzoek in de
      app plus een getest handmatig beheerrunbook. Geen Cloud Function en geen
      Blaze in 8.3c. De vier triggers uit §2.4 zijn vastgelegd als moment om
      dit te herzien.
- [x] **E.1a** — Blokkades en wachttijd, met verfijning: de blokkade op
      niet-afgeronde wedstrijden hangt aan `lastWriterActivityAt` in plaats van
      aan louter bestaan, en de 7 dagen bedenktijd is runbookdiscipline in
      plaats van een Rules-ondergrens (§2.5).
- [x] **E.2** — Bewaartermijnen zoals in de tabel van §3.2, als *ondergrenzen*
      met een handmatig purgepad, aangevuld met het owner-only opruimoverzicht
      uit §3.1.
- [x] **E.2a** — Een verlopen tombstone wordt geredigeerd, niet hard
      verwijderd, en bij die redactie wordt ook `deletedBy` op `null` gezet
      (§3.3).
- [x] **E.2b** — De twee uitnodigingswijzigingen uit §3.4: een vervaltermijn
      van 30 dagen op accepteren, en een enge deleteregel voor terminale
      uitnodigingen ouder dan 30 dagen, inclusief het nieuwe `revokedAt`-veld.
- [x] **E.3** — Sole-owner/accountdelete zoals §4: eerst overdragen of
      exporteren-en-verwijderen, nooit automatische promotie, Auth-delete als
      laatste aparte stap, en nooit een vals "account verwijderd".
- [x] **E.3a** — Self-delete voor niet-owners ("organisatie verlaten"), op
      `organizationMembers` **en** `teamMembers`, in die volgorde (§4.3).

Aanvullend bevestigd: **8.3c wordt gesplitst in 8.3c-1 (data) en 8.3c-2
(personen)**, zie §5.

### De vier verfijningen, op één rij

1. De wachttijd van 7 dagen staat in het runbook, niet in de Rules — anders is
   de verwijderflow niet in één sessie testbaar.
2. De wedstrijdblokkade hangt aan recente `lastWriterActivityAt`, zodat één
   vergeten wedstrijd een organisatie niet permanent onverwijderbaar maakt.
3. Bij redactie van een tombstone wordt ook `deletedBy` gewist.
4. De self-delete dekt ook `teamMembers`, anders blijven er weesdocumenten met
   de eigen uid achter.

### Wat hiermee vervalt en wat blijft staan

De startblokkade uit plan §C 8.3c is hiermee **opgeheven**: 8.3c-1 kan als
implementatie-PR starten. Onveranderd blijven de stopregels uit plan §F en
§6 hierboven — geen Cloud Function, geen Blaze, geen billingkoppeling, geen
deployment, geen productiecutover. De openstaande punten uit §7 blijven
openstaan; met name punt 1 (een juridische toets op de termijnen vóór er
echte spelersdata in productie staat) is een harde voorwaarde voor de
PR 8.5-cutover, niet voor 8.3c.
