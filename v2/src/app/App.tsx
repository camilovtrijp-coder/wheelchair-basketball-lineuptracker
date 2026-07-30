import { useEffect, useState } from 'preact/hooks';

const STRINGS = {
  nl: {
    heading: 'v2 leeg',
    note: 'Scaffold voor Preact + TypeScript + Vite.',
    switchToEn: 'Schakel naar Engels',
    switchToNl: 'Schakel naar Nederlands',
  },
  en: {
    heading: 'v2 empty',
    note: 'Scaffold for Preact + TypeScript + Vite.',
    switchToEn: 'Switch to English',
    switchToNl: 'Switch to Dutch',
  },
} as const;

type Lang = keyof typeof STRINGS;

function detectInitialLang(): Lang {
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en')) {
    return 'en';
  }
  return 'nl';
}

export function App() {
  const [lang, setLang] = useState<Lang>(detectInitialLang());
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const t = STRINGS[lang];
  const other: Lang = lang === 'nl' ? 'en' : 'nl';
  return (
    <main>
      <h1>{t.heading}</h1>
      <p>{t.note}</p>
      <button
        type="button"
        aria-label={other === 'en' ? t.switchToEn : t.switchToNl}
        onClick={() => setLang(other)}
      >
        {other.toUpperCase()}
      </button>
    </main>
  );
}
