# Voorbereidingsplan PR 7.4 — bestaande gebruiker naar cloud

Status: goedgekeurde bouwrichting; start na 7.3. Implementatie nog niet gestart.

## A. Doel en relatie met PR 6.6

PR 7.4 hergebruikt PR 6.6's fail-closed validatie, preview, herstelback-up,
contextbevestiging en rollbackjournal, maar schrijft bestaande lokale team- en
wedstrijddata gecontroleerd naar de cloud. De lokale bron blijft behouden.

Deze PR is geen tweede algemene back-upimporter. Hij migreert een vooraf
geïnventariseerde lokale broncontext naar exact één bevestigde cloudcontext en
kan veilig worden hervat.

## B. Vastgelegde bouwkeuzes

- Alleen `organizationOwner`, `organizationAdmin` en `coach` mogen bulk-
  migreren. `scorer` mag wedstrijden bedienen via 7.3 maar niet een heel team
  migreren of bulk verwijderen; `viewer` blijft read-only.
- Een actieve wedstrijd in `tracking` wordt niet bulk gemigreerd. Die wordt via
  het 7.3-writerprotocol expliciet geadopteerd, zodat er eerst één geldige
  writerclaim bestaat. Een setup zonder bevestigde acties mag alleen na
  afzonderlijke previewbeslissing mee.
- IDs zijn deterministisch: bestaande v2-UUID's blijven gelijk; legacybron
  gebruikt bronfingerprint + bron-ID + doelcontext. Retry maakt geen duplicaat.
- Migratie gebruikt een cloud `migrationRun`-manifest met hash, doelcontext,
  aantallen, status en per-itemcheckpoint. Alleen een volledig bevestigde run
  wordt als voltooid gepresenteerd.
- Rollback betekent: lokale bron onaangeraakt; nog niet zichtbare clouditems
  stoppen, en reeds geschreven migratie-items worden veilig gecompenseerd of
  getombstoned. Geen harde delete en geen vals “alles teruggedraaid” wanneer een
  compensatie faalt.

## C. Sub-PR's

### 7.4a — inventarisatie, mapping en preview

1. Inventariseer settings, roster, actieve game en completed games per lokale
   broncontext met strikte readresultaten; corrupte of onduidelijke data stopt
   vóór iedere cloudwrite.
2. Bouw een pure `CloudMigrationPreview` met bron-/doel-ID's en namen,
   aantallen, bestemmingen, duplicaten/conflicten, trackinggame-status,
   benodigde writes en waarschuwingen.
3. Maak deterministische mappings en payloadhashes; dezelfde bron/doelcombinatie
   levert exact hetzelfde manifest.
4. Controleer capability en context zowel bij preview als vlak voor bevestiging;
   een rol- of contextwissel maakt de preview ongeldig.
5. Test gelijknamige teams in meerdere organisaties, lege/partiële/corrupte
   bron, bestaande clouditems, dubbele IDs en actieve trackinggame.

Acceptatie: nul writes vóór bevestiging; bron en doel zijn ondubbelzinnig; een
scorer/viewer krijgt geen bulkactie.

### 7.4b — hervatbare migratiecoordinator

1. Maak eerst een downloadbare lokale herstelback-up en daarna een
   `migrationRun` met immutable manifest/hash.
2. Schrijf in begrensde stappen via de bestaande cloudgateways; na elke stap
   serverreadback en checkpoint. Respecteer batchlimieten en ondersteun reload/
   crash zonder opnieuw beginnen.
3. Hergebruik settings/roster-contracten uit 5.3, completed-gameflow uit 7.2 en
   writeradoptie uit 7.3. Maak geen tweede afwijkend Firestorepad.
4. Detecteer semantisch gelijke bestaande items als bevestigd; afwijkende
   payload onder dezelfde ID is een zichtbaar conflict, nooit een overwrite.
5. Rapporteer `running`, `paused`, `actionNeeded`, `completed` en
   `compensationFailed`; verwijder de lokale bron nooit automatisch.

Acceptatie: retry/reload is idempotent; gedeeltelijke fout meldt nooit succes;
context- of Rules-afwijzing blijft herstelbaar en exporteerbaar.

### 7.4c — migratie-UI en volledige e2e

1. Voeg een NL/EN-flow toe: inventariseren → preview → herstelback-up → sterke
   bevestiging → voortgang → readback/resultaat → retry/export.
2. Toon per onderdeel lokaal/cloud, aantallen, conflictstatus en of een actieve
   wedstrijd via 7.3 moet worden overgenomen.
3. Houd knoppen toegankelijk op 320 px, toetsenbord en screenreader; voorkom
   dubbel bevestigen tijdens een lopende run.
4. E2e-matrix: alle rollen, lokale modus zonder netwerkcall, contextwissel,
   crash/reload per stap, serverreject, bestaande gelijke/afwijkende payload,
   dubbele retry en echte inhoud van herstelback-up.
5. Pilot op staging met fictieve data; leg writes/reads en open risico's vast.

Acceptatie: gebruiker kan de migratie vooraf begrijpen, veilig hervatten en
lokale data blijven gebruiken; clouddata is na readback op apparaat B gelijk.

## D. Stopregels en faseoverdracht

- Geen automatische migratie bij login of appstart.
- Geen stil verwijderen van lokale keys, games of back-ups.
- Geen trackinggame via bulkpad om de writerclaim heen.
- Geen productie-cutover; na 7.4 volgt eerst fase-7-acceptatie en fase 8
  hardening/security/privacy/kosten.
