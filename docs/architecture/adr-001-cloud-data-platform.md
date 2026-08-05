# ADR-001: Clouddata- en hostingplatform voor v2

## Status

**Geaccepteerd — 5 augustus 2026.** De drie openstaande vragen uit het concept (§9) zijn door de projecteigenaar expliciet beantwoord; zie §9 voor de besluiten en motivatie.

Dit document voert PR 4.1 uit zoals gescoped in `docs/IMPLEMENTATION_PLAN.md` §9. Het formaliseert en actualiseert `docs/architecture/platform-evaluation.md` (1 augustus 2026) tot een besluitrecord, en valideert de daarin genoemde cijfers opnieuw tegen actuele bronnen (augustus 2026).

Dit ADR volgt op een afgeronde poort: de walking-skeleton-fase (PR 3.1 t/m 3.2c) is gemerged en een aparte architectuurreview (importgrenzen, opslagcompatibiliteit, PWA-updategedrag, mobiele bediening, toegankelijkheid, testdekking) is uitgevoerd. Twee bevindingen uit die review zijn relevant voor dit ADR maar veranderen de platformkeuze niet: er ontbreekt nog een zichtbare PWA-update-UX en runtime-a11y-verificatie — beide expliciet PR 8.1/8.2-scope, niet vervroegd (zie §17 van het plan).

## Context

Volgens `docs/IMPLEMENTATION_PLAN.md` §3 en §9 geldt tot en met fase 3 een harde eis: geen backend, geen externe gegevensoverdracht. Die grens is nu bereikt — de settings- en teamflow zijn bewezen via `SettingsRepository`/`RosterRepository`-application-ports met een localStorage-adapter, exact volgens ADR-000's laaggrenzen. Fase 4 moet vóór de resterende wedstrijdschermen worden gebouwd, juist omdat de cloud-/synckeuze de vorm van IDs, repositories en het wedstrijdmodel bepaalt — een latere ombouw zou duurder zijn dan nu kiezen.

Niet-onderhandelbare eisen uit §3 die dit besluit direct raken:

- Spelersgegevens, classificaties en wedstrijddata blijven lokaal beschikbaar voor offline gebruik; synchronisatie gebeurt alleen binnen de goedgekeurde cloudfase.
- Ook na database-introductie moet een wedstrijd zonder netwerk gestart, bijgehouden en afgerond kunnen worden.
- Eén globale gebruikersidentiteit met app-level organisaties, teams en memberships — geen Firebase-project per club.
- Elke Firestore-route beveiligd met geteste, organisatie-/team-/rolgebonden Security Rules.
- Nooit een service-accountkey, Admin SDK-credential of `service_role`-sleutel in browsercode, Git, build-output of logs.
- Cloudmigratie is opt-in en verwijdert nooit stilzwijgend een bestaande lokale wedstrijd of back-up.

## Overwogen opties

| | Firebase (Auth + Firestore) | Supabase (Auth + Postgres) | Eigen API (bijv. Node + Postgres) |
|---|---|---|---|
| Offline schrijfsynchronisatie in de client-SDK | Ja, ingebouwd (`persistentLocalCache`); kernreden voor de voorkeur | Nee — IndexedDB/outbox, idempotency, revisies en conflictherstel zelf bouwen | Nee — volledig zelf bouwen, inclusief transportlaag |
| Multi-organisatie/team-isolatie | Security Rules per pad, getest in Emulator | Row Level Security (RLS), relationeel sterker voor complexe joins | Zelf te ontwerpen en te beveiligen |
| Passend bij "geen dependency als het lokaal kan" | Vervangt exact het stuk (offline sync) dat anders zelf gebouwd moet worden | Voegt een afhankelijkheid toe zonder het duurste probleem (offline sync) op te lossen | Grootste eigen onderhoudslast; rechtvaardigt zich niet voor een kleine beheerorganisatie |
| Statistiek-/exportqueries | Documentmodel, minder geschikt voor complexe aggregaties | SQL, sterker voor rapportages en volledige exports | Vrij te ontwerpen, maar kost bouwtijd |
| Risico bij groei (fase 9, rapportage/analytics) | Mogelijk querybeperkingen bij complexe cross-team-rapportage | Beter gepositioneerd voor die groei | Onafhankelijk van platformkeuze, wel van eigen capaciteit |
| Past bij kleine beheerorganisatie + Netlify/GitHub-workflow | Ja, geen eigen server te beheren | Ja, ook geen eigen server | Nee — vereist server-, database- en deploymentbeheer |

