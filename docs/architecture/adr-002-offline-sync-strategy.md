# ADR-002: Offline-synchronisatiestrategie voor v2

## Status

**Geaccepteerd — 5 augustus 2026.** De twee openstaande vragen uit het concept zijn door de projecteigenaar beantwoord; zie §"Besluiten van de eigenaar".

Voert PR 4.2 uit zoals gescoped in `docs/IMPLEMENTATION_PLAN.md` §9, en bouwt direct voort op [ADR-001](./adr-001-cloud-data-platform.md) (Geaccepteerd, 5 augustus 2026): Firebase Authentication + Cloud Firestore is de gekozen backend. Dit ADR legt vast **hoe** die keuze offline-first courtside-gebruik daadwerkelijk waarmaakt — ADR-001 koos het platform, dit ADR ontwerpt het synchronisatiecontract erbovenop.

## Context

Niet-onderhandelbare eis uit §3 die dit besluit direct raakt: *"Ook na database-introductie moet een wedstrijd zonder netwerk gestart, bijgehouden en afgerond kunnen worden."* Dat is geen bijzaak — het is de kern van waarom Firebase in ADR-001 boven Supabase werd gekozen (ingebouwde offline-schrijfsynchronisatie in de web-SDK). Dit ADR maakt die keuze concreet.

Cloud Firestore's ingebouwde sync lost niet alle domeinproblemen op. Meerdere writes naar hetzelfde document zijn standaard last-write-wins — onbruikbaar voor een live wedstrijd waarin score, speeltijd en segmentstatus reproduceerbaar moeten blijven. Dit ADR ontwerpt daarom bewust **rond** de naïeve document-overschrijf-aanpak.

