# Vaste ontwerpreferentie — compact wedstrijdscherm, versie 6

Vastgelegd op 1 november 2026 voor [het bouwplan voor Claude](../../wedstrijdscherm-compact-bouwplan.md).

Testsite: https://lineup-wedstrijd-testdemo.camilovt.chatgpt.site/

Sites-versie 6, broncommit `0985efefdd2a1bb3ae1ef019b2dd71b780246455`. Deze commit hoort bij de aparte demo, niet bij v2-main. De demo is gepubliceerd op 1 november 2026; versienummer en broncommit zijn bij het opstellen van het bouwplan opnieuw via Sites geverifieerd. Latere inhoud op dezelfde URL kan afwijken.

## Openen

Open `demo.html` rechtstreeks in een moderne browser. Er is geen installatie, Firebase-login of verbinding met de echte wedstrijdgegevens nodig. De geëxporteerde wrapper kan stijl-/icoonhulpmiddelen vanaf een CDN laden; dit bestand is geen bewijs van de offline PWA-werking van v2. De teststatus kan in de browser worden onthouden. Gebruik een schoon browserprofiel voor een nieuwe test; wis geen opslag van de echte app.

`mockup.html` is de leesbare HTML/CSS/JS-bron voor de interactieve gespreksreferentie. Deze is een fragment, geen zelfstandig document. Gebruik `demo.html` voor testen en `mockup.html` om de UI en interacties te begrijpen.

`functiebehoud.md` is de vergelijking met de bestaande v2-functionaliteit. Het bouwplan bevat de aanvullende, normatieve eisen voor implementatie; neem de vereenvoudigingen van de demo niet over als domeincontract.

## Integriteit

SHA-256 van de vastgelegde bestanden:

- `demo.html`: `A857DB5C5CD3CCD5AB3575BF2A9129FD9ABACA87A26BE338280ECE303C83514C`
- `mockup.html`: `5A6FD613E9CFAB97D38F575E4DAF5A3EB86BA7543F4B857CFB9EFD1568679BB2`

De grote zelfstandige wrapper is gegenereerde referentie, geen voorgestelde v2-component. Kopieer geen Sites-manifesten, credentials, accounts of deploymentcode naar de app. Er zijn geen screenshots met echte spelersdata opgenomen.
