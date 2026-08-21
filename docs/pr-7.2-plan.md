# Voorbereidingsplan PR 7.2 — afgeronde wedstrijden synchroniseren

Status: goedgekeurde bouwrichting; start na 7.1a–7.1c. PR 7.2a gemerged
(#61). PR 7.2b geïmplementeerd (zie `docs/IMPLEMENTATION_PLAN.md`
§17-statustabel voor het volledige overzicht van geraakte bestanden en
testdekking); 7.2c nog niet gestart.

## A. Doel en grenzen

PR 7.2 maakt afgeronde wedstrijden veilig beschikbaar op een tweede apparaat.
De lokale afgeronde wedstrijd blijft tijdens fase 7 behouden. Cloudsync is
idempotent, contextgebonden en zichtbaar herstelbaar; een historie-item is na
afronding inhoudelijk onveranderlijk.

Niet in scope: live scorer-overname (7.3), bulkimport van bestaande gebruikers
(7.4), harde verwijdering of automatische tombstone-purge (8.3).

## B. Vastgelegde bouwkeuzes

- `CompletedGame.id` is de cloud-snapshot-ID; `sourceGameId` koppelt de snapshot
  aan het actieve `gameId` en voorkomt dubbel afronden.
- Actions blijven de reproduceerbare historische bron. Het completed
  parentdocument is een bevroren, leesgeoptimaliseerde snapshot voor Historie,
  Stats, Trends, CSV en tweede-apparaatweergave.
- Een completed snapshot mag alleen ontstaan als de bijbehorende actionset en
  parentstatus serverbevestigd of aantoonbaar hervatbaar zijn. Geen vals succes
  op alleen lokale Firestore-acceptatie.
- Verwijderen wordt een tombstone met `deletedAt`, `deletedBy` en revisie. In
  fase 7 worden tombstones niet automatisch gepurged; PR 8.3 stelt pas een
  definitieve bewaartermijn en beheerproces vast.
- Cloudhistorie wordt via een repositoryadapter aangeboden. Stats/Trends/UI
  blijven afhankelijk van application-poorten en krijgen expliciete
  `loading`/`cache`/`error`/`missing`-semantiek.

## C. Sub-PR's

### 7.2a — idempotent afronden en uploadstatus

1. Voeg een pure completed-snapshotprojectie toe die de bestaande
   `finishGame()`-uitkomst byte-/semantisch behoudt.
2. Breid `GameSyncCoordinator` uit met een hervatbare finalize-flow:
   actions uploaden/readback → snapshot schrijven/readback → parentstatus
   `completed` patchen → lokaal checkpoint bevestigen.
3. Gebruik `CompletedGame.id` en `sourceGameId` als dubbele guard. Een retry na
   crash of timeout maakt geen tweede snapshot.
4. Toon per wedstrijd `lokaal`, `wacht op synchronisatie`, `gesynchroniseerd`
   of `actie nodig`; lokale export blijft altijd beschikbaar.
5. Test crash/fout na iedere stap, dezelfde finalize tweemaal, afwijkende
   bestaande payload, revoked membership en herstel na reload.

Acceptatie: geen duplicaten, geen bronverwijdering en geen succesmelding vóór
serverreadback; CSV en lokale historie blijven gelijk.

### 7.2b — cloudhistorie en tweede apparaat

1. Voeg `CloudCompletedGameRepository` of een samengestelde
   `CompletedGameRepository` toe achter de bestaande poort; documenteer bewust
   hoe lokale pending items met serveritems op ID worden samengevoegd.
2. Query alleen binnen actieve organisatie/teamcontext, standaard nieuwste
   eerst, met een begrensde paginagrootte. Voeg alleen de bewezen index toe.
3. Laat Historie, Stats en Trends dezelfde samengestelde bron gebruiken zonder
   directe Firestore-imports of afwijkende berekeningen.
4. Toon cache-/serveractualiteit en maak een leesfout nooit gelijk aan lege
   historie.
5. Test apparaat B, contextwissel, gelijknamige teams, offline cached history,
   ongecachete context en corrupt/malformed serverdocument.

Acceptatie: apparaat B ziet dezelfde inhoud; cross-org data lekt niet; alle
afgeleide waarden blijven handmatig narekenbaar uit dezelfde fixture.

**Geïmplementeerd** (zie `docs/IMPLEMENTATION_PLAN.md` §17-statustabel voor
het volledige bestandenoverzicht):

- `FirestoreCompletedGameRepository` (nieuw): read-only cloudbron,
  `organizations/{orgId}/teams/{teamId}/completedGames`-query begrensd op
  orgId/teamId, `orderBy('date','desc')`, vaste bovengrens
  (`COMPLETED_GAMES_QUERY_LIMIT`), geen nieuwe index nodig.
