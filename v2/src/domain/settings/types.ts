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
  accentColor: '#f97316',
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
