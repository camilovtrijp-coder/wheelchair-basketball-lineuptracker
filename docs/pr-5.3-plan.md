# PR 5.3 — Voorbereidingsplan (Firestore-cache en settings/team-sync)

**Status:** plan, klaar voor review door eigenaar
**Repo:** `camilovtrijp-coder/wheelchair-basketball-lineuptracker` (v2-/herbouwomgeving)
**Geverifieerd tegen:** `origin/main` op `f6d18d1` (PR 5.2)
**Harde gate:** issue #27 (volledige offline-reload + cache-write + tweede cliënt), status PARTIAL/OPEN sinds PR 4.4

## A. Bijgewerkte reality-check

`main` is verder dan een eerdere, ongeverifieerde lezing suggereerde. Aanwezig en bruikbaar voor PR 5.3:

- **Fasen 0–3 volledig gemerged:** PR 3.1 (scaffold), 3.2a (technisch fundament + `injectManifest`-PWA), 3.2b (Instellingen), 3.2c (Team). Architectuurreview na 3.2c doorlopen.
- **Fase 4 volledig gemerged:** ADR-001 (`docs/architecture/adr-001-cloud-data-platform.md`), ADR-002 (`adr-002-offline-sync-strategy.md`), ADR-003 (`adr-003-tenancy-and-authorization.md`) — alle drie geaccepteerd op 5 augustus 2026. PR 4.4 (begrensde Firebase-spike) in `firebase-spike/`; 48 tests groen.
- **PR 5.1 volledig gemerged:** `firebase/` workspace (npm-pakketnaam `firebase-base`): `firebase.json`, `firestore.rules` (incl. `match /settings/{settingsId}` en `match /roster/{rosterId}` met `canReadTeam` read + `canManageTeamData` write), `firestore.indexes.json`, typed `settingsConverter`/`rosterConverter` in `firebase/src/documents/`, seeddata voor 2 organisaties / 3 teams / 5 rollen, 76 tests. Issue #28 (cross-org query) gesloten via `firebase/docs/QUERY_CONTRACT.md`.
- **PR 5.2 volledig gemerged:** `v2/src/app/AuthGate.tsx` (eigen state-machine via `deriveAppState`), `AuthGateway`/`FirebaseAuthGateway`, `LoginScreen`/`SignupScreen`/`TrustedDevicePrompt`, `ContextSwitcher`, `SessionBar`, `NoOrganizationsScreen`, `AcceptInvitationScreen`, `OfflineUncachedScreen`, `ContextRevokedScreen`, `FirestoreOrganizationGateway`, `selectedContext`, `trustedDevice`, `firebaseClient` met `resolveLocalCacheMode(trusted) → persistentLocalCache vs memoryLocalCache`. Bestaande v2-e2e-suite verhuisd naar `tests/e2e-auth/` achter `playwright.auth.config.ts`; nieuwe `v2-e2e`-CI-job tegen `firebase emulators:exec`. Issue #31 gesloten. **Issue #27 blijft expliciet OPEN als harde gate voor PR 5.3** (regel 867 van het plan: "PR 5.3 is niet voltooid zonder volledige offline-reloadtest").

Concreet herbruikbaar in PR 5.3:

- `v2/package.json` heeft `firebase` + `firebase-base` al als dependencies.
- `firebase/src/documents/{settings,roster}.ts` + converters zijn klaar en round-trip-getest (inclusief 16 negatieve malformed-data-tests).
- `firestore.rules` allowlist voor settings/roster staat; gedekt door `firebase-base` CI.
- `v2/src/infrastructure/firebase/firebaseClient.ts` implementeert al `resolveLocalCacheMode(trusted)`; in headless Chromium is bewust géén `tabManager` gezet om Web Locks-hang te vermijden (zie SPIKE_REPORT §10.1).
- `AuthGate` beheert al `selectedContext` (orgId + teamId), `authUser`, `trustedDeviceAnswered` en routeert via `deriveAppState` naar de juiste UI (inclusief de bestaande `uncached-offline`-state die `OfflineUncachedScreen` toont).
- Spike-harnas (`firebase-spike/browser-harness/main.ts`) bevat al een werkende `FirestoreSettingsRepository` + `FirestoreRosterRepository` + `subscribe()` + `pendingActionNodig`-store. Directe basis voor de productie-adapters.

