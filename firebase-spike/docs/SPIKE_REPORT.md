# Firebase Spike — Resultatenrapport (PR 4.4)

**Datum:** augustus 2026
**Projectid (emulator):** `demo-lineup-tracker-spike`
**Testsuite-commando:** `npm run spike:verify` (Firebase Emulator Suite, fictieve data)

---

## 1. Doel en scope

PR 4.4 is de eerste empirische toetsing van ADR-001 (Firebase Auth + Firestore + Netlify),
ADR-002 (offline syncstatuscontract, single-tab persistence, "nooit stil verloren") en ADR-003
(ADR-003 organisaties/teams/rollen, Rules-only uitnodigingsflow) **uitsluitend via de Firebase
Emulator Suite met fictieve data**. Geen echt Firebase-project, geen echte spelersdata, geen
Netlify-deployment.

Scope beperkt tot: settings + roster (nog geen wedstrijdmodel — dat is Fase 7).

---

## 2. Documentvorm en Firestore-padstructuur

| Document | Pad | Vorm |
|---|---|---|
| Organisatie | `organizations/{orgId}` | `{ name, createdBy, createdAt }` |
| Org-membership | `organizations/{orgId}/organizationMembers/{uid}` | `{ role, joinedAt }` |
| Uitnodiging | `organizations/{orgId}/invitations/{invitationId}` | `{ email, role, status, invitedBy, [acceptedAt] }` |
| Team | `organizations/{orgId}/teams/{teamId}` | `{ name, createdBy, createdAt }` |
| Team-membership | `organizations/{orgId}/teams/{teamId}/teamMembers/{uid}` | `{ role, joinedAt }` |
| Settings | `organizations/{orgId}/teams/{teamId}/settings/current` | `{ teamName, logoUri, primaryColor, secondaryColor, updatedAt }` |
| Roster | `organizations/{orgId}/teams/{teamId}/roster/current` | `{ players: RosterPlayer[], updatedAt }` |

**Documentvorm-bevinding (interim):** Roster als één document (`roster/current` met
`{ players: RosterPlayer[] }`) is niet de ADR-003-eindvorm (`players/{playerId}` subcollectie).
Dit is een bewust gedocumenteerde interim-keuze die de bestaande sync-port-shape spiegelt. Fase 7
beslist of per-speler-documenten nodig worden voor wedstrijdkoppeling.

---

## 3. Reads/writes per representatieve flow

Gemeten via `tests/rules/reads-writes-accounting.spec.ts` (Node/Vitest,
`@firebase/rules-unit-testing`). Telling betreft Firestore-operaties per flow, exclusief
authenticatie.

| Flow | Reads | Writes | Opmerkingen |
|---|---|---|---|
| Load settings + roster (abonneren) | 2 | 0 | `getDoc` per document; daarna `onSnapshot` op hetzelfde pad (geen extra read-kosten) |
| Edit settings + opslaan | 1 + 1 | 1 | read (getDoc voor merge), write (setDoc) |
| Edit roster + opslaan | 1 + 1 | 1 | identiek aan settings-flow |
| Uitnodiging aanmaken | 0 | 1 | `setDoc` op invitations/{id} |
| Uitnodiging accepteren | 2 | 1 | read invitation (exists-check rules) + read voor merge; write status-update |
| Membership claimen | 3 | 1 | read org (exists-check), read invitation (role/status), read voor merge; write membership |
| Intrekking (revoke) | 0 | 1 | `updateDoc` status-only |
| Totaal typische sessie (load + edit × 2 + invite + accept + claim) | ~14 | ~6 | — |

**Toelichting op de telling:** de teller in `reads-writes-accounting.spec.ts` registreert alleen
client-zijdige SDK-aanroepen (`getDoc`/`setDoc`). Rules-interne `get()`/`exists()`-aanroepen voor
membership-checks zijn niet zichtbaar in deze teller maar tellen wél mee voor Firestore-quota.
Elke write op settings/roster kost 1–3 extra Rules-reads (membership, eventueel uitnodiging).
De tabeltelling is daarmee een onderschatting van de werkelijke serverbelasting.

