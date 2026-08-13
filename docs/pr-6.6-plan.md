# Voorbereidingsplan PR 6.6 — back-up, import en lokale migratie

Status: voorbereidingsplan met expliciete beslispoorten. PR 6.6 verandert een
duurzaam datacontract en mag daarom niet worden geïmplementeerd voordat de vier
beslissingen in §E door de eigenaar zijn bevestigd tegen de actuele `main`.

## A. Doel en afhankelijkheden

PR 6.6 levert een veilige, contextbewuste v2-back-upflow en migreert bestaande
v1-back-ups zonder bestaande gegevens stil te overschrijven. De gebruiker ziet
eerst een preview, downloadt automatisch een herstelback-up van het doel en
kiest expliciet doelorganisatie en doelteam. Alleen-lokaal gebruik blijft werken.

Startvoorwaarden:

1. PR 6.3–6.5 zijn gemerged of hun definitieve datacontracten zijn aantoonbaar
   stabiel; vooral `CompletedGame`, actieve wedstrijd en rosteridentiteit.
2. Lees- en schrijffouten van iedere gebruikte repository zijn expliciet; een
   fout mag niet als ontbrekende/lege data worden geïnterpreteerd.
3. De v1-volgorde in `handleImportBackupFile()`, `docs/data-contracts.md` en de
   backup/resume-Playwrightfixtures zijn opnieuw gelezen.
4. Er is geen implementatie die rechtstreeks vanuit een UI-component meerdere
   localStorage-/Firestorepaden muteert; coördinatie hoort in application en
   adapters.

## B. Scope

| In scope | Niet in scope |
|---|---|
| v1-back-up type/version/inhoud valideren en naar v2 projecteren | Alle data uit alle organisaties in één export |
| v2-back-up export en roundtrip-import voor één gekozen teamcontext | Wedstrijdsync of cloudmigratie uit fase 7 |
| Preview, expliciete doelkeuze en effectoverzicht vóór schrijven | Stil automatisch importeren bij appstart |
| Automatische downloadbare herstelback-up van de huidige doeldata | Productiedeployment/cutover |
| Leeg, oud, gedeeltelijk, dubbel en foutpad testen | Importeren van willekeurige niet-Lineup-Tracker JSON |
| Herstel/journal/rollback bij gedeeltelijk falen | “Best effort” succes melden na een gedeeltelijke write |
| Lokale modus én bestaande repositorymodus respecteren | Secrets of beheercredentials in browser/importbestand |

## C. Validatie- en migratiepipeline

De pipeline is zuiver en schrijft niets vóór stap 8:

1. Lees maximaal 10 MiB en vang FileReader/parsefouten; een groter bestand wordt
   vóór JSON-parse en zonder writes afgewezen.
2. Vereis een plain object, `type === "lineup-tracker-backup"` en plain `data`.
3. Ontbrekende `version` betekent v1; niet-eindig, lager dan 1 of hoger dan de
   ondersteunde versie wordt geweigerd.
4. Migreer stapsgewijs met pure `MIGRATIONS[fromVersion]`; iedere stap retourneert
   een nieuw object, muteert input niet en faalt gesloten bij ontbrekende stap,
   runtimefout of ongeldige output.
5. Valideer alle aanwezige onderdelen structureel en referentieel. Minimaal:
   unieke roster-ID's, verplichte gamevelden, vijf geldige lineupreferenties,
   positieve `durSec`, niet-negatieve `pf/pa`, consistente tijden en geldige
   settings/taal.
6. Projecteer pas daarna naar een neutraal `ImportPreview`: aantallen,
   waarschuwingen, ontbrekende onderdelen, conflicten/dubbelen en wat in het
   doel wordt vervangen. De preview bevat nog geen writes.
7. De gebruiker selecteert/bevestigt organisatie + team bij zichtbare namen en
   technische ID's. Controleer vlak vóór schrijven opnieuw context en
   `canManageTeamData`; een contextwissel maakt de preview ongeldig.
8. Bouw en download eerst een v2-herstelback-up van de huidige doelcontext.
9. Voer de import via één application-coördinator uit, verifieer readback per
   onderdeel en rapporteer alleen succes als alles bevestigd is.