**Beslissende factor**: dit is een offline-first courtside-app. Betrouwbare lokale caching en automatische hersynchronisatie van browserwrites zijn een kernfunctie, geen bijzaak. Firestore's web-SDK levert dat ingebouwd; bij Supabase en een eigen API is dat het duurste stuk zelfgeschreven code in de hele roadmap. Dat weegt zwaarder dan Supabase's relationele/SQL-voordelen, die vooral pas in fase 9 (rapportage/analytics) relevant worden.

## Besluit

**Firebase Authentication + Cloud Firestore** als voorkeursbackend, met **Netlify** als losstaande, Git-gekoppelde frontendhost voor de Preact/TypeScript/Vite-PWA. Firebase Hosting en Netlify Functions zijn niet nodig: Netlify levert alleen de statische PWA, Firebase levert identiteit en data, en die twee blijven onafhankelijk vervangbare adapters (zelfde principe als de repository-ports in ADR-000).

**Supabase blijft de begrensde terugvaloptie**, alleen bij het falen van een van de meetbare gates in §7 hieronder.

## Validatie: regio, AVG/DPA, quota, prijsplan, back-ups, herstel, exit

Dit is het expliciete controlepunt dat §9/PR 4.1 vereist. Onderstaande cijfers zijn opnieuw gecontroleerd tegen actuele bronnen (augustus 2026), niet alleen overgenomen uit de evaluatie van 1 augustus.

### Regio en dataresidentie — nieuwe bevinding, nog niet in eerdere evaluatie

Firestore biedt een `eur3`-multiregio met read-write-replica's in `europe-west1` (België) en `europe-west4` (Nederland), met een witness-regio in `europe-north1` (Finland) — Firestore-data zelf kan dus binnen de EU blijven.

**Belangrijk risico dat nog niet eerder was vastgelegd**: aanpalende diensten (Cloud Functions, FCM, en met name Firebase Authentication) bieden niet dezelfde residentiegarantie. Auth-tokens kunnen Amerikaanse infrastructuur passeren, ook wanneer Firestore zelf op `eur3` staat. Firebase biedt momenteel geen volledig EU-residente multiregio-oplossing die alle onderdelen (Auth incluis) dekt.

**Besluit van de eigenaar (5 augustus 2026)**: geaccepteerd, met documentatie — niet stilzwijgend. De app bewaart uitsluitend niet-gevoelige teamdata (naam, rugnummer, classificatie; geen geboortedata of medische gegevens, conform de productstandaarden in `platform-evaluation.md` §"Productstandaarden"). Gegeven die beperkte gevoeligheid weegt het risico van mogelijke VS-transit van auth-metadata niet op tegen de kosten van een aparte DPA-opvraagronde of een alternatieve auth-provider. Deze afweging staat hier vastgelegd zodat ze bij een latere uitbreiding van de opgeslagen persoonsgegevens opnieuw beoordeeld kan worden.

### Quota (Spark, gratis plan) — herbevestigd, ongewijzigd t.o.v. 1 augustus

- Opslag: 1 GiB
- Reads: 50.000/dag
- Writes: 20.000/dag
- Deletes: 20.000/dag
- Uitgaand verkeer: 10 GiB/maand
- Quota resetten rond middernacht Pacific Time; slechts één database per project valt onder het gratis quotum.
- Back-ups, point-in-time recovery, Cloud Functions en verhoogd verbruik vereisen een Blaze-account (pay-as-you-go boven het gratis quotum).

