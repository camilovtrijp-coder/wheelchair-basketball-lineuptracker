# PR 6.3 — Voorbereidingsplan (afronden, historie en export)

**Status:** klaar voor implementatie
**Repo:** camilovtrijp-coder/wheelchair-basketball-lineuptracker (v2-/herbouwomgeving)
**Geverifieerd tegen:** origin/main op 13f092e ("PR 6.2: live wedstrijd offline-first")

## A. Reality-check

PR 6.1 (`domain/game/setup.ts`, `infrastructure/game/LocalStorageGameRepository.ts`,
`ui/game/GameSetupPanel.tsx`) en PR 6.2 (`domain/game/tracking.ts`,
`ui/game/LiveTrackingPanel.tsx`) leveren samen een volledig speelbare, offline-first
`ActiveGame` (fase `'setup' | 'tracking'`) met een append-only actielog
(`GameAction[]`) die via `deriveGameHistory()` (`domain/game/tracking.ts:179`)
tot score/segmenten wordt herleid.

Er bestaat nog **niets** voor het afronden van een wedstrijd: geen `'completed'`-
achtige toestand, geen opslag voor afgeronde wedstrijden, geen historie-UI, geen
CSV-export. `ActiveGame` (`domain/game/types.ts:89`) heeft geen `quarterCount`/
`periodLabel`/`useClassLimit`-snapshotvelden — die instellingen leven uitsluitend
in `Settings` en worden pas op het moment van afronden bevroren (net als in v1's
`finishGame()`, dat `settings.quarterCount`/`settings.periodLabel`/
`settings.useClassLimit` in het opgeslagen `Game`-object kopieert).

v1-referentiegedrag (index.html) dat dit PR moet overnemen:
- `finishGame()` (regel 1072-1092): guard op minstens één segment, bevestigingsdialoog,
  `games.unshift(...)` (nieuwste eerst), 6-velden-spelersnapshot, reset naar
  `freshState()`, sprong naar de historie-tab met het net afgeronde spel geopend.
- `deleteGame()` (regel 1093-1099): bevestigingsdialoog, direct verwijderen (geen
  tombstone — tombstones zijn expliciet PR 7.2-scope voor de Firestore-sync, zie
  IMPLEMENTATION_PLAN.md:681).
- `segmentsCsvFor()`/`minutesCsvFor()`/`combinedCsvFor()`/`csvFilenameFor()`/
  `exportHistoryGame()`/`shareOrDownloadCsv()` (regel 1106-1175): het volledige
  Nederlandse CSV-contract, inclusief het niet-robuuste quotinggedrag (alleen het
  "Opstelling"-veld tussen dubbele aanhalingstekens, geen escaping van komma's/
  quotes in spelernamen) — voor "byte-exact" moet dit gedrag letterlijk
  gereproduceerd worden, niet "verbeterd".
- `renderHistoryTab()`/`renderHistoryDetail()` (regel 2284-2328): lijst met
  score-kleur, leeg-state, detailweergave met segmentenlijst, verwijder- en
  exportknop.
- JSON-backupcontract (regel 1358, 1547-1609; ook `docs/data-contracts.md`
  §"JSON Back-up Contract"): `GAMES_KEY`/`lineup-tracker-games` is één van de vijf
  back-up-keys; `GAME_REQUIRED_FIELDS` (regel 1392) definieert het v1-schema van
  een opgeslagen wedstrijd.

## B. Scope van PR 6.3 (volgens IMPLEMENTATION_PLAN §11)

