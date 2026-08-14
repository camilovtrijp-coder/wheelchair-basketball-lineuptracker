# Voorbereidingsplan PR 7.1 — Firestore-wedstrijdmodel en syncfundament

Status: goedgekeurde bouwrichting; implementatie nog niet gestart. Dit plan
splitst roadmap-PR 7.1 in drie afzonderlijk reviewbare sub-PR's.

## A. Doel en startvoorwaarden

PR 7.1 maakt het lokale wedstrijdmodel cloudgeschikt zonder het offline-first
contract te vervangen. De lokale `ActiveGame.actions` blijft de duurzame bron
voor nog te synchroniseren acties; Firestore wordt de gedeelde kopie en levert
serverbevestiging, autorisatie en tweede-apparaatlezing.

Startvoorwaarden:

1. PR 5.3 en 5.4 zijn voltooid en hun syncstatus-, Rules- en twee-devicepatronen
   worden hergebruikt.
2. Fase 6 is voltooid; `ActiveGame`, `GameAction`, `CompletedGame` en de lokale
   repositories zijn de actuele contractbasis.
3. ADR-002's verduidelijkingen over create-only actions, writer epochs en het
   verschil tussen bronacties en draaivelden zijn leidend.
4. Er wordt niet gedeployed. Ontwikkeling en CI draaien tegen de Firebase
   Emulator Suite totdat 5.5b-activatie afzonderlijk is toegestaan.
5. Het in 5.4 uitgestelde multi-write-queuevraagstuk is door de voltooide lokale
   actielog uit PR 6.2 nu actueel. PR 7.1 sluit dit af met actielog + checkpoint,
   idempotente retry en expliciete foutstatus; 5.5c legt het praktijkbewijs vast.

## B. Vastgelegde bouwkeuzes

- Canoniek Firestorepad:
  `organizations/{orgId}/teams/{teamId}/games/{gameId}` met subcollectie
  `actions/{actionId}`. De kortere roadmapnotatie `games/{gameId}` is alleen
  shorthand.
- `gameId` is exact `ActiveGame.id`; een afgeronde snapshot behoudt bovendien
  `CompletedGame.id` en `sourceGameId`.
- Een action-document is create-only en daarna onveranderlijk. Een retry met
  dezelfde ID is alleen succes als de al aanwezige payload semantisch gelijk is;
  een andere payload wordt een zichtbaar integriteitsconflict.
- Iedere action-envelope bevat minimaal `organizationId`, `teamId`, `gameId`,
  `actionId`, `authorUid`, `deviceId`, `writerEpoch`, `sequence`, `occurredAt`,
  `schemaVersion` en de bestaande domeinactie als payload.
- Score, segmenten, plus/min en speeltijd blijven afleidbaar uit actions. Het
  parentdocument bevat identiteit/status plus een afgeleide snapshot en de
  actuele draaivelden (`onCourt`, kwart, open klok en `pendingSwapLineup`).
- Geen generieke IndexedDB-outbox in 7.1. De bestaande lokale actielog krijgt
  een klein lokaal synccheckpoint met bevestigde action-ID's, serverrevisie en
  foutstatus. Alleen aantoonbare gaten mogen later een aparte outbox rechtvaardigen.
- UI-componenten importeren geen Firebase SDK. Cloudverkeer loopt via een
  `GameCloudGateway`; orkestratie hoort in een `GameSyncCoordinator`.

## C. Sub-PR's

### 7.1a — cloudcontracten, converters en lokale checkpointvorm

Werk:

1. Voeg typed `GameDocument`- en `GameActionDocument`-contracten, runtime-
   validators en Firestore-converters toe onder `firebase/src/documents/`.
2. Leg toegestane action-payloads en schema-evolutie fail-closed vast; onbekende
   types/versies of contextmismatches worden geweigerd.
3. Voeg application-poorten toe voor `GameCloudGateway` en een lokaal
   `GameSyncCheckpointRepository`; pas bestaande `GameRepository` niet
   stilzwijgend aan van sync naar async.
