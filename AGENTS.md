# Projectregels — Lineup Tracker

## Leesvolgorde

Lees voor plan- of implementatiewerk eerst:

1. `README.md`;
2. `docs/IMPLEMENTATION_PLAN.md`;
3. de relevante productcode en tests.

Voer per sessie slechts één afgebakende taak of PR uit het implementatieplan uit.

## Veiligheidsgrenzen

- Behoud bestaande `localStorage`-keys en opgeslagen gebruikersdata, tenzij de taak expliciet een geteste migratie bevat.
- Behoud het bestaande Nederlandse CSV-contract.
- Voeg in fase 0 tot en met 3 geen backend, analytics, tracking of externe gegevensoverdracht toe.
- Voeg daarna alleen database- of synchronisatiecode toe binnen de expliciet goedgekeurde fase uit het implementatieplan.
- Plaats nooit tokens, API-sleutels, spelersdata of klantgegevens in broncode, tests, prompts of logs.
- Plaats nooit een databasebeheersleutel of `service_role`-sleutel in browsercode.
- Beveilig elke browsertoegankelijke databasetabel met geteste team- en rolgebonden toegangsregels.
- De app moet offline bruikbaar en als PWA installeerbaar blijven.
- Ook met cloudopslag moet een volledige wedstrijd zonder netwerk kunnen worden gespeeld en afgerond.
- Nieuwe zichtbare tekst moet Nederlands en Engels ondersteunen.
- Verander geen statistiekberekeningen zonder vaste, handmatig narekenbare tests.
- Gebruik fictieve data in tests en screenshots.
- Werk niet rechtstreeks op `main`.
- Wijzig geen niet-gerelateerde code.

## Werkwijze

Voor iedere codewijziging:

1. beschrijf eerst kort de huidige werking;
2. benoem risico’s voor opslag, CSV, offline werking en vertalingen;
3. maak een klein uitvoeringsplan;
4. implementeer alleen de afgesproken scope;
5. voeg gerichte tests toe;
6. voer relevante tests en controles uit;
7. rapporteer gewijzigde bestanden, resultaten en open risico’s.

Stop en vraag om een besluit wanneer de taak buiten de goedgekeurde roadmapfase valt of een frameworkmigratie, gewijzigd datacontract of andere grote architectuurkeuze vereist.
