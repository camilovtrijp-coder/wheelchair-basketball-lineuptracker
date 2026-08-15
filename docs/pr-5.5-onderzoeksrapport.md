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
MIME/cache-header, offline reload werkt), de org-ID/account-uid's/rollen van
de fixtures uit `docs/pr-5.5-handmatig-protocol.md` §B, en de keuze rond
opruimen-of-bewaren (§B.2, punt 8: bij bewaren de identificatiegegevens
hier vastleggen; bij opruimen de `firebase firestore:delete --recursive`-
uitvoer + readback-bevestiging hier vastleggen).

### B.2 — Werkelijke Firestore-verbruiksmeting (inclusief deletes)

_Nog niet ingevuld._

Verwacht hier: gemeten reads/writes/deletes/opslag vóór en ná elke
synthetische pilotflow (`docs/pr-5.5-handmatig-protocol.md` §D, inclusief
flow 5 "deletes"), vergeleken met de emulator-extrapolatie uit
`docs/pr-5.4-onderzoeksrapport.md` §B (15 reads/7 writes per volledige run,
1.500/700 bij 100 runs — die extrapolatie bevat zelf geen deletes, dus de
deletemeting hier heeft geen emulator-referentiewaarde om tegen te
vergelijken, alleen een absolute telling). Bij overschrijding van het
gratis Spark-quotum bij één doorloop: hier documenteren en escaleren naar
PR 8.3.

### B.3 — Multi-write-queue-trigger

_Nog niet ingevuld._

Verwacht hier: bevestiging dat de multi-write-queue-/mergesemantiek-trigger
niet is geraakt door 5.5 (die blijft volgen op multi-tabgebruik of Fase 6
PR 6.2, zie `docs/pr-5.4-onderzoeksrapport.md` §C punt 3).

### B.4 — Handmatig iOS/Android-protocol (2/2 schone runs per platform)

_Nog niet ingevuld._

Verwacht hier, per platform (iOS/Android) en per ronde (1/2) apart — dus 4
volledige rijen: per stap van `docs/pr-5.5-handmatig-protocol.md` §C.1
(stappen 1-8) verwacht vs. waargenomen resultaat inclusief de tweede-client-
readback in élke ronde, met schermafbeeldingen/video indien mogelijk, en een
expliciete "schoon: ja/nee"-conclusie per ronde. Expliciet vermelden of het
reload-hang-patroon uit `docs/pr-5.3d-onderzoeksrapport.md` §A/§G hier al
dan niet terugkeert. Beide platforms moeten 2/2 schoon zijn — bij een
onvolledige of afwijkende run hier expliciet vermelden welke actie volgt
(herhalen, of escaleren naar §G-outbox-traject).

### B.5 — Role-matrix-UI op staging

_Nog niet ingevuld._

Verwacht hier: de uitkomst van `docs/pr-5.5-handmatig-protocol.md` §C.2 —
de positieve test (owner/admin/coach kan daadwerkelijk opslaan, bevestigd
na herlaad) en de negatieve test (viewer kan niet opslaan, read-only-
indicator zichtbaar), met vermelding van welk platform/apparaat gebruikt is.

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
