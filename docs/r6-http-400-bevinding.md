# R6 — bevinding HTTP 400 tijdens sync

Status: **niet gereproduceerd, geen codewijziging.** Onderzocht in de Firestore-laag
(`v2/src/infrastructure/**/Firestore*`, `firebase/firebaseClient.ts`).

## Wat is nagelopen

- **Schrijfbatches**: `writeBatch` komt alleen voor in `FirestoreGameCloudGateway`
  (afronden: 2 schrijfacties) en `FirestoreOrganizationGateway`. Ver onder de limiet van
  500 per batch; geen onbegrensde batches.
- **`in`-queries**: `FirestoreCloudMigrationInventoryGateway` knipt id-lijsten in stukken
  van 30 (de Firestore-limiet). In orde.
- **`undefined`-velden**: de Web SDK weigert die client-side met een gewone fout, niet met
  een HTTP-400 van de server. Geen aanwijzing dat dit via het netwerk gebeurt.
- **Documentgrootte**: actie-documenten zijn klein (één actie per document), snapshots
  groeien niet onbegrensd. Geen aanwijzing voor de 1 MiB-limiet.

## Meest waarschijnlijke verklaring (niet bewezen)

`firebaseClient.ts` zet `experimentalForceLongPolling: true`. Bij long polling gebruikt de
SDK `Listen/channel`-requests met een sessie-id. Een 400 op dat kanaal is het bekende,
meestal onschuldige gevolg van een verlopen of ongeldige sessie na offline gaan, een
achtergrond-tab of het slapen van het apparaat; de SDK bouwt het kanaal dan zelf opnieuw
op. Dit past bij een melding "tijdens sync" op een telefoon in de zaal.

## Om te kunnen bewijzen wat het is

De exacte request-URL en de response-body van de 400 uit de browser-devtools (Network-tab,
filter op `firestore.googleapis.com`). Eindigt de URL op `Listen/channel` of `Write/channel`
en herstelt de sync daarna vanzelf, dan is het bovenstaande de oorzaak en is er niets te
fixen. Staat er een `error.message` zoals "Invalid argument" in de body, dan wijst die naar
het veld of de query. Pas dan is een gerichte fix met test verantwoord.
