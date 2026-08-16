# Eigenaars eigen screenshots

Plaats hier telefoonscreenshots die de eigenaar zelf maakt — via GitHub's
"Add file → Upload files" op de `docs/v1-look-and-feel-pariteit`-branch, of
via een commit die Claude namens de eigenaar doet als het GitHub-uploaden
zelf niet lukt. Deze vullen de zelf-gemaakte referentiescreenshots in
`docs/v1-screenshots/` (één niveau hoger) aan met echte gebruikersinteracties
die niet zomaar geautomatiseerd te reproduceren waren.

Let op: de vier `eigenaar-*`-screenshots (16 aug. 2026) zijn van de
**v2-staging-omgeving** (`staging.netlify.app`, herkenbaar aan de
organisatie/team-wisselaar en de sync-statusindicator), niet van v1 — ze zijn
dus geen directe v1-referentie voor de look-and-feel-pariteit, maar wel
relevant bewijsmateriaal:

- `eigenaar-geen-verbinding-offline.jpg` — het "Geen verbinding"-scherm na
  een offline paginaherlaad (`stateUncachedOfflineTitle`/`-Body`), zie
  `docs/pr-5.5c-bugfixes.md` bug 6.
- `eigenaar-instellingen-gesynchroniseerd.jpg` — Instellingen-tab,
  gesynchroniseerd, teamnaam "Rotterdam basketball RSE 1 test mobiel".
- `eigenaar-instellingen-aangepast-2a.jpg` / `-2b.jpg` — Instellingen-tab met
  teamnaam "Rotterdam basketball RSE 1 test aangepast 2".

De `v1-*`-screenshots (16 aug. 2026, aangeleverd via Google Drive) zijn wél
echte v1-schermen (`RoBa Lineup Tracker`, live productiedata van het
RoBa-team) — de directe referentie voor de look-and-feel-pariteit:

- `v1-instellingen-club-kleuren.jpeg` — Instellingen, Club-sectie met
  primaire/accentkleur.
- `v1-instellingen-classificatie-1.jpeg` / `-backup.jpeg` — Instellingen,
  classificatiesysteem en de back-up-sectie (export/import).
- `v1-team-rosterlijst-1.jpeg` / `-2.jpeg` — Team-tab, spelerslijst met
  klasse/categorieën.
- `v1-wedstrijd-opzet-meedoen-start.jpeg` / `-start-onderkant.jpeg` —
  Wedstrijd-opzet: meedoen/start-keuze per speler, tegenstander/competitie,
  classificatie- en klokinstellingen.
- `v1-wedstrijd-live-scorebord.jpeg` — live scorebord tijdens een wedstrijd.
- `v1-wedstrijd-live-wisselen-segment.jpeg` / `-wissel-bevestigen.jpeg` /
  `-segment-tijd.jpeg` — de wisselflow en segment-vastleggen.
- `v1-wedstrijd-hervatten-dialoog.jpeg` — de "opgeslagen wedstrijd
  gevonden"-hervatten/nieuw-dialoog.
- `v1-historie-overzicht.jpeg` / `-detail-segmenten.jpeg` — Historie-tab:
  wedstrijdlijst en detailweergave met segmenten + CSV-export.
- `v1-trends-minuten-per-wedstrijd.jpeg` / `-samenspel-filter.jpeg` /
  `-samenspel-jitske.jpeg` / `-per-speler.jpeg` — Trends-tab: minuten- en
  samenspel-analyses per speler.

Zie `docs/v1-look-and-feel-pariteit.md` voor de context van de v1-referentie-
screenshots, en `docs/pr-5.5c-bugfixes.md` voor de bugfixes-tracking.
