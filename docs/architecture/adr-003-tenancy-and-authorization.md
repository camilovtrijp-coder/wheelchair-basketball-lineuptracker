# ADR-003: Organisaties, teams en autorisatie voor v2

## Status

**Geaccepteerd — 5 augustus 2026.** De openstaande vraag uit het concept is door de projecteigenaar beantwoord; zie §"Besluit van de eigenaar". In PR 4.4 is de claimstap aangescherpt tot een door Security Rules afgedwongen atomaire batch, zodat een uitnodiging niet kan worden hergebruikt nadat een membership is verwijderd.

Voert PR 4.3 uit zoals gescoped in `docs/IMPLEMENTATION_PLAN.md` §9, en bouwt voort op [ADR-001](./adr-001-cloud-data-platform.md) (backend: Firebase) en [ADR-002](./adr-002-offline-sync-strategy.md) (offline-synccontract: append-only acties, altijd met organisatie/teamcontext). Dit ADR legt vast **wie wat mag** — de laatste van de drie fase-4-ADR's vóór de begrensde spike (PR 4.4).

## Context

Niet-onderhandelbare eis uit §3: *"Gebruik één globale gebruikersidentiteit met app-level organisaties, teams en memberships; maak geen Firebase-project per club."* Eén coach moet dus, zonder opnieuw in te loggen, kunnen wisselen tussen bijvoorbeeld `Rotterdam Basketball` en de `Nederlandse Basketball Bond`, met een andere rol per context.

De kern van dit ADR is een subtiel, makkelijk fout te ontwerpen beveiligingsprobleem: **hoe krijgt een uitgenodigde gebruiker een membership, zonder dat een kwaadwillende gebruiker zichzelf een membership kan toekennen?** Firestore Security Rules draaien clientside-vertrouwd (geen serverlogica tenzij je een Cloud Function toevoegt), dus dit moet zorgvuldig met alleen Rules + documentstructuur worden opgelost, of expliciet gemotiveerd worden waarom een serverfunctie nodig is — precies wat §9/PR 4.3 vereist.

## Datamodel

Ongewijzigd overgenomen uit `platform-evaluation.md`, hier bevestigd als bindend:

```text
users/{uid}
organizations/{organizationId}
organizations/{organizationId}/organizationMembers/{uid}
organizations/{organizationId}/teams/{teamId}
organizations/{organizationId}/teams/{teamId}/teamMembers/{uid}
organizations/{organizationId}/teams/{teamId}/seasons/{seasonId}
organizations/{organizationId}/teams/{teamId}/settings/current
organizations/{organizationId}/teams/{teamId}/players/{playerId}
organizations/{organizationId}/teams/{teamId}/games/{gameId}
organizations/{organizationId}/teams/{teamId}/games/{gameId}/actions/{actionId}
```

Elk membershipdocument gebruikt de **UID als document-ID** (`organizationMembers/{uid}`, niet een autogenereerde ID). Dit is een bewuste keuze: het maakt "is deze gebruiker lid" een directe, goedkope `exists()`-check in Security Rules op een voorspelbaar pad, in plaats van een query die Rules niet kunnen filteren (Firestore Rules zijn geen queryfilters — een breed opgezette query die op toevallige wijze alleen toegestane resultaten teruggeeft, is geen beveiliging).

## Rollen

