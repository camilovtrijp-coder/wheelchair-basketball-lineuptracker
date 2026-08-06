# Querycontract — closure-document voor issue #28

**Status:** opgelost in PR 5.1. Onderdeel van `docs/IMPLEMENTATION_PLAN.md` §9
(PR 5.1) en ADR-003 §"Querycontracten".

## Aanleiding

De begrensde Firebase-spike (PR 4.4/#26) bewees directe-padtoegang
(`getDoc` op een bekend `organizations/{orgId}/...`-pad) sluitend cross-org
geïsoleerd is. Ze bewees dit **niet** voor een *echte query* — met name de
toekomstige contextwisselaar-behoefte "alle organisaties waar ik lid van
ben", die per definitie niet één bekend pad heeft. `collectionGroup`-queries
bleven daarom verboden totdat dit document er was, samen met de
positieve/negatieve Emulator-tests die het bewijzen (issue #28, hard voor
PR 5.1/5.2).

## Het contract

**De enige toegestane niet-directe query in de hele applicatie is:**

```ts
collectionGroup(db, 'organizationMembers').where('uid', '==', eigenUid)
```

Elke andere vorm — zonder `where`-filter, met een `where`-waarde die niet
gelijk is aan de eigen `request.auth.uid`, `orderBy` zonder gelijkheidsfilter
op `uid`, of een `collectionGroup`-query op een andere collectienaam dan
`organizationMembers` — blijft **verboden** totdat er een even expliciet
contract + Rules-tests voor bestaat.

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

## Index

`firestore.indexes.json` bevat een expliciete `fieldOverride` die
`organizationMembers.uid` op `COLLECTION_GROUP`-scope indexeert — zonder deze
override kan Firestore de toegestane query niet uitvoeren.

## Empirisch bewijs

`tests/rules/context-switcher-query.spec.ts`:

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

## Buiten scope van dit contract

- De contextwisselaar-**UI** die deze query daadwerkelijk aanroept: PR 5.2.
- Wedstrijd-/actiepaden (`games`, `actions`): default-deny tot Fase 7, geen
  querycontract nodig zolang die paden niet bestaan.
- Elke toekomstige nieuwe query (bijv. voor wedstrijdhistorie of statistieken
  in Fase 6/7) vereist een eigen, even expliciet vastgelegd en beproefd
  contract — dit document dekt uitsluitend de contextwisselaar-query.