De schaal is klein en dat is een expliciete aanname: dit is een courtside-app voor één team per wedstrijd, niet een systeem met duizenden gelijktijdige schrijvers. Ontwerpkeuzes die bij internetschaal te simpel zouden zijn (bijv. één actieve scorer i.p.v. echte multi-writer CRDT's) zijn hier bewust toereikend — zie ook §9's fase 9-notitie "echte multi-writer wedstrijdbediening, alleen als single-writer aantoonbaar onvoldoende is".

## Browserondersteuning voor persistente lokale cache — geverifieerd augustus 2026

Firestore's persistente lokale cache (`persistentLocalCache`, de moderne vervanger van het oudere `enablePersistence()`) draait op IndexedDB en wordt officieel ondersteund in **Chrome, Safari en Firefox** — ongewijzigd bevestigd t.o.v. de eerdere evaluatie.

Twee praktische nuances die nog niet eerder expliciet waren vastgelegd:

1. **Safari in privénavigatie heeft beperkte IndexedDB-ondersteuning.** Dit moet expliciet gedetecteerd worden — niet stilzwijgend falen.
2. **Single-tab vs. multi-tab persistence manager is een expliciete keuze in de moderne SDK** (`persistentSingleTabManager()` vs. `persistentMultipleTabManager()`). Voor deze app is **single-tab de juiste startkeuze**: een coach/scorer gebruikt courtside typisch één tabblad op één toestel per wedstrijd; multi-tab voegt complexiteit toe (tabblad-coördinatie) zonder een courtside-behoefte op te lossen. Heroverwegen indien een toekomstige flow bewust meerdere tabbladen tegelijk vereist.

**Fallback bij onbeschikbaarheid**: de officiële SDK-documentatie schrijft voor dat een falende persistence-activering (bijv. IndexedDB uitgeschakeld, quota vol, of niet-ondersteunde context) altijd afgehandeld moet worden zonder de app te breken — de app werkt dan door zonder offline-caching, gedegradeerd maar functioneel. v2 volgt dit: een mislukte cache-activering toont "Lokaal beschikbaar niet gegarandeerd" in plaats van de app te blokkeren.

Bron: Firebase/Google Cloud Firestore-documentatie over offline-toegang, herbevestigd via actuele zoekresultaten augustus 2026 (zelfde bronnen als reeds geciteerd in `platform-evaluation.md`).

## Syncstatuscontract

Elke flow toont exact één van vier toestanden, afgeleid uit Firestore's `fromCache`- en pending-write-metadata (`SnapshotMetadata.fromCache` / `SnapshotMetadata.hasPendingWrites`):

| Toestand | Firestore-metadata | Betekenis voor de gebruiker |
|---|---|---|
| `Lokaal beschikbaar` | `fromCache: true`, geen pending writes | Data komt uit de cache en kan verouderd zijn t.o.v. de server |
| `Wacht op synchronisatie` | `hasPendingWrites: true` | Lokale write is geaccepteerd, nog niet serverbevestigd |
| `Gesynchroniseerd` | `fromCache: false`, geen pending writes | Server heeft de actuele data bevestigd |
| `Actie nodig` | Sync geweigerd (bijv. Security Rules-afwijzing na reconnect) | Vraagt een expliciet gebruikersbesluit; nooit stil verloren |

Een lokaal geaccepteerde write kan na reconnect alsnog door Security Rules worden geweigerd — bijvoorbeeld wanneer toegang tot een organisatie/team is ingetrokken terwijl de write in de wachtrij stond. Dit mag nooit resulteren in stil dataverlies: de wijziging blijft zichtbaar onder `Actie nodig`, lokaal herstelbaar (bijv. terug te zien in de UI) en exporteerbaar naar de bestaande lokale JSON-back-up, zodat de gebruiker niets kwijtraakt ook al kan het niet naar Firestore.

Een nog nooit gecachte teamcontext (eerste bezoek op een nieuw toestel, of een lokaal gewiste cache) toont expliciet dat internet nodig is — de app presenteert een lege cache nooit als "dit team heeft geen spelers".

## Wedstrijdmodel: append-only acties, geen overschreven megadocument

**Verworpen aanpak**: één `game`-document dat bij elke score-, wissel- of segmentmutatie wordt overschreven. Bij last-write-wins-semantiek zou een tweede apparaat (of een herstelde verbinding na een lange offline periode) een eerdere wijziging stil kunnen overschrijven — precies het risico dat §3 verbiedt.

**Gekozen aanpak** (bevestigt en verscherpt het model uit `platform-evaluation.md`):

- `games/{gameId}` bevat identiteit, status en een **afgeleide** snapshot (huidige score, huidige fase) — nooit de bron van waarheid voor mutaties.
- `games/{gameId}/actions/{actionId}` is append-only: elke bevestigde handeling (wissel, segment opgeslagen, score gecorrigeerd) is een eigen, nooit gewijzigd document.
- Elke actie draagt een **clientgegenereerde UUID** als document-ID. Dit maakt retries idempotent: als een write na een timeout opnieuw wordt verstuurd, ontstaat er geen duplicaat — Firestore's `set()` met dezelfde ID overschrijft het identieke document in plaats van een tweede aan te maken.
- Elke actie draagt daarnaast auteur (`uid`), client-ID, een monotoon volgnummer per wedstrijd, tijdstip en de actieve organisatie/teamcontext.
- Score, plus/min en speeltijd blijven **reproduceerbaar** door de acties te herberekenen — nooit uit een gecachete teller die uit sync kan raken. Dit spiegelt exact hoe v1 al werkt (`scoreFor = segments.reduce(...)`, zie `docs/architecture/current-state.md`), nu alleen met Firestore-acties in plaats van een in-memory array.
- Historische spelersgegevens in een actie/snapshot blijven onveranderlijk, ook als het roster later wijzigt (zelfde snapshot-principe als v1's `game.players`-kopie, zie `docs/data-contracts.md`).

## Conflicten en tombstones

Conflicten zijn **objectgericht**, niet document-breed: omdat mutaties append-only acties zijn in plaats van veldwijzigingen op één gedeeld document, is er per actie geen "wie wint"-conflict — elke actie staat onafhankelijk. Het enige conflictscenario is *welke acties* uiteindelijk geldig zijn (zie hieronder, single-writer).

- **Verwijderen** van een actie of wedstrijd gebeurt via een tombstone (een `deletedAt`-veld), nooit een harde Firestore-delete — zodat een offline apparaat dat de verwijdering nog niet kende, niet per ongeluk een "geestdocument" opnieuw aanmaakt bij reconnect.
- **Herstel bij een later geweigerde write**: als een actie lokaal is toegevoegd maar bij reconnect door Security Rules wordt afgewezen (bijv. ingetrokken toegang), blijft die actie in de lokale IndexedDB-cache staan met `Actie nodig`-status totdat de gebruiker 'm expliciet exporteert of laat vervallen — nooit automatisch stil verwijderd.
- Bewaarbeleid voor tombstones zelf (hoelang een `deletedAt`-document blijft bestaan voordat het definitief wordt opgeruimd) is **nog niet vastgelegd** — expliciet doorgeschoven naar PR 7.2 (afgeronde wedstrijden synchroniseren), waar dit voor het eerst praktisch relevant wordt.

## Single-writer: één actieve scorer

Voor de eerste versie geldt: **één actieve scorer per lopende wedstrijd**, met een expliciet eigenaarschap/lease-veld op het `games/{gameId}`-document (auteur-`uid`, timestamp).

- Andere apparaten die dezelfde wedstrijd openen zijn **read-only meekijkers**. Ze zien de cache-/serveractualiteit (via het syncstatuscontract hierboven), maar kunnen geen acties schrijven.
- **Overname** is expliciet: een tweede apparaat kan het scorer-eigenaarschap alleen overnemen via een bevestigde actie die het leaseveld met een revisiecontrole wijzigt (optimistic locking — de overname faalt als het leaseveld intussen al door een ander apparaat is gewijzigd), nooit stilzwijgend bij bijvoorbeeld het simpelweg openen van de wedstrijd op een ander toestel.
- Verlies van netwerk blokkeert de actieve scorer niet — die blijft lokaal doorschrijven (append-only acties in de lokale cache) en synchroniseert bij reconnect.
- Dubbele of te laat aankomende acties (bijv. een actie die na een lange offline periode alsnog binnenkomt) veranderen score/segmenten niet met terugwerkende kracht op een manier die de actieve scorer verrast — acties worden op volgnummer verwerkt, niet op aankomsttijdstip.
- Dit is een bewust **beperkt** model (single-writer, geen CRDT's, geen echte gelijktijdige multi-writer-ondersteuning). Dat is een expliciete, in de roadmap vastgelegde keuze (§9, fase 9: "echte multi-writer wedstrijdbediening, alleen als single-writer aantoonbaar onvoldoende is") — niet iets wat dit ADR per ongeluk over het hoofd ziet.

## Pre-game offline-readinesscheck

Vóór een wedstrijd start, controleert de app expliciet dat vijf dingen lokaal gereed zijn, zodat een team courtside niet halverwege een wedstrijdopzet ontdekt dat er internet nodig is:

1. **App-shell**: service worker actief en de huidige build volledig precached (zelfde garantie als de bestaande PWA-offline-reload-test uit PR 3.2a/mobile.spec.ts).
2. **Sessie**: Firebase Authentication-sessie lokaal geldig (geen her-login via netwerk nodig).
3. **Context**: de gekozen organisatie/team is al minstens één keer eerder geopend en dus gecached — een nooit-geopende context faalt deze check expliciet (zie hierboven: nooit een lege cache tonen als een leeg team).
4. **Roster**: teamdata lokaal beschikbaar.
5. **Instellingen**: teaminstellingen (classificatie, kleuren, periodes) lokaal beschikbaar.

Ontbreekt één van deze vijf, dan toont de app dat vóór de wedstrijd begint — niet pas wanneer een wissel of segment-save al mislukt tijdens het spelen.

## Overwogen alternatieven (verworpen)

- **Eén overschreven `game`-megadocument** (last-write-wins per veld): verworpen, zie hierboven — onverenigbaar met "geen stil dataverlies" uit §3.
- **CRDT's / echte multi-writer sync vanaf nu**: verworpen voor deze fase. Voegt aanzienlijke ontwerp- en testcomplexiteit toe voor een scenario (twee scorers die *gelijktijdig* dezelfde wedstrijd actief bedienen) dat courtside niet de praktijk is. Expliciet aangemerkt als mogelijke fase-9-track, niet nu.
- **Firestore transacties als primair conflictmechanisme**: niet gekozen als hoofdstrategie. Transacties lossen concurrency op bij *gelijktijdige verbinding*, maar niet het courtside-kernprobleem (een apparaat is minutenlang offline en moet daarna alsnog veilig synchroniseren) — append-only acties met idempotente client-UUID's doen dat wel.

## Gevolgen

- PR 4.3 (ADR-003, tenancy/autorisatie) bouwt hierop voort: elke actie/document in dit model draagt een organisatie/teamcontext die door Security Rules gecontroleerd moet worden.
- PR 4.4 (begrensde Firebase-spike) moet dit contract voor het eerst empirisch bewijzen: offline wijzigen, reload, reconnect en teruglezen op een tweede client — met settings/roster, niet nog met het volledige wedstrijdmodel (dat komt in fase 7).
- PR 7.1 (Firestore-wedstrijdmodel) en PR 7.3 (single-writer) implementeren dit contract daadwerkelijk voor de live wedstrijdflow; dit ADR legt het ontwerp vast, niet de implementatie.
- Tombstone-bewaarbeleid blijft een open punt tot PR 7.2 — hier bewust niet vooruitgeschoven, zelfde afweging als het Firestore-back-upbeleid in ADR-001 (PR 8.3).

## Verduidelijkingen voor fase 7 (14 augustus 2026)

De lokale fase-6-implementatie en het bewijs uit PR 5.3/5.4 maken vier
uitvoeringsdetails expliciet. Deze verduidelijken het geaccepteerde model; ze
veranderen niet de keuze voor append-only actions en single-writer.

1. **Create-only betekent werkelijk onveranderlijk.** Een action-retry gebruikt
   dezelfde client-ID, maar mag een al bestaand document niet met een andere
   payload overschrijven. Security Rules staan alleen create toe; de gateway
   behandelt "bestaat al en is semantisch gelijk" als idempotent bevestigd en
   iedere afwijking als integriteitsconflict.
2. **De lokale actielog is de duurzame synchronisatiebron.** Firestore pending
   writes alleen zijn geen volledig domein-outboxcontract, vooral niet na een
   latere Rules-afwijzing. PR 7.1 gebruikt daarom `ActiveGame.actions` plus een
   klein lokaal checkpoint met bevestigde action-ID's/revisie/foutstatus. Een
   generieke IndexedDB-outbox wordt pas toegevoegd als tests een concreet gat
   aantonen.
3. **Writerlease is een epoch/fencing-contract, geen timer.** Het parentdocument
   draagt actieve `writerUid`, `deviceId` en monotoon `writerEpoch`; iedere
   action draagt dezelfde epoch plus een sequence. Overname is alleen online,
   expliciet en transactioneel en verhoogt de epoch. Er is geen automatische
   expiry: netwerkverlies mag de courtside-scorer niet ongemerkt onteigenen.
4. **Bronacties en draaivelden hebben verschillende taken.** Score, segmenten,
   plus/min en speeltijd blijven afleidbaar uit actions. `onCourt`, huidig kwart,
   open klok en `pendingSwapLineup` staan als actuele snapshotvelden op het
   parentdocument en worden met echte field patches geschreven. Een cloudgame
   vereist vóór tip-off een serverbevestigde writerclaim; daarna kan de actieve
   scorer de hele wedstrijd offline spelen. Alleen-lokale modus blijft zonder
   claim of netwerk beschikbaar.

## Besluiten van de eigenaar (5 augustus 2026)

1. **Single-tab persistence**: geaccepteerd als startaanname. Courtside-gebruik is typisch één scorer op één toestel/tabblad; multi-tab-coördinatie voegt complexiteit toe zonder concrete behoefte. Heroverwegen indien een toekomstige flow bewust meerdere tabbladen tegelijk vereist.
2. **Vervolgstap**: dit concept is voldoende basis om direct door te gaan naar PR 4.3 (ADR-003, tenancy/autorisatie) — geen aparte formele-acceptatiestap nodig, zelfde redenering als bij ADR-001.