- `CompositeCompletedGameRepository` (nieuw): voegt lokaal ∪ cloud samen
  achter de bestaande `CompletedGameRepository`-poort — gededupliceerd op
  `CompletedGame.id` (lokale versie wint bij een botsing, zelfde ID als het
  Firestore-documentnaam-ID uit `GameSyncCoordinator.finalize()`),
  hersorteerd op datum. `add`/`remove`/`replaceAll` delegeren naar lokaal;
  cloudschrijven blijft uitsluitend via `GameSyncCoordinator`. Poort kreeg
  een optionele `subscribe()` (`CompletedGameRepository.ts`) zodat App.tsx op
  cloud-pushes kan reageren zonder dat Stats/Trends/HistoryPanel wijzigen.
- `selectRepositories.ts`/`resolveAppRepositories.ts`: bouwen de composite in
  cloud-modus; `null` in lokale modus (zelfde patroon als `gameSync`).
- `app/App.tsx`: gebruikt `repositories.completedGames`, abonneert op
  cloud-pushes voor `completedGames`-state, en scherpt `handleDeleteCompletedGame`
  aan — verwijderen in cloud-modus blijft nu volledig geblokkeerd (was:
  toegestaan zodra `gesynchroniseerd`), omdat een cloud-only/gesynchroniseerd
  item anders via de eerstvolgende cloud-snapshot-update vanzelf terug zou
  keren (firestore.rules staat nog geen `update`/`delete` toe op
  `completedGames` — dat is PR 7.2c). `deleteBlockedPendingSync`-tekst is
  hierop aangepast (belooft niet langer dat verwijderen na sync alsnog lukt).
- `HistoryPanel`: nieuwe `cloudReadError`-banner (nooit gelijk aan "geen
  wedstrijden") en een lijstbrede `cloudSync`-indicator (cache-/
  serveractualiteit, plan-werk 4).
- Emulator-e2e (`game-sync-second-client-completed-history.spec.ts`, echte
  Rules via `openSecondDevice()`): bewijst dat een op apparaat A afgeronde
  wedstrijd zonder reload op apparaat B verschijnt via de echte Historie-UI.
  **Zijvondst tijdens het schrijven van deze test**: `GameSyncCoordinator
  .finalize()` roept intern `sync()` aan, volledig los van `app/App.tsx`'s
  eigen `gameSyncInFlightRef`-serialisatie voor de live trackingsync — een
  'Afronden'-klik vlak na een score-/segmentactie (vóórdat die actie's eigen
  sync-cyclus server-bevestigd is) laat zo twee gelijktijdige
  `patchSnapshot()`-aanroepen op dezelfde verwachte `revision` racen; de
  verliezer wordt terecht door firestore.rules' optimistische-
  concurrencycheck afgewezen en het checkpoint valt op `actie-nodig`. Dit is
  een bestaande coordinator-brede racevoorwaarde (PR 7.1c/7.2a-scope, geen
  7.2b-regressie) — nooit eerder zichtbaar omdat geen bestaande e2e-test ooit
  een live actie direct liet volgen door 'Afronden' zonder eerst op
  `gesynchroniseerd` te wachten. De nieuwe test ontwijkt 'm door dezelfde
  wacht-tussen-acties-conventie als de rest van de suite te volgen; een
  eventuele coordinator-brede mutex (bijv. `finalize()` via dezelfde
  in-flight/queued-serialisatie als `runGameSync()` laten lopen) is nog niet
  opgelost en verdient een eigen, gerichte PR.
- 7.2b-uitbreiding op `readFinalizeStatus`-gebruik: een cloud-only item
  (nooit lokaal op dit apparaat opgeslagen) wordt in `finalizeStatuses`
  direct als `gesynchroniseerd` behandeld — `readFinalizeStatus()` leest
  uitsluitend het lokale checkpoint en zou anders ten onrechte
  `lokaal-beschikbaar` teruggeven voor een wedstrijd die per definitie alleen
  via een geslaagde serverquery zichtbaar werd.

### 7.2c — tombstones en pilotbewijs

1. Implementeer verwijderen als toegestane tombstone-fieldpatch; de bevroren
   wedstrijdinhoud blijft onveranderd. Conform ADR-003 mogen owner, admin en
   coach dit; scorer mag wedstrijdacties schrijven maar geen afgeronde historie
   verwijderen en viewer blijft read-only.
2. Synchroniseer tombstones naar andere apparaten en voorkom resurrectie door
   een offline client met een oudere snapshot.
3. Leg het fase-7-bewaarbesluit vast: geen automatische purge vóór 8.3;
   tombstones blijven exporteerbaar/auditbaar.
4. Meet emulator-reads/writes voor upload, history-query, tweede device en
   delete. Vergelijk later op staging met de 5.5c-baseline.
5. Voer twee-device-e2e uit voor upload, offline reload, tombstone, late retry,
   contextisolatie en rule-reject.

Acceptatie: een verwijderd item keert niet terug, een late client verliest zijn
lokale bron niet stil en de zichtbare status verklaart wat herstel vraagt.

## D. Stopregels

- Geen harde delete of automatische purge zonder PR 8.3-besluit.
- Geen cloudbrede onbegrensde history-query.
- Geen edit-API voor afgeronde kerninhoud.
- Stop wanneer action-derived historie en completed snapshot semantisch
  verschillen; corrigeer eerst projectie/validatie, niet de berekeningen.
