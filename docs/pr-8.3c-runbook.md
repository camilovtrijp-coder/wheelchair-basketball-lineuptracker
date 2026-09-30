# Runbook — organisatie verwijderen na een verwijderverzoek (PR 8.3c-1d)

Dit runbook hoort bij besluitrecord `docs/pr-8.3c-besluitvoorstel.md` §2.5 (optie A:
eigenaar-geïnitieerd verwijderverzoek in de app plus een handmatig beheerrunbook). De
app zet alleen `requested`/`cancelled`; **het wissen zelf en de statussen `executing`,
`completed` en `failed` zijn uitsluitend dit runbook.** Er is geen Cloud Function en geen
Blaze.

## 0. Status en wat wel en niet is getest

| Onderdeel | Status |
| --- | --- |
| Toestandsmachine, blokkades, exportpoort, banner, rolgating | Getest in de emulator met echte Rules en in de browser (PR 8.3c-1a t/m 1c-ii) |
| Alleen-lezen inventaris (`npm run runbook:inventory`), dump, hash, uitvoeringsrecord, readback | Getest in de emulator (`firebase/tests/runbook/`, `firebase/tests/unit/runbookLib.spec.ts`), inclusief mutatiecontroles |
| Wissen met `firebase firestore:delete -r` | **Niet uitgevoerd in CI of deze sandbox.** Het commando richt zich op de emulator als `FIRESTORE_EMULATOR_HOST` gezet is, maar vereist ook dan een ingelogde CLI-sessie (vastgesteld in 1d: zonder login faalt het in `requireAuth`). In de proefuitvoering staat `recursiveDelete` van firebase-admin als vervanger. Het echte commando moet op de uitvoeringsdatum eerst na `firebase login` tegen de emulator en daarna tegen een fictieve staging-organisatie worden geverifieerd (§6) |
| Statuswijziging via de Firebase Console | Niet geautomatiseerd; handmatige stap |
| Commando's tegen een echt project | Nog niet uitgevoerd. De Firebase CLI-opties moeten op de uitvoeringsdatum met `--help` worden gecontroleerd (besluitrecord §7 punt 2) |

De 7 dagen bedenktijd, de 12 maanden bewaartermijn van het uitvoeringsrecord en de
30/90/180-dagentermijnen zijn een productvoorstel, geen juridisch advies. Zolang er alleen
fictieve data in de cloud staat is dat voldoende; vóór de PR 8.5-cutover met echte
spelersdata hoort hier een expliciete toets tegen de dan geldende verplichtingen.

## 1. Wie, en welk risico dat is

- De uitvoerder heeft eigenaarsniveau-toegang tot het Firebase-project en omzeilt daarmee
  alle Security Rules. Dat is een geaccepteerd restrisico zolang eigenaar en beheerder
  dezelfde persoon zijn (besluitrecord §2.3). Zodra dat niet meer zo is, of er meer dan
  één organisatie is met een eigenaar buiten de eigen kring, is de servervariant weer een
  verplicht agendapunt (§2.4 trigger 1 en 2).
- Team-only leden (alleen een `teamMembers`-rij, geen `organizationMembers`) zien de banner
  niet (besluitrecord §8.3, geaccepteerd restrisico). Daarom geldt stap 2.4.
- **Geen sleutelbestand.** Er komt nergens een service-accountsleutel, Admin SDK-credential
  of databasebeheersleutel in Git, browser, build-output, logs of dit document. Het runbook
  gebruikt de ingelogde sessie van de beheerder. Het script weigert te starten als
  `GOOGLE_APPLICATION_CREDENTIALS` is gezet. Let op: het script ziet niet of een
  Application Default Credentials-bestand zelf een service-accountsleutel is. Gebruik
  uitsluitend `gcloud auth application-default login` met je eigen account.