Bron: [Firebase — Understand Cloud Firestore billing](https://firebase.google.com/docs/firestore/pricing), herbevestigd via actuele zoekresultaten augustus 2026.

### Prijsplan Netlify — herbevestigd, met één relevante wijziging

Free-plan: $0/maand, 300 credits/maand, harde limiet zonder automatische bijbetaling (sites pauzeren bij overschrijding tot de volgende cyclus) — ongewijzigd. **Nieuw sinds de vorige evaluatie**: Netlify heeft op 14 april 2026 seat-based pricing op het Pro-plan afgeschaft ten gunste van een vlak tarief — niet relevant voor het Free-plan dat deze roadmap gebruikt, maar het bevestigt dat Netlify's prijsmodel dit jaar is gewijzigd en dus periodiek herverificatie verdient.

De exacte creditkosten per productiedeploy (eerder genoemd: 15 credits) zijn niet opnieuw individueel geverifieerd in deze zoekronde — **actie voor de eigenaar**: dit cijfer vóór PR 5.5 (Netlify staging) rechtstreeks in het Netlify-dashboard controleren, niet alleen op basis van dit document aannemen.

Bron: [Netlify — Credit-based pricing plans](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/), herbevestigd augustus 2026.

### Back-ups en herstel

- **Firestore**: point-in-time recovery en geplande back-ups zijn Blaze-only functies, niet onderdeel van het gratis Spark-quotum. **Besluit van de eigenaar**: het concrete back-upbeleid wordt pas bij PR 8.3 (beveiliging, privacy, kosten en beheer) uitgewerkt, niet nu al vooruitgeschoven — dit blijft passend zolang de lokale JSON-back-up (zie hieronder) het vangnet is.
- **v2-eigen laag**: de bestaande JSON-back-up/import (fase 2, PR #9/#10/#12) blijft ongeacht het cloudbesluit bestaan als lokaal, downloadbaar vangnet — dit is al een niet-onderhandelbare eis in §3 ("cloudmigratie... lokale bron en een downloadbare back-up blijven beschikbaar").

### Exit-strategie (platformonafhankelijkheid)

- Firestore-data is exporteerbaar via de standaard Google Cloud export-tools (naar Cloud Storage, vervolgens naar elk gewenst formaat) — geen vendor-lock op het niveau van "data ophalen kan niet".
- De architectuur houdt Firebase achter `RosterRepository`/`SettingsRepository`-achtige application-ports (zelfde patroon als de bewezen localStorage-adapters uit PR 3.2b/3.2c) — een toekomstige platformwissel raakt in theorie alleen `infrastructure/`, niet `domain/`/`application/`/`ui/`. Dit is nog niet bewezen voor een cloud-adapter; PR 4.4 (de begrensde spike) is het eerste bewijspunt hiervoor.
- Concreet exit-plan (hoe een volledige organisatie-export er precies uitziet, welk formaat, welke SLA) is nog niet uitgewerkt — expliciet genoemd als openstaand punt in de "Gates voor definitieve acceptatie" van `platform-evaluation.md` en blijft dat hier ook.

## Dev/staging/productie-scheiding

Development, staging en productie gebruiken elk een **apart Firebase-project**. Een Netlify Deploy Preview wijst nooit naar het productieproject — Firebase-webconfig (geen geheim, wel contextgevoelig) wordt per Netlify-deploycontext beheerd, zodat een preview per ongeluk nooit tegen echte productiedata praat. Dit wordt technisch afgedwongen in PR 5.1 (reproduceerbare Firebase-basis) en PR 5.5 (Netlify staging), niet in dit ADR — hier wordt het als bindende eis vastgelegd.

## Meetbare gates voor terugval naar Supabase

Firebase wordt definitief geaccepteerd — en dit ADR blijft van kracht — alleen wanneer de begrensde spike (PR 4.4) en de platformpilot (fase 5) onderstaande harde gates halen. Bij het falen van één gate: stop verdere platformbouw en voer dezelfde pilot met **Supabase + IndexedDB/outbox** uit, met dezelfde acceptatiecriteria.

1. Gecachte settings/teamdata blijven offline leesbaar én schrijfbaar.
2. Synchronisatie na reconnect veroorzaakt geen stille duplicaten of verliezen.
3. Security Rules dwingen de volledige rol- en organisatie-isolatiematrix aantoonbaar af (Emulator-tests, positief én negatief).
4. Queries, export, verwijdering en verwachte statistiekvolumes blijven beheersbaar binnen het documentmodel.
5. Een ongecachete context wordt nooit stil als een leeg team getoond.
6. De eigenaar accepteert expliciet kosten, regio/DPA-risico (zie boven), gegevensverwerking en herstelbeleid.

Deze gates zijn ongewijzigd overgenomen uit `platform-evaluation.md` — dit ADR voegt er gate 6's DPA/regio-onderbouwing aan toe, die eerder niet expliciet was uitgewerkt.

## Gevolgen

- PR 4.2 (ADR-002, offline synchronisatiestrategie) en PR 4.3 (ADR-003, tenancy/autorisatie) bouwen direct op dit besluit voort en kunnen nu starten.
- PR 4.4 (begrensde Firebase-spike, uitsluitend fictieve data via de Emulator Suite) is het eerste punt waarop dit besluit empirisch wordt getoetst, niet alleen op papier.
- Geen productie-Firebase-project, geen Netlify-deployment en geen echte spelersdata worden aangemaakt of gebruikt vóórdat de gates in §7 zijn gehaald en de eigenaar dat apart goedkeurt (§3, §9 van het plan).
- Het AVG/regio-risico bij Firebase Authentication (zie §5) is door de eigenaar expliciet geaccepteerd, met documentatie van de afweging — geen open punt meer, wel iets om te herbeoordelen bij een latere uitbreiding van opgeslagen persoonsgegevens.

## Alternatieven expliciet verworpen

- **Eigen API/server (bijv. Node + Postgres)**: verworpen. Vereist het volledig zelf bouwen van offline-sync, transportlaag, server- en databasebeheer — de grootste onderhoudslast van de drie opties, zonder een voordeel dat de andere twie niet al bieden, en niet passend bij "kleine beheerorganisatie" uit de kernvraag in `platform-evaluation.md`.
- **Firebase-project per club/organisatie**: verworpen door de niet-onderhandelbare eis van één globale gebruikersidentiteit met app-level organisaties/teams/memberships (§3). Een project per club zou multi-organisatie-toegang voor één coach onmogelijk of onnodig complex maken.
- **Firebase Hosting i.p.v. Netlify**: niet gekozen als eerste optie. Blijft technisch beschikbaar als alternatief, maar Netlify past al bij de bestaande Git-workflow (Deploy Previews, GitHub-koppeling) en er is geen reden om dat nu te wijzigen.

## Besluiten van de eigenaar (5 augustus 2026)

Het concept van dit ADR bevatte drie openstaande vragen. De projecteigenaar heeft ze als volgt beantwoord, waarmee dit ADR van "Voorgesteld" naar "Geaccepteerd" gaat:

1. **AVG-risico rond Firebase Authentication**: geaccepteerd, met documentatie van de afweging (zie §5) — geen aanvullende maatregel of alternatieve auth-provider nodig gezien de beperkte gevoeligheid van de opgeslagen teamdata.
2. **Back-up-/herstelbeleid**: uitwerken bij PR 8.3, niet nu al vooruitgeschoven (zie §"Back-ups en herstel").
3. **Vervolgstap**: dit concept is voldoende basis om door te gaan naar PR 4.2 (ADR-002, offline sync) en PR 4.3 (ADR-003, tenancy) — geen aparte formele-acceptatiestap nodig vóór die PR's starten.
