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

  rosterTitle: 'Team',
  rosterIntro:
    'Beheer hier je spelerslijst: rugnummer, naam en — als je het classificatiesysteem gebruikt (instellingen) — een classificatiewaarde en categorieën.',
  playerNrLabel: 'Rugnummer',
  playerNameLabel: 'Naam',
  playerClassLabel: 'Klasse',
  addPlayerBtn: '+ Speler toevoegen',
  removePlayerBtn: 'Verwijderen',
  confirmDeletePlayer: 'Deze speler definitief verwijderen? Dit kan niet ongedaan worden gemaakt.',
  dupNumberWarningLabel: '⚠ Dubbel rugnummer:',
  rosterSaveError: 'Opslaan is mislukt. Controleer de opslagruimte van je browser.',

  authLoadingTitle: 'Bezig met laden…',
  authEmailLabel: 'E-mailadres',
  authPasswordLabel: 'Wachtwoord',
  authLoginTitle: 'Inloggen',
  authLoginBtn: 'Inloggen',
  authSignupTitle: 'Account aanmaken',
  authSignupBtn: 'Account aanmaken',
  authSwitchToSignupPrompt: 'Nog geen account?',
  authSwitchToSignupBtn: 'Account aanmaken',
  authSwitchToLoginPrompt: 'Al een account?',
  authSwitchToLoginBtn: 'Inloggen',
  authSignOutBtn: 'Uitloggen',
  authInvalidCredentialError: 'Onjuist e-mailadres of wachtwoord.',
  authEmailInUseError: 'Er bestaat al een account voor dit e-mailadres.',
  authWeakPasswordError: 'Kies een wachtwoord van minstens 6 tekens.',
  authInvalidEmailError: 'Vul een geldig e-mailadres in.',
  authGenericError: 'Er ging iets mis. Probeer het opnieuw.',

  trustedDevicePromptTitle: 'Is dit een vertrouwd apparaat?',
  trustedDevicePromptBody:
    'Op een vertrouwd apparaat (bijv. je eigen telefoon of laptop) blijven gegevens lokaal beschikbaar, ook offline. Op een gedeeld apparaat (bijv. een clubtablet) worden je gegevens bij het uitloggen automatisch gewist.',
  trustedDeviceYesBtn: 'Ja, vertrouwd apparaat',
  trustedDeviceNoBtn: 'Nee, gedeeld apparaat',
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

  rosterTitle: 'Team',
  rosterIntro:
    'Manage your player roster here: shirt number, name and — if you use the classification system (settings) — a classification value and categories.',
  playerNrLabel: 'Shirt number',
  playerNameLabel: 'Name',
  playerClassLabel: 'Class',
  addPlayerBtn: '+ Add player',
  removePlayerBtn: 'Remove',
  confirmDeletePlayer: 'Permanently delete this player? This cannot be undone.',
  dupNumberWarningLabel: '⚠ Duplicate shirt number:',
  rosterSaveError: "Saving failed. Check your browser's storage space.",

  authLoadingTitle: 'Loading…',
  authEmailLabel: 'Email address',
  authPasswordLabel: 'Password',
  authLoginTitle: 'Log in',
  authLoginBtn: 'Log in',
  authSignupTitle: 'Create account',
  authSignupBtn: 'Create account',
  authSwitchToSignupPrompt: "Don't have an account yet?",
  authSwitchToSignupBtn: 'Create one',
  authSwitchToLoginPrompt: 'Already have an account?',
  authSwitchToLoginBtn: 'Log in',
  authSignOutBtn: 'Log out',
  authInvalidCredentialError: 'Incorrect email address or password.',
  authEmailInUseError: 'An account already exists for this email address.',
  authWeakPasswordError: 'Choose a password of at least 6 characters.',
  authInvalidEmailError: 'Enter a valid email address.',
  authGenericError: 'Something went wrong. Please try again.',

  trustedDevicePromptTitle: 'Is this a trusted device?',
  trustedDevicePromptBody:
    'On a trusted device (e.g. your own phone or laptop), data stays available locally, even offline. On a shared device (e.g. a club tablet), your data is automatically wiped when you log out.',
  trustedDeviceYesBtn: 'Yes, trusted device',
  trustedDeviceNoBtn: 'No, shared device',
} as const;

export const STRINGS = { nl, en } as const;

export type StringKey = keyof typeof nl;

export function isValidLang(value: unknown): value is Lang {
  return value === 'nl' || value === 'en';
}

export function translate(lang: Lang, key: StringKey): string {
  return STRINGS[lang][key];
}