- Gebruik voor het uitvoeringsrecord en de dump een map **buiten** de repository. Het script
  weigert een `--out` binnen de werkboom (symlinks en `..` worden meegenomen); controleer dat
  toch zelf, want de dump bevat persoonsgegevens en `.gitignore` vangt hem niet af.
- **Twee afwijkingen van het besluitrecord, nog te bevestigen door de eigenaar** (zie ook
  §3 stap 2 en besluitrecord §8.5): (1) de verse "export vlak vóór het wissen" is een
  beheerdersdump van de hele organisatie, niet de 8.3b-exportenvelop; (2) het script
  gebruikt Application Default Credentials via `gcloud` naast de Firebase CLI-sessie.
- Het script vereist Node ≥ 20.11 (`import.meta.dirname`); op een oudere Node faalt het bij
  het laden, dus gesloten.

## 2. Voorwaarden vóór stap 3

Alle vier moeten kloppen. Leg de uitkomst vast in het uitvoeringsrecord-logboek (§4).

1. **Status en termijn.** Lees in de Firebase Console
   `organizations/{orgId}/deletionRequests/current`. `status` is `requested`, niet
   `cancelled`. `requestedAt` ligt **minimaal 7 dagen** geleden. De termijn staat niet in
   de Rules; jij bewaakt hem. Bij een herstart na annuleren telt de `requestedAt` van de
   laatste poging (`attempt`).
2. **Geen recente activiteit en geen open migratie.** Het verzoek is alleen aangemaakt als
   de app toen geen blokkade zag, maar er kan sindsdien activiteit zijn geweest. Controleer
   in de Console per team of er een niet-afgeronde `games/*` is met `lastWriterActivityAt`
   (of, als die `null` is, `updatedAt`, dan `createdAt`) binnen de laatste 24 uur, en of er
   een `migrationRuns/*` is waarvan `status` niet `completed` is. Is dat zo: **niet
   uitvoeren.** Wacht tot de activiteit voorbij is, of volg de overrule in §5.
3. **Nieuwe annulering uitgesloten.** Lees de status opnieuw vlak vóór stap 3.5 (een eigenaar
   kan tot dat moment annuleren). Na `executing` kan de app niet meer annuleren: de Rules
   staan dat alleen vanuit `requested` toe.
4. **Informatieplicht.** Informeer vóór uitvoering alle leden, **ook de team-only leden**
   die de banner niet zien (besluitrecord §8.3). Gebruik de tekst in §7. Het aantal
   team-only leden staat in het verwijderpaneel van de eigenaar en is te verifiëren via
   `teams/*/teamMembers` zonder bijbehorende `organizationMembers`.

## 3. Uitvoering

Werkmap: een map buiten de repo, bijvoorbeeld `~/lineup-runbook/<orgId>/`. Variabelen:
`PROJECT_ID` (het Firebase-project), `ORG_ID` (de organisatie).

1. **Inloggen zonder sleutel.**
   `firebase login` en `gcloud auth application-default login`. Controleer dat
   `echo "$GOOGLE_APPLICATION_CREDENTIALS"` **en** `echo "$FIRESTORE_EMULATOR_HOST"` leeg
   zijn: een gezette emulator-variabele laat zowel het script als `firestore:delete` stil de
   emulator raken, met een readback van nul terwijl de echte data blijft staan. Het script
   weigert een emulator-host samen met een `--project` dat niet met `demo-` begint, maar
   controleer in elke uitvoer dat `"target": "project <PROJECT_ID>"` staat (en niet
   `"emulator"`). Bevestig het project met `firebase projects:list` en gebruik in elk
   commando expliciet `--project "$PROJECT_ID"`.
