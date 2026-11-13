# Voorbereidende testnotities v2 — privégebruik op twee Android-apparaten

Datum: 11 oktober 2026. Geteste bron: `main` op `6502e5518230774aad77f9a1d550884da55bd8c8`.
Scope: één account, één schrijver per wedstrijd, afgeronde wedstrijden bekijken op het andere apparaat. Alleen fictieve gegevens. Dit is een testverslag en geen afgeronde PR 8.4-acceptatie of toestemming voor deployment.

## Voor de staging-deploy

| Controle | Resultaat |
| --- | --- |
| GitHub CI op exact deze SHA | Vier jobs groen (`test`, `v2-e2e`, `firebase-base`, `firebase-spike`), run [38143053340](https://github.com/camilovtrijp-coder/wheelchair-basketball-lineuptracker/actions/runs/38143053340). De v2-e2e-job rapporteert 116 gewone en 135 Auth/Firestore-e2e-tests geslaagd, zonder gemelde flaky test. |
| Lokale browser-e2e met Chromium en Firebase Auth/Firestore-emulators | 116 gewone en 135 Auth/Firestore-tests geslaagd, één worker en zonder retry. De gewone suite bevat één vooraf als `test.fail()` gemarkeerde offline-herlaadtest; Playwright rapporteerde deze als verwachte mislukking en de run eindigde met exitcode 0. De gerichte tests voor vertrouwde offline cache, offline actie en reconnect, en afgeronde wedstrijd op apparaat B slaagden. |
| Lokale v2-unit-tests | 137 bestanden, 1.979 tests geslaagd. |
| TypeScript en ESLint | Geslaagd. |
| Productiebundels | Module- en classic-service-workerbundel gebouwd; de classic-importcontrole is geslaagd. Vite waarschuwt voor een JS-chunk van circa 1,23 MB; dit is een prestatiepunt om op de echte apparaten te beoordelen, geen buildfout. |
| Firebase Rules in Emulator Suite | 26 bestanden, 557 tests geslaagd, inclusief negatieve toegangsproeven. |
| Firebase-unit-tests | 133 geslaagd; drie runbooktests stopten vóór de assertie omdat Windows hier geen symlinks mag aanmaken (`EPERM`). GitHub CI op dezelfde SHA is groen. |
| Prettier op deze Windows-checkout | Mislukt op 435 bestanden doordat `core.autocrlf=true` de regeleinden omzet. GitHub CI op dezelfde SHA is groen; dit is hier geen bewezen broncodefout. |
| Dependency-audit | Niet opnieuw te beoordelen: de npm-auditendpoint was vanuit deze omgeving onbereikbaar. |

## Bevindingen voor de volgende build

1. **Staging loopt achter.** De gepubliceerde Netlify-site `basketball-tracker-staging` stond bij controle op commit `ad663ce68c95ec53abdab87d9abab18fecb53c5d` van 17 augustus 2026. Dit test niet de huidige wedstrijdsync.
2. **Frontend en Firebase samen controleren.** Tussen de staging-commit en de geteste SHA zijn `firebase/firestore.rules` (668 regels diff) en `firebase/firestore.indexes.json` gewijzigd. De huidige live Rules-/indexversie is niet geverifieerd. Publiceer de nieuwe frontend pas in staging wanneer de bijbehorende Auth/Firestore-configuratie en Rules zijn gecontroleerd; test daarna de echte serverflow.
3. **Geen nieuwe productbug gereproduceerd vóór deployment.** De lokale en CI-tests hierboven zijn groen. De vooraf bekende `test.fail()` in `v2/tests/e2e/mobile.spec.ts` betreft offline herladen in de gewone testfixture zonder persistente vertrouwde cache; de aparte Auth/Firestore-suite test offline herladen met cache wel en slaagde. De resterende risico's liggen in de echte hostingconfiguratie, Android/PWA-werking en synchronisatie tussen fysieke apparaten.

## Na deployment: korte privéproef

Leg eerst de gepubliceerde build-SHA, Firebase-project-ID, Rules-/indexversie en Netlify-toegangsinstellingen vast. Gebruik één testaccount, één nieuwe organisatie/teamcontext en fictieve spelers.

1. Installeer/open de PWA op tablet en mobiel. Controleer in beide browsers dat dezelfde teaminstellingen en spelerslijst zichtbaar zijn.
2. Start een wedstrijd op de tablet terwijl die online is. Registreer score, wissel en segment, ga offline, registreer nog een actie en rond af. Herlaad offline als de app die stap toestaat; controleer dat de wedstrijd niet verdwijnt.
3. Verbind de tablet opnieuw. Wacht op expliciete serverbevestiging van de afronding. Noteer iedere fout of `Actie nodig`-melding.
4. Open Historie op de mobiel. Controleer dat de wedstrijd precies één keer verschijnt en vergelijk score, segmenten, minuten en Nederlandse CSV met de tablet. Controleer ook Stats en Trends.
5. Herhaal met een nieuwe fictieve wedstrijd op de mobiel en de tablet als tweede apparaat. Bedien dezelfde wedstrijd nooit tegelijk op beide apparaten.
6. Controleer een app-update/reload en opnieuw openen na afsluiten, zonder dat een nog niet bevestigde wedstrijd verloren gaat.

Bij een afwijking: noteer build-SHA, apparaat/browser/Android-versie, online/offline-status, de exacte stappen, verwacht en werkelijk gedrag, tijdstip en een screenshot met uitsluitend fictieve gegevens. Maak voor elke gereproduceerde productfout een kleine PR met een gerichte regressietest. Houd configuratie-/deploymentfouten apart van broncodefouten.

## Bestaande, nog niet gereproduceerde aandachtspunten

- B3: gelijktijdig wijzigen van instellingen op twee apparaten kan onopgeslagen formulierwaarden overschrijven. Buiten de gekozen opeenvolgende wedstrijdflow; gericht testen als instellingen op beide apparaten worden bewerkt.
- C2: het randgeval rond sluiten/unmount van het verwijderpaneel mist nog een concrete reproductie. Niet relevant voor de eerste privéwedstrijdproef.
- G1/G2: voor deze verkennende privéproef niet als voorwaarde gebruikt; daarmee zijn de meting en herstelproef niet uitgevoerd of bewezen.
