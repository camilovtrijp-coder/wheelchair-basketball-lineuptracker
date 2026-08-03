export const LANG_STORAGE_KEY = 'lineup-tracker-lang';

export const SUPPORTED_LANGS = ['nl', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

export const DEFAULT_LANG: Lang = 'nl';

const nl = {
  appHeading: 'v2 leeg',
  appNote: 'Scaffold voor Preact + TypeScript + Vite.',
  switchToEn: 'Schakel naar Engels',
  switchToNl: 'Schakel naar Nederlands',
} as const;

const en = {
  appHeading: 'v2 empty',
  appNote: 'Scaffold for Preact + TypeScript + Vite.',
  switchToEn: 'Switch to English',
  switchToNl: 'Switch to Dutch',
} as const;

export const STRINGS = { nl, en } as const;

export type StringKey = keyof typeof nl;

export function isValidLang(value: unknown): value is Lang {
  return value === 'nl' || value === 'en';
}

export function translate(lang: Lang, key: StringKey): string {
  return STRINGS[lang][key];
}
