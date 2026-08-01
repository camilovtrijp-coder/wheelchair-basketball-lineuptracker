# ADR-000: Frontendarchitectuur voor v2

## Status

Geaccepteerd — 2026-07-30

Dit besluit is vereist door `docs/IMPLEMENTATION_PLAN.md` §8 vóórdat er ook maar één regel v2-code wordt geschreven. Het is tot stand gekomen na onafhankelijk technisch advies (twee modellen: bouwer + reviewer via OpenCode, plus een aparte onafhankelijke beoordeling) en expliciete goedkeuring door de projecteigenaar.

### Validatie na PR 3.1

Op 1 augustus 2026 opnieuw getoetst aan `main` op commit `a0eab1b` (merge van PR #16):

- de gekozen stack is conform dit ADR als minimale scaffold gerealiseerd in `v2/`;
- TypeScript strict mode, Preact, Vite, Vitest, ESLint en Prettier zijn actief;
- de v1-referentie en haar Playwright-suite zijn naast de v2-build behouden;
- de runtime-taalwissel zonder reload is in de scaffold aantoonbaar aanwezig;
- laaggrenzen, repository-interfaces, PWA-installatie en functionele pariteit zijn nog niet geïmplementeerd en kunnen daarom nog niet als bewezen worden beschouwd.
- de scaffold gebruikt nog één TypeScript-configuratie voor browser- en configuratiecode; deze technische grens is nog niet gevalideerd, maar wijzigt de gekozen stack of laaggrenzen niet.

Conclusie: het besluit blijft **geaccepteerd zonder inhoudelijke wijziging**. Deze validatie kiest of specificeert geen onderdelen van de eerstvolgende verticale flow.

## Context

`index.html` (huidige referentie, 2587 regels) is een enkel bestand zonder build-stap:

- **Rendering**: `app.innerHTML = ...` stringtemplates, geen DOM-API-opbouw, geen virtual DOM.
- **Events**: vrijwel alle UI-events gebruiken inline `onclick="..."`-attributen die verwijzen naar functies die expliciet op `window` zijn gehangen; één `load`-listener registreert de service worker.
- **State**: geen centrale store, losse globale `var`s (`settings`, `games`, `state`); elke mutatie roept expliciet `save()`/`render()` aan.
- **i18n**: parallelle `nl`- en `en`-dictionaries in `STRINGS` met een `t(key, vars)`-functie; taalwissel via `setLang()` doet een volledige `render()` zonder paginareload.
- **PWA**: handgeschreven cache-first `sw.js`, geen Workbox; cachet alleen eigen bestanden (`index.html`, `manifest.json`, 3 iconen, 1 font).
- **CSV-export**: bevroren, hardcoded Nederlands kolomcontract (`segmentsCsvFor`, `minutesCsvFor`, `combinedCsvFor`), onafhankelijk van UI-taal.
- **Tooling**: geen dependencies buiten Playwright (tests); `package.json` heeft geen build-tool.

Consequentie voor deze ADR: **geen enkele stackkeuze kan v1 1-op-1 porten** — er is geen herbruikbare componentstructuur, dus elke optie vereist een volledige herschrijving van de UI-laag. Argumenten die normaal zwaar wegen (grootste ecosysteem, meeste voorbeelden) wegen hier minder, terwijl bundle-grootte en koudopstarttijd zwaarder wegen: dit is een offline-first PWA die courtside op (vaak oudere) telefoons wordt gebruikt.

Niet-onderhandelbare eisen uit §3/§8 die dit besluit direct raken:
- Domeinberekeningen en opslag blijven onafhankelijk van het UI-framework.
- Geen externe runtime-dependency als hetzelfde eenvoudig lokaal kan.
- Geen lege lagen of abstracties zonder concrete verantwoordelijkheid.
- Behoud offline gebruik, PWA-installeerbaarheid, NL+EN, en het bevroren CSV/back-up-contract.
- Kleine, apart controleerbare PR's; nooit rechtstreeks op `main`.

## Overwogen opties (stack)

| | React + TS + Vite | Preact + TS + Vite | vanilla TS + ES-modules |
|---|---|---|---|
| Bundle (runtime) | Grootste van de drie opties | Kleiner dan React + React DOM | Geen framework-runtime |
| Component-/hooks-model | Ja | Ja (identieke API) | Zelf te bouwen |
| Ecosysteem/voorbeelden | Grootst | Groot genoeg; `preact/compat` voor React-only libs | N.v.t. |
| Risico | Laag (bekend), maar zwaarder dan nodig voor courtside-koudopstart | Laag | Hoog: reactief render-mechanisme (live klok, segmentbewerking, meerdere afhankelijke tabbladen) zelf bouwen en onderhouden |
| Past bij "geen dependency als het lokaal kan" | Grijs gebied | Grijs gebied, maar rechtvaardigt zich door omvang van de state-problematiek | Ja, maar verplaatst het probleem naar zelfgeschreven code i.p.v. het op te lossen |

## Besluit

**Preact + TypeScript + Vite.**

- Kleinste runtime-footprint van de twee frameworkopties; relevant omdat dit een offline-first PWA is die courtside op telefoons draait, niet een kantoor-webapp.
- Zelfde JSX/hooks-mentale-model als React: geen leercurve-nadeel, en `preact/compat` beschikbaar mocht een library ooit React-only blijken.
- Vanilla TS is afgewezen: deze app is aantoonbaar stateful (live wedstrijdklok, segmentbewerking, meerdere onderling afhankelijke tabbladen) en zelf een reactief render-mechanisme bouwen is precies het type werk dat een compacte, bewezen library overbodig maakt. Het risico van een zelfgebouwd mini-framework weegt zwaarder dan het toevoegen van Preact als dependency.

## Laaggrenzen

```
src/
  app/            — bootstrapping, root component, tab-state (geen routing-library, zie hieronder)
  domain/         — entities, berekeningen (score, plus/min, speeltijd, lineupcode, classificatie), validatie, migratie
  application/    — use-cases die domain + repository-interfaces combineren
  infrastructure/ — repository-implementaties (localStorage nu; later cloud/IndexedDB)
  ui/             — Preact-componenten, screens, hooks
  i18n/           — STRINGS-dictionary + t()-equivalent
  styles/
```

Regels (afdwingbaar, geen lege lagen vooraf aanmaken — zie "Scaffold-niveau"):
- `domain/` importeert **geen** DOM-, Preact- of databasecode. Pure TypeScript-functies, direct porteerbaar vanuit de bestaande, al-pure logica in `index.html` (`validateBackupData`, `migrateBackup`, score-/speeltijdberekeningen).
- `application/` kent `domain/` en repository-**interfaces**, nooit een concrete opslagimplementatie.
- `infrastructure/` implementeert de interfaces (`TeamRepository`, `GameRepository`, `SettingsRepository`) tegen `localStorage`, met **dezelfde sleutels** als v1 (`lineup-tracker-v1`, `lineup-tracker-roster`, `lineup-tracker-games`, `lineup-tracker-settings`, `lineup-tracker-lang`, `lineup-tracker-schema-version`).
- `ui/` praat met opslag uitsluitend via `application/`-use-cases, nooit rechtstreeks via `localStorage.getItem`.

Mappen ontstaan pas zodra een concrete flow ze vult — geen vooraf aangemaakte lege submappen.

## i18n-strategie: runtime, niet build-time

Blijf bij een runtime-dictionary (klein JSON/object per taal, reactive state), functioneel gelijk aan v1's `STRINGS`/`t()`. Build-time taalbundels (aparte bundle per taal) zouden de huidige reload-vrije taalwissel verslechteren, en het gebruikelijke bundle-voordeel van build-time i18n vervalt sowieso: een offline-first PWA moet toch beide taalbundels in de service-worker-cache opnemen om zonder netwerk te kunnen wisselen. CSV-export blijft zoals nu hardcoded Nederlands, onafhankelijk van UI-taal — dat is een bevroren contract, geen i18n-vraagstuk.

## PWA-strategie

Vite genereert gehashte bestandsnamen per build, waardoor de huidige handgeschreven `APP_SHELL`-lijst in `sw.js` niet meer volstaat (die lijst zou bij elke build handmatig moeten worden bijgewerkt — foutgevoelig en in strijd met "geen abstractie zonder concrete verantwoordelijkheid" andersom: hier ontbreekt juist een noodzakelijke abstractie).

Besluit: **`vite-plugin-pwa` in `injectManifest`-modus.** Dit genereert automatisch de precache-lijst met gehashte build-assets, terwijl de bestaande, al-begrepen cache-first `install`/`activate`/`fetch`-logica uit `sw.js` letterlijk behouden blijft (die logica wordt niet vervangen door Workbox-gegenereerd gedrag, alleen de manifest-injectie is geautomatiseerd). Dit is geen "generateSW"-volautomatische aanpak — dat zou het huidige, doelbewust simpele SW-gedrag vervangen door ongeziene Workbox-strategieën, wat niet nodig is om het eigenlijke probleem (gehashte bestandsnamen) op te lossen.

## Teststrategie

- **Unit (domain/application)**: Vitest. Bestaande fixtures uit `tests/fixtures.js` (`SMALL_GAME_PLAYERS`, `SMALL_GAME_SETTINGS`, etc.) zijn al pure data en rechtstreeks herbruikbaar.
- **E2E**: bestaande Playwright-suite blijft ongewijzigd tegen de oude `index.html` draaien totdat een vervangende e2e-suite tegen de v2-app dezelfde dekking aantoonbaar heeft (per flow, zie migratiestrategie in §8).
- **Regressie-garantie**: elke gemigreerde flow vergelijkt CSV-output (byte-exact) en JSON-back-up (semantisch gelijk) met de v1-referentie op dezelfde fixtures, conform `docs/product-compatibility-matrix.md`.

## Kleine vervolgbeslissingen

- **Routing-bibliotheek: geen.** v1 kent geen URL-routing — `currentTab` is in-memory state binnen één pagina, geen deep-linking of terug-knop-ondersteuning. Een routing-library zou een dependency toevoegen zonder dat er een product-eis is die dat rechtvaardigt ("geen externe dependency als het lokaal kan"). Tab-navigatie blijft lokale component-state (bijv. een signal/hook), functioneel gelijk aan v1. Routing kan later alsnog worden toegevoegd als deep-linking een expliciete productwens wordt.
- **Build- vs runtime-i18n**: runtime (zie hierboven).
- **localStorage nu, of al IndexedDB-abstractie**: **localStorage nu.** Fase 6 van het plan beschrijft al een bewust latere, uitgebreide IndexedDB/sync-migratie (tombstones, conflictmodel). Dat nu al doen betekent twee migraties bouwen in plaats van één. `localStorage` blijft in fase 3 achter de repository-interfaces verborgen — dat voldoet al aan het acceptatiecriterium "opslag onafhankelijk van UI" zonder op fase 6 vooruit te lopen.

## Scaffold-niveau (gerealiseerd in PR #16)

De scaffold-PR bevat Vite + TypeScript (strict) + ESLint/Prettier + Vitest + CI, met precies één triviale pagina — **niet** in één keer de volledige `src/{domain,application,infrastructure,ui,i18n,styles}`-boom leeg aanmaken. PR #16 heeft dit conform de afspraak gerealiseerd. Mappen ontstaan pas zodra een concrete flow ze vult, conform §8's verbod op lege abstracties.

## Migratievolgorde (bevestiging/verfijning van §8)

De zeven stappen uit §8 worden gevolgd, met twee verfijningen:

1. Oude app blijft bruikbare referentie tot de compatibiliteitsmatrix is afgedekt.
2. Minimale scaffold (zie hierboven), geen oude code verwijderd.
3. Puur domeinfundament: entities, berekeningen, validatie, geport vanuit de al-pure logica in `index.html`.
4. **Repository-interfaces worden pas geïntroduceerd bínnen de eerste verticale flow**, niet als losse voorafgaande PR — anders is het een abstractie zonder concrete consument, wat §8 expliciet afwijst.
5. Verticale flows in de volgorde instellingen/team → wedstrijdopzet → live wedstrijd → historie → stats → trends. **De eerste flow (instellingen/team) is expliciet een walking-skeleton-valideringspoort**: pas doorgaan naar de overige vijf zodra daar aantoonbaar werken: build, PWA-installeerbaarheid/offline-reload, NL/EN-taalwissel zonder reload, en Vitest + Playwright naast elkaar groen. PR #16 bewijst de basisbuild en beide test-runners; PWA-, opslag- en flowintegratie zijn nog niet bewezen. Een fout die pas bij flow 3-4 opduikt kost anders meerdere PR's aan rework.
6. Elke flow vergeleken met vaste fixtures en de compatibiliteitsmatrix.
7. Oude monoliet pas verwijderd/gearchiveerd in een aparte PR na expliciete goedkeuring van de eigenaar.

## Taal (documentatie en commits)

Nederlands, ongewijzigd voortgezet vanuit fase 0-2 — geen reden om halverwege een intern/solo-project over te schakelen naar het Engels; dat levert alleen frictie op. Code-identifiers (variabelen, functies, types) blijven Engels, zoals nu al gebruikelijk. Bevroren datacontract-veldnamen (`naam`, `kl`, `nr`, `vrouw`, `jeugd`, CSV-kolomkoppen) blijven letterlijk staan ongeacht taalkeuze — dat is een contract, geen stijlkeuze.

## Gevolgen

- Elke PR in fase 3 kan tegen dit document worden getoetst: geen lege lagen, `domain/` framework-vrij, dezelfde `localStorage`-sleutels, CSV/JSON-gelijkheid per flow.
- `preact/compat` is een uitwijkmogelijkheid, geen verplichting — pas toevoegen als een concrete library dat noodzakelijk maakt.
- Dit besluit gaat niet over hosting/deploy/cutover; dat blijft een apart, later besluit (§3).

## Alternatieven expliciet verworpen

- **React + TS + Vite**: geen technisch bezwaar, maar meer runtime-overhead voor deze offline/courtside-usecase gegeven dat v1 toch volledig herschreven wordt. Het ecosysteemvoordeel van React woog voor de huidige eisen niet op tegen die extra omvang; werkelijke buildgroottes moeten per release worden gemeten en zijn niet zelfstandig beslissend.
- **vanilla TypeScript + ES-modules**: verschuift het probleem (reactief renderen voor een stateful app) naar zelfgeschreven code i.p.v. het op te lossen; hoger onderhoudsrisico dan een compacte, bewezen library rechtvaardigt.
