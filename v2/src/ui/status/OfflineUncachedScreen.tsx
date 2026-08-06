import { translate, type Lang } from '../../i18n/strings';

export interface OfflineUncachedScreenProps {
  lang: Lang;
}

/** Getoond bij een eerste login of ongecachete context zonder netwerk — vraagt expliciet om verbinding. */
export function OfflineUncachedScreen({ lang }: OfflineUncachedScreenProps) {
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">{translate(lang, 'stateUncachedOfflineTitle')}</h1>
      </header>
      <main className="app-main">
        <p data-testid="uncached-offline-body">{translate(lang, 'stateUncachedOfflineBody')}</p>
      </main>
    </div>
  );
}
