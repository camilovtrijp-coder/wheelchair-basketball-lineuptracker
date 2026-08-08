# PR 5.4 — Voorbereidingsplan (multi-organisatie- en twee-apparatenpilot)

**Status:** goedgekeurd na review + Q&A; klaar om te implementeren.
**Repo:** `camilovtrijp-coder/wheelchair-basketball-lineuptracker` (v2-/herbouwomgeving)
**Geverifieerd tegen:** `origin/main` op `17a78d4` (PR 5.3d vervolgfix, gemerged als onderdeel van #36)
**Voorganger:** PR 5.3 (gemerged in #36). #27 gesloten op verkleinde scope — zie `docs/pr-5.3d-onderzoeksrapport.md` §I.
**Laatst bijgewerkt:** 8 augustus 2026 — plan aangepast na Q&A (zie §C/5.4a voor `canWrite`-berekening, indicator-locatie en teststrategie).

## A. Bijgewerkte reality-check

`main` is verder dan ooit. Aanwezig en bruikbaar voor PR 5.4:

- **Fase 5 fundament volledig gemerged:** PR 5.1 (`firebase/` workspace met `firestore.rules`, `settingsConverter`/`rosterConverter`, 76 tests, #28 gesloten via `collectionGroup`-querycontract + `uid`-veld), PR 5.2 (`AuthGate` met `deriveAppState`-state-machine, login/signup/vertrouwd-apparaatprompt, contextwisselaar, invitations, multi-org + team-only-membership — #31 gesloten), PR 5.3 (`v2/src/infrastructure/settings|roster/{Firestore,LocalAsync}*Repository.ts`, `useSyncStatus`-hook, `ActionNeededPanel` + `SyncStatusIndicator`, `migrateLocalStorageToCloud`, v1→cloud-import — #27 op verkleinde scope gesloten).
- **`TeamAccess.canManageTeamData` is al beschikbaar in de domeinlaag** (`v2/src/domain/organizations/teamAccess.ts:5, 48`) — er is een pure `deriveTeamAccess(orgRole, teamMemberRole): { effectiveRole, canManageTeamData, isExplicitlyAuthorized }` die exact spiegelt wat `firestore.rules`' `canManageTeamData` toestaat (owner/admin of een teamMemberRole van `'coach'`). De UI gebruikt dit nog **niet** — de huidige `SettingsPanel`/`RosterPanel` tonen save/reset/add-knoppen aan elke rol. 5.4a maakt de prop beschikbaar en de panels beslissen.
- **Live listener-foutdetectie ontbreekt.** `App.tsx:147–155` en `159–166` geven de `subscribe()`'s `onError` door aan `markUncachedOffline`, die `OfflineUncachedScreen` toont — maar dat pad vereist `settings === null || roster === null`. Na een succesvolle initiële load faalt de listener, blijft de gebruiker op verouderde data zonder foutmelding. Dit is een open follow-up uit `pr-5.3d-onderzoeksrapport.md` §J die in 5.4a wordt opgepakt.
- **Listeners leveren al `fromCache: boolean` mee** via `SyncState` (`v2/src/domain/syncState.ts:15, 31`) — een sublabel "uit cache" is een UI-uitbreiding van één regel, niet een nieuwe architectuurlaag. `updatedAt` is als `serverTimestamp()` op alle settings/roster-documenten aanwezig maar wordt door `stripUpdatedAt` uitgekleed voor de UI; 5.4b leidt `updatedAt` via een apart kanaal naar de panels.
- **Twee `browser.newContext()`s in één test is al bewezen patroon** in `v2/tests/e2e-auth/offline-reload-cache-write-second-client.spec.ts:181–192` (tweede cliënt voor de serverwaarde-verificatie). 5.4b zet hetzelfde patroon in voor live-listener-deliver en conflict-tests.
- **Issue #28 (cross-org `collectionGroup`-query) is technisch gesloten in PR 5.1** (zie `docs/IMPLEMENTATION_PLAN.md` §17 regel 869) — de tests in `firebase/tests/rules/context-switcher-query.spec.ts` en `team-context-switcher-query.spec.ts` bewijzen het. **Maar §17 Fase 4-rij en PR 4.4-rij zijn niet bijgewerkt** — die vermelden nog steeds "#27 en #28 staan open". 5.4c ruimt die inconsistentie administratief op.

Niet aanwezig in `main`, hoort expliciet bij PR 5.4:

- `Role` (of `canManageTeamData: boolean`) als prop in `SettingsPanel`/`RosterPanel` (light UI-restrictie, zie locked-in beslissing 3 in §E).
- `listenerError`-state in `App.tsx` en een bijbehorende "verbinding weggevallen"-indicator in `App.tsx` (PR 5.3d §J-follow-up).
- Twee-apparaten-e2e-tests met `live listener delivery` (niet alleen offline-reload).
- `updatedAt`-rendering in `SettingsPanel`/`RosterPanel` en `fromCache`-sublabel in `SyncStatusIndicator`.
- `docs/pr-5.4-onderzoeksrapport.md` met last-write-wins-ontwerpbeslissing en pilot-bevindingen.
- §17-tabel-correctie voor #28-status en een nieuwe rij voor PR 5.4.

Niet aanwezig en **niet** in scope voor 5.4 (bewuste uitstellers):

- Echte iOS/Android-device-tests in CI. Locked-in beslissing 4: alleen handmatig protocol in `pr-5.4-onderzoeksrapport.md`, geen automatisering.
- Werkelijke Firestore-verbruiksmeting op een Netlify-staging. Locked-in beslissing 5: alleen emulator-meting + extrapolatie.
- De "offline write + reload terwijl offline met pending write"-combinatie. Locked-in beslissing 2: 5.4 staat los; de handmatige iOS/Android-protocolstappen 3–7 uit `pr-5.3d-onderzoeksrapport.md §F` worden verplicht onderdeel van PR 5.5.
- Multi-write-queue-semantiek voor meerdere gelijktijdig-pending writes. Open follow-up uit PR 5.3d §J — bewust uitgesteld naar eerste multi-tab-gebruik of Fase 6 PR 6.2.
- Roster-normalisatie (`roster/current` → `players/{playerId}`-subcollectie). Fase 7-beslissing.

## B. Scope van PR 5.4 (volgens `IMPLEMENTATION_PLAN` §10)

| In scope | Niet in scope |
|---|---|
| Volledige UI-autorisatiematrix: owner/admin mogen schrijven, coach mag schrijven, scorer/viewer zien read-only (canManageTeamData als prop, panels hiden of disabled knoppen). | Een `useCanWrite(orgId, teamId)`-hook in de application-laag. Hoort bij Fase 6 wanneer meerdere panels dezelfde logica nodig hebben. Light-aanpak volstaat voor 5.4. |
| Twee-apparaten-scenario's in e2e: live-listener-deliver, verschillende orgs gelijktijdig, deliberate conflict (last-write-wins), non-conflicterende parallelle writes. | De combinatie "offline write + reload terwijl offline met pending write" — verkleinde scope van PR 5.3 blijft gehandhaafd; validatie verplaatst naar 5.5. |
| Bron, actualiteit en syncstatus in de UI: `updatedAt` ("laatst gewijzigd op X") in panels; `fromCache` als sublabel in `SyncStatusIndicator` wanneer van toepassing; syncstatus bestaat al. | Nieuwe syncstatussen of een nieuw indicator-design. Bestaande vier toestanden + het "verbinding weggevallen"-attribuut uit 5.4a zijn het totaalplaatje. |
| Stale-listener-follow-up uit `pr-5.3d-onderzoeksrapport.md` §J: `listenerError`-state + niet-blokkerende indicator. | Volledige reconnect-flow met automatische retry. De indicator signaleert; de gebruiker vernieuwt handmatig. |
| `pr-5.4-onderzoeksrapport.md` met per-scenario-bevindingen en een expliciet last-write-wins-ontwerpbesluit. | Werkelijke Firestore-verbruikscijfers op staging (hoort bij 5.5). Emulator-meting + extrapolatie volstaat. |
| §17-tabel-correctie: Fase 4-rij + PR 4.4-rij consistent met de werkelijke #28-sluiting in PR 5.1; nieuwe rij voor PR 5.4; §J-trigger-criteria aanvulling. | Algemene §17-herziening of andere eerdere inconsistenties buiten 5.4-scope. |
| Issue #28 administratief sluiten. | Issue #27 herbeoordelen (reeds in PR 5.3 gesloten op verkleinde scope). |

**Bewaking tegen AGENTS §3:**

- **Geen nieuwe `localStorage`-keys.** 5.4 voegt niets toe aan de bestaande v1-keys; de rolgrens en listener-fout zijn puur UI-state. De `updatedAt` is al op het Firestore-document aanwezig, alleen nog niet zichtbaar.
- **Geen Firebase secrets.** Geen nieuw Admin-SDK-gebruik; alleen al bestaande Firestore-`onSnapshot`-subscribe in de browser-SDK.
- **CSV-contract en v1-back-up ongewijzigd.** Geen aanraking van `lineup-tracker-games` of exportlogica.
- **i18n nieuw zichtbaar:** drie NL+EN-paren (`settingsReadOnly`, `rosterReadOnly`, `listenerErrorIndicator`) + een optionele "uit cache"-sublabel (`syncStatusFromCache`). `fromCache`-sublabel is een technische micro-string die óók een i18n-sleutel verdient.
- **Safari + iPadOS** blijven expliciet PR 8.1-scope. De nieuwe UI is klein genoeg om geen extra Safari-risico te introduceren.
- **Statistiekberekeningen ongewijzigd.** 5.4 raakt settings/roster, geen stats.

## C. Drie sub-PRs

PR 5.4 is in zijn geheel te groot voor één reviewbare PR (AGENTS §3). Gesplitst in drie sub-PRs; iedere sub-PR levert een afzonderlijk groen-tests-pakket en geen gedragsregressie op eerdere PR's.

**Conventie** (overgenomen uit PR 5.3): geen van 5.4a/5.4b is op zich "PR 5.4 voltooid". 5.4c documenteert de pilot-bevindingen en sluit de gate. De acceptatiecriteria uit `IMPLEMENTATION_PLAN §10` ("cross-organisatietoegang mislukt", "rolgrenzen in UI en Rules", "geen stil dataverlies bij conflict", "bron/actualiteit/syncstatus zichtbaar") zijn pas volledig bewezen na 5.4b + 5.4c.

### 5.4a — UI-rolgrenzen + listener-fout-detectie

**Doel:** sluit 5.4-acceptatiecriterium #2 (rolgrenzen in UI) en de open §J-follow-up #1 (stale listener) af. Geen architectuuruitbreiding — pure UI/state-laag.

**Werk:**

1. **`canWrite` prop in `AppProps` en in `SettingsPanel`/`RosterPanel`.** `AuthGate` berekent deze prop door de bestaande team-validatiecall uit te breiden:
   - `OrganizationGateway.validateSelectedTeam()` krijgt een nieuw retourtype `{ valid: boolean; canManageTeamData: boolean }` in plaats van een boolean. De implementatie in `FirestoreOrganizationGateway` levert `access.isExplicitlyAuthorized` als `valid` en `access.canManageTeamData` uit de al bestaande `getMyTeamAccess()`-call.
   - `AuthGate` slaat `canManageTeamData` op in een nieuwe state `selectedContextCanWrite` (naast de bestaande `selectedContextTeamValid`). Deze state wordt in hetzelfde effect berekend waarin `validateSelectedTeam()` al wordt aangeroepen (`AuthGate.tsx:166-186`), dus er is **geen extra Firestore-read** en geen korte disabled-flash voor owners/admins.
   - `AuthGate` geeft `canWrite={selectedContextCanWrite ?? false}` door aan `<App />`. `App` geeft het door aan `SettingsPanel`/`RosterPanel`.
   - Deze aanpak houdt de gateway-interface klein, hergebruikt bestaande bewijslast (`teamAccess.ts` + `firestore.rules`) en voorkomt dat de UI kort “alleen-lezen” toont aan een gebruiker die wel mag schrijven.
2. **Panels hiden/disabled de schrijfknoppen wanneer `!canWrite`:**
   - `SettingsPanel`: `settings-save`, `settings-reset`, en de logo-input/remove-acties worden `disabled` (niet verborgen — de gebruiker moet zien dát ze bestaan). `settings-refresh` blijft enabled (read-only actie).
   - `RosterPanel`: `roster-save`, `roster-add`, de `roster-remove-{id}`-knoppen en de categorie-toggle-knoppen (`roster-vrouw-*`, `roster-jeugd-*`) worden `disabled`. De speler-inputs (`roster-nr-*`, `roster-naam-*`, `roster-kl-*`) worden `readOnly` zodat de gebruiker de huidige waarden kan lezen maar niet wijzigen.
   - Een read-only-indicator (`<p data-testid="settings-read-only" role="status">` voor settings, idem voor roster) toont de i18n-string `settingsReadOnly`. **Bewust geen modal of storende banner** — de disabled state + een rustige mededeling volstaat; coach/scorer/viewer zijn in deze app doorgaans geen editors.
3. **Listener-fout-detectie** in `App.tsx`:
   - Nieuwe state: `const [listenerError, setListenerError] = useState<'settings' | 'roster' | null>(null);`.
   - De `onError`-callbacks van de `subscribe()`-calls in `App.tsx:155, 166` worden uitgebreid: naast `markUncachedOffline(step)` (bestaand gedrag voor pre-load fouten) zetten ze `setListenerError(kind)`. Een listener die **na** de initiële load faalt, triggert geen `markUncachedOffline` meer (omdat settings/roster niet meer `null` zijn) — vandaar de aparte `listenerError`-state.
   - Automatische recovery: een nieuwe `onSnapshot`-emissie (een volgende listener-deliver die wél lukt) zet `listenerError` terug naar `null`. Dat is de canonieke Firestore SDK-gedraging: `onError` wordt één keer aangeroepen, daarna hervat de listener bij de volgende serververbinding.
4. **Niet-blokkerende "Verbinding weggevallen"-indicator in `App.tsx`:**
   - `App` rendered de indicator zelf, direct boven of in de buurt van de panels, alleen in cloud-modus (`repositories.mode === 'cloud'`). De indicator is een subtiele span met `data-testid="listener-error-indicator"` en een grijze kleur (geen rood alarm, alleen een seintje).
   - `SessionBar` krijgt geen nieuwe prop: `App` heeft de `listenerError`-state al en `SessionBar` blijft voor auth-context-zaken (uitloggen, wisselen). Syncstatus-zaken blijven in `App`.
5. **i18n-strings** (NL + EN in `v2/src/i18n/strings.ts`):
   - `settingsReadOnly: 'Alleen-lezen'` / `settingsReadOnly_en: 'Read-only'`.
   - `rosterReadOnly: 'Alleen-lezen'` / `rosterReadOnly_en: 'Read-only'`.
   - `listenerErrorIndicator: 'Verbinding met cloud weggevallen'` / `listenerErrorIndicator_en: 'Cloud connection lost'`.
   - `syncStatusFromCache: 'uit cache'` / `syncStatusFromCache_en: 'from cache'` voor het `fromCache`-sublabel (komt in 5.4b).

**Gewijzigde bestanden (indicatief):**

- `v2/src/application/organizations/OrganizationGateway.ts` — `validateSelectedTeam` retourneert `{ valid: boolean; canManageTeamData: boolean }`.
- `v2/src/infrastructure/organizations/FirestoreOrganizationGateway.ts` — implementatie levert `canManageTeamData` mee.
- `v2/src/app/AuthGate.tsx` — `selectedContextCanWrite`-state + doorgeven aan `App`.
- `v2/src/app/App.tsx` — `canWrite` accepteren, doorgeven aan panels; `listenerError`-state; indicator-render in `App`; `onError`-callbacks uitbreiden.
- `v2/src/ui/settings/SettingsPanel.tsx` — `canWrite` prop, knoppen disabled, read-only-indicator.
- `v2/src/ui/roster/RosterPanel.tsx` — `canWrite` prop, inputs `readOnly`, overige schrijfacties `disabled`, read-only-indicator.
- `v2/src/i18n/strings.ts` — drie nieuwe NL+EN-paren (`settingsReadOnly`, `rosterReadOnly`, `listenerErrorIndicator`).

**Nieuwe tests:**

- `v2/tests/e2e-auth/role-matrix-ui.spec.ts` — 5 rollen × 2 panels × 1 assertion. Elke testcase registreert een unieke gebruiker, seedt via `adminDb()` een org/team en zet het membership op de gewenste rol (zie `team-level-authorization.spec.ts` voor het seedpatroon). Patroon: owner/admin/coach → settings-save/roster-save enabled; scorer/viewer → disabled + read-only-indicator zichtbaar. Voor disabled knoppen: `expect(button).toBeDisabled()`; voor read-only inputs: `expect(input).toBeReadonly()` of `toBeEditable({ editable: false })`.
- `v2/tests/unit/AppListenerError.spec.tsx` — injecteer mock-`AsyncSettingsRepository`/`AsyncRosterRepository` in `App` die na een eerste succesvolle emit een `onError` doorgeven. Bewijs: `listener-error-indicator` verschijnt na de fout en verdwijnt weer zodra de listener een volgende succesvolle emit doet. Deze unit-test is de betrouwbare basis; de e2e-variant is flaky omdat het forceren van een `onSnapshot`-fout tegen de emulator moeilijk is.
- `v2/tests/e2e-auth/listener-error-indicator.spec.ts` *(stretch-goal, optioneel)* — forceer een listener-fout na initiële load (bijv. `page.route('**/*', route => route.abort())` op emulator-verkeer na een bepaald moment). Alleen opnemen als de strategie in CI stabiel blijkt.

**Buiten scope:** rolgrens-asserties in Security Rules (die zijn al bewezen in PR 4.4 + 5.1), nieuwe `OrganizationRole`-waarden, automatische retry van de listener.

**Risico:** visueel regressie-risico op mobiele viewport. Mitigatie: de mobiele e2e-suite (`mobile.spec.ts`) moet na 5.4a groen blijven; expliciet draaien vóór merge. Bouw vóór elke e2e (les uit `pr-5.3d-onderzoeksrapport.md` §B).

### 5.4b — Twee-apparaten + conflict + actualiteit

**Doel:** sluit 5.4-acceptatiecriteria #1 (cross-org + self-promotion aantoonbaar), #3 (geen stil dataverlies bij conflict), #4 (bron/actualiteit/syncstatus zichtbaar) af. Bewijst de multi-apparaat-pilot in CI.

**Werk:**

1. **Vier nieuwe e2e-tests in `v2/tests/e2e-auth/`:** Elke test registreert één of twee unieke gebruikers en seedt de benodigde organisaties, teams en memberships via `adminDb()` (hetzelfde patroon als `team-level-authorization.spec.ts`).
   - **`two-devices-same-context.spec.ts`** — twee `browser.newContext()`s, beide ingelogd als dezelfde coach op hetzelfde team. Apparaat A wijzigt `settings.teamName`. Apparaat B observeert via listener (geen reload) de nieuwe waarde. Bewijst: live-listener-deliver is daadwerkelijk live, niet alleen first-emit. Patroon voor de live-emissie: `await expect.poll(() => B.getByTestId('settings-teamName').inputValue(), { timeout: 5_000 }).toBe(newTeamName)`.
   - **`two-devices-different-orgs.spec.ts`** — twee `browser.newContext()`s, A ingelogd als coach op team A, B ingelogd als coach op team B in een andere organisatie. Beide actief. A schrijft `settings.teamName`; B schrijft `tag1Label`. Beide verwachten hun eigen write succesvol; geen koppeling tussen de listeners. Bewijst: er is geen impliciete Firestore-cache-deling over verschillende orgs.
   - **`deliberate-conflict.spec.ts`** — twee contexts, beide ingelogd als dezelfde coach op hetzelfde team. A schrijft `teamName="Alpha"`, B schrijft `teamName="Beta"` via `saveSettings`, **parallel** (geen `await` ertussen). Verwacht: last-write-wins (locked-in beslissing 1). Het apparaat dat wint, toont zijn eigen waarde; het verliezende apparaat ziet via de listener de winnende waarde. **Geen `actie-nodig` panel** — last-write-wins is geen afwijking, het is een normale write. **Actualiteit** toont expliciet "laatst gewijzigd" met de meest recente `updatedAt`. Implementatie: een korte `Promise.all` of `setTimeout` race in de test; tolerant voor non-determinism (één van beide is winner, niet beide).
   - **`concurrent-non-conflicting-writes.spec.ts`** — twee contexts, A schrijft `teamName="X"`, B schrijft `tag1Label="Y"`, parallel. Verwacht: beide slagen; beide clients zien de gecombineerde waarde (A's teamName + B's tag1Label) via listener. Bewijst: er is geen onnodig write-conflict tussen verschillende velden van hetzelfde document.
2. **`updatedAt` in panels** — kleine UI-uitbreiding:
   - `FirestoreSettingsRepository.subscribe()` levert nu de settings + SyncState. Het `updatedAt`-veld wordt door `stripUpdatedAt` verwijderd voor de UI-state maar zit nog wel in het Firestore-document. Aanpak: `subscribe()` levert optioneel een `updatedAt` door — een nieuwe prop `updatedAt?: number` (epoch ms) op het `onNext`-signaal. `App` houdt `settingsUpdatedAt` en `rosterUpdatedAt` in state, geeft ze door aan de panels.
   - `SettingsPanel`/`RosterPanel` tonen onder de header: `<p data-testid="settings-last-modified" role="status">Laatst gewijzigd op: {formatDate(updatedAt)}</p>` (NL/EN).
   - Voor het last-write-wins-conflict-testscenario: `updatedAt` is het enige wat de gebruiker laat zien dát er een verandering was door een ander apparaat (sync-status 'gesynchroniseerd' is identiek voor en na). Dit is de kern van 5.4-acceptatiecriterium #4.
3. **`fromCache`-sublabel in `SyncStatusIndicator`:**
   - `SyncState.fromCache: boolean` wordt nu al meegeleverd maar genegeerd in de UI. `SyncStatusIndicator` accepteert een optionele `fromCache?: boolean` prop; wanneer `true`, toont het een klein "uit cache"-suffix. (`fromCache=true` komt in `deriveSyncState` alleen voor bij `lokaal-beschikbaar` of `wacht-op-synchronisatie`, nooit bij `gesynchroniseerd`.)
   - Verbetert het onderscheid tussen "lokaal beschikbaar" (uit cache, geen verbinding) en "gesynchroniseerd" (server bevestigd) zonder een nieuwe status toe te voegen.
4. **Pilot-rapport-skelet** in `docs/pr-5.4-onderzoeksrapport.md` (verder uitgewerkt in 5.4c):
   - §A: **last-write-wins-ontwerpbeslissing** met verwijzing naar de e2e-test en de `pr-5.3d-onderzoeksrapport.md §J`-positie.
   - §B: scenario-bevindingen per testbestand (verwacht vs. waargenomen).
   - §C: open punten die expliciet niet in 5.4 zijn afgerond (de handmatige iOS/Android-protocolstappen 3–7).

**Gewijzigde bestanden (indicatief):**

- `v2/src/application/settings/AsyncSettingsRepository.ts` — `subscribe`-signatuur uitgebreid met optioneel `updatedAt`. Idem voor roster.
- `v2/src/infrastructure/settings/FirestoreSettingsRepository.ts` — `subscribe()` levert `updatedAt` door (epoch ms). Idem voor roster.
- `v2/src/infrastructure/roster/FirestoreRosterRepository.ts` — idem.
- `v2/src/infrastructure/settings/LocalAsyncSettingsRepository.ts` — implementeert nieuwe `subscribe`-signatuur (`updatedAt` wordt weggelaten).
- `v2/src/infrastructure/roster/LocalAsyncRosterRepository.ts` — idem.
- `v2/src/app/App.tsx` — houdt `settingsUpdatedAt`/`rosterUpdatedAt` in state, geeft door aan panels + indicator.
- `v2/src/ui/settings/SettingsPanel.tsx` — `updatedAt` prop, "laatst gewijzigd" rendering.
- `v2/src/ui/roster/RosterPanel.tsx` — idem.
- `v2/src/ui/sync/SyncStatusIndicator.tsx` — `fromCache` prop, sublabel-rendering.

**Nieuwe tests:** vier e2e-tests zoals hierboven. Geen nieuwe unit tests nodig; de `updatedAt`-threading is triviaal en covered door de e2e.

**Buiten scope:** nieuwe sync-toestanden, automatische retry na conflict, "wie heeft er gewonnen"-attributie op het conflict (de daadwerkelijke winner is onbepaald door last-write-wins; de actualiteit toont alleen dát er iets gewijzigd is).

**Risico's:**

- **Twee browser-contexts in één test = timing/race-risico.** Mitigatie: gebruik `expect.poll` met korte intervals (200ms, 500ms) en langere timeouts (10-15s), geen vaste `waitForTimeout`. Voor het deliberate-conflict-test: tolerantie voor "één van beide is winner" — niet beide tegelijk.
- **`updatedAt` is een `serverTimestamp()`** die in Firestore pas ná de write-resolutie zichtbaar is. De tweede client ziet de `updatedAt` via de listener. Test: wacht op `expect.poll(() => updatedAt-text, ...).toContain(today)`.
- **Firestore-emulator en `experimentalForceLongPolling`** zijn al in `firebaseClient.ts` ingesteld. De live-listener-deliver via long-polling kan 1-2 seconden duren in CI. Timeouts dienovereenkomstig kiezen.

### 5.4c — Pilot-rapport + §17-update + Issue #28-sluiting

**Doel:** documenteer de pilot-bevindingen, formaliseer de §J-trigger-criteria, sluit #28 administratief af, maak §17 intern consistent.

**Werk:**

1. **`docs/pr-5.4-onderzoeksrapport.md`** (zelfde stramien als `pr-5.3d-onderzoeksrapport.md`):
   - **§A: scope en locked-in beslissingen.** Verwijst naar de zeven Q&A-beslissingen. Somt de architectuurkeuzes (last-write-wins, light UI-rollen, listener-fout-detectie, geen mobiele-automatisering, alleen emulator-verbruiksmeting) op met de rationale.
   - **§B: scenario-bevindingen per pilot-scenario.** Tabelformaat: scenario | verwacht | waargenomen | testbewijs (bestandsnaam + regel). Minimaal: twee-apparaten-live-deliver, twee-apparaten-verschillende-orgs, deliberate-conflict, concurrent-non-conflicting, listener-fout-detectie, role-matrix-UI. Per scenario één of twee regels.
   - **§C: open punten** — de handmatige iOS/Android-protocolstappen 3–7 uit `pr-5.3d-onderzoeksrapport.md §F`, expliciet overgedragen aan 5.5. Verwijst naar de §J-trigger-criteria in `pr-5.3d-onderzoeksrapport.md` (zie punt 3 hieronder).
   - **§D: cross-references** — verwijzing naar `pr-5.3-plan.md §C/5.3d` voor de #27-scopebeslissing, en naar de nieuwe §17-rij (punt 4 hieronder).
2. **§J in `pr-5.3d-onderzoeksrapport.md` uitbreiden met trigger-criteria** voor de twee open follow-ups:
   - **Stale-listener-follow-up:** trigger = vóór PR 5.5 (Netlify staging) OF eerste pilot-bevinding in `pr-5.4-onderzoeksrapport.md`. (Wordt in 5.4a al opgepakt; deze §J-uitbreiding is een safety-net voor de toekomstige "verbinding weggevallen"-patronen.)
   - **Multi-write-queue-semantiek:** trigger = eerste multi-tab-gebruik of Fase 6 PR 6.2 (live wedstrijd). Generatieteller-dekking is voldoende tot dan.
3. **§17 in `docs/IMPLEMENTATION_PLAN.md` corrigeren en aanvullen:**
   - **Fase 4-rij:** "#27 en #28 staan open" → "#27 op verkleinde scope gesloten in PR 5.3d (PR #36); #28 gesloten in PR 5.1 via `collectionGroup`-querycontract + `uid`-veld" (consistent met de huidige regel 869 die dit al zegt).
   - **PR 4.4-rij:** idem corrigeren; toevoegen dat #28 door de latere PR 5.1-merge is afgerond.
   - **Nieuwe rij voor PR 5.4** met de locked-in beslissingen en de scenario's. Spiegelt het stramien van de PR 5.3-rij (regel 868) — bondig, geen lap tekst.
4. **Issue #28 administratief sluiten** in dezelfde PR. Dit is een handmatige stap door de eigenaar, uitgevoerd via de GitHub-webinterface of — indien `gh` geïnstalleerd en geauthenticeerd is — via `gh issue close 28 --comment "..."`. De agent voert deze sluiting niet zelf uit zonder explicieke bevestiging. De commentaar in het issue verwijst naar de bestaande PR 5.1-bewijzen.

**Gewijzigde bestanden (indicatief):**

- `docs/pr-5.4-onderzoeksrapport.md` (nieuw).
- `docs/pr-5.3d-onderzoeksrapport.md` (uitbreiding §J).
- `docs/IMPLEMENTATION_PLAN.md` (§17 Fase 4-rij + PR 4.4-rij + nieuwe PR 5.4-rij).

**Buiten scope:** sluiting van andere open issues (#27 is al behandeld in PR 5.3), bredere §17-herziening, release-notes of changelog.

**Risico:** §17-correctie is een tekstuele wijziging met geen testdekking. Mitigatie: minimale, mechanische vervanging; geen herformuleringen, alleen toevoeging/vervanging van bestaande cellen.

## D. Acceptatiecriteria-mapping (uit `IMPLEMENTATION_PLAN` §10)

| Acceptatiecriterium | PR 5.4-sub | Bewijs |
|---|---|---|
| Cross-organisatietoegang en self-promotion mislukken aantoonbaar | (al in PR 5.1 + spike) | `firebase/tests/rules/cross-org-isolation.spec.ts`, `self-promotion.spec.ts`; §17-rij 869 vermeldt dit. 5.4 voegt expliciete eind-tot-eind-bevestiging toe via de nieuwe e2e-tests in `two-devices-different-orgs.spec.ts` |
| Rolgrenzen zijn zowel in UI als Security Rules afgedwongen | 5.4a | UI: `role-matrix-ui.spec.ts` (5 rollen × 2 panels × disabled/enabled); Rules: bestaande tests, niet aangeraakt in 5.4 |
| Conflict of rule-weigering veroorzaakt geen stil dataverlies | 5.4b | `deliberate-conflict.spec.ts` (last-write-wins, geen stil verlies); `action-needed-panel.spec.ts` (reeds aanwezig, dekt rule-weigering) |
| De gebruiker ziet bron, actualiteit en syncstatus van data | 5.4a + 5.4b | Bron: `fromCache`-sublabel in `SyncStatusIndicator`; actualiteit: `updatedAt` in panels; syncstatus: bestaande indicator |

Daarnaast uit §10-werk (niet expliciet als acceptatiecriterium, wel als scope):

- Volledige autorisatiematrix: 5.4a.
- Offline write op A, lees na reconnect op B: al in PR 5.3d (test 3).
- Wissel op beide apparaten tussen minstens twee orgs en drie teams: 5.4b (`two-devices-different-orgs.spec.ts` + `context-switch-two-orgs.spec.ts` al in PR 5.2).
- Trek één membership in terwijl een write queued is: al in PR 5.2 (`revoke-access-isolation.spec.ts`).
- Test gelijktijdige niet-conflicterende writes en een bewust conflict: 5.4b.
- Werkelijk Firestore-verbruik: emulator-meting in `firebase-base`'s `verify`-script uitbreiden (zie §F punt 3); staging-meting hoort bij 5.5.

## E. Locked-in beslissingen (Q&A-bevestiging, 8 aug. 2026)

1. **Conflict-semantiek: last-write-wins.** Firestore-standaard; tweede client ziet eerste write via listener. Documenteren in `pr-5.4-onderzoeksrapport.md §A` + `updatedAt`-indicator als gebruikers-feedback. Past bij single-document-model en is wat de meeste coaches intuitief verwachten.
2. **Reload-combinatie: 5.4 staat los, 5.5 neemt 'm verplicht mee.** De handmatige iOS/Android-protocolstappen 3–7 uit `pr-5.3d-onderzoeksrapport.md §F` worden een expliciet onderdeel van PR 5.5-handmatige-validatie.
3. **UI-rolgrenzen: light-aanpak.** `Role` (of `canManageTeamData`) als prop, panels hiden of disabled knoppen. Geen `useCanWrite`-hook in de application-laag; die hoort bij Fase 6.
4. **Mobiele e2e: alleen handmatig protocol, geen automatisering.** Geen WebKit-CI in 5.4. Bestaande mobiele regressie (Chromium-viewport-emulatie, PR 3.2a-patroon) blijft wat het is.
5. **Firestore-verbruik: alleen emulator-meting + extrapolatie.** `firebase-base`'s `verify`-script uitbreiden met de pilot-flows. Werkelijke staging-meting hoort bij 5.5.
6. **Issue #28: 5.4c sluit #28 + werkt §17 bij.** Eén-regel-handeling via GitHub-webinterface of `gh issue close 28 --comment "..."`. Commentaar verwijst naar PR 5.1-bewijzen.
7. **Stale-listener-follow-up: 5.4a neemt 'm mee.** `listenerError`-state + niet-blokkerende indicator. Lost een open §J-punt op vóór de pilot.

## F. Aanbevolen volgorde

1. Eigenaar bevestigt dit plan (de zeven beslissingen in §E zijn al locked-in via de Q&A-sessie, dit document legt de details vast).
2. Eerste sub-PR: **5.4a** op een nieuwe branch `feature/pr-5.4a-ui-role-gate-listener-error`, gebaseerd op `origin/main` (head `17a78d4`).
3. 5.4b, 5.4c als opeenvolgende PR's met groene regressie op alle vorige sub-PR's + de bestaande 33 v2-e2e + 24 v2-e2e-auth + 76 firebase-base + 48 spike-tests.
4. Na merge van 5.4c: issue #28 sluiten via GitHub-webinterface; `pr-5.4-onderzoeksrapport.md` definitief. §17 bevat de PR 5.4-rij.
5. PR 5.5 kan onafhankelijk van 5.4 starten zodra de staging-Firebase-projectconfig beschikbaar is (afzonderlijke opdracht per AGENTS §18). De handmatige iOS/Android-protocolstappen 3–7 worden een expliciet onderdeel van 5.5.

**Concrete sub-PR-volgorde in deze repo:**

- `feature/pr-5.4a-ui-role-gate-listener-error` → merge.
- `feature/pr-5.4b-two-devices-conflict-actuality` → merge.
- `feature/pr-5.4c-pilot-report-and-section-17` → merge.
- Issue #28 sluiten via GitHub-webinterface (geen commit, maar wel in dezelfde PR-reeks zichtbaar via cross-references).

## Appendix A — wijzigingen t.o.v. eerste locked-in samenvatting

| § | Wijziging | Bron |
|---|---|---|
| §A | Reality-check toegevoegd: `TeamAccess.canManageTeamData` is al beschikbaar in de domeinlaag, 5.4a hoeft alleen de prop te threaden — geen nieuwe logica. | verificatie tegen `main` head `17a78d4` |
| §B | Verduidelijkt dat de "uit cache"-sublabel een i18n-sleutel krijgt (geen technische micro-string). | AGENTS §veiligheidsgrenzen "Nieuwe zichtbare tekst moet Nederlands en Engels ondersteunen" |
| §C/5.4a | `canWrite` wordt afgeleid uit de bestaande `validateSelectedTeam()`-call door deze uit te breiden met `canManageTeamData`. Geen extra Firestore-read, geen disabled-flash voor owners/admins. | Q&A-beslissing + verificatie tegen `infrastructure/organizations/FirestoreOrganizationGateway.ts:257-272` |
| §C/5.4a punt 4 | `listenerError`-indicator wordt in `App` zelf gerenderd, niet in `SessionBar` (om props-drilling te vermijden en de state-locality te bewaren). | designbeslissing tijdens plannen |
| §C/5.4a tests | Listener-fout-indicator wordt verplicht getest via unit-test met mock-repositories; e2e-test is optionele stretch-goal vanwege netwerkflaky foutforcering tegen de emulator. | Q&A-beslissing + reviewbevinding |
| §C/5.4a UI | Read-only-indicator toont alleen "Alleen-lezen" / "Read-only", zonder rolnaam. Vermindert i18n-strings en is voldoende voor de pilot. | Q&A-beslissing |
| §C/5.4b | `updatedAt` wordt door de `subscribe()`-signatuur meegeleverd (nieuw veld op `onNext`-signaal), niet door een aparte API-call. Houdt één codepad. | verificatie tegen `infrastructure/{settings,roster}/Firestore*Repository.ts` |
| §C/5.4c | §J-trigger-criteria-aanvulling expliciet in 5.4c genomen (lost de eerdere review-aanbeveling op). | vorige onafhankelijke review op PR 5.3d |
| §D | Cross-org en self-promotion zijn al bewezen; 5.4 voegt expliciete eind-tot-eind-bevestiging toe maar dekt de criteria niet als nieuw werk. | verificatie tegen `firebase/tests/rules/` |
| §E | Zeven beslissingen locked-in via Q&A-sessie (8 aug. 2026) — geen verdere open beslissingen. | Q&A-sessie |
| §F | Issue #28 wordt via de GitHub-webinterface gesloten, niet via een commit. | AGENTS §veiligheidsgrenzen "Maak in de productie-repository geen branch, issue, comment, commit of PR" — issues beheren in deze repo blijft prima |

## Appendix B — overgedragen open punten naar PR 5.5

Onderstaande punten zijn **bewust uitgesteld** naar PR 5.5 (Netlify staging en GitHub-flow) en worden expliciet in `pr-5.4-onderzoeksrapport.md §C` opgenomen:

1. Handmatige iOS/Android-validatie van de "offline write + reload terwijl offline met pending write"-combinatie, per `pr-5.3d-onderzoeksrapport.md §F` stappen 3–7 (genuine OS-vliegtuigmodus, niet CDP-emulatie).
2. Werkelijke Firestore-verbruiksmeting op de Netlify-staging-Firebase (vs. 5.4's emulator-extrapolatie).
3. Multi-write-queue-semantiek voor meerdere gelijktijdig-pending writes (PR 5.3d §J punt 2) — eerste multi-tab-pilot of Fase 6 PR 6.2 triggert 'm.

Geen van deze blokkeert 5.4-merge; geen van deze verandert de locked-in beslissingen in §E.
