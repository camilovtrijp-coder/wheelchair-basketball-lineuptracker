# PR 5.4 — Onderzoeksrapport multi-organisatie- en twee-apparatenpilot

Status: 5.4a (commit `494b4d9`) en 5.4b (#40) gemerged; dit rapport is de afsluiting.
Getest tegen: `main` op `ceb8dc0` (PR #40 merge-commit), via CI-run #102 (groen).
Datum: 9 augustus 2026.

## A. Scope en locked-in beslissingen

PR 5.4 realiseert de tweede helft van Fase 5
(`docs/IMPLEMENTATION_PLAN.md` §10): de multi-organisatie- en
twee-apparatenpilot bovenop de al gemergde instellingen/team-sync
(PR 5.3 / #36). De pilot is opgesplitst in drie sub-PR's die elk een
afzonderlijke, groene regressie op de vorige stap vereisten:

- **5.4a** — UI-rolgrenzen (canManageTeamData als prop, panels hiden
  of disablen schrijfknoppen voor scorer/viewer) + listener-fout-
  detectie in `App.tsx` (niet-blokkerende "Verbinding met cloud
  weggevallen"-indicator na een listener-`onError` ná de initiële
  load). Resultaat: commit `494b4d9`.
- **5.4b** — field-patch voor niet-conflicterende writes
  (`setDoc(..., { merge: true })` zodra `documentExists` +
  `changedKeys.length > 0`), last-write-wins op hetzelfde veld, en
  actualiteit/cache-bron in de UI (`LastModified` met `updatedAt`
  en `fromCache`-sublabel in `SyncStatusIndicator`). Vier nieuwe
  e2e-tests tegen de Firebase-emulator. Resultaat: #40, commit
  `ceb8dc0`.
- **5.4c** — dit rapport + de §17-correctie (deze PR). Geen code,
  geen tests; administratieve afsluiting van de §J-trigger-criteria
  die in PR #36 al waren vastgelegd (`docs/pr-5.3d-onderzoeksrapport.md`
  regels 430-461) en van de §17-rijconsistentie die de pilot nodig
  had. De §17-tabel krijgt één samengestelde rij voor PR 5.4
  (in plaats van drie afzonderlijke rijen voor 5.4a/5.4b/5.4c) —
  spiegelt de oorspronkelijke bedoeling uit `docs/pr-5.4-plan.md`
  §C/5.4c ("nieuwe rij voor PR 5.4").

De zeven locked-in beslissingen uit de Q&A-sessie van 8 aug. 2026
(`docs/pr-5.4-plan.md` §E) zijn ongewijzigd:

1. **Conflict-semantiek: last-write-wins.** Firestore-standaard;
   één serverwaarde wint, beide clients convergeren via listener.
   Bewust geen "wie won"-attributie — alleen `updatedAt` als
   gebruikers-feedback.
2. **Reload-combinatie: 5.4 staat los, 5.5 neemt 'm verplicht mee.**
   De handmatige iOS/Android-protocolstappen 3-7 uit
   `pr-5.3d-onderzoeksrapport.md` §F worden een expliciet onderdeel
   van PR 5.5.
3. **UI-rolgrenzen: light-aanpak.** `canWrite` als prop op
   `SettingsPanel`/`RosterPanel`; geen `useCanWrite`-hook in de
   application-laag (Fase 6).
4. **Mobiele e2e: alleen handmatig protocol, geen automatisering.**
   Geen WebKit-CI in 5.4.
5. **Firestore-verbruik: alleen emulator-meting + extrapolatie.**
   Werkelijke staging-meting hoort bij 5.5.
6. **Issue #28: gesloten in PR 5.1 (#29, commit `e268404`+).**
   Geen PR-actie meer nodig in 5.4c; cross-org-isolatie is
   bewezen in `firebase/tests/rules/context-switcher-query.spec.ts`
   en `team-context-switcher-query.spec.ts`. De #28-rij in
   `docs/IMPLEMENTATION_PLAN.md` §17 wordt in deze PR bijgewerkt
   zodat de overige rijen (Fase 4, PR 4.4, Fase 5) niet meer naar
   #28 als open gate verwijzen.
7. **Stale-listener-follow-up: 5.4a neemt 'm mee.** `listenerError`-
   state + niet-blokkerende indicator lost de §J-follow-up #1
   uit PR #36 op vóór de pilot.

## B. Scenario-bevindingen

Per pilot-scenario één of twee regels; de gebruikte bronnen zijn de
testbestanden zelf (regelnummers verwijzen naar `main` op
`ceb8dc0`). De emulator-suite waar dit alles in CI tegen draaide
bevestigde het geheel als groen in CI-run #102.

| Scenario | Verwacht | Waargenomen | Testbewijs |
|---|---|---|---|
| 5.4a: rolgrenzen in UI (5 rollen × 2 panels) | Owner/admin/coach → schrijfknoppen enabled; scorer/viewer → disabled + read-only-indicator | Groene matrix; per (rol, panel) één test | `v2/tests/e2e-auth/role-matrix-ui.spec.ts` (140 regels, 10 cases) |
| 5.4a: listener-fout ná initiële load | Niet-blokkerende indicator verschijnt; verdwijnt bij volgende succesvolle listener-emit | Indicator verschijnt op `onError`; `onNext` ruimt 'm op; pre-load-fout gaat nog steeds naar `OfflineUncachedScreen` | `v2/tests/unit/AppListenerError.spec.tsx:150-203` |
| 5.4b: twee apparaten, zelfde team, live-deliver | Apparaat B ziet A's `teamName`-wijziging via listener binnen 15 s, geen reload, plus serverbevestigde `updatedAt` | Groene run; `settings-last-modified` zichtbaar op B | `v2/tests/e2e-auth/two-devices-same-context.spec.ts:9-31` |
| 5.4b: twee apparaten, verschillende organisaties | A schrijft `teamName`; B schrijft `tag1Label` parallel; beide docs behouden uitsluitend hun eigen write | Groene run; `teamName` alleen in A's doc, `tag1Label` alleen in B's doc | `v2/tests/e2e-auth/two-devices-different-orgs.spec.ts:4-39` |
| 5.4b: bewust conflict, zelfde veld | Last-write-wins; één serverwaarde; beide clients tonen winnaar; geen `actie-nodig`-panel; `updatedAt` zichtbaar | Groene run; winnaar is `alpha` of `beta` (Firestore serialiseert) | `v2/tests/e2e-auth/deliberate-conflict.spec.ts:10-50` |
| 5.4b: gelijktijdige niet-conflicterende velden | A's `teamName` + B's `tag1Label` blijven beide behouden via `setDoc(..., { merge: true })` | Groene run; beide clients zien de gecombineerde waarde | `v2/tests/e2e-auth/concurrent-non-conflicting-writes.spec.ts:10-49` |
| 5.4b: actualiteit in NL/EN | `LastModified` toont de serverbevestigde `updatedAt` met `Intl.DateTimeFormat`; rendert niets zonder timestamp | Groene runs; label `Laatst gewijzigd:` / `Last modified:` | `v2/tests/unit/LastModified.spec.tsx:9-25` |
| 5.4b: cache-bron in syncstatus | `fromCache` toont `uit cache` / `from cache` als suffix wanneer minstens één gegevensbron uit cache komt | Groene runs; alleen suffix wanneer van toepassing | `v2/tests/unit/SyncStatusIndicator.spec.tsx:29-37` |
| 5.4b: field-patch + empty-patch in repository | Bestaand document met `changedKeys.length > 0` → `setDoc(..., { merge: true })`; lege patch → no-op; eerste write of niet-bestaand doc → volledige schemawrite | Groene unit-tests; ook retry-pad na afgewezen create forceert volledige schema | `v2/tests/unit/FirestoreSettingsRepository.spec.ts:127-197` |
| 5.4b: useSyncStatus generatieteller + dismiss-isolatie | Late `settled`-afwijzing na dismiss/setter zet pending niet terug; nieuwere save "wint" over oudere late afwijzing; `isMountedRef` voorkomt post-unmount state-update | Groene unit-tests (18 cases; meeste dekken de onafhankelijke reviewpunten 2-5 uit PR #36) | `v2/tests/unit/useSyncStatus.spec.ts:325-412` |

**Volledige lokale run tegen de Firebase Auth/Firestore-emulator
(`firebase emulators:exec` via CI):** de v2-e2e:auth-suite groen
(`38 passed` over alle seriële runs — 24 PR 5.2-basistests, 10
5.4a role-matrix-tests, 4 5.4b twee-apparaten-tests); de
v2-unit-suite telt 229 passing tests verdeeld over 34 bestanden
(`v2/tests/unit/**`). Geen gedragsregressie op de 33 bestaande
v2-e2e-tests, de 76 firebase-base-tests of de 48 spike-tests.

## C. Open punten — bewust overgedragen aan PR 5.5

Deze punten zijn in 5.4 niet aangepakt, zijn geen blokker voor
5.4-merge, en worden expliciet onderdeel van PR 5.5 (Netlify
staging + GitHub-flow, IMPLEMENTATION_PLAN §10):

1. **Handmatige iOS/Android-validatie van de "offline write + reload
   terwijl offline met pending write"-combinatie**, per
   `docs/pr-5.3d-onderzoeksrapport.md` §F stappen 3-7 (genuine
   OS-vliegtuigmodus, niet CDP-emulatie). §A van dat rapport en §H
   documenteerden de eerdere bevindingen: de ernstige reload-hang
   reproduceert niet op een echt Windows-laptop-apparaat (2/2 schone
   runs), maar het label-gebrek uit §H punt 2 is wél bevestigd en
   is in 5.4a/b meegenomen; alleen de mobiele apparaatklasse en een
   echte productie-Firestore (vs. emulator) ontbreken nog. Trigger:
   eerste brede platformpilot-uitrol met echte coaches op echte
   telefoons (IMPLEMENTATION_PLAN §17 "Volledige validatie" rij).
2. **Werkelijke Firestore-verbruiksmeting op de Netlify-staging-
   Firebase** (vs. 5.4's emulator-extrapolatie). Trigger: het moment
   dat 5.5 het staging-Firebase-project daadwerkelijk provisioneert
   (afzonderlijke opdracht per AGENTS §18).
3. **Multi-write-queue-semantiek voor meerdere gelijktijdig-pending
   writes** (`pr-5.3d-onderzoeksrapport.md` §J punt 2 + §J
   trigger-criteria aldaar). De generatieteller-dekking in
   `useSyncStatus.ts` is voldoende voor het gangbare geval (een
   latere volledige-documentwrite draagt de inhoud van een eerdere,
   nog niet bevestigde write al mee, omdat de UI de payload uit de
   actuele in-memory-staat opbouwt), maar lost het bredere
   ontwerpvraagstuk van een expliciete merge-/wachtrijstrategie
   niet op. Trigger: eerste multi-tab-scenario of Fase 6 PR 6.2.

## D. Cross-references

- **Issue #27 (offline-write-hang):** gesloten op verkleinde scope
  in PR 5.3d (#36), met de driehoeksmeting en het handmatige
  apparaatprotocol in `docs/pr-5.3d-onderzoeksrapport.md` §A-§I. De
  label-fix uit §H punt 2 is meegenomen in 5.4a/b.
- **Issue #28 (cross-org `collectionGroup`-query):** gesloten in
  PR 5.1 (#29) via het `collectionGroup`-querycontract + `uid`-veld
  (`docs/architecture/adr-003-tenancy-and-authorization.md` en
  `firebase/docs/QUERY_CONTRACT.md`). Geen open punten meer.
- **§17 in `docs/IMPLEMENTATION_PLAN.md`:** deze PR voegt één
  nieuwe samengestelde rij toe voor PR 5.4 (5.4a/5.4b/5.4c) en
  corrigeert de Fase 4-, PR 4.4- en Fase 5-rijen zodat ze niet
  meer naar #28 als open gate verwijzen (de #28-rij van PR 5.1 was
  al correct).
- **§J-trigger-criteria in `docs/pr-5.3d-onderzoeksrapport.md`
  regels 430-461:** door PR #36 (commit `1957182`) al toegevoegd
  vóór 5.4; deze PR herhaalt of wijzigt die criteria niet.
- **Locked-in beslissingen:** `docs/pr-5.4-plan.md` §E.
