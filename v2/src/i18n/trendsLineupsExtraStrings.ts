/**
 * Vertalingen van de extra Lineups-kaarten (plan docs/pr-trends-lineups-plan.md,
 * T7): sorteeroptie "voorzichtig" (gedempte waarde), beste en slechtste
 * duo's/trio's, start- en sluitlineup en de consistentieregel. Eigen bestand
 * zodat parallelle stappen `trendsStrings.ts` niet hoeven te delen. Alle
 * sleutels beginnen met `trendsLineupsExtra`; `strings.ts` spreidt deze
 * objecten in `nl` en `en`, dus `tests/unit/i18n.spec.ts` bewaakt de pariteit.
 *
 * Plaatshouders ({n}, {x}, {min}, ...) worden in de UI ingevuld.
 */

export const trendsLineupsExtraNl = {
  // ---- Sorteeroptie (gedempte waarde) ----
  trendsLineupsExtraSortLabel: 'Sorteer',
  trendsLineupsExtraSortValue: 'Waarde',
  trendsLineupsExtraSortCareful: 'Voorzichtig',
  trendsLineupsExtraSortBadge: 'volgorde: voorzichtig',
  trendsLineupsExtraSortExplain:
    'Voorzichtig = alsof de lineup nog 10 minuten gelijk speelde; korte lineups tellen daardoor minder zwaar.',
  trendsLineupsExtraSortShown: 'De getoonde waarde blijft de gewone; alleen de volgorde verandert.',

  // ---- Consistentie ----
  trendsLineupsExtraConsistency: '{x} van {n} wedstrijden positief',
  trendsLineupsExtraConsistencyOne: '{x} van 1 wedstrijd positief',
  trendsLineupsExtraSmallN: '(n klein)',
  trendsLineupsExtraConsistencyNote:
    'Positief = de lineup had in die wedstrijd een +/- boven 0. Het aantal wedstrijden (n) is klein: lees dit als een indruk, niet als zekerheid.',

  // ---- Beste en slechtste duo's/trio's ----
  trendsLineupsExtraComboTitle: "Beste en slechtste duo's/trio's",
  trendsLineupsExtraComboSizeLabel: 'Combinatiegrootte',
  trendsLineupsExtraComboDuos: "Duo's",
  trendsLineupsExtraComboTrios: "Trio's",
  trendsLineupsExtraComboKindDuo: 'Duo',
  trendsLineupsExtraComboKindTrio: 'Trio',
  trendsLineupsExtraComboHint:
    '+/- per 10 min, alleen combinaties met minstens {min} samen op het veld in de gekozen wedstrijden. Beschrijvend, geen voorspelling. De toon volgt het teken van +/- per 10 min (teamgemiddelde {team}).',
  trendsLineupsExtraComboBest: 'Beste 3',
  trendsLineupsExtraComboWorst: 'Slechtste 3',
  trendsLineupsExtraComboNoWorst: 'Geen aparte slechtste combinaties: alle staan al bij de beste.',
  trendsLineupsExtraComboEmptyDuos: "Te weinig data voor duo's boven {min}",
  trendsLineupsExtraComboEmptyTrios: "Te weinig data voor trio's boven {min}",
  trendsLineupsExtraComboExcluded:
    'Combinaties die altijd samen speelden zijn weggelaten: ze zeggen niets onderscheidends.',
  trendsLineupsExtraComboExcludedCount: 'Weggelaten: {n}.',
  trendsLineupsExtraComboAria: '{kind} {lineup}: {time}, {value} per 10 minuten, {tone}',

  // ---- Start- en sluitlineup ----
  trendsLineupsExtraStartCloseTitle: 'Start- en sluitlineup',
  trendsLineupsExtraStartTitle: 'Startlineup (begin kwart 1)',
  trendsLineupsExtraCloseTitle: 'Sluitlineup (einde laatste kwart)',
  trendsLineupsExtraStartCloseExplain:
    'Per wedstrijd is dit één segment: het eerste van kwart 1 en het laatste van het laatste kwart. Het zegt dus pas iets over veel wedstrijden. Alleen minuten en totaal, geen oordeel.',
  trendsLineupsExtraStartCloseEmpty: 'Nog geen start- of sluitlineups in de gekozen wedstrijden.',
  trendsLineupsExtraStartCloseNoSide: 'Geen gegevens',
  trendsLineupsExtraStartCloseMore: '+ {n} andere lineups',
  trendsLineupsExtraUnreliableOne:
    'Volgorde onzeker in 1 wedstrijd (overlappende segmenten of gemengde klokrichting): start en sluit zijn daar een beste gok.',
  trendsLineupsExtraUnreliableMany:
    'Volgorde onzeker in {n} wedstrijden (overlappende segmenten of gemengde klokrichting): start en sluit zijn daar een beste gok.',
  trendsLineupsExtraStartCloseAria: '{lineup}: {time}, totaal {pm}, {games}',
} as const;

