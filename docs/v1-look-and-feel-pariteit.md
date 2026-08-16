# v1 look-and-feel-pariteit — criteria voor de uiteindelijke v2-uitrol

Status: **verzamelfase, groeit met elke aangeleverde batch v1-screenshots.**
Dit document verzamelt bewuste ontwerp-/UX-verschillen tussen de nog
live v1-app en de huidige v2-opbouw — geen bugs (die staan in
`docs/pr-5.5c-bugfixes.md`), maar **criteria voor de uiteindelijke
v2-app**, omdat de eigenaar v1's look-and-feel expliciet goed vond en
als referentie wil gebruiken. Losstaand van 5.5/5.5c; dit werk loopt
door terwijl v2 verder ontwikkeld en getest wordt.

**Nog te doen**: de v1-URL zelf live doorlopen (deze sandbox heeft een
browser beschikbaar) zodra die met de sessie gedeeld is, voor een
systematischer, zelf-uitgevoerd onderzoek naast de aangeleverde
screenshots.

## Expliciet criterium (eigenaarsbesluit)

**Licht/donker als instelbare modus, niet als vervanging.** v1's
donkere thema mag niet zomaar v2's huidige lichte thema overschrijven —
de uiteindelijke app moet **beide** bieden, gebruikersinstelbaar (zelfde
soort losstaande instelling als de bestaande NL/EN-taalwissel in de
header). Vereist dus een eigen thema-token-laag (licht + donker
kleurenschema, geen hardcoded kleuren per component) met een
gebruikersinstelling die het gekozen thema onthoudt — niet alleen
"volg systeeminstelling" zonder eigen toggle.

## Algemene waarnemingen (uit meerdere screenshots)

1. **Donker thema als standaard in v1** — v1 is overal donkerblauw/zwart
   met groen/teal/oranje accenten. v2 is in alle tot nu toe geziene
   schermen licht/wit. Zie het expliciete criterium hierboven: dit wordt
   een instelbare modus, geen simpele vervanging van v2's huidige thema.
2. **Kleuren worden functioneel gebruikt, niet alleen decoratief**: groen
   = eigen team/positief, oranje = tegenstander, rood/roze = negatief,
   teal/cyaan = secundaire metriek (minuten). Dit is precies waarom bug
   10 (teamkleuren zonder visueel effect) een echte regressie is — v1
   toont dat kleurgebruik het hele scherm doortrekt, niet alleen de
   score-knoppen.
3. **Onderaan een vaste navigatiebalk** (Team/Wedstrijd/Stats/Trends/
   Historie, met pictogram + label, actieve tab groen gemarkeerd) i.p.v.
   v2's bovenaan-tabs.
4. **Ronde, "gloeiende" knopstijl** met een lichte gloed/schaduw rond
   primaire acties (Opslaan, Start wedstrijd, Segment opslaan) — v2's
   knoppen zijn vlakker.
5. **Instellingen als modal-overlay** (met X-sluitknop, dus expliciet
   "sluiten" i.p.v. terugnavigeren) i.p.v. een eigen volledige-pagina-tab.

## Per scherm

### Team-tab (roster)
- Kaartlayout per speler: rugnummer + naam op één regel, klasse-waarde en
  twee classificatie-toggles (bijv. "Vrouw"/"Jeugd") op de regel eronder.
- **Classificatie-toggles hebben een eigen kleur per actieve categorie**
  (bijv. roze/magenta-rand voor "Vrouw" actief, teal-rand voor "Jeugd"
  actief) — in v2 zagen we tot nu toe alleen neutrale grijze
  outline-knoppen voor deze toggles, geen categoriegebonden kleur.
- "+ Speler toevoegen" onderaan de lijst, buiten de kaarten.

### Instellingen (modal)
- Club-sectie: teamnaam, logo (kiezen + verwijderen als los knoppenpaar),
  primaire/accentkleur als kleurenpalet (7 presets + 2 recent-gebruikte
  "geheugen"-swatches + een "Aangepast"-knop) — v2 heeft 10 presets maar
  geen recent-gebruikte-geheugenswatches.
- Wedstrijd-sectie (aantal periodes/naam periode) en Classificatie-sectie
  qua velden functioneel gelijk aan v2.

### Wedstrijdopzet
- Per speler één rij met **twee losse toggleknoppen naast elkaar**:
  "Meedoen" (groen met vinkje wanneer actief) en "Start" (voor starters
  kiezen) — compacter dan wat we tot nu toe van v2's opzetscherm zagen.
- Tegenstander/Competitie als losse, duidelijk "Optioneel"-gelabelde
  velden.
- Een aparte **"Wedstrijdklok telt af (10:00 → 0:00)"-toggle** (aftellen
  vs. aflopen) zichtbaar vóór het starten.
- Groot, fel-groen "Start wedstrijd"-knop.

### Live wedstrijd (scoren/wisselen)
- Score-knoppen (+1/+2/+3) in de eigen teamkleur (groen) resp.
  tegenstanderkleur (oranje) — zie bug 10.
- **Wissel-flow met directe visuele feedback**: de gekozen speler krijgt
  een groene gloeirand, een groene banner verschijnt ("Ilias #10
  gekozen — tik de speler om mee te ruilen"), met expliciete
  "✓ Klaar met wisselen — kloktijd"/"Annuleer"-knoppen. Nog niet
  vergeleken met hoe v2's wisselflow er live uitziet (nog niet apart
  getest/gescreenshot in deze sessie).
- "Segment vastleggen": kwartselectie als knoppenrij (actief kwart groen
  omrand), begin-/eindtijd als getalvelden, live "Speeltijd dit segment"-
  berekening, groene "Segment opslaan (+/- ±N)"-knop die het effect al in
  het label toont.

### Historie
- Lijst: naam tegenstander, datum + competitie, eindstand met een groene
  bolletje-indicator, chevron.
- Detail: chronologische segmentenlijst in het formaat
  "Q1 <opstelling> <tijd> <±delta>" met delta groen/rood gekleurd, rode
  "Verwijderen"-knop rechtsboven, groene "Deel/download CSV"-knop
  onderaan.

### Trends
- Per-speler-kaarten met een **gekleurde lijngrafiek** ("+/- per
  wedstrijd", groen) en een **gekleurde staafgrafiek** ("Minuten per
  wedstrijd", teal), plus een in-/uitklapbare wedstrijdenlijst eronder.
- Filter-/sorteerknoppenrij bovenaan (kwartselectie 1-5, "+/- ↓", "Per 10
  min", "Wedstrijden (N)", "Sorteer: Nr").

### Stats
- Lineup-combinaties (2-koppige subsets) met "Met hen"/"Zonder hen" als
  gekleurde pillen (groen positief, rood/roze negatief), plus Tijd/Pnt/
  Teg-kolommen.
- Zelfde filter-/sorteerbalk als Trends (kwartselectie, "+/- ↓", "Per 10
  min", "Wedstrijden (N)", "Filter spelers").

## Cross-references

- `docs/pr-5.5c-bugfixes.md` bug 10 (teamkleuren zonder visueel effect in
  v2) — direct gerelateerd, mogelijk dezelfde implementatiestap lost
  meerdere punten hierboven tegelijk op (bijv. een thema-/kleurenlaag op
  basis van `settings.primaryColor`/`accentColor`).
- `docs/pr-5.5-onderzoeksrapport.md` — de staging-omgeving waarop v2
  momenteel getest wordt.