10. Bij fout: stop, herstel uit de in-memory pre-importsnapshot waar mogelijk,
    houd een hersteljournal zichtbaar en bied de al gedownloade back-up aan. Geen
    reload of succesmelding bij een gedeeltelijke toestand.

## D. v1 → v2-projectie

- `lineup-tracker-settings` en `lineup-tracker-roster` worden met de bestaande
  normalizers gevalideerd, maar onbekende velden worden alleen behouden wanneer
  het actuele contract dat expliciet toestaat.
- `lineup-tracker-v1` gebruikt de bestaande pure v1-actieve-wedstrijdmigratie,
  maar krijgt het door de gebruiker bevestigde `organizationId`/`teamId`.
- Iedere v1-`Game` wordt een `CompletedGame` met dezelfde zichtbare metadata,
  score, segmenten, instellingen en spelersnapshot. Numerieke v1-speler-ID's
  worden per wedstrijd één-op-één naar nieuwe game-player-ID's gemapt; hun oude
  ID blijft `rosterId`, en iedere segment-lineup wordt met dezelfde mapping
  herschreven.
- Migratie-identiteit moet deterministisch en herhaalbaar zijn. Dezelfde
  back-up naar hetzelfde team mag bij retry geen tweede actieve of afgeronde
  wedstrijd creëren. Gebruik een expliciete import/provenance-identiteit of een
  deterministische sleutel uit backupfingerprint + legacy game-ID; vertrouw niet
  op een nieuwe `randomUUID()` per poging.
- Alle gemigreerde objecten worden pas na volledige projectie met de doelcontext
  getagd. Een bron zonder organisatie/team mag nooit automatisch het eerst
  geopende team claimen.
- `lineup-tracker-lang` is apparaat-/interfacevoorkeur. De preview vermeldt
  apart of deze wordt overgenomen; taal mag geen teamdata of CSV-contract wijzigen.

## E. Eigenaarsbeslissingen vóór implementatie

Onderstaande voorstellen zijn bewust nog geen stilzwijgende architectuurkeuze:

1. **Back-upformaat** — voorstel: introduceer `version: 2` met benoemde,
   semantische secties (`settings`, `roster`, `activeGame`, `completedGames`,
   `lang`, bronmetadata) in plaats van v2-interne localStorage-keys. Export is
   per geselecteerde teamcontext. v1 blijft importeerbaar via migratie.
2. **Importsemantiek** — voorstel: behoud v1's replace-contract per onderdeel.
   Een gedeeltelijke back-up toont ontbrekende onderdelen als “wordt geleegd”;
   pas na expliciete bevestiging wordt de doelcontext vervangen. `data: {}`
   blijft ongeldig. Geen impliciete merge die ID-conflicten verstopt.
3. **Cloudmodus** — voorstel: settings/roster lopen in de actuele modus via de
   bestaande async repositories; actieve/afgeronde wedstrijden blijven in fase
   6 lokaal per gekozen context. De preview moet deze gemengde bestemming
   letterlijk tonen. Volledige cloudmigratie blijft fase 7.
4. **Bevoegdheden** — voorstel: team-back-up export en import vereisen een
   afzonderlijk expliciet capabilitycontract, initieel dezelfde grens als
   `canManageTeamData` (owner/admin/coach). `scorer` en `viewer` krijgen geen
   bulkexport/-importknoppen. Controleer dit tegen ADR-003 voordat code start.

Als één voorstel wordt afgewezen, werk eerst §C/§F en het nieuwe schema bij;
begin niet met een half passend implementatiepad.

## F. Voorgestelde laag- en bestandsindeling

### 6.6a — domain

- `v2/src/domain/backup/types.ts`: expliciete v1-inputtypes, v2-schema,
  `ImportPreview`, waarschuwingen en provenance.
- `v2/src/domain/backup/validate.ts`: plain-object-, veld-, referentie- en
  versievalidatie met gestructureerde foutcodes (UI vertaalt die NL/EN).
- `v2/src/domain/backup/migrate.ts`: pure stapsgewijze migraties en
  deterministische v1→v2-projectie.
- `v2/src/domain/backup/export.ts`: pure payload-/bestandsnaambouw.

