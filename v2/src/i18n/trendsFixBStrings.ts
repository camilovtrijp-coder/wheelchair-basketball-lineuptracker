/**
 * Vertalingen van de review-fixes (set B) op de Trends-bundel. Eigen bestand met
 * eigen prefix `trendsFixB*`; `strings.ts` spreidt `trendsFixBNl`/`trendsFixBEn`
 * append-only in `nl` en `en`. De pariteitstest in `tests/unit/i18n.spec.ts`
 * dekt dit bestand ook.
 */

export const trendsFixBNl = {
  // Lineups: sortering in Totaal en turnovers altijd per 10 min.
  trendsFixBHintPmTotal:
    'Hoogste is het beste. Gesorteerd op het totaal; bij gelijk eerst de meeste minuten.',
  trendsFixBHintPfPaTotal:
    'Voor: hoger is beter. Tegen: lager is beter. Gesorteerd op voor min tegen (totaal); bij gelijk eerst de meeste minuten.',
  trendsFixBTovHint: 'Laagste is het beste. Altijd per 10 min, ook bij "Totaal".',
  trendsFixBTovCount: 'Turnovers: {n}',
  // Kwarten: onder de drempel alleen het ruwe totaal.
  trendsFixBQuarterLow: 'te weinig data',
  trendsFixBQuarterLowAria: 'Kwart {n}, {value} in {time}, te weinig data, geen oordeel',
} as const;

export const trendsFixBEn = {
  trendsFixBHintPmTotal: 'Highest is best. Sorted by the total; ties go to the most minutes first.',
  trendsFixBHintPfPaTotal:
    'For: higher is better. Against: lower is better. Sorted by for minus against (total); ties go to the most minutes first.',
  trendsFixBTovHint: 'Lowest is best. Always per 10 min, also in "Total".',
  trendsFixBTovCount: 'Turnovers: {n}',
  trendsFixBQuarterLow: 'too little data',
  trendsFixBQuarterLowAria: 'Quarter {n}, {value} in {time}, too little data, no judgement',
} as const;
