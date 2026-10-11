# Spark-runbook (PR 8.3d-i)

Status: **voorstel, wacht op invulling door de eigenaar** (§7). Opgesteld op 11 oktober 2026.
Hoort bij [`docs/pr-8.3-operational-report.md`](pr-8.3-operational-report.md) en het
plan in [`docs/pr-8.3-plan.md`](pr-8.3-plan.md) §E.6 en 8.3d werk 3.

Dit runbook gaat uit van het Spark-plan (gratis Firestore-quotum). Er is **geen Blaze, geen
billingkoppeling en geen automatische upgrade**. Overstappen naar Blaze is altijd een afzonderlijk,
expliciet besluit van de eigenaar.

## 1. Quota (herverifieerd op 11 oktober 2026)

Bron: <https://firebase.google.com/docs/firestore/pricing>, pagina "Last updated 2026-10-08 UTC",
sectie "Free quota". Per project geldt er **één** database met gratis quotum.

| Onderdeel | Gratis quotum | Eenheid |
|---|---|---|
| Opgeslagen data | 1 GiB | totaal |
| Document reads | 50.000 | per dag |
| Document writes | 20.000 | per dag |
| Document deletes | 20.000 | per dag |
| Uitgaand dataverkeer | 10 GiB | per maand |

- Quota zijn dagelijks en resetten "around midnight Pacific time" (zelfde bron). Dat is **09:00
  Nederlandse tijd**, en **08:00** in de weken waarin de omschakeling naar zomer- of wintertijd in de VS en
  in Europa niet gelijktijdig valt (in het voorjaar de VS op de tweede zondag van maart tegen Europa op de
  laatste zondag; in het najaar Europa op de laatste zondag van oktober tegen de VS op de eerste zondag van
  november).
- Geen gratis gebruik, en dus alleen met billing beschikbaar: TTL-deletes, PITR-data, back-updata,
  restore- en clone-operaties (zelfde bron).
- Wat telt als read, afgeleid uit dezelfde pagina:
  - elk document uit een query, plus één read per 1000 indexvermeldingen in bepaalde gevallen;
  - minimaal één read per query, ook zonder resultaat;
  - bij een listener: één read per toegevoegd of gewijzigd document in de resultaatset, **en
    opnieuw een volledige query als de listener met persistente cache langer dan 30 minuten
    ontkoppeld was**;
  - **extra reads voor Security Rules**: elk document dat `exists()`, `get()` of `getAfter()`
    leest telt als één read per request, ook bij een listener-update (zie rapport §2).

## 2. Wat deze pagina's niet vastleggen (eerlijk open)

De officiële pagina's die ik raadpleegde beschrijven **niet** hoe Firestore zich precies gedraagt zodra
het gratis quotum op is. Dat gedrag is hier daarom niet ingevuld. Het blijft een **open gate**: test
het in een stagingproject (rapport §6, gate G1) voordat het in een gebruikersbelofte komt.

Wat wél uit het ontwerp van de app volgt (geen quotumgedrag, maar eigen architectuur):
- Een wedstrijd is volledig lokaal speelbaar en af te ronden, ook zonder netwerk (AGENTS.md,
  offline-eis). Writes komen in de lokale wachtrij en worden na herstel opnieuw geprobeerd.
- De synchronisatiestatus toont "lokaal / wacht op synchronisatie / gesynchroniseerd".
- Een afronding blijft in de wachtrij staan tot de server hem bevestigt; accountverwijdering wordt
  daardoor geblokkeerd zolang er onbevestigd werk is.

## 3. Controletempo en drempels (voorstel)

Dashboard: Firebase Console, Firestore, tab **Usage**. De console toont een **rollend 24-uurs-totaal**
met vertraging en geen teller per scenario (bevestigd in `docs/pr-5.5-onderzoeksrapport.md` §B.2).
Gebruik het daarom voor trend en drempel, niet voor exacte per-flow-cijfers.

