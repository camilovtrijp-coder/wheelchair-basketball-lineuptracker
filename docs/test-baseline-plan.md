# PR 8 — Testbasis vóór architectuurmigratie

## Doel

Leg de huidige, werkende Lineup Tracker functioneel vast met betrouwbare Playwright-tests en automatische CI-controle. Deze PR is uitsluitend een veiligheidsnet voor de latere omzetting van de grote `index.html` naar React, TypeScript en Vite.

De huidige productieversie op `main` is het functionele referentiepunt:

- commit: `e2684047985d13740b913938887ea692a6c44dc7`
- productiedata blijft lokaal opgeslagen met dezelfde localStorage-keys;
- Netlify-productie mag door deze PR niet functioneel veranderen.

## Uitvoerder en review

- Implementatie: Antigravity
- Review na implementatie: ChatGPT/Codex
- Werk uitsluitend op branch `agent/test-baseline` en vul deze bestaande draft-PR aan.

## Scope

1. Vervang of breid `tests/ui.spec.js` uit met echte end-to-endtests en inhoudelijke assertions.
2. Draai de app tijdens tests via een lokale HTTP-server, niet via `file://`.
3. Voeg herbruikbare testfixtures/helpers toe voor een fictieve spelerslijst en het legen of vullen van localStorage.
4. Voeg GitHub Actions toe zodat tests automatisch draaien bij pull requests en pushes naar `main`.
5. Leg de gebruikte testcommando's kort vast in de README of een apart testdocument.
6. Voeg alleen waar noodzakelijk stabiele selectors toe, bij voorkeur `data-testid`; wijzig geen gedrag of ontwerp.

## Buiten scope

- Geen React, TypeScript- of Vite-migratie.
- Geen opsplitsing of algemene refactor van `index.html`.
- Geen nieuwe gebruikersfunctionaliteit.
- Geen wijziging van de bestaande gegevensstructuren of localStorage-keys.
- Geen backend, account, cloudopslag of Airtable-synchronisatie.
- Geen visuele restyling.

## Verplichte localStorage-compatibiliteit

De volgende keys moeten exact behouden blijven:

- `lineup-tracker-v1`
- `lineup-tracker-roster`
- `lineup-tracker-games`
- `lineup-tracker-settings`
- `lineup-tracker-lang`

Gebruik uitsluitend fictieve testspelers. Er mag geen echte ROBA-spelersdata in de repository komen.

## Verplichte testscenario's

### 1. Team en wedstrijdvoorbereiding

- Start met lege opslag.
- Voeg minimaal zes fictieve spelers toe.
- Controleer rugnummers en sortering.
- Zet één speler op niet meedoen.
- Selecteer vijf starters.
- Vul tegenstander en competitie/toernooi in.
- Start de wedstrijd en controleer dat precies vijf spelers op het veld staan.

### 2. Score en segment

- Registreer punten voor en tegen.
- Sla een segment op met een vaste begin- en eindtijd.
- Controleer de score, segmentduur, lineup en +/-.
- Herlaad de pagina en controleer dat de lopende wedstrijd wordt hervat.

### 3. Enkelvoudige wissel

- Selecteer één veldspeler en één bankspeler.
- Bevestig de wissel op een vaste kloktijd.
- Controleer dat het voorgaande segment aan de oude lineup is gekoppeld.
- Controleer dat de nieuwe speler daarna op het veld staat.

### 4. Meervoudige wissel

- Voer twee wissels uit binnen hetzelfde wisselblok.
- Bevestig het blok één keer met één kloktijd.
- Controleer dat geen dubbel of leeg segment ontstaat.
- Controleer dat de uiteindelijke lineup correct is.

### 5. Segmentcorrectie

- Open een bestaand segment.
- Wijzig tijd, score en lineup.
- Controleer dat totaalscore, speeltijd en +/- opnieuw correct worden berekend.
- Verwijder een segment en controleer opnieuw de totalen.

