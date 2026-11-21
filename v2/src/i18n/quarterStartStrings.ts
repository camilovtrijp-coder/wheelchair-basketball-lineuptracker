/**
 * Teksten van de keuze van de opstelling voor het volgende kwart (bouwplan R3), bij Einde
 * kwart in Snel en Rustig. Eigen bestand met prefix `quarterStart*`; `strings.ts` spreidt
 * `quarterStartNl`/`quarterStartEn` append-only in `nl` en `en`. De pariteitstest in
 * `tests/unit/i18n.spec.ts` dekt dit bestand ook.
 */

export const quarterStartNl = {
  quarterStartTitle: 'Opstelling {period} {n}',
  quarterStartField: 'Zoals het veld nu staat',
  quarterStartPlan: 'Volgens het wisselschema',
  quarterStartCustom: 'Zelf samenstellen',
  quarterStartNoChange: 'Geen wissel t.o.v. het veld',
  quarterStartClass: 'klasse {sum} / {allowed}',
  quarterStartOver: 'te hoog, mag wel',
  quarterStartCustomCount: '{n} van 5 gekozen',
  quarterStartCustomHint: 'Tik precies 5 spelers aan. Het veld verandert pas bij Afsluiten.',
  quarterStartCustomNeed: 'Kies precies 5 spelers.',
} as const;

export const quarterStartEn = {
  quarterStartTitle: 'Lineup {period} {n}',
  quarterStartField: 'As the court is now',
  quarterStartPlan: 'According to the rotation plan',
  quarterStartCustom: 'Build my own',
  quarterStartNoChange: 'No change from the court',
  quarterStartClass: 'class {sum} / {allowed}',
  quarterStartOver: 'too high, allowed',
  quarterStartCustomCount: '{n} of 5 chosen',
  quarterStartCustomHint: 'Tap exactly 5 players. The court only changes when you close.',
  quarterStartCustomNeed: 'Choose exactly 5 players.',
} as const;
