# Platformevaluatie voor de v2-roadmap

Status: richtinggevend voorkeursbesluit, nog te bekrachtigen in ADR-001 t/m ADR-003

Datum: 1 augustus 2026

## Vraag

Welke combinatie past het beste bij een offline-first lineuptracker die:

- op meerdere apparaten gebruikt kan worden;
- één coach toegang geeft tot meerdere organisaties en teams;
- tijdens een wedstrijd zonder netwerk betrouwbaar blijft;
- later meerdere clubs, bonden, teams en seizoenen ondersteunt;
- via GitHub controleerbaar kan worden gebouwd en gepubliceerd;
- door een kleine beheerorganisatie onderhouden kan worden?

## Voorkeursroute

Behoud **Preact + TypeScript + Vite** voor de PWA, **Netlify** voor de
Git-gekoppelde frontendhosting en kies **Firebase Authentication + Cloud
Firestore** als voorkeursbackend. Firestore krijgt de voorkeur boven Supabase
omdat betrouwbare lokale caching en het later synchroniseren van browserwrites
een kernfunctie van de web-SDK zijn. Dat sluit beter aan op courtside gebruik
dan een volledig zelf te bouwen offline synchronisatielaag.

Dit document geeft de bouwrichting en standaardkeuzes. De keuze wordt formeel
geaccepteerd nadat ADR-001, ADR-002 en ADR-003 en de fictieve platformpilot uit
fase 4 de gates halen. **Supabase is de begrensde terugvaloptie** wanneer de
pilot aantoont dat het Firestore-documentmodel, Security Rules, export of
statistiekvragen onvoldoende beheersbaar zijn.

## Doelarchitectuur

```text
GitHub -> CI -> Netlify Deploy Preview / productiebuild
                         |
                    Courtside PWA
              Preact UI + application use-cases
                         |
                   repository ports
                         |
          Firebase web-SDK met persistent local cache
                         |
          +--------------+---------------+
          |                              |
  Firebase Authentication       Cloud Firestore
  identiteit en sessie          data, listeners en sync
                                        |
                          Security Rules per organisatie,
                              team, membership en rol
```

Netlify en Firebase zijn onafhankelijke onderdelen. Netlify levert de statische
PWA; Firebase levert identiteit en data. Firebase Hosting is daarom niet nodig
voor de eerste versie en Netlify Functions zijn niet nodig zolang alle
toegestane browsertoegang veilig met Firebase Authentication en Security Rules
kan worden uitgevoerd.

## Waarom Firebase nu de voorkeur heeft

Cloud Firestore kan op het web een persistente lokale cache gebruiken. De app
kan gecachte data offline lezen en lokale writes worden na herstel van de
verbinding gesynchroniseerd. Webpersistentie staat niet standaard aan, wordt
expliciet geconfigureerd en wordt volgens de officiële documentatie ondersteund
in Chrome, Safari en Firefox. Omdat de cache niet automatisch tussen sessies
wordt gewist, vraagt de app vóór activering of dit een vertrouwd apparaat is.

Bronnen:

- [Firestore offline data](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
- [Firebase Authentication voor web](https://firebase.google.com/docs/auth/web/start)
- [Authenticatiesessies bewaren](https://firebase.google.com/docs/auth/web/auth-state-persistence)

De ingebouwde sync neemt niet alle domeinproblemen weg. Meerdere writes naar
hetzelfde document zijn standaard last-write-wins. Daarom wordt een actieve
wedstrijd niet als één steeds overschreven megadocument opgeslagen. Bevestigde
wedstrijdhandelingen worden append-only documenten met een
clientgegenereerde unieke ID. Score, speeltijd en segmentstatus blijven daaruit
reproduceerbaar. De eerste versie houdt daarnaast één actieve scorer aan;
meekijkers zijn read-only en overname is expliciet.

## Authenticatie en autorisatie zijn aparte lagen

Firebase Authentication stelt vast **wie** de gebruiker is. Firestore Security
Rules bepalen vervolgens **welke organisatie, welk team en welke handeling**
die gebruiker mag benaderen. Inloggen is dus nooit op zichzelf toestemming.

Startkeuze:

- e-mail en wachtwoord;
- optioneel Google-login;
- geen telefoon/SMS in de eerste versie;
- geen magic link als standaard op Spark: de huidige Auth-limiet voor verzonden
  sign-in-link-e-mails is vijf per dag; heroverweeg dit alleen na een bewust
  Blaze-/Identity Platform-besluit;
- uitloggen en lokale cache wissen is expliciet beschikbaar op gedeelde
  apparaten.

Een eerste login en het openen van nog nooit gecachte context vereisen netwerk.
Een vooraf geopende en gecachte teamcontext moet daarna offline werken. De app
krijgt daarom een controle vóór de wedstrijd die bevestigt dat account,
teamcontext, roster, instellingen en app-shell lokaal gereed zijn.

## Multi-organisatie is vanaf het begin kernarchitectuur

Eén Firebase-gebruiker heeft één globale identiteit en kan tegelijk lid zijn
van meerdere organisaties en teams, met een andere rol per context. Een
organisatie kan bijvoorbeeld `Rotterdam Basketball` of `Nederlandse
Basketball Bond` voorstellen. Hiervoor wordt geen afzonderlijke Firebase-tenant
of Firebase-project per club gebruikt: iedere omgeving gebruikt één Firebase-
project en de applicatie modelleert organisaties, teams en memberships zelf.

Beoogde Firestore-structuur:

```text
users/{uid}
organizations/{organizationId}
organizations/{organizationId}/organizationMembers/{uid}
organizations/{organizationId}/teams/{teamId}
organizations/{organizationId}/teams/{teamId}/teamMembers/{uid}
organizations/{organizationId}/teams/{teamId}/seasons/{seasonId}
organizations/{organizationId}/teams/{teamId}/settings/current
organizations/{organizationId}/teams/{teamId}/players/{playerId}
organizations/{organizationId}/teams/{teamId}/games/{gameId}
organizations/{organizationId}/teams/{teamId}/games/{gameId}/actions/{actionId}
```

Ieder membershipdocument bevat minimaal `userId`, `role`, `status`,
`invitedAt` en `acceptedAt`. Teamdata wordt altijd via een organisatie- en
teampad benaderd. Security Rules controleren lidmaatschap op een
deterministisch pad. Queries moeten dezelfde organisatie-/teamscope bevatten,
want Firestore Rules zijn geen filters.

Eerste rollen:

| Rol                     | Bevoegdheden                                                    |
| ----------------------- | ---------------------------------------------------------------- |
| `organizationOwner`     | organisatie, eigenaarschap, leden, export en verwijdering        |
| `organizationAdmin`     | teams en memberships beheren, geen eigenaarschap overdragen      |
| `coach`                 | roster, wedstrijden en teaminstellingen beheren                  |
| `scorer`                | wedstrijdacties schrijven, roster niet beheren                   |
| `viewer`                | alleen lezen                                                      |

De contextwisselaar toont uitsluitend toegestane organisatie/teamcombinaties.
Het intrekken van toegang bij de ene organisatie heeft geen invloed op toegang
tot een andere. Tijdens een actieve wedstrijd is de context vergrendeld; wisselen
kan pas na afronden of na een expliciete, sterke bevestiging zonder stille
datamutatie.

## Offline- en synchronisatiecontract

Iedere flow toont één van deze toestanden:

- `Lokaal beschikbaar` — data komt uit de cache en kan verouderd zijn;
- `Wacht op synchronisatie` — lokale writes zijn nog niet serverbevestigd;
- `Gesynchroniseerd` — de server heeft de writes geaccepteerd;
- `Actie nodig` — sync is geweigerd of vraagt een gebruikersbesluit.

Een lokaal geaccepteerde write kan na reconnect alsnog door Security Rules
worden geweigerd, bijvoorbeeld wanneer toegang intussen is ingetrokken. De app
mag zo'n wijziging niet stil verliezen: zij blijft herstelbaar en exporteerbaar
onder `Actie nodig`. Een nog nooit geopende teamcontext toont offline duidelijk
dat internet nodig is; de app presenteert geen lege cache als een leeg team.

## Beveiligingsmodel en verplichte tests

- De browser-Firebaseconfig bevat publieke projectidentificatie en is geen
  geheim; service-accountkeys, Admin SDK-credentials en private keys staan nooit
  in PWA, Git, build-output of logs.
- Alleen owners/admins kunnen uitnodigingen of memberships wijzigen; een client
  kan zichzelf niet promoveren.
- Rules worden in de Firebase Emulator Suite getest met positieve en negatieve
  gevallen. Emulatorgebruik is verplicht voordat een cloud-PR wordt gemerged.
- Organisatie A kan organisatie B niet lezen of schrijven, ook niet via een
  anders samengestelde query.
- Queries worden ontworpen naast Rules; brede queries die hopen dat Rules de
  resultaten filteren zijn niet toegestaan.
- Gebruik uitsluitend fictieve data in emulator, CI en previews.

Bronnen:

- [Security Rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions)
- [Securely query data](https://firebase.google.com/docs/firestore/security/rules-query)
- [Test Security Rules](https://firebase.google.com/docs/rules/unit-tests)

## Productstandaarden zodat bouwen kan starten

Deze standaarden gelden totdat de eigenaar bewust anders besluit:

1. Een nieuwe gebruiker mag na aanmelden één eerste organisatie en team maken;
   extra leden komen via uitnodiging van een owner/admin.
2. E-mail/wachtwoord is verplicht beschikbaar; Google-login is optioneel.
3. Eén actieve scorer bedient een lopende wedstrijd; andere apparaten kijken
   read-only mee en overname is expliciet.
4. Een afgeronde wedstrijd is standaard onveranderlijk. Heropenen is een latere,
   geaudite beheeractie.
5. Sla alleen noodzakelijke spelerdata op: naam, rugnummer, classificatie en de
   bestaande categorievlaggen. Geen geboortedatum of medische gegevens.
6. Development, staging en productie gebruiken afzonderlijke Firebase-projecten.
   Een Deploy Preview wijst nooit naar het productieproject.
7. Cloudmigratie blijft opt-in; de lokale bron en een downloadbare back-up blijven
   beschikbaar totdat cloudbevestiging en herstel zijn bewezen.

## Kosten- en beheerkader

De pilot begint op het Firebase Spark-plan zolang de actuele quota passen. De
officiële Firestore-prijspagina vermeldt voor één gratis database momenteel 1
GiB opslag, 50.000 reads per dag, 20.000 writes per dag, 20.000 deletes per dag
en 10 GiB uitgaand verkeer per maand. Quota en voorwaarden worden in ADR-001
opnieuw vastgelegd, omdat ze kunnen wijzigen. Back-ups, point-in-time recovery,
Cloud Functions of hoger verbruik kunnen een Blaze-account vereisen. Een
budgetwaarschuwing is geen harde uitgavenlimiet; een upgrade gebeurt daarom
alleen na expliciete goedkeuring.

Bronnen:

- [Firebase-prijsplannen](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [Firestore-prijzen en gratis quota](https://firebase.google.com/docs/firestore/pricing)
- [Firebase Authentication-limieten](https://firebase.google.com/docs/auth/limits)

## Waarom Netlify behouden

Netlify past bij de bestaande werkwijze: pushes kunnen Git-gekoppelde builds
starten en pull requests kunnen een Deploy Preview krijgen. Voor de Vite-PWA
worden base directory, buildcommand en publish-directory expliciet vastgelegd.
Firebase SDK's werken gewoon vanuit een door Netlify gehoste browserapp.

- [Vite on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/)
- [Git workflows](https://docs.netlify.com/build/git-workflows/overview/)
- [Deploy Previews](https://docs.netlify.com/deploy/deploy-types/deploy-previews/)

Firebase-webconfig wordt per Netlify-deploycontext beheerd. Hoewel deze config
geen geheim is, voorkomt contextsplitsing dat previews per ongeluk echte
productiedata gebruiken. Een hostingwijziging of deployment blijft een
afzonderlijke expliciete opdracht. Firebase Hosting blijft een technisch
alternatief, niet de eerste keuze.

De bestaande Netlify-account kan een legacyplan hebben wanneer het account vóór
4 september 2025 is aangemaakt; dat wordt in PR 5.5 in de accountinstellingen
geverifieerd. Voor nieuwe credit-based accounts is Free momenteel $0 met 300
credits per maand en een harde limiet zonder automatische bijbetaling. Deploy
Previews zijn ongemeten; een geslaagde productiedeploy kost momenteel 15
credits. De roadmap staat geen betaalde upgrade of auto-recharge toe zonder
expliciete goedkeuring.

- [Netlify credit-based prijsplannen](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)
- [Legacy- en credit-based accounts](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)

## Waarom Supabase de terugvaloptie blijft

Supabase past relationeel beter bij constraints, SQL-statistieken en volledige
exports. Het nadeel voor deze app is dat de browserclient geen gelijkwaardige,
ingebouwde offline schrijfsynchronisatie levert; IndexedDB, outbox,
idempotency, revisies en conflictherstel moeten dan zelf worden gebouwd. Kies
Supabase alleen als de Firebase-pilot één van deze harde gates niet haalt:

- Security Rules en queries kunnen de multi-organisatie-isolatie niet eenvoudig
  en testbaar afdwingen;
- append-only wedstrijdacties leveren geen betrouwbaar offline herstel;
- benodigde statistiek-, export- of verwijderflows worden aantoonbaar
  onbeheerbaar of te duur;
- een volledige organisatie-export en platformexit zijn niet reproduceerbaar.

Bij terugval worden actuele Supabase-breaking changes opnieuw gecontroleerd en
worden publishable keys plus geteste Row Level Security gebruikt; een secret of
`service_role`-sleutel komt nooit in de browser.

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase breaking changes](https://supabase.com/changelog?types=breaking-change)

## Gates voor definitieve acceptatie

De platformpilot gebruikt alleen fictieve data en bewijst minimaal:

- één gebruiker met verschillende rollen bij twee organisaties en meerdere
  teams;
- de contextwisselaar toont uitsluitend geautoriseerde contexten;
- intrekken van toegang tot Rotterdam verwijdert geen toegang tot de NBB;
- een `viewer` schrijft niet, een `scorer` schrijft alleen wedstrijdacties, een
  `coach` beheert het team en een owner/admin beheert memberships;
- niemand kan zichzelf promoveren en organisatie A kan organisatie B niet lezen;
- een vooraf gecacht team blijft offline bruikbaar; een ongecachet team vraagt
  duidelijk om internet;
- settings/roster wijzigen offline, overleven reload en verschijnen na reconnect
  exact één keer op apparaat B;
- een na intrekking geweigerde queued write wordt `Actie nodig` en blijft lokaal
  exporteerbaar;
- een actieve wedstrijd houdt dezelfde organisatie/teamcontext;
- kosten, regio, DPA, export, verwijdering, back-up en herstel zijn beoordeeld.

## Besluitadvies

Ga verder met **Netlify + Firebase Authentication + Cloud Firestore** als
voorkeursroute. Bouw eerst PR 3.2a-c zonder backend. Leg daarna ADR-001 t/m
ADR-003 vast en voer de beperkte Firebase-pilot uit. Begin pas aan de overige
wedstrijdschermen wanneer offline herstel, multi-organisatie-isolatie,
rolbeveiliging en twee-apparatensynchronisatie aantoonbaar werken. Als een harde
gate faalt, stop dan vóór verdere productbouw en voer dezelfde pilot met
Supabase uit.