### 6.6b — application/infrastructure

- `v2/src/application/backup/BackupCoordinator.ts`: preview, contextrevalidatie,
  pre-importsnapshot, geordende writes, readback, rollback/journal.
- Breid bestaande repositorypoorten alleen uit met expliciete bulk-/replace- en
  leesresultaten waar de migratie dat nodig heeft; normale historie blijft
  onveranderlijk en krijgt geen algemene edit-API.
- DOM-effecten voor JSON-download en file-read blijven in infrastructure; pure
  payloadbouw en validatie blijven testbaar zonder browser.
- Schrijffouten moeten propageren. Gebruik geen adapter die een mislukte
  methodecall als `null`, lege data of succes vertaalt.

### 6.6c — UI

- Een Back-up-sectie in Instellingen met export, bestand kiezen, preview,
  doelcontext, waarschuwingen, bevestiging en herstelstatus.
- Toon vóór bevestiging minimaal aantallen spelers/wedstrijden, actieve
  wedstrijd ja/nee, bronversie, ontbrekende onderdelen, dubbelen/conflicten,
  doelorganisatie/team en lokale/cloudbestemming per onderdeel.
- Alle teksten NL/EN; toetsenbord-/screenreaderbediening en mobiel 320 px.

## G. Testmatrix

Pure/adaptertests:

1. Geldige volledige v1-back-up, ontbrekende versie (=1), geldige v2-roundtrip.
2. Verkeerd type, geen plain `data`, toekomstige/ongeldige versie, niet-JSON en
   overschrijding van maximale bestandsgrootte: nul writes.
3. Leeg `{}` afgewezen; gedeeltelijke geldige back-up toont exact de clear/
   replace-gevolgen en schrijft pas na bevestiging.
4. Ongeldig roster, dubbele speler-ID, ontbrekende gamevelden, onbekende
   lineupreferentie, verkeerde lineupgrootte/duur/punten/tijd.
5. Twee organisaties met gelijknamige teams: preview en writes gaan uitsluitend
   naar het expliciet bevestigde ID; contextwissel vóór bevestiging blokkeert.
6. Dezelfde import tweemaal/retry na crash: geen dubbele games of claims.
7. Fout bij elke afzonderlijke schrijfstap, readback-mismatch en fout tijdens
   rollback: nooit vals succes; herstelback-up/journal blijft beschikbaar.
8. Bestaande doeldata blijft byte-/semantisch gelijk bij validatie-, migratie-
   of annuleerpad.
9. Actieve en afgeronde v1-gameprojectie behoudt score/segmenten en herschrijft
   alle spelerreferenties consistent; Stats/Trends-fixtures blijven gelijk.
10. Lokale modus doet geen netwerkcall; cloudmodus raakt alleen de vooraf
    getoonde bestaande repositorypaden en nooit een andere context.
11. Capabilitymatrix owner/admin/coach/scorer/viewer voor export én import.

Playwright dekt minimaal preview → automatische download → bevestiging →
readback, annuleren, corrupte/partiële back-up, foutpad, dubbele retry, expliciete
contextkeuze, lokale modus, NL/EN en 320 px. V1-backup/resume-regressies,
v2-unit/e2e, typecheck, lint, format en build blijven groen.

## H. Acceptatiecriteria en stopregels

- Oude v1-exports blijven importeerbaar of worden vóór iedere write met een
  concrete, vertaalde fout geweigerd.
- V2-export → import is semantisch roundtrip-gelijk voor de gekozen context.
- Preview, herstelback-up en doelcontext zijn verplichte poorten, geen hints.
- Geen gedeeltelijke import wordt als succes gerapporteerd.
- Geen enkele broncontext wordt automatisch aan een team toegekend.
- Alleen-lokaal blijft volledig bruikbaar; fase 7 wordt niet naar voren gehaald.
- Bij een nieuw schema of repositorycontract dat niet in §E is bevestigd: stop
  en vraag eerst een eigenaarsbesluit.

Aanbevolen volgorde: eigenaarsbesluiten → 6.6a pure schema/validatie/migratie →
6.6b coordinator/adapters → 6.6c preview/UI/e2e.
