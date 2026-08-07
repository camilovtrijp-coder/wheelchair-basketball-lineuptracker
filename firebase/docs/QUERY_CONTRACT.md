# Querycontract — closure-document voor issue #28 en #31

**Status:** issue #28 opgelost in PR 5.1; issue #31 opgelost in PR 5.2.
Onderdeel van `docs/IMPLEMENTATION_PLAN.md` §9/§10 en ADR-003
§"Querycontracten".

## Aanleiding

De begrensde Firebase-spike (PR 4.4/#26) bewees directe-padtoegang
(`getDoc` op een bekend `organizations/{orgId}/...`-pad) sluitend cross-org
geïsoleerd is. Ze bewees dit **niet** voor een *echte query* — met name de
contextwisselaar-behoefte "alle organisaties waar ik lid van ben", die per
definitie niet één bekend pad heeft. `collectionGroup`-queries bleven
daarom verboden totdat dit document er was, samen met de
positieve/negatieve Emulator-tests die het bewijzen (issue #28, hard voor
PR 5.1/5.2). PR 5.2's contextwisselaar bracht een tweede, verwante behoefte
aan het licht: een gebruiker met **uitsluitend** een `teamMembers`-document
(geen `organizationMembers`) had via de eerste query geen enkele manier om
zijn/haar eigen team-only toegang te vinden (issue #31) — vandaar het tweede
contract hieronder, exact hetzelfde patroon toegepast op `teamMembers`.

## Het contract

**De enige twee toegestane niet-directe queries in de hele applicatie zijn:**

```ts
collectionGroup(db, 'organizationMembers').where('uid', '==', eigenUid)
collectionGroup(db, 'teamMembers').where('uid', '==', eigenUid)
```

Elke andere vorm — zonder `where`-filter, met een `where`-waarde die niet
gelijk is aan de eigen `request.auth.uid`, `orderBy` zonder gelijkheidsfilter
op `uid`, of een `collectionGroup`-query op een andere collectienaam dan
`organizationMembers`/`teamMembers` — blijft **verboden** totdat er een even
expliciet contract + Rules-tests voor bestaat.

## Waarom dit veilig is (en wat empirisch anders bleek dan aanvankelijk gedacht)

`organizations/{orgId}/organizationMembers/{uid}` gebruikt de UID als
document-ID (ADR-003). De aanvankelijke aanname was dat de bestaande geneste
leesregel (`match /organizations/{orgId}/organizationMembers/{uid} { allow
read: if isOrgMember(orgId); }`) al voldoende zou zijn: Firestore herbindt
padwildcards zoals `{orgId}` immers per kandidaat-document. Dat klopt voor
directe `getDoc`-paden (bewezen in `cross-org-isolation.spec.ts` en
`membership-and-roles.spec.ts`), maar **niet** voor een `collectionGroup`-
LIST-query: elke poging gaf empirisch `FirebaseError: No matching allow
statements`, ook met de simpelst mogelijke voorwaarde
(`resource.data.uid == request.auth.uid`, zonder enige `get()`/`exists()`).

De daadwerkelijke oorzaak: Firestore autoriseert een `collectionGroup`-query
alléén via een **recursieve-wildcard match** (`match /{path=**}/<collectie>/{id}`)
— een geneste, vaste match zoals hierboven governeert wél directe paden,
maar wordt kennelijk niet geraadpleegd voor collection-group-LIST-autorisatie,
ongeacht de complexiteit van de voorwaarde erin. `firestore.rules` bevat
daarom een aparte regel onderaan het bestand:

```
match /{path=**}/organizationMembers/{uid} {
  allow read: if signedIn() && resource.data.uid == request.auth.uid;
}
```

Deze regel is bewust smal: geen `get()`/`exists()`, alleen een vergelijking
van `resource.data.uid` (het nieuwe veld) met `request.auth.uid` — precies
wat Firestore voor een LIST-query vooraf kan bewijzen zonder de query zelf
uit te voeren. Ze staat volledig los van de bestaande geneste regel (die
blijft gelden voor directe paden, incl. het lezen van collega's binnen
dezelfde organisatie) en breidt de toegang niet uit: een gebruiker kan via
deze regel nooit meer lezen dan zijn/haar eigen membershipdocument, in welke
organisatie dan ook.

Het `uid`-veld op `organizationMembers/{uid}` (zie
`firebase/src/documents/organizationMember.ts`) is dus **wél** de kern van
de oplossing — niet alleen functioneel (filteren op UID), maar ook
veiligheidsbepalend (het is de enige voorwaarde die de recursieve match mag
gebruiken). `firestore.rules` valideert bij elke `organizationMembers`-create
dat `uid` gelijk is aan de document-ID/eigen `request.auth.uid`, zodat het
veld altijd betrouwbaar is en nooit kan afwijken van de document-ID.

Issue #31 past exact hetzelfde patroon toe op `teamMembers/{uid}` (zie
`firebase/src/documents/teamMember.ts`): een `uid`-veld, verplicht en gelijk
aan de document-ID bij create, onveranderlijk bij update, en een eigen
recursieve-wildcard match (`match /{path=**}/teamMembers/{uid}`) — zie
`firestore.rules`. Een team-only lid (uitsluitend een `teamMembers`-document,
geen `organizationMembers`) kan via deze route nooit meer lezen dan zijn/haar
eigen teamMembers-document, in welk team/welke organisatie dan ook.

**Organisatienaam voor team-only leden.** `organizations/{orgId}` blijft
bewust `allow read: if isOrgMember(orgId)` — dit contract verbreedt die regel
NIET naar "alle ingelogde gebruikers" of "iedereen met een teamMembers-
document ergens in deze org" (dat laatste is met Rules ook niet praktisch
uit te drukken zonder een specifiek teamId te kennen). In plaats daarvan
draagt `teams/{teamId}` nu een gedenormaliseerd `orgName`-veld (zie
`firebase/src/documents/team.ts`), geschreven bij team-create door de
org-owner/-admin die de organisatienaam toch al kent. Een team-only lid
heeft via `canReadTeam` (ongewijzigd: `isOrgMember(orgId) ||
isTeamMember(orgId, teamId)`) al directe leestoegang tot zijn/haar eigen
teamdocument, en dus tot deze kopie van de naam — zonder dat de organisatie
zelf ooit breder leesbaar wordt.

