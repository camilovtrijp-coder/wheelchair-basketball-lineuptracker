# PR 5.4 — Onderzoeksrapport multi-organisatie- en twee-apparatenpilot

Status: 5.4b lokaal geverifieerd; 5.4c vult de eindrapportage en §17-status aan.
Getest tegen: branch `feature/pr-5.4b-two-devices-conflict-actuality`, gebaseerd op `main` `494b4d9`.
Datum: 9 augustus 2026.

## A. Conflictbesluit

Settings blijven één Firestore-document, maar de schrijfsemantiek maakt onderscheid tussen twee situaties:

- twee apparaten wijzigen hetzelfde veld: Firestore last-write-wins; beide listeners convergeren naar dezelfde serverwaarde;
- twee apparaten wijzigen verschillende velden: de UI geeft de werkelijk gewijzigde keys door en de repository schrijft alleen die velden met `setDoc(..., { merge: true })` plus `updatedAt`.

Een nieuw settingsdocument wordt altijd volledig geschreven. Daardoor blijven de converter- en Rules-contracten voor een eerste write geldig. De patchroute wordt pas gebruikt nadat de repository een bestaand document heeft gelezen of via de listener heeft gezien.

Deze combinatie bewaart de eerder gekozen eenvoudige last-write-wins-semantiek voor echte conflicten, maar voorkomt dat twee inhoudelijk onafhankelijke wijzigingen elkaar stil overschrijven.

## B. Pilotscenario’s

| Scenario                                   | Verwacht                                                                | Lokaal waargenomen                                                   | Testbewijs                                  |
| ------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------- |
| Twee apparaten, hetzelfde team             | B ontvangt A's wijziging via de listener zonder reload                  | Geslaagd; B toont ook de serverbevestigde actualiteit                | `two-devices-same-context.spec.ts`          |
| Twee apparaten, verschillende organisaties | Writes en listeners blijven volledig organisatiespecifiek               | Geslaagd; beide documenten behielden uitsluitend hun eigen wijziging | `two-devices-different-orgs.spec.ts`        |
| Bewust conflict op hetzelfde veld          | Eén serverwaarde wint en beide clients convergeren zonder `Actie nodig` | Geslaagd; winnaar mag Alpha of Beta zijn                             | `deliberate-conflict.spec.ts`               |
| Gelijktijdige niet-conflicterende velden   | Beide velden blijven behouden en verschijnen op beide clients           | Geslaagd via expliciete keypatches                                   | `concurrent-non-conflicting-writes.spec.ts` |

Volledige lokale run: `38 passed` in de seriële v2-auth-e2e-suite tegen verse Firebase Auth- en Firestore-emulators. De unit-suite was eveneens groen: `229 passed`.

## C. Bron, actualiteit en syncstatus

- Settings en roster tonen `updatedAt` pas wanneer een serverbevestigde Firestore Timestamp beschikbaar is.
- De Timestamp wordt aan de repositorygrens omgezet naar epoch-milliseconden; Firebase-types lekken niet naar de UI.
- De gecombineerde syncstatus bewaart `fromCache`; de sessiebalk toont in NL of EN het suffix `uit cache` / `from cache` wanneer minstens één actieve gegevensbron uit cache komt.
- Nieuwe datum- en cachetekst is beschikbaar in Nederlands en Engels.

## D. Open punten voor 5.4c en 5.5

5.4c blijft verantwoordelijk voor de definitieve §17-status en de administratieve opschoning van verouderde #28-verwijzingen. Issue #28 zelf is al gesloten.

Bewust overgedragen aan PR 5.5:

1. handmatige iOS/Android-validatie van offline schrijven en herladen met een nog pending write, via een echte netwerkonderbreking;
2. werkelijk Firestore-verbruik op staging in plaats van alleen emulatorbewijs;
3. bredere multi-write-queue-semantiek zodra multi-tabgebruik of Fase 6 PR 6.2 dit activeert.