4. Projecteer `ActiveGame` naar parent snapshot + action-envelopes met pure
   functies. Bewijs dat dezelfde input deterministisch dezelfde document-ID's
   en volgorde oplevert.
5. Voeg een begrote payloadtest toe voor documentgrootte en een read/write-
   begroting voor een handmatig narekenbare volledige wedstrijdfixture.

Acceptatie:

- converters roundtrippen geldige fictieve wedstrijden en weigeren malformed
  nested spelers, segmenten, actions, timestamps en contextvelden;
- transient snapshotvelden kunnen nooit de action-derived historie vervangen;
- lokale v1-/v2-opslagkeys, CSV en berekeningen blijven ongewijzigd;
- unit-, type-, lint-, format- en buildcontroles zijn groen.

### 7.1b — Security Rules, queries en create-only actions

Werk:

1. Voeg geneste `games`/`actions`-Rules toe met lezen voor geautoriseerde
   teamleden en schrijven voor `owner`, `admin`, `coach` en `scorer`; `viewer`
   blijft read-only.
2. Game-create vereist overeenkomende pad-/payloadcontext, maker en initiële
   writerinformatie. Updates gebruiken een veldallowlist per toegestane status-
   overgang; afgeronde kernvelden zijn onveranderlijk.
3. Action-create vereist eigen auteur, actieve `writerEpoch`/`deviceId` uit het
   parentdocument en een volledige geldige envelope. Update/delete is verboden.
4. Leg de contextgebonden queries voor actief spel en historie vast en voeg
   alleen empirisch benodigde indexes toe.
5. Test positief én negatief: alle rollen, cross-org/team, self-promotion,
   vervalste auteur/context, stale epoch, action-update/delete en queryscope.

Acceptatie:

- default-deny blijft gelden buiten de expliciete paden;
- een offline action uit een oude writer epoch wordt na overname door Rules
  geweigerd en kan als `Actie nodig` worden afgehandeld;
- dezelfde action kan niet met gewijzigde inhoud worden overschreven;
- `firebase-base` draait reproduceerbaar vanaf een schone checkout.

### 7.1c — GameSyncCoordinator en idempotente upload

Werk:

1. Implementeer de Firestore-gateway achter de application-poort en composeer
   die alleen in cloudmodus; lokale modus blijft volledig netwerkloos.
2. Upload uitsluitend nog onbevestigde action-ID's uit de lokale actielog,
   daarna de parent snapshot met een veldpatch en revisiecontrole. Geen
   full-documentwrite die een wijziging van een ander apparaat kan wissen.
3. Schrijf serverbevestiging pas in het lokale checkpoint na readback. Een
   timeout of Rules-afwijzing blijft retrybaar/zichtbaar en verwijdert nooit de
   lokale action.
4. Hergebruik het bestaande syncstatuscontract voor wachten, bevestigd,
   cachebron en `Actie nodig`; voeg een exporteerbare diagnosedescriptor toe
   zonder spelersdata in logs.
5. Voeg emulator-e2e toe voor online upload, offline actions, reload, reconnect,
   idempotente retry, gedeeltelijke fout, serverreject en tweede-client-readback.

Acceptatie:

- elke action staat na retry exact één keer in Firestore;
- een mislukte parent-snapshotpatch tast bevestigde actions niet aan;
- niet-conflicterende parentvelden worden via echte field patches behouden;
- een volledige wedstrijd blijft zonder netwerk speelbaar en afrondbaar;
- lokale modus veroorzaakt nul Firestore/Auth-netwerkrequests.

## D. Gates en overdracht

Na 7.1c volgt de expliciete stagingpoort: 5.5b-activatie en 5.5c valideren op
echte mobiele apparaten de nog open 5.3/5.4-scenario's en leggen een billable
Firestore-baseline vast. Zonder die toestemming mag 7.2 in de emulator worden
ontwikkeld, maar de fase-7-praktijkacceptatie mag niet als voltooid gelden.

Open voor latere PR's: afgeronde historie/tombstones (7.2), writerclaim en
overname (7.3), bulk-/bestaande-gebruikersmigratie (7.4) en definitieve
kosten-/bewaarreview (8.3).
