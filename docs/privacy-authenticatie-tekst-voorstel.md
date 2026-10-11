# Concepttekst: Authentication en gegevens in de VS (PR 8.3d-i, gate G8)

Status: **concept van 11 oktober 2026**, nog niet in de app en niet in een privacyverklaring. Geen
juridisch advies. De eigenaar controleert de tekst en vult de punten tussen [vierkante haken] in; pas
daarna volgt een kleine PR die de tekst in de app zet (nieuwe zichtbare tekst in NL en EN).

Besluit: [`docs/pr-8.3-operational-report.md`](pr-8.3-operational-report.md) §4.4 (accepteren en
transparant vermelden, bevestigt ADR-001 van 5 augustus 2026).

## 1. Waarop de tekst steunt

Alleen bronnen die op 11 oktober 2026 zijn gelezen (rapport §1 en §4.1):
- Firebase Authentication draait volgens <https://firebase.google.com/support/privacy> "only from US data
  centers" en verwerkt gegevens "exclusively in the United States".
- Verwerkte gegevens: wachtwoorden, e-mailadressen, user agents en IP-adressen. IP-adressen worden enkele
  weken bewaard; overige authenticatiegegevens tot de klant het account verwijdert, daarna verdwijnen ze
  binnen 180 dagen uit live- en back-upsystemen.
- Firestore (teamgegevens) staat in `eur3`: `europe-west1` (België), `europe-west4` (Nederland) en
  `europe-north1` (Finland) als witness.
- Authentication en Firestore vallen onder de Google Cloud Platform Terms en de Cloud Data Processing
  Addendum van Google. Die addendum noemt eerst een "Alternative Transfer Solution" (indien door Google gekozen) en daarna standaardcontractbepalingen (SCC's) als terugvaloptie (CDPA §4.1).

Niet gelezen en dus niet in de tekst beloofd: de details van de overdrachtsclausules in de addendum, en de
subverwerkerslijst die daarbij hoort.

## 2. Tekst, Nederlands

**Inloggen en je account**

Voor inloggen en accountbeheer gebruikt deze app Firebase Authentication van Google. Daarbij verwerkt
Google je e-mailadres, je wachtwoord, gegevens over je browser en je IP-adres.

**Waar die gegevens staan.** Firebase Authentication draait uitsluitend vanuit datacenters in de Verenigde
Staten. Je inloggegevens worden dus buiten de Europese Unie verwerkt. De overige gegevens van je team
(zoals spelers, wedstrijden en instellingen) staan in de EU [regio te bevestigen: België en Nederland, met reserveregio in Finland] en daarnaast als kopie op je eigen apparaat.

**Waarom dit kan.** Voor deze doorgifte gelden de afspraken over internationale doorgifte in de Cloud Data
Processing Addendum van Google [mechanisme te bevestigen]. [Toevoegen na controle door de eigenaar of een jurist: de
rechtsgrond, en wie de verwerkingsverantwoordelijke is.]

**Hoe lang.** Firebase bewaart IP-adressen enkele weken. Je overige inloggegevens blijven bewaard tot je
je account verwijdert; daarna zijn ze binnen 180 dagen ook uit de back-upsystemen van Google verdwenen.

**Wat je zelf kunt doen.** Je kunt je account zelf verwijderen via de instellingen van de app. Vragen of
verzoeken over je gegevens kun je sturen naar [contactadres].

## 3. Tekst, Engels

**Signing in and your account**

This app uses Google's Firebase Authentication to sign you in and manage your account. Google processes
your email address, your password, information about your browser and your IP address for this.

**Where this data is processed.** Firebase Authentication runs only from data centers in the United States.
Your sign-in data is therefore processed outside the European Union. The rest of your team's data (such as
players, games and settings) is stored in the EU [region to be confirmed: Belgium and the Netherlands, with a backup region in Finland] and as a copy on your own device.

**Why this is possible.** The international-transfer terms in Google's Cloud Data Processing Addendum apply to this
transfer [mechanism to be confirmed]. [To add after review by the owner or a lawyer: the legal basis, and who the data
controller is.]

**How long.** Firebase keeps IP addresses for a few weeks. Your other sign-in data is kept until you delete
your account; after that it is also removed from Google's backup systems within 180 days.

**What you can do.** You can delete your account yourself in the app's settings. Send questions or requests
about your data to [contact address].

## 4. Open invulpunten voor de eigenaar

| Punt | Nodig |
|---|---|
| Verwerkingsverantwoordelijke | naam van de organisatie of persoon die de app aanbiedt; sluit aan bij de accounthouder van het Google-account (rapport §4.2, D2) |
| Rechtsgrond en grondslag voor de doorgifte | te bevestigen door de eigenaar of een jurist; de tekst belooft hier niets |
| Contactadres voor vragen en verzoeken | [contactadres] |
| Waar de tekst komt | privacyverklaring en een korte melding bij het aanmaken van een account; de plaatsing in de UI wordt bij de PR besloten |
| Databaselocatie | bevestigen in de Firebase-console (Firestore, databaselocatie) dat de database in `eur3` staat |
| Andere Firebase-diensten | als er meer diensten in gebruik zijn (bijv. App Check, dat attestatiegegevens verwerkt), die toevoegen |
| Rol van de eigenaar | verwerkingsverantwoordelijke of verwerker ten opzichte van clubs (rapport §4.5) |
| Leeftijd van gebruikers | als er minderjarigen gebruiker kunnen zijn, de toestemming en de formulering laten beoordelen |