2. **Vooraf-inventaris en dump (alleen lezen).**
   `npm --workspace firebase run runbook:inventory -- --project "$PROJECT_ID" --org "$ORG_ID" --out ~/lineup-runbook/$ORG_ID/dump.json`
   - De uitvoer toont `counts` per gegevensfamilie (dezelfde tien sleutels als
     `exportProof.counts`), `unmapped` (moet `{}` zijn; een onbekende familie betekent dat
     het script of de datavorm is gewijzigd: **stop en onderzoek**), de `contentHash` en de
     duur.
   - De dump bevat persoonsgegevens (e-mail, namen), is alleen voor de beheerder leesbaar
     (modus 0600, alleen bij een nieuw bestand: bestaat het pad al, controleer de rechten)
     en mag nooit in Git, tickets of chat. `sha256sum dump.json` geeft dezelfde hex als de
     `contentHash` (zonder het voorvoegsel `sha256:`) wanneer het bestand onaangetast is.
   - De dump is een eigen, canonieke JSON (Firestore-tijdstempels als `{"__timestamp": ISO}`)
     en **geen** 8.3b-export en niet importcompatibel. Hij is dus een controlemiddel en een
     noodkopie, geen garantie op herstel.
   - Dit is de export die telt. De `exportProof` van de eigenaar is een UX-poort, geen
     bewijs: er kan tussen aanvraag en uitvoering data bijgekomen zijn. De `contentHash`
     hier is de hash van deze beheerdersdump (canonieke JSON van alle documenten, gesorteerd
     op pad) en is **niet** gelijk aan de hash van de 8.3b-exportenvelop van de eigenaar.
3. **Vergelijk met het bewijs van de eigenaar (informatief).** Vergelijk `counts` met
   `exportProof.counts` uit de Console. Meer documenten is normaal als er data is
   bijgekomen; **minder** wijst op tussentijds verwijderen: uitzoeken vóór je doorgaat.
   Let op: de inventaris telt elk document in `settings` en `roster` (de 8.3b-export alleen
   `current`), dus een klein verschil daar is te verwachten en het script rapporteert het
   niet als `unmapped`.
4. **Logboek openen.** Noteer in het logboek (§4): `organizationId`, `requestedAt`,
   `requestedBy`, de inventaris-`counts`, de `contentHash`, de huidige tijd en dat je
   begint. Doe dit vóór stap 5: zodra het wissen begint verdwijnt
   `deletionRequests/current` mee en is de status niet meer in Firestore terug te lezen.
5. **Status `executing` zetten.** Lees eerst `status` opnieuw (§2 punt 3). Wijzig in de
   Console uitsluitend `status` naar `executing` en `revision` naar de vorige waarde + 1.
   Raak geen ander veld aan. Vanaf nu ziet elk lid de banner "wordt uitgevoerd".
6. **Laatste controle en wissen.** Tussen de dump (stap 2) en het wissen is er bewust geen
   lockdown: een lid kan in dat venster nog schrijven. Draai daarom vlak vóór het wissen de
   inventaris nog een keer (zonder `--out`) en vergelijk `contentHash` met stap 2. Wijkt hij
   af, maak dan de dump opnieuw (terug naar stap 2) en leg dat vast. Let op de leeskosten:
   de inventaris leest elk document (een `get()` plus `listCollections()` per document) en je
   draait hem minstens drie keer, plus `firestore:delete`. Spark heeft een dagelijks
   leesquotum (actuele waarde op de uitvoeringsdatum controleren, besluitrecord §7 punt 3);
   bij een grote organisatie kan dit het quotum voor alle gebruikers opmaken. Plan daarom
   buiten piekuren en meet eerst op staging.
   `firebase firestore:delete "organizations/$ORG_ID" --recursive --project "$PROJECT_ID"`
   - Bevestig de prompt alleen na controle van het pad. Gebruik nooit `--all-collections`
     en nooit `--force` zonder het pad nog een keer te hebben gelezen.
   - Verwachting (op staging te verifiëren, §6): het commando verwijdert ook documenten die
     alleen nog subcollecties hebben. De readback in stap 7 is de controle, niet deze aanname.
   - Bij een fout of onderbreking: niet opnieuw beginnen vanuit de status, maar meteen
     stap 7 (readback) uitvoeren, dan het commando herhalen tot de readback nul is. Herhalen
     is veilig bedoeld (het verwijdert alleen wat er nog staat); bevestig dat op staging (§6).
