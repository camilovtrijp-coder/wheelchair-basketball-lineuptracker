import { DEFAULT_LANG, type Lang, isValidLang } from './strings';

export function detectInitialLang(navigatorLanguage?: string): Lang {
  if (navigatorLanguage && navigatorLanguage.toLowerCase().startsWith('en')) {
    return 'en';
  }
  return DEFAULT_LANG;
}

export function resolveInitialLang(navigatorLanguage: string | undefined, stored: unknown): Lang {
  if (isValidLang(stored)) {
    return stored;
  }
  return detectInitialLang(navigatorLanguage);
}
