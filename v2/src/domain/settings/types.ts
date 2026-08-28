export const SETTINGS_STORAGE_KEY = 'lineup-tracker-settings';

export interface Settings {
  teamName: string;
  logoUri: string;
  primaryColor: string;
  accentColor: string;
  quarterCount: number;
  periodLabel: string;
  useClassLimit: boolean;
  tag1Label: string;
  tag2Label: string;
  classBaseLimit: number;
  maxBonus: number;
  bonusTag1Only: number;
  bonusTag2Only: number;
  bonusBoth: number;
}

export const SETTINGS_KEYS = [
  'teamName',
  'logoUri',
  'primaryColor',
  'accentColor',
  'quarterCount',
  'periodLabel',
  'useClassLimit',
  'tag1Label',
  'tag2Label',
  'classBaseLimit',
  'maxBonus',
  'bonusTag1Only',
  'bonusTag2Only',
  'bonusBoth',
] as const satisfies ReadonlyArray<keyof Settings>;

export const SETTINGS_BOOLEAN_KEYS = ['useClassLimit'] as const satisfies ReadonlyArray<
  keyof Settings
>;

export const SETTINGS_NUMBER_KEYS = [
  'quarterCount',
  'classBaseLimit',
  'maxBonus',
  'bonusTag1Only',
  'bonusTag2Only',
  'bonusBoth',
] as const satisfies ReadonlyArray<keyof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  teamName: '',
  logoUri: '',
  primaryColor: '#2563eb',
  // PR 8.2b (bug 10, docs/pr-5.5c-bugfixes.md #10): vóór deze PR had
  // `accentColor` geen enkel visueel effect, dus een zwakke defaultkleur
  // was onopgemerkt gebleven. Nu `accentColor` daadwerkelijk als
  // `.app-title`-tekstkleur gerenderd wordt (index.css/App.tsx), moet de
  // default zelf de bestaande axe-core-runtime-a11y-baseline
  // (a11y-axe.spec.ts, PR 8.2a) halen: `#f97316` gaf slechts 2.68:1 tegen
  // de headerachtergrond (#f9fafb), ruim onder de AA-tekstdrempel van
  // 4.5:1 — `#c2410c` (~4.96:1) is dezelfde oranje familie, met genoeg
  // contrast.
  accentColor: '#c2410c',
  quarterCount: 4,
  periodLabel: '',
  useClassLimit: false,
  tag1Label: '',
  tag2Label: '',
  classBaseLimit: 14.5,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1.0,
  bonusBoth: 2.0,
};

export const QUARTER_COUNT_MIN = 1;
export const QUARTER_COUNT_MAX = 12;

/** Bovengrens voor een geüploade logo-afbeelding, vóór base64-encodering. */
export const LOGO_MAX_BYTES = 500 * 1024;

export type SettingsKey = (typeof SETTINGS_KEYS)[number];
export type SettingsBooleanKey = (typeof SETTINGS_BOOLEAN_KEYS)[number];
export type SettingsNumberKey = (typeof SETTINGS_NUMBER_KEYS)[number];