7. **Readback.** Draai de inventaris opnieuw zonder `--out`:
   `npm --workspace firebase run runbook:inventory -- --project "$PROJECT_ID" --org "$ORG_ID"`
   Verwacht: `organizationExists: false`, `totalDocuments: 0`, alle `counts` nul,
   `unmapped: {}`. Alles anders is **niet afgerond**: herhaal stap 6 en 7. Lukt dat niet,
   ga naar §8 (mislukt).
8. **Uitvoeringsrecord schrijven** (§4) en het logboek sluiten. De status `completed` uit
   §2.5 is in Firestore onbereikbaar: `deletionRequests/current` verdwijnt mee met het
   wissen. Logboek plus uitvoeringsrecord vervangen die status; zet nooit eerst `completed`
   en wis daarna.
9. **Dump opruimen.** Verwijder `dump.json` direct na stap 8 en overschrijf niets in een
   gedeelde map. De dump is na het wissen de enige kopie van de organisatiedata; de eigenaar
   heeft zijn eigen export (een download die de app alleen op het moment van aanvragen
   aanbiedt). Bewaar de dump alleen langer als de eigenaar daar schriftelijk om vraagt, en
   leg dat dan in het logboek vast. Dit is een voorstel; de eigenaar beslist.
10. **Informeren.** Meld de leden en de aanvrager dat de organisatie is verwijderd. Firebase
    Authentication-accounts blijven bestaan: accountverwijdering en "organisatie verlaten"
    zijn PR 8.3c-2, niet dit runbook.

## 4. Uitvoeringsrecord (buiten Firestore, 12 maanden)

`deletionRequests/current` staat onder `organizations/{orgId}` en verdwijnt dus mee met het
wissen. Het bewijs van uitvoering staat daarom in een bestand buiten Firestore en buiten Git.
**Uitsluitend deze zes velden:**

```json
{
  "organizationId": "<orgId>",
  "requestedAt": "2026-09-01T10:00:00.000Z",
  "requestedBy": "<uid van de aanvrager>",
  "executedAt": "2026-09-09T10:00:00.000Z",
  "counts": {
    "organizationMembers": 0, "invitations": 0, "teams": 0, "teamMembers": 0,
    "settingsDocuments": 0, "rosterPlayers": 0, "games": 0, "gameActions": 0,
    "completedGames": 0, "migrationRuns": 0
  },
  "contentHash": "sha256:<hash van de beheerdersdump uit stap 2>"
}
```

- `counts` zijn de aantallen **voor** het wissen (stap 2); de readback (stap 7) wordt als
  aparte regel in het logboek vastgelegd.
- Geen e-mailadressen, geen spelersnamen, geen exportinhoud, ook niet "ter verduidelijking".
  De bouwfunctie (`firebase/scripts/lib/executionRecord.ts`) weigert extra velden en elke
  tekstwaarde met een `@`; gebruik haar of controleer het bestand met dezelfde maatstaf.
- Bewaartermijn **12 maanden**, daarna handmatig verwijderen. De termijn is een
  productvoorstel (besluitrecord §3.2).
- Tijdstippen zijn ISO-8601 zoals `Date.prototype.toISOString()` ze levert.

## 5. Overrule van een blokkade (alleen hier, nooit als knop in de app)

De app blokkeert hard op een recente niet-afgeronde wedstrijd en op een migratierun die niet
`completed` is (besluitrecord §2.5 en §8.4). Een dode run of een vergeten wedstrijd blijft dus
een blokkade die alleen de beheerder kan overrulen, schriftelijk:

1. Schrijf in het logboek: welke blokkade (pad en status of tijdstip), waarom die niet meer
   kan veranderen, wie het besluit nam, en de datum. Zonder die regel: niet uitvoeren.