Niet aanwezig, hoort expliciet bij PR 5.3:

- `AsyncSettingsRepository` / `AsyncRosterRepository` in `v2/src/application/...` (sync-over-async-brug ontbreekt; spike §5.1 markeerde dit als openstaande eigenaarkeuze).
- `FirestoreSettingsRepository` / `FirestoreRosterRepository` onder `v2/src/infrastructure/...` (de spike-varianten zitten in `firebase-spike/`, niet in de productieworkspace).
- Sync-statusindicator + `Actie nodig`-pad in de UI.
- v1→cloud import: lezen van `lineup-tracker-settings` + `lineup-tracker-roster`, valideren, schrijven naar `organizations/{orgId}/teams/{teamId}/settings/current` + `.../roster/current`. v1-keys worden **niet** verwijderd.
- i18n-strings voor de vier sync-toestanden.
- **`#27` PWA-offline-reloadtest in CI** — de daadwerkelijke harde gate.

## B. Scope van PR 5.3 (volgens IMPLEMENTATION_PLAN §10)

| In scope | Niet in scope |
|---|---|
| Firebase-adapters achter een **nieuwe `Async*Repository`-poort**; UI praat uitsluitend via die poort. | Tweede, "echte" repository-port of sync-over-async-brug. De keuze is open en expliciet — zie beslissing 1. |
| `persistentLocalCache` alleen na vertrouwd-apparaatkeuze (al geïmplementeerd in `firebaseClient.ts`). | Wijziging van `AuthGate` of de vertrouwd-apparaatprompt zelf. |
| v1→cloud-kopie: opt-in, getest, geen delete van v1-keys. | v1→cloud import voor `lineup-tracker-games` of andere keys. |
| Vier sync-toestanden in UI; `Actie nodig` herstelbaar + exporteerbaar. | Aggregatie- of rapportageschermen. |
| Vier #27-acceptatietests in CI die automatisch in de bestaande `v2-e2e`-job groen worden. | PR 5.4 (multi-org/twee-apparatenpilot) en PR 5.5 (Netlify staging). |

Bewaking tegen AGENTS §3:

- **v1-localStorage-keys niet verwijderen** — cloud-import is additief; `localStorage.getItem('lineup-tracker-settings')` blijft na migratie letterlijk gelijk aan ervoor. Bewijs in een Vitest.
- **Geen Firebase secrets in browsercode** — `firebaseClient.ts` gebruikt al `projectId: 'demo-lineup-tracker-dev'`, `apiKey: 'demo-key'`; CI draait uitsluitend tegen de Emulator. Geen productie-Firebase.
- **CSV-contract en v1-back-up ongewijzigd** — geen aanraking van `lineup-tracker-games` of de exportlogica.
- **i18n nieuw zichtbaar** — vier sync-toestanden in NL én EN in `v2/src/i18n/strings.ts`.
- **Statistiekberekeningen niet aanraken** — settings/roster zijn geen statistiekpaden.
- **Safari + iPadOS-module-SW-onzekerheid** (PR 8.1-scope, niet vervroegen): de SW uit PR 3.2a wordt in CI op Chromium getest; Safari-specifieke validatie blijft expliciet 8.1.

## C. Vier sub-PRs

PR 5.3 is in zijn geheel te groot voor één reviewbare PR (AGENTS §3 "vermijd één grote PR"). Gesplitst in 4 sub-PRs; iedere sub-PR levert een afzonderlijk groen-tests-pakket, geen gedragsregressie op eerdere PR's, en geen API-wijziging in een nog niet-gebruikt deel.