export const trendsLineupsExtraEn = {
  // ---- Sort option (damped value) ----
  trendsLineupsExtraSortLabel: 'Sort',
  trendsLineupsExtraSortValue: 'Value',
  trendsLineupsExtraSortCareful: 'Careful',
  trendsLineupsExtraSortBadge: 'order: careful',
  trendsLineupsExtraSortExplain:
    'Careful = as if the lineup had played another 10 minutes at an even score; short lineups therefore weigh less.',
  trendsLineupsExtraSortShown: 'The value shown stays the regular one; only the order changes.',

  // ---- Consistency ----
  trendsLineupsExtraConsistency: '{x} of {n} games positive',
  trendsLineupsExtraConsistencyOne: '{x} of 1 game positive',
  trendsLineupsExtraSmallN: '(small n)',
  trendsLineupsExtraConsistencyNote:
    'Positive = the lineup had a +/- above 0 in that game. The number of games (n) is small: read this as an impression, not as certainty.',

  // ---- Best and worst pairs/trios ----
  trendsLineupsExtraComboTitle: 'Best and worst pairs/trios',
  trendsLineupsExtraComboSizeLabel: 'Combination size',
  trendsLineupsExtraComboDuos: 'Pairs',
  trendsLineupsExtraComboTrios: 'Trios',
  trendsLineupsExtraComboKindDuo: 'Pair',
  trendsLineupsExtraComboKindTrio: 'Trio',
  trendsLineupsExtraComboHint:
    '+/- per 10 min, only combinations with at least {min} together on court in the selected games. Descriptive, not a prediction. The tone follows the sign of +/- per 10 min (team average {team}).',
  trendsLineupsExtraComboBest: 'Best 3',
  trendsLineupsExtraComboWorst: 'Worst 3',
  trendsLineupsExtraComboNoWorst: 'No separate worst combinations: all are already among the best.',
  trendsLineupsExtraComboEmptyDuos: 'Too little data for pairs above {min}',
  trendsLineupsExtraComboEmptyTrios: 'Too little data for trios above {min}',
  trendsLineupsExtraComboExcluded:
    'Combinations that always played together are left out: they tell nothing distinctive.',
  trendsLineupsExtraComboExcludedCount: 'Left out: {n}.',
  trendsLineupsExtraComboAria: '{kind} {lineup}: {time}, {value} per 10 minutes, {tone}',

  // ---- Starting and closing lineup ----
  trendsLineupsExtraStartCloseTitle: 'Starting and closing lineup',
  trendsLineupsExtraStartTitle: 'Starting lineup (start of quarter 1)',
  trendsLineupsExtraCloseTitle: 'Closing lineup (end of the last quarter)',
  trendsLineupsExtraStartCloseExplain:
    'Per game this is one segment: the first of quarter 1 and the last of the last quarter. It only says something over many games. Minutes and total only, no verdict.',
  trendsLineupsExtraStartCloseEmpty: 'No starting or closing lineups in the selected games yet.',
  trendsLineupsExtraStartCloseNoSide: 'No data',
  trendsLineupsExtraStartCloseMore: '+ {n} other lineups',
  trendsLineupsExtraUnreliableOne:
    'Order uncertain in 1 game (overlapping segments or mixed clock direction): start and close are a best guess there.',
  trendsLineupsExtraUnreliableMany:
    'Order uncertain in {n} games (overlapping segments or mixed clock direction): start and close are a best guess there.',
  trendsLineupsExtraStartCloseAria: '{lineup}: {time}, total {pm}, {games}',
} as const;