2. Een wedstrijd met recente activiteit overrule je niet: wacht liever 24 uur. Het
   offline-apparaat kan nog niet-gesynchroniseerde data vasthouden die per definitie niet in
   de dump staat; doorzetten is dan stil dataverlies.
3. Een mislukte of onopgeloste `migrationRuns`-run mag pas worden overruled nadat iemand die
   heeft bekeken (besluitrecord §3.2): noteer wat je zag.

## 6. Gemeten testuitvoering

**Wat is gemeten.** Op een fictieve organisatie in de Firestore-emulator
(`firebase/tests/runbook/deletion-runbook-drill.spec.ts`, draait in `npm run verify` en dus in
CI): 24 documenten, twee teams, een wees-document (team zonder eigen document met een wedstrijd
eronder), plus een tweede organisatie die onaangeroerd moet blijven.

| Stap | Emulator, kleine organisatie (24 documenten) | Emulator, 5111 documenten (eenmalige meting, niet opgenomen in CI) |
| --- | --- | --- |
| 2. inventaris (lezen) | ≈ 0,4 s (eerste aanroep) | ≈ 9,1 s |
| 2. dump + hash | ≈ 1 ms | ≈ 34 ms |
| 5. `executing` zetten | ≈ 11 ms | n.v.t. |
| 6. wissen (`recursiveDelete`, vervanger) | ≈ 46 ms | ≈ 9,7 s |
| 7. readback | ≈ 7 ms | ≈ 13 ms |

Wat de proefuitvoering aantoont (en dus wat het runbook veilig mag aannemen):

- De inventaris telt exact dezelfde tien families als `exportProof.counts`, tellen `rosterPlayers`
  als spelers en niet als documenten, en meldt een onbekende familie apart (`unmapped`) in
  plaats van hem stil te negeren.
- Een document dat alleen nog subcollecties heeft, telt niet als document, maar zijn
  subcollecties wel. Zo blijft een half gewist organisatieonderdeel zichtbaar voor de readback.
- De hash is stabiel voor dezelfde inhoud, onafhankelijk van volgorde, en verandert bij één
  gewijzigde waarde.
- Na het wissen is de readback nul, ook voor het organisatiedocument; een resterende wees
  maakt de uitkomst "niet leeg".
- De andere organisatie behoudt al haar documenten.
- Het uitvoeringsrecord bevat alleen de zes velden en geen `@` of spelersnaam.

**Wat niet is gemeten.**

- De wall-clock van een echte uitvoering is **minimaal 7 dagen bedenktijd plus de handmatige
  stappen**; emulatorseconden zeggen niets over een echt project. De inventaris doet per
  document twee aanroepen en is dus het langzaamste onderdeel bij grote organisaties.
- `firebase firestore:delete -r`, de Console-edit voor `executing` en de logins via
  `firebase login` en `gcloud auth application-default login` zijn niet uitgevoerd (CI en
  sandbox hebben geen login). **Voer op de uitvoeringsdatum eerst stap 1 t/m 9 uit tegen de
  emulator na `firebase login`** (met `FIRESTORE_EMULATOR_HOST` gezet en een
  `demo-`-project), en daarna op een fictieve staging-organisatie; meet de duur en noteer die
  hier. De 12 maanden en 7 dagen staan ook pas dan vast.
- Trigger 4 uit besluitrecord §2.4: duurt een gemeten uitvoering langer dan één werkdag of
  ontstaat er een fout die niet uit dit runbook te herstellen is, dan is de servervariant
  weer een verplicht agendapunt.

## 7. Tekst voor de informatieplicht

NL: "De organisatie «{naam}» is door de eigenaar aangevraagd om te worden verwijderd. Na
{datum, minimaal 7 dagen na de aanvraag} worden alle gegevens van deze organisatie
(spelerslijsten, wedstrijden, instellingen en uitnodigingen) verwijderd. Wil je een kopie, vraag
die dan vóór die datum aan de eigenaar. Je eigen account blijft bestaan."

