/**
 * Thema (donker/licht) van de app. Donker is de standaard (v1-look); licht is
 * een kiesbare modus via `data-theme="light"` op <html> (zie styles/tokens.css).
 * De keuze staat bewust alleen lokaal op dit toestel (nieuwe, eigen key; geen
 * bestaande key of gebruikersdata geraakt) en is geen persoonsgegeven: een
 * onbeschikbare of falende storage valt stil terug op de standaard.
 */
export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'lineup-tracker-v2-theme';

export function parseTheme(raw: string | null | undefined): Theme {
  return raw === 'light' ? 'light' : 'dark';
}

export function readStoredTheme(): Theme {
  try {
    return parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Onbeschikbare storage: het thema geldt dan alleen voor deze sessie.
  }
}