### 6. Wedstrijd afronden en historie

- Rond een wedstrijd af.
- Controleer tegenstander, competitie/toernooi, datum en eindscore in Historie.
- Open het historiedetail en controleer de segmenten.
- Controleer dat een nieuwe wedstrijd leeg start terwijl de teamlijst behouden blijft.

### 7. Stats

- Maak minimaal twee afgeronde wedstrijden met bekende lineups en scores.
- Controleer combinatiegrootte 1 en 5.
- Controleer `Met hen`, `Zonder hen` en de per-10-minutenweergave met vooraf handmatig berekende verwachte waarden.
- Controleer wedstrijd- en spelersfilters.

### 8. Trends

- Controleer gemiddelde speeltijd en +/- over meerdere wedstrijden.
- Controleer dat een speler die niet meedeed niet als nulmeting wordt meegenomen.
- Controleer sortering en per-10-minutenweergave.

### 9. Back-up en herstel

- Exporteer een back-up met spelers, instellingen, actieve wedstrijd en historie.
- Wis de browseropslag.
- Importeer de back-up.
- Controleer dat alle onderdelen zijn hersteld.

### 10. Taal, instellingen en classificatie

- Controleer dat NL/EN na herladen behouden blijft.
- Controleer teamnaam en clubkleuren.
- Zet het classificatiesysteem aan en test minimaal één lineup binnen en één lineup boven de toegestane grens.

## Testkwaliteit

- Gebruik inhoudelijke `expect`-assertions; screenshots alleen aanvullend.
- Vermijd vaste `waitForTimeout`-pauzes. Gebruik Playwright-locators en web-first assertions.
- Tests moeten onafhankelijk van elkaar kunnen draaien.
- Iedere test start met expliciet lege of gecontroleerd gevulde localStorage.
- Gebruik vaste datums, kloktijden en testwaarden waar dit nodig is voor reproduceerbare berekeningen.
- Test minimaal Chromium. Een mobiele viewport is verplicht voor de live wedstrijdflow.
- Bewaar traces/screenshots alleen bij falen om CI-artifacts klein te houden.

## Voorgestelde scripts

De exacte namen mogen worden aangepast als daar een goede reden voor is, maar minimaal moeten beschikbaar zijn:

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  }
}
```

## CI-acceptatiecriteria

GitHub Actions moet op iedere pull request minimaal uitvoeren:

1. dependencies installeren met een lockfile;
2. Playwright-browser installeren;
3. de app via HTTP starten;
4. alle end-to-endtests uitvoeren;
5. het testrapport en failure-artifacts beschikbaar maken bij fouten.

## Definition of Done

- Alle verplichte scenario's hebben minimaal één inhoudelijke test.
- De testresultaten zijn deterministisch en lokaal reproduceerbaar.
- CI slaagt op de volledige branch.
- De productiebuild en Netlify-publicatie blijven werken.
- De huidige UI en gebruikersfunctionaliteit zijn niet gewijzigd.
- Bestaande lokale gegevens blijven compatibel.
- De PR-beschrijving is bijgewerkt met uitgevoerde tests, bekende beperkingen en eventuele bewust uitgestelde scenario's.

## Rollback en behoud huidige versie

De huidige werkende versie blijft beschikbaar via commit `e2684047985d13740b913938887ea692a6c44dc7`. Zolang deze draft-PR niet is gemerged, verandert `main` en daarmee de Netlify-productie niet.

Als een latere merge problemen veroorzaakt, zijn er drie veilige herstelroutes:

1. de mergecommit via een nieuwe revert-PR terugdraaien;
2. Netlify tijdelijk opnieuw laten publiceren vanaf de laatste goede commit;
3. een herstelbranch maken vanaf `e2684047985d13740b913938887ea692a6c44dc7` en die via een PR terugbrengen naar `main`.

Verwijder of herschrijf de bestaande Git-history niet. Gebruik voor herstel altijd een nieuwe commit of pull request.
