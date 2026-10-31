/**
 * Vertalingen van de Trends-weergave Overzicht, onderdeel T6 (classificatieprofiel,
 * tijd over de limiet en datakwaliteitswaarschuwingen). Eigen bestand zodat
 * parallelle weergaven hun eigen vertalingen houden; alle sleutels beginnen met
 * `trendsOverview`. `strings.ts` spreidt `trendsOverviewNl`/`trendsOverviewEn`,
 * dus de pariteitstest in `tests/unit/i18n.spec.ts` dekt dit bestand ook.
 *
 * Plaatshouders: `{games}`, `{time}`, `{n}`, enz. worden in de UI ingevuld.
 */

export const trendsOverviewNl = {
  // ---- Classificatie en resultaat ----
  trendsOverviewClassTitle: 'Classificatie en resultaat',
  trendsOverviewClassMeta: 'Gebaseerd op {games} met klassegrens (grens met bonus).',
  trendsOverviewClassListLabel: 'Resultaat per klassegroep',
  trendsOverviewClassFull: 'Op de grens',
  trendsOverviewClassFullHelp:
    'De vijf op het veld gebruiken de klassegrens vrijwel volledig: 0 tot en met 0,5 punt ruimte.',
  trendsOverviewClassSlack: 'Ruimte over',
  trendsOverviewClassSlackHelp: 'Er blijft meer dan 0,5 punt van de klassegrens ongebruikt.',
  trendsOverviewClassOver: 'Over de grens',
  trendsOverviewClassOverHelp:
    'De som van de klassen ligt boven de klassegrens. Dat hoort regeltechnisch niet voor te komen.',
  trendsOverviewClassTooLittle: 'Te weinig data',
  trendsOverviewClassTooLittleRaw: '{pm} in {time}, onder de drempel van {threshold}',
  trendsOverviewClassNoTime: 'Geen speeltijd',
  trendsOverviewClassNote:
    'Beschrijvend, geen oorzaak: dit toont wat er gebeurde als de vijf op het veld de klassegrens volledig, deels of te veel gebruikten, niet waarom. Per 10 min is geen balbezitcorrectie. De toon vergelijkt met het team over alle gekozen wedstrijden.',
  trendsOverviewClassSkippedOne:
    '1 segment met ongeldige of ontbrekende klassegegevens is overgeslagen.',
  trendsOverviewClassSkippedMany:
    '{n} segmenten met ongeldige of ontbrekende klassegegevens zijn overgeslagen.',

  // ---- Tijd over de limiet ----
  trendsOverviewOverLimitTitle: 'Tijd over de limiet',
  trendsOverviewOverLimitIntro:
    'Over de klassegrens spelen mag regeltechnisch niet. In de data is dit meestal een invoerfout, bijvoorbeeld een verkeerde klasse of een niet vastgelegde wissel. Controleer de genoemde wedstrijden.',
  trendsOverviewOverLimitListLabel: 'Tijd over de limiet per wedstrijd',
  trendsOverviewOverLimitIn: '{time} in {n} van {total} segmenten',
  trendsOverviewOverLimitNone: 'geen',

  // ---- Datakwaliteit ----
  trendsOverviewQualityTitle: 'Datakwaliteit',
  trendsOverviewQualityIntro:
    'Informatief, er wordt niets geblokkeerd. Deze punten kunnen de cijfers vertekenen.',
  trendsOverviewQualityListLabel: 'Datakwaliteitswaarschuwingen',
  trendsOverviewQualityToggle: 'Toon {n} waarschuwingen',
  trendsOverviewWarnQuarterAll: 'Kwart {quarter} heeft in geen enkele wedstrijd een segment.',
  trendsOverviewWarnQuarterSome: 'Kwart {quarter} heeft geen segment in {games}.',
  trendsOverviewWarnPlaytime: '{game}: speeltijd {time} (minder dan {expected}).',
  trendsOverviewWarnZeroOne: '1 segment van 0 seconden in {games}.',
  trendsOverviewWarnZeroMany: '{n} segmenten van 0 seconden in {games}.',
  trendsOverviewWarnTurnovers:
    'Geen turnovers vastgelegd in {games}; turnovercijfers zijn daar onvolledig.',
  trendsOverviewWarnPartialOne:
    '1 segment met onbekende spelers is uitgesloten van de berekeningen ({games}).',
  trendsOverviewWarnPartialMany:
    '{n} segmenten met onbekende spelers zijn uitgesloten van de berekeningen ({games}).',
} as const;

export const trendsOverviewEn = {
  // ---- Classification and result ----
  trendsOverviewClassTitle: 'Classification and result',
  trendsOverviewClassMeta: 'Based on {games} with class limit (limit with bonus).',
  trendsOverviewClassListLabel: 'Result per class group',
  trendsOverviewClassFull: 'At the limit',
  trendsOverviewClassFullHelp:
    'The five on court use the class limit almost fully: 0 up to and including 0.5 points of room.',
  trendsOverviewClassSlack: 'Room to spare',
  trendsOverviewClassSlackHelp: 'More than 0.5 points of the class limit is left unused.',
  trendsOverviewClassOver: 'Over the limit',
  trendsOverviewClassOverHelp:
    'The class total is above the class limit. This should not happen under the rules.',
  trendsOverviewClassTooLittle: 'Too little data',
  trendsOverviewClassTooLittleRaw: '{pm} in {time}, below the threshold of {threshold}',
  trendsOverviewClassNoTime: 'No playing time',
  trendsOverviewClassNote:
    'Descriptive, not a cause: this shows what happened when the five on court used the class limit fully, partly or too much, not why. Per 10 min is not a possession correction. The tone compares with the team over all selected games.',
  trendsOverviewClassSkippedOne: '1 segment with invalid or missing class data was skipped.',
  trendsOverviewClassSkippedMany: '{n} segments with invalid or missing class data were skipped.',

  // ---- Time over the limit ----
  trendsOverviewOverLimitTitle: 'Time over the limit',
  trendsOverviewOverLimitIntro:
    'Playing over the class limit is not allowed under the rules. In the data this is usually an entry error, for example a wrong class or a substitution that was not recorded. Check the games listed.',
  trendsOverviewOverLimitListLabel: 'Time over the limit per game',
  trendsOverviewOverLimitIn: '{time} in {n} of {total} segments',
  trendsOverviewOverLimitNone: 'none',

  // ---- Data quality ----
  trendsOverviewQualityTitle: 'Data quality',
  trendsOverviewQualityIntro:
    'Informational, nothing is blocked. These points can distort the numbers.',
  trendsOverviewQualityListLabel: 'Data quality warnings',
  trendsOverviewQualityToggle: 'Show {n} warnings',
  trendsOverviewWarnQuarterAll: 'Quarter {quarter} has no segment in any game.',
  trendsOverviewWarnQuarterSome: 'Quarter {quarter} has no segment in {games}.',
  trendsOverviewWarnPlaytime: '{game}: playing time {time} (less than {expected}).',
  trendsOverviewWarnZeroOne: '1 segment of 0 seconds in {games}.',
  trendsOverviewWarnZeroMany: '{n} segments of 0 seconds in {games}.',
  trendsOverviewWarnTurnovers: 'No turnovers recorded in {games}; turnover figures are incomplete.',
  trendsOverviewWarnPartialOne:
    '1 segment with unknown players is excluded from the calculations ({games}).',
  trendsOverviewWarnPartialMany:
    '{n} segments with unknown players are excluded from the calculations ({games}).',
} as const;