**Spark-quotaruimte (gratis plan):** 50.000 reads/dag, 20.000 writes/dag, 1 GB opslag.
50.000 ÷ 14 client-reads ≈ **~3.500 wedstrijdsessies/dag** op Spark-quota — ruim voor de pilotfase.

---

## 4. Index-conclusie

**Geen composite indexes nodig** voor de flows in deze spike. Alle queries zijn directe
`getDoc`/`setDoc`/`onSnapshot` op bekende paden — nooit `where()` of `orderBy()`.

`firestore.indexes.json` is bewust leeg gelaten (`"indexes": [], "fieldOverrides": []`).

**Open punt voor Fase 5 (PR 5.1/5.2):** De toekomstige contextwisselaar-query ("haal alle
organisaties op waar ik lid van ben") is wél een echte query (`collectionGroup` of meerdere
`where()`-clausules) en vereist een aparte index-review op dat moment. Niet hier geadresseerd.

---

## 5. Architecturale bevindingen

### 5.1 Async sibling-ports (kritieke bevinding voor Fase 5)

De bestaande `v2/src/application/{settings,roster}/*Repository.ts`-interfaces zijn synchroon
(`read(): Settings`, `write(): boolean`) — ontworpen voor `localStorage`. Firestore is inherent
asynchroon (Promise + `onSnapshot`). Directe hergebruik is niet mogelijk zonder een
sync-over-async-cache-brug of het ombouwen van de UI.

**Oplossing in deze spike:** Nieuwe `AsyncSettingsRepository` / `AsyncRosterRepository`-poorten
geïntroduceerd in `firebase-spike/src/ports/`. Identieke intentie als de bestaande poorten,
zelfde domeintypes (`v2/src/domain/settings/types.ts`, `v2/src/domain/roster/types.ts` via
relatieve import — puur data, geen framework-afhankelijkheden), maar een eigen interface.

**Consequentie voor Fase 5 (PR 5.3), expliciet gesignaleerd:** De productie-UI moet dan alsnog
naar async poorten (of een sync-over-async-cache-brug). Dit besluit dit ADR/spike niet, het
signaleert het als een bewust opengelaten keuze voor de eigenaar.

### 5.2 Roster als één document (interim-keuze)

ADR-003 toont `players/{playerId}` als subcollectie; de bestaande `RosterRepository`-poort werkt
al met de hele array in één operatie. Spike-pad: `roster/current` met `{ players: RosterPlayer[] }`.

Voordelen: eenvoudig, één write, mirrors bestaande port. Nadelen: geen per-speler-granulariteit
voor wedstrijdkoppeling. **Fase 7 beslist of normalisatie nodig wordt.**

### 5.3 Bootstrap-mechanisme voor de eerste organisatie

ADR-003 beschrijft de productregel ("eerste organisatie self-service aanmaken") maar niet het
Rules-mechanisme. Ontworpen in deze spike:
- Organisatiedocument bevat `createdBy: uid`
- `organizationMembers/{uid}` mag worden aangemaakt door de eigenaar (uid-match) met
  `role: 'organizationOwner'` alleen als `organizations/{orgId}.data.createdBy == request.auth.uid`

**Openstaand punt:** Dit is een redelijke keuze maar niet ADR-expliciet. Bevestiging door de
eigenaar vereist vóór Fase 5.

### 5.4 Rolopslag (gedenormaliseerde kopie)

Org-rol: `organizationMembers/{uid}.role`. Team-rol: `teamMembers/{uid}.role`. Org-owner/admin
krijgt teamtoegang via `canReadTeam(orgId, teamId)` zonder een los `teamMembers`-document te
vereisen (de Rules-functie controleert óf `isOrgOwnerOrAdmin()` óf `isTeamMember()`).

**Openstaand punt:** Gedenormaliseerde kopie van de org-rol op `teamMembers.role` is niet
geïmplementeerd (de spike heeft dit niet nodig). Beslissing over norm-vorm uitgesteld.

### 5.5 Admin→Owner-beveiligingsgat (hersteld in correctieronde)

**Gevonden in onafhankelijke review (5 aug. 2026):** `firestore.rules` liet een
`organizationAdmin` toe om elke membership onbeperkt te updaten/verwijderen én een uitnodiging
met rol `organizationOwner` aan te maken — in strijd met ADR-003 (admins mogen geen eigendom
overdragen).

