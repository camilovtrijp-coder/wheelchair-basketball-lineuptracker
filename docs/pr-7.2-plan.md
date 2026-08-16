# Voorbereidingsplan PR 7.2 — afgeronde wedstrijden synchroniseren

Status: goedgekeurde bouwrichting; start na 7.1a–7.1c. PR 7.2a geïmplementeerd
en in review (zie `docs/IMPLEMENTATION_PLAN.md` §17-statustabel voor het
volledige overzicht van geraakte bestanden en testdekking); 7.2b/7.2c nog niet
gestart.

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