| Rol | Bevoegdheden |
|---|---|
| `organizationOwner` | Organisatie, eigenaarschap, leden, export en verwijdering |
| `organizationAdmin` | Teams en memberships beheren, geen eigenaarschap overdragen |
| `coach` | Roster, wedstrijden en teaminstellingen beheren |
| `scorer` | Wedstrijdacties schrijven (spiegelt ADR-002's single-writer-model), roster niet beheren |
| `viewer` | Alleen lezen |

Rollen zijn per organisatie/team-context, niet globaal: dezelfde gebruiker kan `organizationOwner` zijn bij Rotterdam Basketball en tegelijk `viewer` bij de NBB.

## Zelf eerste organisatie/team aanmaken; verdere toegang via uitnodiging

Een nieuwe gebruiker mag na registratie **zelf** één eerste organisatie en team aanmaken (wordt daarmee automatisch `organizationOwner`). Alle verdere leden komen uitsluitend via een uitnodiging van een bestaande owner/admin — nooit door zelf een membership bij een bestaande organisatie te claimen.

## Uitnodigingsflow: Rules-only, geen Cloud Function nodig

Dit is het kernontwerp dat PR 4.3 expliciet vereist te bewijzen of te motiveren. **Voorstel: een Rules-only ontwerp, geen serverfunctie, geen Blaze-vereiste voor deze flow.**

### Documentstructuur

```text
organizations/{organizationId}/invitations/{invitationId}
  email: string          // genormaliseerd, lowercase
  role: string            // toegekende rol bij acceptatie
  status: "pending" | "accepted" | "claimed" | "revoked"
  invitedBy: uid
  invitedAt: timestamp
  acceptedAt: timestamp | null
  claimedAt: timestamp | null
```

### Rules-ontwerp (in pseudocode, uit te werken als daadwerkelijke `firestore.rules` in PR 5.1)

1. **Aanmaken van een uitnodiging** (`invitations/{invitationId}`, create): alleen toegestaan als `request.auth` een bestaand `organizationMembers/{uid}`-document heeft met rol `organizationOwner` of `organizationAdmin` in dezelfde organisatie. `email` en `role` worden bij aanmaak vastgelegd; `status` moet `"pending"` zijn.
2. **Accepteren van een uitnodiging** (`invitations/{invitationId}`, update): alleen toegestaan als `request.auth.token.email` gelijk is aan `resource.data.email` (Firebase Authentication's e-mailverificatie is hier het vertrouwde anker) én de wijziging **uitsluitend** `status` (naar `"accepted"`) en `acceptedAt` raakt — geen enkel ander veld, zeker niet `role`.
3. **Membership atomair claimen** (`organizationMembers/{uid}` create + `invitations/{invitationId}` update in één Firestore-batch): alleen toegestaan als:
   - `request.auth.uid == uid` (je kunt uitsluitend je eigen membershipdocument aanmaken, nooit dat van een ander — dit is de kern van "geen self-grant voor een ander");
   - er een `invitations/{invitationId}`-document bestaat in dezelfde organisatie met `email == request.auth.token.email` en `status == "accepted"`;
   - `request.resource.data.role == invitation.data.role` — de geclaimde rol moet exact overeenkomen met wat de uitnodiging toekende; een gebruiker kan zichzelf dus nooit een hogere rol geven dan waarvoor hij is uitgenodigd.
   - de uitnodiging in dezelfde batch van `accepted` naar `claimed` gaat en uitsluitend `status` en `claimedAt` wijzigt; Rules gebruiken `getAfter()`/`existsAfter()` om beide writes te koppelen. Een losse membership-write of losse claimed-update wordt geweigerd.
4. **Wijzigen/verwijderen van andermans membership** (rol aanpassen, toegang intrekken): alleen toegestaan voor een owner/admin in dezelfde organisatie, nooit door de gebruiker zelf. Een admin mag een bestaande owner niet wijzigen/verwijderen en niemand naar `organizationOwner` promoveren; alleen een owner mag owner-rollen beheren.

Dit ontwerp heeft geen Cloud Function nodig: elke stap is een Rules-`get()`/`exists()`/`getAfter()`-check op een voorspelbaar pad (het eigen uid, of een specifiek invitation-ID dat de client al kent uit de uitnodigings-e-mail/-link). Er is geen stap die serverlogica vereist zoals het automatisch aanmaken van het membership namens de gebruiker.

**Bekende beperking, expliciet geaccepteerd voor v1**: dit ontwerp vertrouwt op Firebase Authentication's e-mailverificatie (`request.auth.token.email`) als anker. Een gebruiker die zijn e-mailadres nog niet heeft geverifieerd, zou in theorie een uitnodiging voor een ander (nog niet geregistreerd) e-mailadres kunnen proberen te claimen als hij dat adres later zelf verifieert. **Mitigatie**: Rules vereisen aanvullend `request.auth.token.email_verified == true` voor stap 2 (accepteren). Dit wordt in PR 5.1 als expliciete Emulator-test opgenomen (positief: geverifieerd e-mailadres kan accepteren; negatief: ongeverifieerd e-mailadres kan niet).

### Wat dit ADR **niet** oplost (bewust doorgeschoven)

- **Laatste eigenaar beschermen**: Firestore Rules kunnen niet efficiënt "is dit de enige owner" controleren zonder een niet-schaalbare query over alle memberships. Voorstel: dit wordt **niet** in Security Rules afgedwongen (te fragiel/complex voor v1), maar in de **application-laag** (een `removeOrganizationMember`/`downgradeRole`-use-case telt eerst de overige owners en weigert clientside als dat de laatste zou zijn). Dit is een zachtere garantie dan een Rules-afdwinging — expliciet gedocumenteerd als een geaccepteerde beperking, te herzien als dit in de praktijk een probleem blijkt (dan alsnog een begrensde Cloud Function overwegen, met een aparte Blaze-goedkeuring zoals §9 vereist).
- **Uitnodiging intrekken vóór acceptatie**: eenvoudig — owner/admin zet `status` op `"revoked"`; Rules voor stap 3 hierboven controleren al op `status == "accepted"`, dus een ingetrokken uitnodiging kan sowieso niet meer tot een membership leiden.

## Querycontracten

Elke query in de applicatiecode moet dezelfde organisatie-/teamscope bevatten als de Rules controleren — Rules filteren geen brede queries, ze wijzen ze af. Concreet: een query naar `organizations/{orgId}/teams/{teamId}/players` faalt in de Emulator als de aanvrager geen `teamMembers/{uid}`-document heeft in exact dat pad, ongeacht hoe de query zelf is samengesteld. Dit wordt in PR 5.1 bewezen met een negatieve test: organisatie A kan organisatie B niet lezen, ook niet via een anders samengestelde query.

## Verwijdering, bewaartermijnen en minimale persoonsgegevens

- **Account-/teamverwijdering**: een `organizationOwner` kan de organisatie verwijderen; dit is een beheeractie die in PR 8.3 (beveiliging, privacy, kosten en beheer) een concreet bewaarbeleid en auditlog krijgt — hier alleen vastgelegd dat de bevoegdheid bij de owner ligt, niet de uitvoeringsdetails.
- **Minimale persoonsgegevens**: spelersdata blijft beperkt tot naam, rugnummer, classificatie en de bestaande categorievlaggen (`vrouw`/`jeugd`) — exact wat v1 al opslaat, geen uitbreiding. Geen geboortedatum, geen medische gegevens. Dit is al vastgelegd in `platform-evaluation.md` §"Productstandaarden" en wordt hier herbevestigd, direct relevant voor het AVG-besluit in ADR-001 §5 (de afweging daar steunt expliciet op deze beperkte gevoeligheid).
- **Bewaartermijn na accountverwijdering**: nog niet vastgelegd — expliciet doorgeschoven naar PR 8.3, zelfde patroon als het Firestore-back-upbeleid in ADR-001 en het tombstone-bewaarbeleid in ADR-002.

## Contextwisselaar (UI-consequentie, geen Rules-consequentie)

De contextwisselaar toont uitsluitend organisatie/teamcombinaties waarvoor een geldig `organizationMembers`/`teamMembers`-document bestaat — nooit een lijst die clientside gefilterd wordt op een breder resultaat (dat zou dezelfde fout zijn als een te brede query in de vorige paragraaf). Tijdens een actieve wedstrijd is de context vergrendeld (spiegelt ADR-002's single-writer-model); wisselen kan pas na afronden of een expliciete, sterke bevestiging.

## Overwogen alternatieven (verworpen)

- **Cloud Function voor het aanmaken van memberships bij acceptatie**: verworpen als primair ontwerp. Het Rules-only-ontwerp hierboven dekt dezelfde beveiligingseis zonder de operationele last (Blaze-vereiste, koude-start-latency, een extra stuk serverlogica om te testen en te onderhouden) van een Cloud Function. Blijft een optie als de Emulator-tests in PR 5.1 een gat in het Rules-only-ontwerp blootleggen.
- **Eén Firebase-project per organisatie/club**: verworpen, zelfde reden als in ADR-001 — onverenigbaar met één globale gebruikersidentiteit die naadloos tussen organisaties wisselt.
- **Rollen als een enkel globaal veld op `users/{uid}`**: verworpen. Een rol is per organisatie/team betekenisvol (dezelfde gebruiker heeft elders een andere rol); een globaal rolveld zou dat onmogelijk maken.

## Gevolgen

- PR 4.4 (begrensde Firebase-spike) moet dit Rules-only-uitnodigingsontwerp voor het eerst in de Emulator bewijzen — positieve en negatieve gevallen, inclusief de `email_verified`-mitigatie.
- PR 5.1 (reproduceerbare Firebase-basis) implementeert de daadwerkelijke `firestore.rules` op basis van dit ontwerp, met de volledige Rules-testsuite.
- PR 5.2 (authenticatie, onboarding, contextwisselaar) implementeert de UI-kant: eerste-organisatie-aanmaak, uitnodiging accepteren, contextwisselaar.
- De "laatste eigenaar"-beperking (application-laag, geen Rules-garantie) is een bewust aanvaard risico dat bij PR 5.1/5.2 als zodanig gedocumenteerd moet worden in de code, niet stilzwijgend.

## Besluit van de eigenaar (5 augustus 2026)

Akkoord met het Rules-only-uitnodigingsontwerp (geen Cloud Function, geen Blaze-vereiste voor deze flow), inclusief de bewust aanvaarde "laatste eigenaar niet Rules-afgedwongen"-beperking in de application-laag. Dit ontwerp gaat als bindend naar PR 4.4 (Emulator-bewijs) en PR 5.1 (daadwerkelijke `firestore.rules`-implementatie).