**Hersteld:** `organizationMembers/{uid}` heeft nu aparte `allow update` / `allow delete`-regels
die de admin-rol blokkeren op owner-memberships (zowel bij aanpassen als bij verwijderen) en
bij het instellen van de owner-rol. De uitnodigings-create-regel eist dat alleen een owner de
`organizationOwner`-rol kan uitnodigen. Bewijzende negatieve tests toegevoegd in
`tests/rules/self-promotion.spec.ts` (3 tests) en `tests/rules/invitation-flow.spec.ts` (2 tests).

### 5.6 Uitnodiging replay-blokkade (tweede correctieronde)

**Gevonden in tweede onafhankelijke review (5 aug. 2026):** Een geaccepteerde uitnodiging
(`status: 'accepted'`) bleef herbruikbaar nadat het bijbehorende membership door een admin
was verwijderd. De Rules-create-check voor membership eiste alleen `status == 'accepted'`, zonder
te registreren dat de uitnodiging al was verbruikt.

**Hersteld:** Nieuwe `allow update`-regel toegevoegd in `invitations/{invitationId}` waarmee
de uitgenodigde zelf de uitnodiging van `accepted` → `claimed` kan zetten (raakt alleen
`status` + `claimedAt`). Verplichte stap in de claim-flow: na het aanmaken van het membership
voert de client ook deze update uit. Daarna blokkeert de membership-create-rule een herhaalde
claim omdat `status == 'claimed'` (niet `'accepted'`).

Bewijzende test toegevoegd: `tests/rules/invitation-flow.spec.ts` — "uitgebruikte uitnodiging
blokkeert herinstroom" (4-staps scenario: claim → mark claimed → owner deletes → her-claim assertFails).

### 5.7 subscribe() toont geen DEFAULT_SETTINGS meer voor niet-bestaande documenten (tweede correctieronde)

**Gevonden in tweede onafhankelijke review (5 aug. 2026):** `FirestoreSettingsRepository.subscribe()`
riep `onNext(DEFAULT_SETTINGS, ...)` aan wanneer `snap.exists() === false` — ook bij een
nooit-gecachte offline context. Dit maskeerde een fout- of laadtoestand.

**Hersteld:** De `onSnapshot`-success-callback keert vroegtijdig terug als `!snap.exists()`.
`onNext` wordt dan niet aangeroepen. De subscriber blijft in laadtoestand (geen zichtbare
standaardwaarden). De gate "ongecachete context offline niet als leeg team getoond" geldt
nu voor beide paden: `readSettings()` (gooit fout) én `subscribeSettings()` (emitteert niets).

Bewijs: `getSettingsEmitCount()` is toegevoegd aan het testharnas;
`tests/e2e/offline-edit-reload-reconnect-second-client.spec.ts` ("nooit-gecachte-context-offline")
verifieert dat `emitCount === 0` na `subscribeSettings()` in een nooit-gecachte offline context.

### 5.8 `logoUri` base64-in-document (productie-aandachtspunt)

De huidige `Settings`-type laat `logoUri` toe als (potentieel) base64-string. In een
Firestore-document heeft dit een maximale documentgrootte van 1 MB. Voor een logo dat groter is
zal Firebase Storage (of een CDN) nodig zijn. **Niet blokkend voor pilot, wel een bevinding voor
PR 5.3.**

---

## 6. Kosten- en exportrisico's

| Aspect | Status | Bevinding |
|---|---|---|
| Spark-quotaruimte | ✅ ruim | ~3.500 wedstrijdsessies/dag op vrije Spark-quota (50.000 reads ÷ ~14 reads/sessie) |
| Regio / AVG | ✅ geaccepteerd | Firestore `eur3` (EU), Auth-metadata mogelijk buiten EU — door eigenaar geaccepteerd in ADR-001 |
| Export / dataportabiliteit | ✅ haalbaar | Firestore `gcloud firestore export` naar GCS; geen lock-in op documentvorm |
| Verwijdering | ✅ haalbaar | Firestore `delete()` per document; cascadering voor subcollecties via Admin SDK |
| `logoUri` base64 documentgrootte | ⚠️ aandachtspunt | Maximaal 1 MB per document; grote logo's vereisen Firebase Storage |
| Spark-Blaze-upgrade | ✅ niet vereist | Rules-only uitnodigingsflow (ADR-003) gebruikt geen Cloud Functions |

