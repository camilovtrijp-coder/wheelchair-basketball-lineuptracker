export const LANG_STORAGE_KEY = 'lineup-tracker-lang';

export const SUPPORTED_LANGS = ['nl', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

export const DEFAULT_LANG: Lang = 'nl';

const nl = {
  switchToEn: 'Schakel naar Engels',
  switchToNl: 'Schakel naar Nederlands',

  appNameFallback: 'Lineup Tracker',
  settingsTitle: 'Instellingen',
  settingsOpen: '⚙ Instellingen',
  settingsSectionClub: 'Club',
  settingsSectionMatch: 'Wedstrijd',
  settingsSectionClass: 'Classificatie',
  teamNameLabel: 'Teamnaam',
  logoLabel: 'Logo',
  logoChooseBtn: 'Logo kiezen',
  logoRemoveBtn: 'Logo verwijderen',
  primaryColorLabel: 'Primaire kleur',
  accentColorLabel: 'Accentkleur (tegenstander)',
  quarterCountLabel: 'Aantal periodes',
  quarterLabel: 'Kwart',
  periodLabelLabel: 'Naam periode',
  useClassLimitLabel: 'Classificatiesysteem gebruiken',
  toggleTag1Default: 'Categorie 1',
  tag1LabelLabel: 'Label categorie 1',
  tag1LabelHint: 'bijv. Vrouw',
  toggleTag2Default: 'Categorie 2',
  tag2LabelLabel: 'Label categorie 2',
  tag2LabelHint: 'bijv. Jeugd/U19',
  classBaseLimitSettingLabel: 'Basis classificatie (standaardwaarde)',
  maxBonusLabel: 'Maximale bonus',
  bonusTag1OnlyLabel: 'Bonus bij categorie 1',
  bonusTag2OnlyLabel: 'Bonus bij categorie 2',
  bonusBothLabel: 'Bonus bij beide categorieën',
  classLimitExplain:
    'Dit systeem beperkt de totale classificatie van de 5 spelers op de vloer, met een bonus voor twee optionele categorieën - oorspronkelijk bedacht als categorie 1 = Vrouw en categorie 2 = Jeugd/U19, om gemixte en jonge line-ups te stimuleren. Je kunt de labels en bonuswaarden hieronder naar wens aanpassen.',
  customColorBtn: 'Aangepast',
  saveBtn: 'Opslaan',
  settingsResetBtn: 'Standaardinstellingen herstellen',
  logoTooLargeError: 'Logo is te groot (max 500 KB). Kies een kleinere afbeelding.',
  settingsSaveError: 'Opslaan is mislukt. Controleer de opslagruimte van je browser.',
} as const;

const en = {
  switchToEn: 'Switch to English',
  switchToNl: 'Switch to Dutch',

  appNameFallback: 'Lineup Tracker',
  settingsTitle: 'Settings',
  settingsOpen: '⚙ Settings',
  settingsSectionClub: 'Club',
  settingsSectionMatch: 'Match',
  settingsSectionClass: 'Classification',
  teamNameLabel: 'Team name',
  logoLabel: 'Logo',
  logoChooseBtn: 'Choose logo',
  logoRemoveBtn: 'Remove logo',
  primaryColorLabel: 'Primary color',
  accentColorLabel: 'Accent color (opponent)',
  quarterCountLabel: 'Number of periods',
  quarterLabel: 'Quarter',
  periodLabelLabel: 'Period name',
  useClassLimitLabel: 'Use classification system',
  toggleTag1Default: 'Category 1',
  tag1LabelLabel: 'Category 1 label',
  tag1LabelHint: 'e.g. Female',
  toggleTag2Default: 'Category 2',
  tag2LabelLabel: 'Category 2 label',
  tag2LabelHint: 'e.g. Youth/U19',
  classBaseLimitSettingLabel: 'Base classification (default value)',
  maxBonusLabel: 'Max bonus',
  bonusTag1OnlyLabel: 'Bonus for category 1',
  bonusTag2OnlyLabel: 'Bonus for category 2',
  bonusBothLabel: 'Bonus for both categories',
  classLimitExplain:
    'This system caps the total classification of the 5 players on court, with a bonus for two optional categories - originally conceived as category 1 = Female and category 2 = Youth/U19, to encourage mixed and young lineups. You can adjust the labels and bonus values below as you like.',
  customColorBtn: 'Custom',
  saveBtn: 'Save',
  settingsResetBtn: 'Reset to defaults',
  logoTooLargeError: 'Logo is too large (max 500 KB). Choose a smaller image.',
  settingsSaveError: "Saving failed. Check your browser's storage space.",
} as const;

export const STRINGS = { nl, en } as const;

export type StringKey = keyof typeof nl;

export function isValidLang(value: unknown): value is Lang {
  return value === 'nl' || value === 'en';
}

export function translate(lang: Lang, key: StringKey): string {
  return STRINGS[lang][key];
}