| Niveau | Reads/dag | Writes/dag en deletes/dag | Opslag | Uitgaand/maand | Actie |
|---|---|---|---|---|---|
| Groen (< 25%) | < 12.500 | < 5.000 | < 0,25 GiB | < 2,5 GiB | niets, wekelijks controleren |
| Let op (25–50%) | 12.500–25.000 | 5.000–10.000 | 0,25–0,5 GiB | 2,5–5 GiB | oorzaak benoemen (§4), vaker controleren |
| Actie (50–80%) | 25.000–40.000 | 10.000–16.000 | 0,5–0,8 GiB | 5–8 GiB | gebruik terugbrengen (§4), eigenaar informeren |
| Kritiek (> 80%) | > 40.000 | > 16.000 | > 0,8 GiB | > 8 GiB | eigenaar beslist (§5); geen automatische stap |

**Tempo:** wekelijks, en daarnaast vóór en na een toernooi of een dag met meerdere wedstrijden. Na de
eerste echte pilotdag vaker, tot de eerste meting de projectie in het rapport heeft bevestigd of
gecorrigeerd.

## 4. Eerst de oorzaak, dan de maatregel

De projectie in het rapport (§2) laat zien dat **reads door kijkers** de grootste kostendrijver zijn,
niet de writes van de scorer. Volgorde bij "Actie":
1. Hoeveel apparaten hadden dezelfde wedstrijd open (kijkers)? Laat alleen de nodige apparaten live
   meekijken.
2. Waren er lange offline-periodes van meer dan 30 minuten met een open listener? Elke herverbinding
   leest de hele resultaatset opnieuw.
3. Zijn er testsessies, herhaalde inlogs of migratieruns die in dezelfde dag vielen?
4. Zijn er onverwacht veel writes (dubbele acties, herhaalde migratie)? De Rules weigeren een dubbele
   create en de app stuurt wat al in de wachtrij staat niet opnieuw; een stijgende write-lijn is dus
   een bevinding om te onderzoeken, geen normaal gedrag.

## 5. Bij uitputting of kritiek niveau

- **De scorer hoeft niet te stoppen.** De wedstrijd loopt lokaal door. Dat de synchronisatie daarna volgt
  na de reset (09:00 NL, zie §1) of na een besluit van de eigenaar is een **verwachting op basis van de
  architectuur, te bevestigen in G1** (§2): het quotumgedrag zelf is niet uit de bronnen vastgelegd.
- **Geen automatische upgrade naar Blaze.** Opties voor de eigenaar: wachten op de reset, het gebruik
  verlagen (§4), of expliciet besluiten tot Blaze. Blaze vereist een eigen goedkeuring, budgetalerts met
  ontvangers en een testmelding (plan §E.6) en valt buiten dit runbook.
- **Budgetalerts zijn geen harde limiet.** Volgens het plan (§E.6, eerder onderzocht) beperkt een budget
  het gebruik niet, het waarschuwt alleen. De Cloud Billing-pagina's heb ik in deze sessie **niet**
  kunnen herverifiëren (de omgeving blokkeerde `docs.cloud.google.com`); die tekst staat daarom nog als
  "niet herverifieerd op 11 oktober 2026" in het rapport.

## 6. Meetprotocol voor staging (open gate G1)

Doel: de afgeleide cijfers in het rapport vervangen door metingen. Voorwaarden:
- een afzonderlijk Firebase-stagingproject met **fictieve** data (geen echte spelers of e-mails);
- één meetdag per scenario, zonder ander gebruik, zodat het rollende 24-uurs-totaal bruikbaar is;
- een nulmeting vooraf en een eindmeting direct na afloop, beide met tijd en waarde genoteerd.

Scenario's (plan 8.3d werk 1): login en context; settings en roster; live wedstrijd met sync;
afronden en historie; tweede apparaat (kijker); tombstone; migratie; organisatie-export; het gekozen
verwijderpad (8.3c). Noteer per scenario reads, writes, deletes en opslag, plus het meetvenster.
Herhaal de "uitputting"-test (§2) in dit project, nooit in een project met gebruikers.

## 7. Invulling door de eigenaar (nodig)

| Onderwerp | Voorstel | Besluit eigenaar |
|---|---|---|
| Verantwoordelijke voor de wekelijkse controle | de eigenaar zelf | _in te vullen_ |
| Vervanger bij afwezigheid | _geen voorstel_ | _in te vullen_ |
| Controletempo (§3) | wekelijks plus rond toernooien | _bevestigen of wijzigen_ |
| Waar komen waarschuwingen binnen | e-mail van de eigenaar | _in te vullen_ |
| Drempels (§3) | 25 / 50 / 80% | _bevestigen of wijzigen_ |
