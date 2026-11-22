# Firestore Rules publiceren: lineupcorrectie (PR 7.7c)

Deze update is **verplicht vóór het gebruik van lineupcorrecties in de cloud**
(`docs/pr-7.7-plan.md`, uitrolvolgorde: eerst de Rules, daarna de clients).
Zonder de nieuwe Rules geeft een geüploade lineupcorrectie
`permission-denied` (status `actie-nodig` in de app). De lokale correctie blijft
dan staan en kan later opnieuw worden geüpload.

## Wat verandert

- Eigenaar, beheerder en coach mogen een afgeronde wedstrijd corrigeren met een
  gewijzigde lineup per segment (punt 22 in `firebase/firestore.rules`).
- De lineup moet echt wijzigen en uit precies 5 unieke spelers bestaan die aan de
  wedstrijd meededen. Het logitem draagt daarvoor het cloud-only veld
  `lineupPlayerIndexes`.
- Alle andere segmenten, de spelerslijst en rollen blijven ongewijzigd. Niemand
  kan zichzelf lid of beheerder maken.
- Bekende beperking: de exacte klassesom en toegestane som worden niet in de
  Rules nagerekend (alleen onderlinge consistentie en bereik).

## Voor je publiceert (optioneel, veilig)

Draai de Rules-tests tegen de Emulator vanuit de repo (publiceert niets):

```bash
cd firebase && npm ci && npm run verify
```

## Stappen in de Firebase-console (aanbevolen)

1. Open <https://console.firebase.google.com> en kies het project
   `wheelchair-basketball-tracker`.
2. Ga naar **Firestore Database** en dan het tabblad **Rules**.
3. Kopieer de regels die er nu staan naar een notitie, als terugweg. De console
   bewaart ook de versiegeschiedenis.
4. Open `firebase/firestore.rules` van de actuele `main` in de repo, kopieer de
   **hele** inhoud en plak die over de oude regels heen.
5. Klik op **Publish**.
6. Controleer de app (zie hieronder).

## Stappen met de Firebase CLI (alternatief)

Vanuit de hoofdmap van de repo, met de Firebase CLI ingelogd op het juiste
account en met `main` uitgecheckt en bijgewerkt:

```bash
npx firebase-tools login
```

```bash
npx firebase-tools deploy --only firestore:rules --project wheelchair-basketball-tracker --config firebase/firebase.json
```

## Controle na publicatie

1. Open de staging-app met een account dat owner, admin of coach is en kies een
   afgeronde cloudwedstrijd in Historie.
2. Corrigeer één segment: wissel een speler (alleen spelers die meededen zijn
   kiesbaar) en bevestig.
3. Controleer dat de synchronisatiestatus op "Gesynchroniseerd" komt en dat de
   correctie na een herstart of op een tweede apparaat nog klopt.
4. Controleer dat een viewer (of scorer) de correctie niet kan uploaden.
5. Corrigeer ook één segment alleen op score of tijd, om te zien dat de
   bestaande correcties nog werken.

## Terugdraaien

Plak de oude regels uit je notitie terug in de console en klik op **Publish**,
of kies in de versiegeschiedenis een eerdere versie. Met de oude regels worden
lineupcorrecties door de server geweigerd; bestaande correcties van tijd, score
en turnovers blijven werken. Reeds opgeslagen lineupcorrecties in de cloud blijven
leesbaar.

## Controle in de repo

De regels zijn positief en negatief getest in de Emulator Suite in
`firebase/tests/rules/completed-games-lineup-correction.spec.ts` (o.a. rollen,
5 unieke deelnemers, andere segmenten ongewijzigd, log groeit met precies één
item, worst case voor de limiet van 1000 expressies) en de converters in
`firebase/tests/unit/documentConverters.spec.ts`.
