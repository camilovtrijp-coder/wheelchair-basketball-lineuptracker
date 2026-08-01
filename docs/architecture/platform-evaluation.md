# Platformevaluatie voor de v2-roadmap

Status: richtinggevend advies, nog geen geaccepteerd architectuurbesluit  
Datum: 1 augustus 2026

## Vraag

Welke combinatie past het beste bij een offline-first lineuptracker die:

- op meerdere apparaten gebruikt kan worden;
- later meerdere clubs, teams en seizoenen ondersteunt;
- tijdens een wedstrijd zonder netwerk betrouwbaar blijft;
- via GitHub controleerbaar kan worden gebouwd en gepubliceerd;
- door een kleine beheerorganisatie onderhouden kan worden?

## Advies in één zin

Behoud **Preact + TypeScript + Vite** voor de app, gebruik **Netlify** als
voorkeurskandidaat voor Git-gekoppelde frontendhosting en gebruik **Supabase**
als voorkeurskandidaat voor Postgres, authenticatie en autorisatie. Bouw boven
Supabase wel een eigen, geteste offline-first opslag- en synchronisatielaag;
Supabase vervangt die laag niet.

Dit advies wordt pas een besluit nadat
`adr-001-cloud-data-platform.md`, `adr-002-offline-sync-strategy.md` en
`adr-003-tenancy-and-authorization.md` zijn opgesteld en door de eigenaar zijn
goedgekeurd.

## Beoogde doelarchitectuur

```text
Courtside PWA
  Preact UI
      |
  application use-cases
      |
  repository ports
      |
  +-------------------------+
  | IndexedDB + outbox      |  <- altijd eerst lokaal schrijven
  +-------------------------+
              |
         sync worker
              |
  Supabase publishable API
      Auth + Postgres + RLS

GitHub -> CI -> Netlify Deploy Preview / productiebuild
```

De browser bevat uitsluitend een Supabase publishable key. Een secret key of
`service_role`-sleutel hoort nooit in de PWA, Git, build-output of logs. De
publishable key is geen autorisatie: elke blootgestelde tabel krijgt geteste
Row Level Security op basis van club-/teamlidmaatschap en rol.

## Waarom Supabase de voorlopige voorkeur heeft

De kerngegevens zijn relationeel: een club heeft teams, teams hebben seizoenen,
leden en spelers, wedstrijden hebben snapshots en segmenten, en segmenten
verwijzen naar precies vijf wedstrijdspelers. Postgres past daar natuurlijk bij
en maakt statistiekqueries, constraints, exports en een latere exit overzichtelijk.

Supabase combineert een volledige Postgres-database met Auth, Row Level
Security, migrations/CLI en optioneel Realtime. Dat vermindert de hoeveelheid
eigen backendbeheer. De officiële documentatie bevestigt dat browsertoegang met
een publishable key bedoeld is, maar alleen veilig is wanneer RLS correct is
ingeschakeld en getest:

- [API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Local development and migrations](https://supabase.com/docs/guides/local-development)

### Belangrijke beperking

Supabase biedt niet automatisch het offline gedrag dat deze courtside-app nodig
heeft. De PWA moet zelf IndexedDB, een outbox, idempotency, revisiecontrole,
conflicten en herstelgedrag implementeren. Realtime kan later apparaten snel
bijwerken, maar wordt niet de bron van waarheid voor lokale wedstrijdacties.

### Actuele platformwijzigingen om rekening mee te houden

- Nieuwe code gebruikt `sb_publishable_...` en niet de legacy `anon`-sleutel;
  de legacy sleutels worden volgens Supabase eind 2026 uitgefaseerd.
- Nieuwe tabellen worden niet vanzelf aan de Data API blootgesteld. Dat is een
  veiligere standaard, maar migrations moeten expliciet vastleggen welke schema's
  en tabellen bereikbaar zijn.
- De Supabase-changelog wordt bij iedere platform-PR opnieuw gecontroleerd op
  breaking changes.

Bronnen:

- [Migreren naar publishable en secret keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Supabase breaking changes](https://supabase.com/changelog?types=breaking-change)

## Waarom Firebase niet de eerste keuze is

Cloud Firestore heeft een belangrijk voordeel: de clients kunnen offline data
cachen, lokale writes synchroniseren en bij conflicterende wijzigingen op
hetzelfde document geldt standaard last-write-wins. Voor een generieke mobiele
app is dat aantrekkelijk. Zie
[Access data offline](https://firebase.google.com/docs/firestore/manage-data/enable-offline).

Voor deze app weegt daartegenover dat het domein relationeel is, historische
snapshots en constraints belangrijk zijn en toekomstige statistiekvragen zich
goed lenen voor SQL. De conclusie dat Supabase hier beter past is daarom een
architectuurinschatting, niet de stelling dat Firestore technisch ongeschikt is.
Firebase blijft het terugvalalternatief wanneer een proof-of-concept aantoont dat
de eigen Supabase-synchronisatielaag te complex of onbetrouwbaar wordt.

## Waarom geen eigen API als startpunt

Een eigen API boven een zelfbeheerde database geeft maximale controle, maar
voegt ook serverbeheer, authenticatie, autorisatie, upgrades, monitoring,
back-ups en incidentherstel toe. Die extra onderhoudslast levert in de eerste
productfasen weinig voordeel op. De repository-ports en Postgres-migrations
houden een latere overstap wel mogelijk.

## Waarom Netlify voorlopig behouden

Netlify past bij de bestaande werkwijze: een gekoppelde GitHub-repository kan na
een push automatisch bouwen en deployen, en pull requests kunnen een eigen
Deploy Preview krijgen. Voor Vite adviseert Netlify standaard `npm run build`
met `dist` als publish-directory:

- [Vite on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/)
- [Git workflows](https://docs.netlify.com/build/git-workflows/overview/)
- [Deploy Previews](https://docs.netlify.com/deploy/deploy-types/deploy-previews/)

Netlify host alleen de statische PWA. Supabase blijft een afzonderlijk backend-
en dataplatform. Daardoor kan één van beide later worden vervangen zonder de
hele app opnieuw te ontwerpen.

Omgevingsvariabelen worden per deploycontext in Netlify beheerd en niet met
waarden in Git gezet. Alleen de Supabase URL en publishable key mogen door Vite
in browsercode worden opgenomen; servergeheimen niet. Zie
[Environment variables overview](https://docs.netlify.com/build/environment-variables/overview/).

Er is voor de statische PWA geen Netlify Function of Netlify-specifieke
Vite-plugin nodig zolang alle toegestane datatoegang via Supabase Auth en RLS
loopt. Voeg zo'n serverlaag pas toe voor een concrete behoefte, bijvoorbeeld
een beheertaak die bewust een secret key nodig heeft.

## Multi-tenant uitgangspunt

Ontwerp het schema vanaf het begin als:

```text
organization/club
  -> teams
      -> seasons
          -> players and games

users
  -> organization_memberships
  -> team_memberships where finer access is needed
```

De eerste UI hoeft nog maar één club en één team per gebruiker te tonen. Het
schema voorkomt wel dat later elk record en elke RLS-policy opnieuw moet worden
ontworpen wanneer een tweede club aansluit.

Eerste rollen:

- `owner`: leden en eigenaarschap beheren, exporteren en verwijderen;
- `coach`: team en wedstrijden beheren en scoren;
- `viewer`: alleen lezen.

## Eerste multi-device grens

De eerste cloudversie ondersteunt één actieve scorer per lopende wedstrijd.
Andere apparaten kunnen lezen; een tweede scorer moet de bediening expliciet
overnemen. Dit voorkomt stille dubbele punten en segmenten. Echte gelijktijdige
multi-writer samenwerking is een latere productkeuze, niet een basisvereiste.

## Beslispoorten vóór implementatie

De eigenaar hoeft niet alle technische details te kiezen, maar wel deze
productwensen:

1. Mag een gebruiker zelf een club/team maken, of alleen via een uitnodiging?
2. Is e-mail magic link/OTP voldoende voor de eerste versie?
3. Is één actieve scorer plus read-only meekijken de juiste eerste
   multi-device-ervaring?
4. Welke persoonsgegevens zijn echt nodig, hoe lang blijven ze bewaard en moet
   classificatie per speler in de cloud staan?
5. Mag een eigenaar een afgeronde wedstrijd heropenen, of blijft die standaard
   onveranderlijk?

Technische controles binnen ADR-001:

- EU-regio, actuele kosten en limieten;
- back-up- en herstelmogelijkheden;
- DPA/AVG-verantwoordelijkheden;
- export- en verwijderflow;
- exit-test: volledige clubdata exporteren naar een leesbaar formaat;
- proof-of-concept voor offline outbox, idempotente sync en RLS-isolatie.

## Besluitadvies

Ga verder met **Supabase + Netlify als voorkeursroute**, maar keur nu nog geen
productiedatabase of deployment goed. Laat PR 3.2a-c eerst de frontend-
walking-skeleton bewijzen. Maak daarna de drie ADR's en een klein technisch
prototype met uitsluitend fictieve data. Alleen wanneer offline herstel,
teamisolatie en twee-apparatensynchronisatie aantoonbaar werken, wordt deze
platformkeuze definitief en mag de rest van de app erop worden gebouwd.
