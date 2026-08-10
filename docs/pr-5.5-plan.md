# PR 5.5 — Plan Netlify-staging en Firebase-webconfig-externalisatie

Status: goedgekeurd concept; sub-PR's mogen starten volgens §E hieronder.
**Repo:** `camilovtrijp-coder/wheelchair-basketball-lineuptracker` (v2-/herbouwomgeving)
**Geverifieerd tegen:** `main` op `ceb8dc0` (na merge van PR #40 / 5.4b); `feature/pr-5.4c-pilot-report-and-section-17` (PR #41, gemerged) raakt hier niet.
**Voorganger:** PR 5.4 (#40, 5.4a #37, 5.4c #41) — pilot-bewijs geleverd, geen open punten meer in §17.
**Eerste concept:** Minimax, 9 augustus 2026. **Herzien en vastgelegd:** 10 augustus 2026, na verificatie tegen de daadwerkelijke repo-inhoud en een eigenaarsbesluit over de §10/AGENTS-gate (§E hieronder).

## A. Reality-check

- **v2 is op dit moment nergens gedeployed.** `firebaseClient.ts` praat uitsluitend met de emulator (`demo-lineup-tracker-dev`, `apiKey: 'demo-key'`, `connectFirestoreEmulator`/`connectAuthEmulator` op `127.0.0.1`); er is geen webconfig voor staging of productie in de bron. De top-comment in dat bestand zegt zelf al: "een echt GCP-/Firebase-project komt pas met PR 5.5 (Netlify-staging)."
- **`netlify.toml` (root) dekt v1, niet v2.** Het kopieert `index.html`/`manifest.json`/icons/fonts uit de root naar `_site/` en vervangt `__CACHE_VERSION__` in `sw.js` door een contenthash; `publish = "_site"`. Geen `base = "v2"`, geen build-command voor v2, geen context-aware Firebase-injectie.
- **Drie project-aliassen bestaan al in `firebase/.firebaserc`** (`development` = `demo-lineup-tracker-dev`, `staging` = `demo-lineup-tracker-staging`, `production` = `demo-lineup-tracker-prod`), maar alleen `development` is echt (het emulatorproject). `staging`/`production` zijn placeholders zonder GCP-project erachter.
- **`v2/vite.config.ts`** heeft geen `base`-optie en geen env-handling. **`v2/package.json`** `build: tsc -b && vite build` → `v2/dist/`, zonder env-injectie. **`.github/workflows/ci.yml`** deployt nergens heen (alleen test/lint/build + emulator-e2e); geen Netlify- of `VITE_`-referenties.
- **Governance:** AGENTS.md regel 40 verbiedt "Netlify-specifieke wijzigingen" en deployment zonder afzonderlijke expliciete opdracht. `docs/IMPLEMENTATION_PLAN.md` §10 zette (tot deze herziening) "Alleen na afzonderlijke expliciete hostingopdracht" boven de **volledige** PR 5.5-bullet-lijst, inclusief het webconfig-externalisatiepunt. Dat is nu expliciet gesplitst (zie §E.1) — de webconfig-structuur (5.5a) mag vooruitlopen op de hostingopdracht, de Netlify-config en echte staging/productieprojecten (5.5b/5.5c) niet.

## B. Scope (uit `IMPLEMENTATION_PLAN.md` §10 + open punten `pr-5.4-onderzoeksrapport.md` §C)

| In scope | Niet in scope (bewust uitgesteld) |
|---|---|
| Firebase-webconfig uit de bron externaliseren zodat `v2/dist/` per context een werkende webconfig meekrijgt (5.5a) | Echt Firebase-staging- of -productieproject aanmaken — apart, bij 5.5b |
| `netlify.toml` voor v2 met base/command/publish + context-aware Firebase-injectie (5.5b) | Werkelijke Netlify-site koppelen / deployen — apart besluit |
| GitHub Deploy Previews: PR → automatische staging-preview met `staging`-webconfig; geen productie-preview | Productie-deploy naar het bestaande productieadres — uitgesteld naar PR 8.5 |
| Netlify-account/plan-controle: legacy- of credit-based; quota + kosten; **geen betaalde upgrade, geen auto-recharge** | Budgetwaarschuwingen / Spark→Blaze — PR 8.3 |
| PWA-headers, directe assetroutes, offline reload verifiëren tegen de Netlify-build | Safari/iPadOS-module-SW-verificatie — PR 8.1 |
| Werkelijke Firestore-verbruiksmeting op staging-Firebase, vergeleken met 5.4's emulator-extrapolatie | Volledige kosten- en performance-review — PR 8.3 |
| Handmatig iOS/Android-protocol (`pr-5.3d-onderzoeksrapport.md` §F stappen 3-7) uitvoeren + resultaten rapporteren | Geautomatiseerde mobiele e2e (locked-in 5.4-plan §E.4) — nooit |
| Trigger-monitoring voor multi-write-queue (track only) | Multi-write-queue-implementatie — eerste multi-tab of Fase 6 PR 6.2 |

**Bewaking tegen AGENTS.md §"Veiligheidsgrenzen":** geen `localStorage`-keys aangeraakt; geen Firebase-secrets in broncode/logs (de geïnjecteerde webconfig is publieke projectidentificatie, regel 26-27); geen CSV-contractwijziging; geen statistiekberekeningen gewijzigd; geen Netlify-bestanden in 5.5a.

## C. Drie sub-PR's

### 5.5a — Firebase-webconfig-externalisatie (mag zonder hostingopdracht)

**Doel:** één build kan drie deploy-contexts bedienen: development (emulator, huidig gedrag ongewijzigd), staging (echt project, webconfig via env), productie (echt project, webconfig via env). Geen Netlify, geen deploy, geen echt project.

**Werk:**

1. `v2/src/infrastructure/firebase/firebaseClient.ts` splitsen:
   - `resolveWebConfig(context: 'development' | 'staging' | 'production')` — pure, unit-testbare functie.
   - `resolveEmulatorConfig(context)` — `null` voor staging/productie; bestaande `{ host: '127.0.0.1', firestorePort: 8080, authUrl: 'http://127.0.0.1:9099' }` voor development.
   - `initFirebase(trusted, context)` — schakelt emulatorconnectie aan/uit op basis van `context`. Default via `import.meta.env.VITE_DEPLOY_CONTEXT`, fallback `'development'` — bestaand gedrag blijft bitwise ongewijzigd in CI/dev.
2. `v2/src/infrastructure/firebase/webConfig.ts` (nieuw): dev-defaults + env-gestuurde staging/productie-velden (`VITE_FIREBASE_PROJECT_ID_STAGING`, `_API_KEY_STAGING`, `_AUTH_DOMAIN_STAGING`, idem `_PRODUCTION`, plus `VITE_DEPLOY_CONTEXT`). Drie `.env.*.example`-bestanden in `v2/` met placeholders en een waarschuwing dat deze waarden nooit in Git horen.
3. `v2/src/infrastructure/firebase/__tests__/webConfig.spec.ts` (nieuw): defaults voor development; staging met/zonder env-vars (ontbrekend → expliciete fout, geen lege webconfig); `resolveEmulatorConfig('staging') === null`.
4. Geen CI-wijziging. CI blijft `development`-context, tegen de emulator.
5. Geen i18n/localStorage/CSV-aanraking.

**Buiten scope:** Netlify-context-injectie (5.5b), echte staging/productieprojecten, deploy.

**Acceptatiecriteria:** bestaande unit-/e2e-/e2e-auth-tests blijven groen zonder wijziging (default-pad = oud pad); `firebaseClient.ts` bevat geen hardcoded staging/production-ID's meer; `webConfig.spec.ts` dekt defaults, env-override, ontbrekende env-vars, staging zonder emulatorconnectie.

**Risico's:** `import.meta.env.*` is build-time — geen contextwissel zonder rebuild (bewust, voorkomt dat een staging-build per ongeluk productie aanspreekt). `apiKey`-velden zijn publieke webconfig, geen geheimen (AGENTS.md regel 26-27); mogen buiten Git in `.env` en later via Netlify env-vars.

### 5.5b — Netlify-config + Deploy Previews (wacht op expliciete hostingopdracht)

**Doel:** repo Netlify-klaar maken zodat een PR automatisch een Deploy Preview met `staging`-webconfig krijgt. Geen productie-deploy.

**Werk:**

1. `netlify.toml` (root) — v1-blok **behouden** met een commentaarregel dat dit v1 is; nieuw v2-blok toevoegen: `[build] base = "v2"`, `command`, `publish = "v2/dist"`, `[build.environment]`/`[context.deploy-preview]`/`[context.production]` met `VITE_DEPLOY_CONTEXT`, PWA-headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, cache-control voor `sw.js`), SPA-fallback-redirect met expliciete uitzonderingen voor `sw.js`/`assets/*`.
2. Firebase-webconfig per context als Netlify environment variables (eigenaar zet deze in de Netlify UI — vereist accounttoegang, dus apart).
3. Netlify-account/plan-controle (eenmalig, door eigenaar): legacy- of credit-based, quota, kosten; **geen betaalde upgrade, geen auto-recharge**. Vastleggen in `docs/pr-5.5-onderzoeksrapport.md` §B.1.
4. GitHub-koppeling: één site, Deploy Previews aan, main = productie-context. **Pas na de hostingopdracht.**
5. PWA-verificatie na eerste staging-deploy: preview laadt, `sw.js` zonder lange cache, directe route valt terug op `index.html`, offline reload werkt.

**Buiten scope:** account-koppeling, eerste deploy, monitoring/alerts.

**Acceptatiecriteria:** nieuwe PR krijgt automatisch een Deploy Preview; preview toont staging-Firebase-webconfig in de console; staging-`firestore.rules` uit PR 5.1 actief; main-deploys gebruiken productie-context maar wijzen nog niet naar het bestaande productieadres; `sw.js`/`manifest.webmanifest` met juiste MIME-typen; geen console-errors bij paint/reload.

**Risico's:** één build per context (zie 5.5a); SPA-redirect moet getest tegen edge-cases (`sw.js`, `assets/*` mogen niet redirecten); Netlify's gratis Deploy-Preview-quota kan een bottleneck worden bij veel PR's — documenteren zodra bekend.

### 5.5c — iOS/Android-handmatig protocol + staging-verbruiksmeting (na 5.5b live)

**Doel:** de twee open punten uit `pr-5.4-onderzoeksrapport.md` §C uitvoeren zodra er een werkende staging-deploy is. Geen code, geen tests — alleen onderzoeksrapport en metingen.

**Werk:**

1. Handmatig iOS/Android-protocol (`pr-5.3d-onderzoeksrapport.md` §F stappen 1-9, nu tegen **staging-Firebase** i.p.v. de emulator) — bevestigt of de eerdere Windows-laptop/emulator-bevinding (§H: geen reload-hang, 2/2 schone runs) ook standhoudt op mobiel + een echte backend. Voorbereiding: `docs/pr-5.5-handmatig-protocol.md` (NL, wat nodig is + de 9 stappen + rapportagetemplate).
2. Werkelijke Firestore-verbruiksmeting op staging: dezelfde synthetische seed en pilot-flows als 5.4 (live-deliver, bewust conflict, role-matrix-UI), reads/writes/deletes/opslag vastleggen, vergelijken met 5.4's emulator-extrapolatie (`pr-5.4-onderzoeksrapport.md` §B: 15 reads/7 writes per volledige run). Documenteren in `docs/pr-5.5-onderzoeksrapport.md` §B.2.
3. Multi-write-queue: geen implementatie (trigger blijft multi-tab-pilot of Fase 6 PR 6.2). Bevestiging in §B.3 dat de trigger niet is geraakt; één zin toevoegen aan `IMPLEMENTATION_PLAN.md` §17 die de trigger blijft volgen.

**Acceptatiecriteria:** `docs/pr-5.5-onderzoeksrapport.md` met §A (scope), §B (account/verbruik/multi-write-queue-status), §C (open punten, vooral Safari/iPadOS voor 8.1), §D (cross-references); `IMPLEMENTATION_PLAN.md` §17 krijgt een 5.5-rij; iOS/Android: 2/2 schone runs; staging-verbruiksmeting binnen gratis Spark-quota bij één doorloop (bij overschrijding: documenteren + escaleren naar PR 8.3).

**Risico's:** apparaat moet echte staging-Firestore kunnen bereiken, niet de emulator; verbruiksmeting is een momentopname (structurele meting volgt in PR 8.3).

## D. Acceptatiecriteria-mapping

| Criterium (`IMPLEMENTATION_PLAN.md` §10 of open punt) | Sub-PR | Bewijs |
|---|---|---|
| Base directory, `npm run build`, `v2/dist` vastgelegd | 5.5b | `netlify.toml` met `base = "v2"`, `command`, `publish = "v2/dist"` |
| GitHub-gekoppelde Deploy Previews | 5.5b | eerste PR-preview-URL in `docs/pr-5.5-onderzoeksrapport.md` §B.1 |
| Netlify-account/plan-controle; geen betaalde upgrade | 5.5b | §B.1 (eigenaar-bevestigd) |
| Deploy Previews → staging, nooit productie | 5.5b | `[context.deploy-preview]` = staging; `[context.production]` apart, pas gebruikt in PR 8.5 |
| Firebase-webconfig per context buiten de broncode | 5.5a (structuur) + 5.5b (Netlify env-vars) | `webConfig.ts` + `VITE_*`-env + Netlify environment-vars |
| PWA-headers, directe assetroutes, offline reload | 5.5b | handmatige check + `netlify.toml`-headers; Safari/iPadOS bewust 8.1 |
| Geen productiepublicatie | 5.5b | productie-context bestaat maar ongebruikt tot PR 8.5 |
| iOS/Android-handmatig protocol (§F stappen 3-7) | 5.5c | `docs/pr-5.5-onderzoeksrapport.md` §B |
| Werkelijke Firestore-verbruiksmeting | 5.5c | §B.2 (gemeten vs. 5.4-extrapolatie) |
| Multi-write-queue (track only) | 5.5c | §B.3 |

## E. Open keuzes — beslist (eigenaar, 10 aug. 2026)

1. **§10-gate voor 5.5a.** `IMPLEMENTATION_PLAN.md` §10 zette de hostingopdracht-eis boven de volledige PR 5.5-lijst, inclusief webconfig-externalisatie; AGENTS.md regel 40 verbiedt specifiek alleen Netlify-wijzigingen. **Besluit: 5.5a mag nu starten.** Webconfig-externalisatie is pure applicatielaag-refactor zonder Netlify-bestanden, zonder echte project-secrets, met een default-fallback die het huidige emulator-gedrag bitwise ongewijzigd laat — geen hostingwijziging. `IMPLEMENTATION_PLAN.md` §10 is hierop aangepast: het webconfig-punt staat nu expliciet los van de "alleen na hostingopdracht"-bullets.
   *(Correctie t.o.v. het eerste concept: de eerdere verwijzing naar "AGENTS §18" is onjuist — AGENTS.md heeft geen genummerde secties. De bedoelde bepaling is `IMPLEMENTATION_PLAN.md` §18 "Bewuste uitsluitingen": "deployment, hostingwijziging of productie-cutover zonder afzonderlijke expliciete goedkeuring".)*
2. **Sub-PR-structuur:** drie sub-PR's (5.5a → 5.5b → 5.5c), consistent met de 5.3/5.4-conventie (AGENTS.md §"Werkwijze"/"vermijd één grote PR").
3. **v1 `netlify.toml`:** behouden zoals hij is, met een commentaarregel dat dit v1 is en v2 in 5.5b een eigen sectie krijgt.
4. **Staging-Firebase-project:** structuur eerst in 5.5a (geen externe afhankelijkheid); het echte project aanmaken hoort bij 5.5b, na de hostingopdracht.
5. **CI-workflow:** geen extra staging-rooktest-stap. Netlify's eigen build is de rooktest voor de staging-context; CI blijft development/emulator-only, snel en ongewijzigd.

## F. Voorgestelde volgorde

1. **5.5a** op een nieuwe branch `feature/pr-5.5a-firebase-webconfig-externalization`, gebaseerd op `main` (huidige head, na PR #41). CI groen; PR open.
2. **Eigenaar geeft de expliciete hostingopdracht** (voor 5.5b/5.5c) en maakt het staging-Firebase-project aan; bevestigt Netlify-plan/quota.
3. **5.5b** op `feature/pr-5.5b-netlify-staging-deploy-previews`. Eerste Deploy Preview-URL in PR-tekst + onderzoeksrapport. CI groen.
4. **5.5c** op `feature/pr-5.5c-handmatige-validatie-en-verbruik` zodra 5.5b live is. Geen code, alleen docs.

**Buiten scope van 5.5:** PR 8.1 (Safari/iPadOS-module-SW), PR 8.3 (security/privacy/kosten review), PR 8.5 (productie-cutover). 5.5 stopt waar de eerste brede platformpilot-uitrol veilig kan beginnen, conform `pr-5.3d-onderzoeksrapport.md` §J trigger-criterium 3.
