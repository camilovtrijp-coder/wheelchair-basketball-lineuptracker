# Onderzoeksrapport — PR 5.5 (staging-activatie en handmatige validatie)

Status: **sjabloon, nog niet ingevuld**. Aangemaakt in PR
5.5b-activatievoorbereiding (aug. 2026) zodat de structuur al vaststaat
vóórdat 5.5b-activatie en 5.5c daadwerkelijk plaatsvinden — geen deploy,
accountkoppeling of meting is in déze PR uitgevoerd. Vul de secties hieronder
in zodra de betreffende stap is afgerond; laat een sectie expliciet
"nog niet ingevuld" staan zolang dat zo is, in plaats van 'm leeg te laten
(dat is niet te onderscheiden van "vergeten").

Zie `docs/pr-5.5-plan.md` §C (5.5b/5.5c-scope) en
`docs/pr-5.5-handmatig-protocol.md` (de uit te voeren stappen) voor de
volledige context.

## A. Scope

_Nog niet ingevuld._

Hier komt te staan: welke sub-stap (5.5b-activatie en/of 5.5c) dit rapport
dekt, de datum van uitvoering, en wie de handmatige stappen heeft
uitgevoerd.

## B. Bevindingen

### B.1 — Staging-activatie (Firebase-project, Netlify-site, eerste Deploy Preview)

_Nog niet ingevuld._

Verwacht hier: het staging-Firebase-project-ID, de eerste Deploy Preview-URL,
bevestiging dat de console de staging-webconfig toont (niet
`demo-lineup-tracker-dev`), PWA-verificatie (laadt, `sw.js` correcte
MIME/cache-header, offline reload werkt), en de keuze rond testaccounts
opruimen-of-bewaren (zie `docs/pr-5.5-handmatig-protocol.md` §B, stap 7).

### B.2 — Werkelijke Firestore-verbruiksmeting

_Nog niet ingevuld._

Verwacht hier: gemeten reads/writes/opslag per synthetische pilotflow
(`docs/pr-5.5-handmatig-protocol.md` §D), vergeleken met de emulator-
extrapolatie uit `docs/pr-5.4-onderzoeksrapport.md` §B (15 reads/7 writes
per volledige run, 1.500/700 bij 100 runs). Bij overschrijding van het
gratis Spark-quotum bij één doorloop: hier documenteren en escaleren naar
PR 8.3.

### B.3 — Multi-write-queue-trigger

_Nog niet ingevuld._

Verwacht hier: bevestiging dat de multi-write-queue-/mergesemantiek-trigger
niet is geraakt door 5.5 (die blijft volgen op multi-tabgebruik of Fase 6
PR 6.2, zie `docs/pr-5.4-onderzoeksrapport.md` §C punt 3).

### B.4 — Handmatig iOS/Android-protocol

_Nog niet ingevuld._

Verwacht hier: per stap van `docs/pr-5.5-handmatig-protocol.md` §C
(stappen 1-9) verwacht vs. waargenomen resultaat, apart voor iOS en Android
indien beide zijn uitgevoerd, met schermafbeeldingen/video indien mogelijk.
Expliciet vermelden of het reload-hang-patroon uit
`docs/pr-5.3d-onderzoeksrapport.md` §A/§G hier al dan niet terugkeert.

## C. Open punten

_Nog niet ingevuld._

Verwacht hier: welke van de in `docs/pr-5.4-onderzoeksrapport.md` §C
genoemde open punten door dit rapport zijn afgesloten, en welke — vooral
Safari/iPadOS-specifiek gedrag, bewust voorbehouden aan PR 8.1 — nog open
blijven.

## D. Cross-references

- `docs/pr-5.5-plan.md` §C (5.5b/5.5c-scope), §E (eigenaarsbesluiten);
- `docs/pr-5.5-handmatig-protocol.md` (het uitgevoerde protocol);
- `docs/pr-5.4-onderzoeksrapport.md` §C (de drie punten die dit rapport
  overneemt) en §B (de emulator-verbruiksextrapolatie waartegen §B.2
  vergelijkt);
- `docs/pr-5.3d-onderzoeksrapport.md` §F/§G (het oorspronkelijke, tegen de
  emulator uitgevoerde protocol en het voorwaardelijke IndexedDB-outbox-
  vervolgtraject).
