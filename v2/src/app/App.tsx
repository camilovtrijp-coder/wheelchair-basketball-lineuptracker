import { useEffect, useState } from 'preact/hooks';
import { browserStorage } from '../i18n/browserStorage';
import { readLang, writeLang } from '../i18n/persistence';
import { resolveInitialLang, detectInitialLang } from '../i18n/detect';
import { SUPPORTED_LANGS, translate, type Lang, type StringKey } from '../i18n/strings';

function initialLang(): Lang {
  const stored = readLang(browserStorage);
  return resolveInitialLang(
    typeof navigator !== 'undefined' ? navigator.language : undefined,
    stored,
  );
}

function tFor(lang: Lang): (key: StringKey) => string {
  return (key) => translate(lang, key);
}

export function App() {
  const [lang, setLang] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    writeLang(browserStorage, lang);
  }, [lang]);

  const t = tFor(lang);
  const other: Lang = lang === SUPPORTED_LANGS[0] ? SUPPORTED_LANGS[1] : SUPPORTED_LANGS[0];
  const otherLabel = t(other === 'en' ? 'switchToEn' : 'switchToNl');

  return (
    <main>
      <h1>{t('appHeading')}</h1>
      <p>{t('appNote')}</p>
      <button
        type="button"
        aria-label={otherLabel}
        data-testid="lang-switch"
        onClick={() => setLang(other)}
      >
        {other.toUpperCase()}
      </button>
    </main>
  );
}

export { detectInitialLang };