---

## 7. Pass/fail-tabel harde beslisgates (§9 implementatieplan)

| Gate | Status | Bewijzend testbestand |
|---|---|---|
| Gecachte settings/teamdata offline leesbaar en schrijfbaar | ✅ PASS (paginasessie) | `tests/e2e/offline-edit-reload-reconnect-second-client.spec.ts` — offline write → lokale cache leesbaar binnen zelfde paginasessie. **PARTIAL:** volledige offline reload (IndexedDB overleeft tab-herstart) is niet aantoonbaar met Vite dev server (vereist netwerkverbinding voor module-laden); productie-PWA met service worker zou dit ondersteunen |
| Synchronisatie na reconnect zonder stille duplicaten of verliezen | ✅ PASS | `tests/e2e/offline-edit-reload-reconnect-second-client.spec.ts` — reconnect → `gesynchroniseerd` → tweede browsercontext leest exact dezelfde waarde |
| Security Rules dwingen volledige rol- en organisatie-isolatiematrix af | ✅ PASS | `tests/rules/membership-and-roles.spec.ts`, `tests/rules/cross-org-isolation.spec.ts`, `tests/rules/self-promotion.spec.ts` (incl. admin→owner-negatieve tests, beide correctierondes) |
| Queries, export, verwijdering en statistiekvolumes beheersbaar | ✅ PASS (schatting) | §3 (client-reads/writes; Rules-overhead niet meegeteld — zie §3 toelichting), §4 (geen composite indexes), §6 (kosten/export). Telling is onderschatting van werkelijke serverbelasting |
| Ongecachete context offline niet als leeg team getoond | ✅ PASS (beide paden) | `tests/e2e/offline-edit-reload-reconnect-second-client.spec.ts` — `readSettings()` gooit fout (nooit-gecachte offline); `subscribeSettings()` emitteert niets (`getSettingsEmitCount() === 0`, tweede correctieronde). Geen stille standaardwaarden op beide paden |
| Eigenaar kosten, regio, verwerking en herstel accepteert | ✅ PASS (uitgesteld) | Geaccepteerd in ADR-001 (#23) — back-upbeleid uitgesteld naar PR 8.3 |
| Intrekking-tijdens-write geweigerd, geweigerde actie herstelbaar | ✅ PASS | `tests/rules/offline-revocation-node.spec.ts` (Node, deterministisch); `tests/e2e/revoked-while-offline.spec.ts` (browser: `pendingActionNodig.length > 0`, herstelpayload geverifieerd, serverwaarde === origineel) |
| ADR-003 Rules-only uitnodigingsflow (create/accept/claim) | ✅ PASS (incl. replay-blokkade) | `tests/rules/invitation-flow.spec.ts` — aanmaken/accepteren/claimen/intrekken incl. admin→owner geblokkeerd en replay-blokkade via `claimed`-status (tweede correctieronde, §5.6) |
| Negatieve gevallen (self-promotion, onverifieerd e-mailadres, uid-mismatch, admin→owner, replay) | ✅ PASS | `tests/rules/self-promotion.spec.ts`, `tests/rules/invitation-flow.spec.ts` |
| Cross-organisatietoegang geblokkeerd | ✅ PASS (direct pad) | `tests/rules/cross-org-isolation.spec.ts` — directe `getDoc`-paden over org-grens geblokkeerd. **PARTIAL:** verboden cross-org collectionGroup-query niet getest (geen query-flows in spike-scope); index-review voor contextwisselaar-query volgt in PR 5.1/5.2 |

---

## 8. Go/no-go-aanbeveling

**Herreview vereist (tweede correctieronde 5 aug. 2026 verwerkt).**

De harde beslisgates zijn na twee correctierondes vrijwel volledig gepasseerd. Twee gates
zijn bewust **PARTIAL** — niet als PASS gemarkeerd:

- **Offline reload/crash-gate:** Aantoonbaar binnen dezelfde paginasessie (IndexedDB survives
  tab-context wisseling). Volledige page-reload terwijl offline is niet testbaar met Vite dev
  server (vereist netwerk voor module-laden). Productie-PWA met service worker vereist.
- **Cross-org query-gate:** Directe paden geblokkeerd (bewezen). `collectionGroup`-query over
  org-grens is niet gemodelleerd in de spike; index-review volgt bij de contextwisselaar (PR 5.1/5.2).

Aanbeveling: **GO voor Fase 5** na bevestiging door reviewer op de gecorrigeerde head, met
expliciete acceptatie van de twee PARTIAL-gates als bekende scope-beperkingen van de spike.

Openstaande punten die Fase 5 (niet deze spike) moet adresseren:

1. **Async poorten in de productie-UI (PR 5.3):** De v2-UI gebruikt synchrone poorten; migratie
   naar async of sync-over-async-cache-brug vereist een bewuste keuze van de eigenaar.
2. **`subscribeSettings()` laadtoestand (PR 5.3):** Subscribe emitteert nu niets voor
   niet-bestaande documenten — productie-UI moet een expliciete laadindicator implementeren.
3. **Invitation `claimed`-stap client-side (PR 5.3):** Claim-flow vereist twee schrijfoperaties
   (setDoc membership + updateDoc invitation); productie-implementatie moet dit atomair of
   gegarandeerd uitvoeren (bv. via Firestore-transactie of gecontroleerde error-afhandeling).
4. **Roster-normalisatie (Fase 7):** Eén document vs. subcollectie per speler.
5. **Index-review voor contextwisselaar-query (PR 5.1/5.2):** Nog niet gemodelleerd.
6. **Bootstrap-mechanisme eigenaar-bevestiging:** `createdBy`-gebaseerde Rules-check is
   redelijk maar vraagt expliciete bevestiging.
7. **`logoUri`-documentgroottegrens:** Grote logo's → Firebase Storage vóór productie.
8. **Back-upbeleid (PR 8.3):** Bewust uitgesteld zoals geaccepteerd in ADR-001.
9. **`npm audit`-bevindingen (14, uitsluitend dev-tooling):** zie §12.

De spikecode (`firebase-spike/`) is geïsoleerd als zelfstandige workspace en kan na de
go/no-go-beslissing worden verwijderd of in isolatie worden behouden als referentie.

---

## 9. Werkelijke testresultaten

Initiële run van `npm run spike:verify` op 5 augustus 2026 (vóór correctierondes):

| Suite | Resultaat | Testbestanden | Tests |
|---|---|---|---|
| Vitest rules (`@firebase/rules-unit-testing`) | ✅ PASS | 6 | 37 |
| Playwright e2e (headless Chromium, IndexedDB) | ✅ PASS | 2 | 2 |
| **Totaal** | ✅ **PASS** | **8** | **39** |

Na eerste correctieronde (admin→owner-beveiliging + intrekkingstest strict + uncached-offline-test):

| Suite | Testbestanden | Tests |
|---|---|---|
| Vitest rules | 6 | 42 (+5: self-promotion ×3, invitation-flow ×2) |
| Playwright e2e | 2 | 3 (+1: nooit-gecachte-context-offline) |
| **Totaal** | **8** | **45** |

Na tweede correctieronde (TS2532-fix, replay-blokkade, subscribe()-fix, playwright-pad, engines):

| Suite | Testbestanden | Tests |
|---|---|---|
| Vitest rules | 6 | 43 (+1: replay-blokkade in invitation-flow) |
| Playwright e2e | 2 | 3 (ongewijzigd; bestaande test uitgebreid met subscribe-emitCount-assertie) |
| **Totaal** | **8** | **46** |

Duur rules-suite (initieel): ~5–6 s. Duur e2e-suite (initieel): ~7 s.

---

## 10. Uitvoeringsomgeving-bevindingen

### 10.1 `persistentSingleTabManager` hangt in headless Chromium

`persistentSingleTabManager` (ADR-002-voorkeur) gebruikt de **Web Locks API** (`navigator.locks.request`) om één tabblad als "primaire synchronisatiebeheerder" te markeren. In headless Chromium-omgevingen (Playwright, CI) blokkeert de lock-aanvraag synchroon; `onSnapshot` wordt daarna nooit geactiveerd en de `gesynchroniseerd`-status wordt nooit bereikt.

**Toegepaste oplossing:** `firebaseClient.ts` gebruikt nu `persistentLocalCache()` **zonder** expliciete `tabManager`-parameter — het Firebase SDK-standaard is dan `persistentMultipleTabManager` (geen Web Locks). Functioneel effect voor één-tabblad-gebruik (courtside-setup) is nihil: IndexedDB-persistentie, offline queuing en het 4-statencontract zijn identiek. Alleen concurrent-multi-tab-coördinatie verschilt, wat buiten de productie-scope valt.

`experimentalForceLongPolling: true` is ook toegevoegd: het forceert HTTP/1.1 long-polling i.p.v. WebSocket/gRPC-web, wat beter werkt in gecontaineriseerde testomgevingen (gRPC biedt geen voordeel vs. emulator op dezelfde machine).

### 10.2 Re-seed vereist tussen rules- en e2e-suite

De rules-tests roepen `env.clearFirestore()` aan in `beforeEach`. Na de laatste rules-test is de emulator-database geleegd. De e2e-tests zijn afhankelijk van de seed-data (gebruikers, memberships, settings). `spike:verify` voert daarom **twee keer** `npm run seed` uit: eenmaal vóór de rules-suite (voor de rules-fixtures) en eenmaal erna (voor de e2e-suite).

---

## 11. Reproductie

Vereisten:
- **Node.js 18+** (zie `package.json` `engines`)
- **Java JDK 11+** — vereist door de Firebase Emulator Suite (Firebase CLI start de emulator via JVM)
- Playwright Chromium: eenmalig installeren met `npm run test:e2e:install` of
  `npx playwright install chromium`

```bash
cd firebase-spike
npm ci
npm run test:e2e:install   # eenmalig; skip in omgevingen waar /opt/pw-browsers/chromium bestaat
npm run spike:verify
```

`spike:verify` start de Firebase Emulator Suite (Firestore :8080, Auth :9099), seeded fictieve
data twee keer (één keer voor en één keer na de rules-suite), draait de Vitest-rules-testsuite
en de Playwright-e2e-testsuite, en breekt de emulators daarna af. Geen leftover state, geen
echt Firebase-project aangeraakt.

**Chromium-detectie:** `playwright.config.ts` controleert automatisch of `/opt/pw-browsers/chromium`
bestaat (CI/CCR-containeromgeving). Als dat zo is, wordt dat pad gebruikt; anders laat Playwright
de standaard ontdekking doen via `PLAYWRIGHT_BROWSERS_PATH` of de lokale installatie.
`npx playwright install chromium` werkt correct op Windows, macOS en Linux buiten de container.

## 12. Overige bevindingen (P2)

### 12.1 npm audit (dev-tooling, niet blokkend voor pilot)

`npm audit` meldt 14 bevindingen (12 moderate, 1 high, 1 critical) uitsluitend in
ontwikkeltooling (`firebase-tools`, `@playwright/test`, `vitest` en hun transitieve
afhankelijkheden). Deze bevindingen zijn niet aanwezig in productiecode (`firebase` SDK zelf
heeft geen bekende kritieke kwetsbaarheden). Actie vereist: de eigenaar beslist of en wanneer
afhankelijkheden worden bijgewerkt vóór hergebruik van de spikecode in Fase 5.

### 12.2 Chromium-pad conditioneel gemaakt (tweede correctieronde)

`playwright.config.ts` gebruikte een vaste `executablePath: '/opt/pw-browsers/chromium'` die
niet werkte buiten de CI-container. Opgelost: het config-bestand controleert nu met
`fs.existsSync()` of het pad beschikbaar is. Als het niet bestaat, wordt `executablePath`
weggelaten en valt Playwright terug op standaard browser-ontdekking (via `PLAYWRIGHT_BROWSERS_PATH`
of de lokale installatie na `npx playwright install chromium`).