| In scope | Niet in scope |
|---|---|
| Afronden van de actieve v2-wedstrijd naar een onveranderlijke `CompletedGame` | v1-historie (`lineup-tracker-games`) inlezen/migreren — dat is PR 6.6 (docs/IMPLEMENTATION_PLAN.md:645-651: "bestaande v1-back-up valideren en veilig migreren") |
| Eigen v2-opslag voor afgeronde wedstrijden, per organisatie/team | Cloud-sync van afgeronde wedstrijden — PR 7.1/7.2 |
| Historie-lijst, -detail en verwijderen | Statistieken/lineupcombinaties/on-off — PR 6.4 |
| Byte-exact Nederlands CSV-export per afgeronde wedstrijd (download/share) | Trends over meerdere wedstrijden — PR 6.5 |
| JSON-backupcontract: semantisch gelijk of expliciet gemigreerde versie | Live-export van de nog niet afgeronde wedstrijd (v1's `openExport()`/`exportOnlyBtn`) — geen plan-bullet, blijft open voor een latere PR als daar behoefte aan is |

**Bewaking tegen AGENTS §3:**
- geen nieuwe `localStorage`-key vervangt of overschrijft een bestaande; de
  nieuwe sleutel (`lineup-tracker-v2-completed-games:{orgId}:{teamId}`, zie §C.2)
  is volledig nieuw en additioneel, net als PR 6.1's `activeGameStorageKey`;
- het Nederlandse CSV-contract wordt 1:1 geport, met golden-master-tests tegen
  de letterlijke v1-output (`docs/product-compatibility-matrix.md` Voorbeeld 1/2);
- nieuwe zichtbare tekst krijgt zowel NL als EN (`i18n/strings.ts`);
- geen statistiekberekening wijzigt — `deriveGameHistory()` blijft de enige bron
  van segmenten/score, ook bij het afronden (geen losse herberekening);
- geen UI-component praat rechtstreeks met localStorage — alles via
  `CompletedGameRepository`.

## C. Sub-onderdelen

### 6.3a — domain: `CompletedGame`, `finishGame()`, CSV-contract

- `domain/game/types.ts`: nieuw type `CompletedGame` (v2-natuurlijke vorm, zie §E.2)
  — `id` (UUID), `organizationId`, `teamId`, `opponent`, `competition`, `date`
  (ISO, afrondmoment), `players: GamePlayer[]` (volledige snapshot, niet de
  v1-6-veldsubset — zie §E.2), `segments: Segment[]`, `scoreFor`, `scoreAgainst`,
  `quarterCount`, `periodLabel`, `useClassLimit`.
- `domain/game/finish.ts`: `canFinishGame(game)` (v1-guard: minstens één afgeleid
  segment) en `finishGame(game, settings)` die `deriveGameHistory()` gebruikt om
  score/segmenten te bevriezen — geeft `null` terug als `canFinishGame` faalt.
- `domain/game/csv.ts`: pure poort van `segmentsCsvFor`/`minutesCsvFor`/
  `combinedCsvFor`/`csvFilenameFor`, werkend op `Segment[]`/`GamePlayer[]`/
  `CompletedGame`, met dezelfde niet-robuuste CSV-quoting als v1.
- Tests: golden-master unit tests met de letterlijke fixtures uit
  `docs/product-compatibility-matrix.md` (Voorbeeld 1 zonder classificatie,
  Voorbeeld 2 met classificatie), plus randgevallen (geen segmenten → geen
  finish, speler zonder speeltijd ontbreekt in de "Speeltijd"-sectie).

### 6.3b — application/infrastructure: opslag voor afgeronde wedstrijden

- `application/game/CompletedGameRepository.ts`: poort met `list()` (nieuwste
  eerst), `add(game)` (`false` bij opslagfout of context-mismatch), `remove(id)`.
- `infrastructure/game/LocalStorageCompletedGameRepository.ts`: eigen sleutel per
  organisatie/team (`lineup-tracker-v2-completed-games:{orgId}:{teamId}`, zie
  §E.3), zelfde shape-check + context-filter-patroon als
  `LocalStorageGameRepository` (regel 39-68) maar dan per item in een array
  (corrupte/verkeerd-getagde items worden uit de lijst gefilterd, niet de hele
  lijst ongeldig gemaakt).
- Tests: legacy/corrupte payloads, org/team-mismatch (zowel hele lijst als los
  item), opslagfout-paden (quota), volgorde na `add`/`remove`.

### 6.3c — UI: afronden + historie

- `ui/game/LiveTrackingPanel.tsx`: "Wedstrijd afronden"-knop (v1: `finishGameBtn`,
  `flag`-icoon), disabled zonder segmenten of zonder schrijfrecht, met
  `window.confirm(t('confirmFinishGame'))` vóór de daadwerkelijke afronding
  (zelfde patroon als het bestaande `handleDeleteEditSegment`).
- `ui/game/HistoryPanel.tsx` (nieuw): lijst (leeg-state, score-kleur) + detail
  (segmentenlijst, verwijderknop met bevestiging, exporteren/delen-knop).
- `infrastructure/game/shareOrDownloadCsv.ts`: DOM-bijwerkende poort van v1's
  `shareOrDownloadCsv()` (Web Share API met bestand, val terug op
  blob-download), zelfde patroon als
  `infrastructure/sync/exportPendingPayload.ts` (pure bouwfunctie gescheiden
  van de DOM-effectfunctie).
- `app/App.tsx`: nieuwe tab `'history'`, `completedGameRepo` (per org/team,
  zelfde `useMemo`-patroon als `gameRepo`), `handleFinishGame()` (roept
  `finishGame()` aan met de actuele `settings`-snapshot, slaat op via
  `completedGameRepo.add()`, reset de actieve wedstrijd door `game` op `null`
  te zetten zodat het bestaande "verse opzet"-effect, regel 202-209, een nieuwe
  `ActiveGame` aanmaakt — zelfde mechanisme als v1's `freshState()`), springt
  naar de historie-tab met het net afgeronde spel geopend.
- Nieuwe i18n-sleutels (NL+EN): `finishGameBtn`, `confirmFinishGame`,
  `historyTitle`, `historyEmpty`, `confirmDeleteGame`, `exportShareBtn`
  (`backBtn`/`deleteBtn`/`teamOpponent`/`confirmBtn` bestaan al en worden
  hergebruikt).
- Tests: Playwright e2e `game-history.spec.ts` (afronden → verschijnt in
  historie → detail → CSV-download → verwijderen), unit tests voor
  `HistoryPanel`-gedrag indien nodig naast de e2e-dekking.

## D. Acceptatiecriteria-mapping (uit IMPLEMENTATION_PLAN §11, PR 6.3-bullets)

| Criterium | Ingevuld door |
|---|---|
| afgeronde wedstrijd plus afleidbare snapshot bewaren | 6.3a (`finishGame()` bevriest `deriveGameHistory()`-uitkomst) + 6.3b (opslag) |
| historie, detail en verwijderen volgens het vastgelegde beleid | 6.3c (`HistoryPanel`) + 6.3b (`remove()`, direct verwijderen zonder tombstone — lokaal v1-pariteitsgedrag, tombstones zijn PR 7.2) |
| afgeronde wedstrijd standaard onveranderlijk | 6.3b: geen `update()`-methode op `CompletedGameRepository`, alleen `add`/`remove`; geen UI-pad om een opgeslagen `CompletedGame` te bewerken |
| byte-exact gelijk Nederlands CSV-contract | 6.3a (`domain/game/csv.ts`) met golden-master-tests tegen `docs/product-compatibility-matrix.md` |
| semantisch gelijk JSON-back-upcontract of expliciet gemigreerde versie | **PARTIAL/OPEN, bewust niet vervuld in deze PR** — zie §E.2. `CompletedGame` is een nieuw TypeScript-type met een eigen, nieuwe `localStorage`-sleutel; dat is op zichzelf geen JSON-back-up-export/-import-contract. v2 heeft ook voor settings/roster nog geen algemene back-up-export/-importflow (alleen de smalle `exportPendingPayload.ts` voor geweigerde syncacties) — een vergelijkbare flow voor afgeronde wedstrijden hoort bij PR 6.6 ("bestaande v1-back-up valideren en veilig migreren", IMPLEMENTATION_PLAN.md:645-651), samen met een expliciete schemaversie-beslissing voor `CompletedGame`. Externe review (aug. 2026) bevestigde dat dit criterium hier PARTIAL blijft totdat 6.6 het oppakt — geen eigenaarsbesluit om het criterium te laten vervallen. |

## E. Locked-in beslissingen (bevestigd door de eigenaar, 2026-08-13)

1. **Scope 6.3 vs 6.6**: v1-historie-import (`lineup-tracker-games`) hoort bij
   PR 6.6, niet bij 6.3. 6.3 bouwt alleen de nieuwe v2-opslag/UI voor
   zelf-afgeronde wedstrijden.
2. **`CompletedGame`-schema**: v2-natuurlijke vorm (UUID's, `organizationId`/
   `teamId`, volledige `GamePlayer`-snapshot inclusief game-player-UUID) in
   plaats van v1's exacte vorm (`"g"+Date.now()`-string-ID, 6-veld-spelersnapshot,
   geen organisatie/teamcontext). Gevolg: een JSON-back-up-export/-import voor
   afgeronde wedstrijden (nog niet in 6.3-scope) heeft later een aparte
   v1-projectiestap of een schemaversie-ophoging nodig — dit is bewust
   doorgeschoven, zie §D.
3. **Opslag-scoping**: eigen `localStorage`-sleutel per organisatie/team
   (`lineup-tracker-v2-completed-games:{orgId}:{teamId}`), consistent met hoe
   `LocalStorageGameRepository` de actieve wedstrijd al per org/team scoped —
   niet één globale lijst zoals v1's `lineup-tracker-games`.

## F. Aanbevolen volgorde

6.3a (domain, geen UI-afhankelijkheden) → 6.3b (opslag, afhankelijk van 6.3a's
`CompletedGame`-type) → 6.3c (UI, afhankelijk van 6.3a+6.3b). Alle drie in één
PR/branch (`claude/stap-6-3-q24m0p`), zoals PR 6.1 en 6.2 ook als één doorlopende
commit zijn opgeleverd.

## Appendix — fixes uit de externe PR-review (aug. 2026, PR #47)

Een onafhankelijke review op de eerste versie van deze PR identificeerde drie
merge-blocking bevindingen en één zichtbaarheidsprobleem, alle opgelost in een
vervolgcommit:

1. **Read-fout in `LocalStorageCompletedGameRepository` werd als "leeg"
   behandeld**: `list()` vertaalde een storage-readfout, corrupte JSON of een
   niet-array-payload naar `[]`, waarna `add()`/`remove()` die ambigue `[]`
   als schrijfbasis gebruikten — een tijdelijke leesfout kon zo de bestaande
   historie wissen. Opgelost door read-uitkomst en -fout expliciet te
   onderscheiden (`readAll(): { games, ok }`); `add()`/`remove()` weigeren nu
   te schrijven (`false`) zodra de voorafgaande read niet gelukt is.
2. **Afronden was niet crash-/fout-idempotent**: de reset van de actieve
   wedstrijd naar een verse opzet gebeurde impliciet via een later effect; bij
   een crash of mislukte write tussen archiveren en resetten bleef de
   zojuist afgeronde wedstrijd als 'tracking' hervatbaar, met een dubbele
   `CompletedGame` als risico bij een tweede afrondpoging. Opgelost met een
   nieuw `sourceGameId`-veld op `CompletedGame`, een synchrone/gecontroleerde
   reset in `handleFinishGame()`, en een resume-guard die een `ActiveGame`
   waarvan het ID al als `sourceGameId` in de historie staat nooit meer als
   'tracking' hervat.
3. **`scorer` kon afgeronde wedstrijden verwijderen**: `HistoryPanel` kreeg
   `canWriteGameData` (owner/admin/coach/scorer) i.p.v. de smallere
   `canManageTeamData`-grens (ADR-003: "wedstrijden beheren" is coach/owner/
   admin). Opgelost door `App.tsx` `canWrite` (== `canManageTeamData`) door te
   geven aan `HistoryPanel` voor de verwijderknop; lezen/exporteren blijft
   ongated.
4. **Opslag-/verwijderfouten waren op de Historie-tab onzichtbaar**:
   `HistoryPanel` kreeg een eigen `saveError`-prop met zichtbare foutbanner op
   zowel de lijst- als detailweergave.

Het vijfde punt — het JSON-back-upcontract-criterium — is geen bugfix maar een
statuscorrectie: zie de PARTIAL/OPEN-aantekening in §D.
