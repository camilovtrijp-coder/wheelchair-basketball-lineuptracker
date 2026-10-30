# Turnovers: Firestore-regels opnieuw publiceren

De app schrijft turnovers als een nieuw veld `tov` op een segment en als een nieuwe
actie `turnover-delta` in het wedstrijdlogboek. De Firestore Security Rules in het
echte Firebase-project weigeren die tot ze zijn bijgewerkt. Publiceer daarom de
regels uit de repo (`firebase/firestore.rules`, punt 20) voordat je turnovers in
de cloud gebruikt.

Zonder deze stap werkt de app nog wel, maar de wedstrijd kan dan niet worden
aangemaakt of gesynchroniseerd zodra een segment met `tov` of een turnoveractie
wordt weggeschreven.

## Wat verandert er in de regels

- `Segment.tov` is optioneel en een niet-negatief geheel getal. Oude segmenten
  zonder `tov` blijven geldig (ze tellen als 0).
- De actie `turnover-delta` heeft precies de sleutels `type` en `delta` (`delta`
  is een geheel getal; `-1` is corrigeren).
- Het parent-document `games/{gameId}` krijgt GEEN nieuwe velden: het totaal
  wordt, net als de score, uit het actielogboek afgeleid.
- De rolregels veranderen niet: owner, admin, coach en scorer mogen wedstrijddata
  schrijven, een viewer niet, en alleen de huidige writer mag acties toevoegen.

## Stappen in de Firebase-console (aanbevolen)

1. Open <https://console.firebase.google.com> en kies het project
   `wheelchair-basketball-tracker`.
2. Ga naar **Firestore Database** en dan het tabblad **Rules**.
3. Kopieer de regels die er nu staan naar een notitie, als terugweg. De console
   bewaart ook de versiegeschiedenis.
4. Open `firebase/firestore.rules` in de repo, kopieer de **hele** inhoud en
   plak die over de oude regels heen.
5. Klik op **Publish**.
6. Open de app opnieuw, start een proefwedstrijd, tik een turnover en rond een
   segment af. Controleer dat de status "Gesynchroniseerd" blijft.

## Stappen met de Firebase CLI (alternatief)

Vanuit de hoofdmap van de repo, met de Firebase CLI ingelogd op het juiste account:

```bash
npx firebase-tools login
```

```bash
npx firebase-tools deploy --only firestore:rules --project wheelchair-basketball-tracker --config firebase/firebase.json
```

## Terugdraaien

Plak de oude regels uit je notitie terug in de console en klik op **Publish**, of
kies in de versiegeschiedenis een eerdere versie. Let op: met de oude regels
worden segmenten met `tov` en turnoveracties door de server geweigerd.

## Controle in de repo

De regels zijn getest tegen de Firebase Emulator in
`firebase/tests/rules/games-and-actions.spec.ts` (blok "turnovers") en de
converters in `firebase/tests/unit/documentConverters.spec.ts`.