**Belangrijke conventie voor iedere sub-PR-beschrijving:** geen van 5.3a t/m 5.3c is op zich "PR 5.3 voltooid". Alleen 5.3d (de automatische #27-acceptatietests) sluit de gate. Sub-PRs 5.3a–5.3c markeren hun status expliciet als *"onderdeel van PR 5.3, nog niet voltooid tot 5.3d groen is in CI"*.

### 5.3a — Async sibling-poorten + Firestore-adapters + repository-compositie

Doel: bestaande sync-poort uitbreiden met een async broer, en de Firestore-adapter achter die broer hangen zonder de UI- of localStorage-paden te wijzigen.

Werk:

1. **Adapterkeuze (architecturaal bindend — gecorrigeerd op basis van review):** de adapter wordt gekozen op basis van **`authUser && selectedContext && trustedDevice`** (alle drie vereist) versus géén van die drie. `online` is géén schakelcriterium.
   - Bij alle drie aanwezig → `FirestoreSettingsRepository` + `FirestoreRosterRepository` (uit deze PR).
   - Bij geen van de drie → `LocalStorageSettingsRepository` + `LocalStorageRosterRepository` (bestaand; pre-cloud/legacy-modus).
   - Offline binnen de Firestore-modus is geen ander pad: de adapter leest uit `persistentLocalCache` en queueut writes lokaal. Een **nooit-gecachte context** terwijl offline blijft de bestaande `uncached-offline`-state uit `deriveAppState`/`OfflineUncachedScreen` — geen fallback naar een andere repository. Dit is consistent met hoe `AuthGate` al omgaat met memberships (geen "fallback naar lege lijst", maar expliciete "geen cache"-UI).
   - Rationale: een cloud-only team heeft geen v1-localStorage-data; een fallback naar localStorage bij offline zou een lege of verouderde dataset tonen en de #27-garantie (cache blijft zichtbaar na offline reload) architectonisch onmogelijk maken.

2. **Async sibling-poort:** nieuwe `AsyncSettingsRepository` / `AsyncRosterRepository` interfaces in `v2/src/application/{settings,roster}/`, identieke domeintypes, `Promise<...>`, met `subscribe(onNext, onError): () => void` voor live updates. De sync-poort blijft voor localStorage (PR 3.2b/3.2c-tests blijven ongewijzigd).
3. **Adapters porten vanuit spike** (`firebase-spike/src/adapters/FirestoreSettingsRepository.ts` → `v2/src/infrastructure/settings/FirestoreSettingsRepository.ts`, idem voor roster). `settingsConverter` en `rosterConverter` komen uit `firebase-base/documents`. `getDocFromCache`-fallback in `read()`, `setDoc` met `serverTimestamp()`, `subscribe()` met `includeMetadataChanges: true`, en `actie-nodig` bij geweigerde write (geen stille fallback, conform ADR-002).
4. **Compositie in `App`:** `App` ontvangt de gekozen adapter via props van `AuthGate` (geen eigen adapter-resolutie; één bron van waarheid voor "welke modus"). `AuthGate` kiest de adapter precies op de drie criteria uit punt 1, geeft `null` mee als geen van de drie aanwezig is (localStorage-modus).
5. **Unit-tests (Vitest):** `FirestoreSettingsRepository` met een geïsoleerde `FakeFirestore` (spy op `setDoc`/`onSnapshot`/`getDocFromCache`/`getDoc`) — happy path, cache-fallback, geweigerde write → `actie-nodig`, **en een spy-bewijs dat elke `saveSettings` precies één `setDoc`-call veroorzaakt** (geen retry-duplicatie) — dit verplaatst het "exact één keer"-bewijs naar de juiste laag, zoals in de review opgemerkt.

Buiten scope: UI-werk, v1→cloud-kopie, #27-tests, aanpassing van `AuthGate` zelf.

Risico: nieuwe async-poort naast sync-poort is een uitbreiding van `application/` — expliciet gekozen; zie beslissing 1.

### 5.3b — v1→cloud import (opt-in, getest, geen v1-delete)

Doel: eenmalige, geteste kopie van `lineup-tracker-settings` + `lineup-tracker-roster` naar de gekozen teamcontext, expliciet aangeroepen door de gebruiker (geen stille migratie).

Werk:

1. `v2/src/application/settings/usecases.ts` + `v2/src/application/roster/usecases.ts` krijgen `migrateLocalStorageToCloud(local, async, orgId, teamId): Promise<{ok, imported, skipped, errors}>`.
2. Valideer via de bestaande `normalizeSettings` / `normalizeRoster` (pure, al getest) vóór iedere write. Identieke "X is verplicht"-fouten als in de huidige localStorage-paden.
3. **UI-plaatsing (architecturaal bindend — gecorrigeerd op basis van review):** de "Eenmalig naar cloud kopiëren"-knop hoort **niet** in `AuthGate` (data-migratie is geen routering-state). De knop verschijnt in een discrete banner boven `SettingsPanel`/`RosterPanel` zodra `selectedContext` actief is en er nog **niet** eerder naar cloud gekopieerd is voor dit team. Geen automatische call, geen verwijdering van de v1-keys.
4. v1-keys blijven onaangeroerd: een Vitest bewijst na de migratie dat `localStorage.getItem('lineup-tracker-settings')` exact gelijk is aan vóór de migratie (byte-equality). De cloud-versie wordt gemarkeerd met een `cloudImportedAt`-vlag in localStorage (puur een UI-hint, niet权威).
5. i18n-strings `cloudImportPrompt`, `cloudImportButton`, `cloudImportSuccess`, `cloudImportError`, `cloudImportAlreadyDone` (NL + EN).

Buiten scope: automatische sync na elke write, conflict-resolutie, write-naar-cloud van de v1-keys zelf, terug-schrijven van cloud naar localStorage.

Risico: scope-creep richting "v1 volledig vervangen" — expliciet verboden in §B. 5.3b voegt cloud toe, vervangt niets.

### 5.3c — Sync-status-UX + `Actie nodig`-pad

Doel: de vier toestanden uit ADR-002 worden in de UI zichtbaar; geweigerde writes zijn herstelbaar en exporteerbaar.

Werk:

1. **Sync-status hook** in `App`: leeft de huidige `AsyncSettingsRepository`/`AsyncRosterRepository` af, exposeert `{status, lastError, pendingPayload}[]` aan de UI.
2. **Indicator in `SessionBar`:** niet-opdringerig, met NL/EN-vertaling — `Lokaal beschikbaar` / `Wacht op synchronisatie` / `Gesynchroniseerd` / `Actie nodig` (4 nieuwe toetsen in `v2/src/i18n/strings.ts`).
3. **`Actie nodig`-paneel:** lijst van geweigerde payloads, per item `[Opnieuw proberen] [Negeren] [Exporteren]`.
4. **Exportformaat (beslissing 3 — akkoord):** de geweigerde payload wordt geëxporteerd als één `.json`-bestand in de **v1-back-up-`data`-envelop** (spiegelt `validateBackupData`'s verwachtte structuur in `data-contracts.md` §"Backupformaat"), downloadbaar via `URL.createObjectURL` + `<a download>`. Voordeel: de gebruiker kan dit fragment later via de bestaande import-flow terugzetten zonder een nieuw sidecar-formaat te leren.
5. **"Negeren"** verwijdert uit de pending-store maar raakt `lineup-tracker-settings`/`-roster` niet aan.
6. **Unit + e2e:** Vitest voor de hook (juiste indicator per `SyncState`-variant; "Opnieuw proberen" levert write opnieuw aan en wist pending bij `ok`). Mobiele e2e-test (zelfde patroon als PR 3.2a) voor het paneel.

Buiten scope: cross-team sync-conflicten, sync van `games` of andere v1-keys.

Risico: nieuwe UI met eigen toetsenbord/a11y-eisen — bestaande `jsx-a11y` lint moet slagen; mobiele e2e-test verplicht (PR 3.2a-pattern).

### 5.3d — Harde gate #27 in CI

Doel: de vier acceptatiecriteria automatisch in de bestaande `v2-e2e`-CI-job bewijzen — **PR 5.3 is pas voltooid als deze groen zijn**.

Achtergrond uit SPIKE_REPORT §8: de spike bewees offline-edit/reconnect/tweede-cliënt alleen binnen één paginasessie. Een volledige page-reload terwijl offline vereist een PWA-capabele testbuild — dat is precies wat `v2-e2e` al doet (`npm run build` + `npm run preview:e2e` met `injectManifest`-SW uit PR 3.2a). **Geen CI-wijziging nodig**; alleen nieuwe tests in de bestaande job.

Werk: nieuwe `v2/tests/e2e-auth/offline-reload-cache-write-second-client.spec.ts` met vier tests (serieel, geen parallel — `playwright.auth.config.ts` staat al op `workers: 1`).

1. **Test 1 — app-shell laadt zonder netwerk (PWA):** log in (carol, vertrouwd apparaat), wacht tot `navigator.serviceWorker.controller` actief is en `caches.keys()` minimaal één precache bevat. `context.setOffline(true)`. `page.reload()`. Assert `.app-title` rendert met de geseede teamnaam (`SEED_SETTINGS_A.teamName`). **Vereist dat 5.3a Firestore read doet bij mount zodat de offline cache gevuld is.**
2. **Test 2 — gecachte team/settings na offline reload:** idem setup, na `setOffline(true)` + `page.reload()` assert `RosterPanel` toont ≥ 1 speler uit `SEED_PLAYERS_A` (geen lege-roster-stille-default) en `SettingsPanel` toont de geseede teamnaam. Bewijst: een lege cache wordt nooit als "leeg team" geïnterpreteerd.
3. **Test 3 — offline write + reload + reconnect + tweede cliënt ziet serverwaarde:** `setOffline(true)`, wijzig `teamName` via SettingsPanel-save. `page.reload()` (nog offline) — assert nieuwe teamnaam zichtbaar (cache). `setOffline(false)`, wacht op indicator `Gesynchroniseerd`. Open tweede `browser.newContext()` als bob (admin), lees `teamName` — moet exact de gewijzigde waarde zijn. Het **"exact één keer"-bewijs** levert de Vitest uit 5.3a (spy op `setDoc`); de e2e-test bewijst hier alleen dat de eindwaarde landt zoals verwacht (deze helft is in de spike al ✅ bewezen).
4. **Test 4 — nooit-gecachete context offline:** log in met een verse gebruiker, wijs een tweede, nooit eerder geopende teamcontext toe, `setOffline(true)` vóór de eerste Firestore-read. Assert `OfflineUncachedScreen` (hertest van spike's `subscribeSettings()`-emitCount-gedrag, maar nu in de productie-UI). Bewijst: een ongecachete context wordt nooit als lege roster getoond.

Na merge van 5.3d: issue #27 sluiten in dezelfde PR of in een directe follow-up; de status-tabel van `docs/IMPLEMENTATION_PLAN.md` §17 aanvullen met "PR 5.3 voltooid" + een regel per sub-PR.

Buiten scope: productie-omgeving, Netlify, Safari-specifieke validatie (PR 8.1).

Risico: Playwright's `setOffline(true)` deactiveert Firestore-WS via de HTTP-laag; in CI met `experimentalForceLongPolling: true` (al ingesteld in `firebaseClient.ts`) zou dit moeten werken. Bij twijfel een `page.route('**/firestore.googleapis.com/**', ...)`-interceptie toevoegen die netwerkfouten simuleert. Open punt; eerste testrun moet dit bevestigen.

## D. #27-hard-gate expliciet

| # | Eis uit issue #27 | Spike-bewijs | PR 5.3-bewijs |
|---|---|---|---|
| 1 | app-shell laadt zonder netwerk (PWA-capable build) | Onbewezen (dev-server) | 5.3d test 1 — `dist/` + `vite preview` + `setOffline` + `reload` |
| 2 | gecachte team/settings blijven correct zichtbaar na offline reload | Onbewezen (zelfde) | 5.3d test 2 |
| 3 | offline wijziging na reload blijft lokaal, synchroniseert na reconnect precies één keer | Binnen één sessie bewezen | 5.3d test 3 (eindwaarde) + 5.3a Vitest (spy: 1 `setDoc` per save) |
| 4 | tweede cliënt ziet dezelfde serverwaarde | ✅ spike | 5.3d test 3 (tweede `browser.newContext()`) |

Geen van deze tests is vandaag groen. 5.3d is dus **letterlijk de blocker** voor "PR 5.3 voltooid".

## E. Open beslissingen

1. **Async-poort of sync-over-async-brug** — spike §5.1 noemt dit expliciet als nog te nemen eigenaarkeuze. Aanbevolen: **(A) tweede `Async*Repository`-poort** naast de bestaande sync-poort. UI gebruikt de async poort zodra Firestore gekozen is; sync-poort blijft voor localStorage-modus. Geen sync-over-async-brug, dus geen microtask- of busy-loop-randgedrag. Spike-code is direct herbruikbaar. Varianten (B sync-over-async-cache, C UI volledig async) staan in dit document; aanbeveling is A.

   **Inclusief de architecturale fix uit review:** adapterkeuze = `authUser && selectedContext && trustedDevice` (Firestore) versus géén (LocalStorage). `online` is geen schakelcriterium. Offline binnen Firestore-modus = `persistentLocalCache`-read; ongecachet offline = bestaande `OfflineUncachedScreen` (geen fallback naar LocalStorage).

2. **`#27` CI-strategie** — aanname: de bestaande `v2-e2e`-job (Emulator + `vite preview` van `dist/`) is voldoende voor de vier tests, geen nieuwe job. Alternatief: een aparte `v2-e2e-pwa`-job als blijkt dat de `v2-e2e`-job onvoldoende PWA-isolatie biedt (tegen stemt: extra CI-minuten zonder functioneel voordeel).

3. **`Actie nodig`-exportformaat** — **akkoord** op v1-back-up-`data`-envelop (zie 5.3c punt 4).

4. **v1→cloud import: éénrichting** — **akkoord** op éénrichting (5.3b): één keer pushen, nooit v1→cloud-resync. Geen automatische sync van writes.

## F. Aanbevolen volgorde

1. Eigenaar bevestigt beslissingen 1, 2, 4 (3 is akkoord). Issue #27 in deze repo opnieuw bevestigen/verlengen met de body die de vier scenario's + de CI-job specificeert.
2. Eerste sub-PR: **5.3a** op een nieuwe branch `feature/pr-5.3a-async-firestore-adapters`, gebaseerd op `origin/main` (`f6d18d1`).
3. 5.3b, 5.3c, 5.3d als opeenvolgende PR's met groene regressie op alle vorige sub-PR's + de bestaande 33 v2-e2e + 11 v2-e2e-auth + 76 firebase-base + 48 spike-tests.
4. Na merge van 5.3d: issue #27 sluiten, status-tabel §17 bijwerken, "PR 5.3 voltooid".

## Appendix — wijzigingen t.o.v. eerste plandraft

Na verificatie door een tweede model en een architecturale review zijn de volgende correcties op het eerste plan doorgevoerd:

| § | Wijziging | Bron |
|---|---|---|
| §A | Reality-check geverifieerd tegen `origin/main` (`f6d18d1`) en GitHub-issue #27 zelf; "vrijwel woordelijk" akkoord. | review |
| C / 5.3a punt 1 | Adapterkeuze: `online` verwijderd als schakelcriterium. Drie vereisten: `authUser && selectedContext && trustedDevice`. Offline binnen Firestore-modus = cache-read, niet fallback. | review (architecturale tegenstrijdigheid met `AuthGate.tsx` `uncached-offline`-patroon) |
| C / 5.3b punt 3 | "Kopiëren?"-knop uit `AuthGate` verplaatst naar banner in `SettingsPanel`/`RosterPanel` — scheiding van verantwoordelijkheden tussen routering en data-migratie. | review |
| C / 5.3d test 3 | "Exact één keer"-bewijs verplaatst naar Vitest in 5.3a (spy op `setDoc`); de e2e-test bewijst alleen de eindwaarde. | review (fragiele emulator-instrumentatie) |
| C / alle sub-PRs | Expliciete statusregel toegevoegd: "5.3a–5.3c zijn individueel niet 'PR 5.3 voltooid'; alleen 5.3d sluit de gate." | review (Minimax-uitvoeringsrisico) |
| E / 1 | Architecturale fix uit §C/5.3a expliciet onderdeel gemaakt van beslissing 1 zodat eigenaarsbeslissing in één keer genomen kan worden. | review |