## Index

`firestore.indexes.json` bevat expliciete `fieldOverride`s die
`organizationMembers.uid` én `teamMembers.uid` op `COLLECTION_GROUP`-scope
indexeren — zonder deze overrides kan Firestore de toegestane queries niet
uitvoeren.

## Empirisch bewijs

`tests/rules/context-switcher-query.spec.ts` (issue #28, `organizationMembers`):

- **Positief:** een gebruiker met memberships in twee organisaties krijgt via
  het contract precies die twee documenten terug (`uid`-veld matcht,
  organisatie-ID's kloppen).
- **Negatief — crafted uid:** een gebruiker die slechts lid is van één
  organisatie krijgt via `where('uid','==', <andermans uid>)` geen enkel
  document van een organisatie waar hij geen lid van is, ongeacht of
  Firestore de query afwijst of een lege resultatenset teruggeeft (beide zijn
  een veilige uitkomst — de test accepteert expliciet allebei).
- **Negatief — ongefilterde query:** dezelfde garantie zonder `where`-filter.
- **Regressie:** de bestaande directe-padisolatietest
  (`tests/rules/cross-org-isolation.spec.ts`) blijft ongewijzigd slagen.

**Review-opvolging (#29, P1 — blocker):** het contract steunt volledig op de
aanname dat `resource.data.uid` altijd gelijk is aan de document-ID. Die
invariant werd bij *create* al afgedwongen, maar niet bij *update* — een
owner/admin kon het `uid`-veld van andermans membership laten afwijken zonder
dat er een aparte Rules-check op lette. Dat zou de query-uitkomst kunnen
corrumperen: het membership zou onvindbaar worden voor de echte eigenaar
en/of zichtbaar voor een outsider op wiens uid de vervalsing mikte. Beide
owner- en admin-updateregels in `firestore.rules` eisen nu expliciet
`request.resource.data.uid == uid && request.resource.data.uid ==
resource.data.uid`. Bewezen in `tests/rules/self-promotion.spec.ts`
(negatieve update-pogingen voor owner en admin, elk gevolgd door een
outsider-contextquery die aantoont dat er niets lekt).

`tests/rules/team-context-switcher-query.spec.ts` (issue #31, `teamMembers`):

- **Positief:** een team-only lid (geen `organizationMembers`) met toegang
  tot teams in twee verschillende organisaties krijgt via het contract
  precies die twee teamMembers-documenten terug, mét een leesbare
  organisatienaam via het gedenormaliseerde `orgName`-veld op het teamdocument.
- **Negatief — crafted uid / ongefilterde query:** zelfde bewijslast als bij
  `organizationMembers` hierboven, nu voor `teamMembers`.
- **Negatief — zelf-promotie:** een create/update-poging met een afwijkend
  `uid`-veld op `teamMembers` wordt geweigerd, met een outsider-contextquery
  die aantoont dat er niets lekt (zelfde patroon als `self-promotion.spec.ts`).
- **Regressie:** bestaande team-/rolisolatietests blijven ongewijzigd slagen.
- **Organisatienaam-isolatie:** een team-only lid kan `organizations/{orgId}`
  zelf nog steeds niet direct lezen (`isOrgMember(orgId)` blijft false) —
  alleen de kopie op het eigen teamdocument is bereikbaar.

## Buiten scope van dit contract

- Wedstrijd-/actiepaden (`games`, `actions`): default-deny tot Fase 7, geen
  querycontract nodig zolang die paden niet bestaan.
- Elke toekomstige nieuwe query (bijv. voor wedstrijdhistorie of statistieken
  in Fase 6/7) vereist een eigen, even expliciet vastgelegd en beproefd
  contract — dit document dekt uitsluitend de twee contextwisselaar-queries
  hierboven.