EN: "The owner has requested deletion of the organisation «{name}». After {date, at least 7
days after the request} all data of this organisation (rosters, matches, settings and
invitations) will be deleted. If you want a copy, ask the owner before that date. Your own
account remains."

## 8. Als het misgaat

- **Wissen mislukt of onderbroken.** Herhaal stap 6 en 7 tot de readback nul is. Het
  commando verwijdert alleen wat er nog staat (te bevestigen op staging, §6).
- **Niet leeg na herhaald proberen.** Zet, als `deletionRequests/current` nog bestaat,
  `status` op `failed` en `revision` + 1 in de Console, noteer de reden in het logboek en
  onderzoek eerst; ga niet verder met andere commando's. Bestaat dat document niet meer,
  dan is het logboek je enige statusbron. `failed` is voorbehouden aan de beheerder om te
  hervatten; een half uitgevoerde wissing is geen nieuwe eigenaarsaanvraag.
- **Verkeerd pad of verkeerde organisatie gewist.** Direct stoppen. Op Spark bestaat geen
  back-up of herstel (besluitrecord §3.2: operationele cloudback-ups bestaan niet zonder
  Blaze); het enige herstelmiddel is de dump van stap 2 voor de betreffende organisatie plus
  de eigen exports van de eigenaren. Daarom controleer je het pad in stap 6 voor je bevestigt.
- **Dump kwijt of onleesbaar vóór het wissen.** Niet wissen. Maak stap 2 opnieuw.
- **Een geannuleerd verzoek waar de eigenaar niet meer mee kan herstarten.** Als de eigenaar
  na annuleren "klok loopt achter" ziet (de app eist een strikt latere `exportProof.exportedAt`
  en de klok van zijn apparaat, of die van de eerste aanvraag, wijkt af), is het
  `cancelled`-document vastgelopen. Controleer dat `status` echt `cancelled` is, noteer het
  document in het logboek en verwijder `organizations/{orgId}/deletionRequests/current` in de
  Console. Er gaat geen organisatiedata verloren (een geannuleerd verzoek bevat alleen het
  exportbewijs); de eigenaar kan daarna een nieuw verzoek indienen (`attempt` begint weer op
  1). Doe dit nooit bij `requested`, `executing` of `failed`.

## 10. Niet in dit stuk

- Het opruimen voor de bewaartermijnen (verlaten wedstrijden > 180 dagen, migratieruns
  > 90 dagen): besluitrecord §3.2 noemt dat "opruiming via runbook", maar dat is een apart
  stuk werk en staat hier niet in.
- Account- en lidmaatschapsverwijdering (PR 8.3c-2) en gebruik, back-up en verwerkersovereenkomst
  (8.3d).

## 9. Korte checklist

- [ ] §2.1 status `requested` en ≥ 7 dagen
- [ ] §2.2 geen recente activiteit, geen open migratie (of schriftelijke overrule, §5)
- [ ] §2.4 alle leden, ook team-only, geïnformeerd
- [ ] 3.1 ingelogd zonder sleutel, `GOOGLE_APPLICATION_CREDENTIALS` en `FIRESTORE_EMULATOR_HOST` leeg, uitvoer toont `target: project <id>`
- [ ] 3.2 inventaris en dump buiten de repo, `unmapped` is `{}`
- [ ] 3.4 logboek geopend
- [ ] 3.5 status opnieuw gelezen, `executing` gezet
- [ ] 3.6 inventaris opnieuw, `contentHash` gelijk aan stap 2 (anders dump opnieuw)
- [ ] 3.6 wissen, pad gecontroleerd
- [ ] 3.7 readback nul
- [ ] 3.8 uitvoeringsrecord, 3.9 dump verwijderd, 3.10 leden geïnformeerd
